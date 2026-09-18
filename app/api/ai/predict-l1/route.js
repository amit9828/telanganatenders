import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/db';
import { parseAIJson } from '@/lib/ai-extraction';
import { estimateTenderValue, parseIndianAmount } from '@/lib/matchmaking';
import {
  HISTORICAL_COLLECTION,
  summariseBaseline,
  titleKeywords,
} from '@/lib/historical-l1';
import { getGeminiApiKey } from '@/lib/env';
import { publicAiError } from '@/lib/gemini';
import { DESIGNATIONS, resolveActorRole } from '@/lib/staff-auth';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MAX_HISTORY = 40;

const SYSTEM_PROMPT = `
You are a Senior Bid Strategist for Indian government e-procurement (GeM and state
e-procurement portals). You advise a tender consultancy on competitive pricing.

You will be given: the tender under consideration, a curated L1 Benchmark Repository of
verified past award outcomes, and historical L1 (lowest bidder) outcomes recorded by this
consultancy against its own tracked bids.

The L1 Benchmark Repository is the authoritative baseline. Where it and the consultancy's
own records disagree, anchor on the repository and treat the consultancy records as
supporting evidence.

Return STRICTLY a single JSON object in this exact shape, and nothing else:

{
  "likely_competitors": [
    { "name": "firm name", "wins_observed": 0, "typical_behaviour": "one short line" }
  ],
  "suggested_l1_percentage": 0.0,
  "suggested_quote_inr": 0,
  "confidence": "high | medium | low",
  "rationale": "2-4 sentences explaining the recommendation",
  "jv_recommendation": "one line, or 'Not required'",
  "risks": ["short risk statements"]
}

Rules:
- Name competitors ONLY if they appear in the historical data. Never invent firm names.
  If the history names no competitors, return an empty array.
- suggested_l1_percentage is the discount below the estimated value, as a percentage
  (e.g. 7.5 means quote 7.5% below the estimated contract value).
- suggested_quote_inr must be consistent with that percentage and the estimated value.
  If no estimated value is available, return 0 and say so in the rationale.
- Set confidence to "low" when the repository and consultancy records together give fewer
  than 3 comparable outcomes, and say plainly in the rationale that the sample is thin.
  Only use "high" when the repository match scope is "category".
- Never recommend a discount so deep it would be commercially unviable; if the history
  shows aggressive undercutting, flag it as a risk instead.
- Output raw JSON only. No markdown fences, no commentary.
`;

function tenderFilters(tenderId) {
  const filters = [];
  if (ObjectId.isValid(tenderId)) {
    try { filters.push({ _id: new ObjectId(tenderId) }); } catch { /* not an ObjectId */ }
  }
  filters.push({ _id: tenderId }, { id: tenderId }, { bid_no: tenderId });
  return filters;
}

async function loadTender(db, tenderId) {
  const projection = {
    projection: {
      bid_no: 1, title: 1, department: 1, last_date: 1, district: 1,
      category: 1, emd_amount: 1, supply_details: 1, estimated_value: 1,
      l1_price: 1, l1_winner: 1,
    },
  };
  for (const filter of tenderFilters(tenderId)) {
    const tender = await db.collection('tenders').findOne(filter, projection);
    if (tender) return tender;
  }
  return null;
}

/**
 * Reads category-specific baselines out of the L1 Benchmark Repository — past award
 * outcomes ingested by staff, which are far more reliable than our own thin bid history.
 *
 * Widens the search in stages so a prediction is never starved of context: exact category
 * first, then title keywords and department, then the overall repository average.
 */
async function loadBenchmarks(db, tender) {
  const collection = db.collection(HISTORICAL_COLLECTION);
  const projection = {
    projection: {
      tender_title: 1, department: 1, category: 1, l1_price: 1,
      estimate_value: 1, discount_pct: 1, winner_name: 1, award_year: 1,
    },
  };

  const attempts = [];
  if (tender.category) attempts.push({ scope: 'category', filter: { category: { $regex: escapeRegex(tender.category), $options: 'i' } } });

  const keywords = titleKeywords(tender.title);
  const broadClauses = [];
  if (tender.department) broadClauses.push({ department: { $regex: escapeRegex(tender.department), $options: 'i' } });
  keywords.forEach((kw) => broadClauses.push({ tender_title: { $regex: escapeRegex(kw), $options: 'i' } }));
  if (broadClauses.length > 0) attempts.push({ scope: 'similar_work', filter: { $or: broadClauses } });

  attempts.push({ scope: 'all_categories', filter: {} });

  for (const { scope, filter } of attempts) {
    const records = await collection.find(filter, projection)
      .sort({ award_year: -1, created_at: -1 })
      .limit(MAX_HISTORY)
      .toArray();

    // A single record is not a baseline; keep widening rather than anchoring on noise.
    if (records.length >= 2 || (records.length > 0 && scope === 'all_categories')) {
      return { scope, records, baseline: summariseBaseline(records) };
    }
  }

  return { scope: 'none', records: [], baseline: summariseBaseline([]) };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Pulls comparable historical outcomes from both places L1 intel is recorded:
 * `tenders.l1_price` (captured by the L1 Intel widget) and `bids` (captured when a
 * tracked bid is marked Lost or Won).
 */
async function loadHistory(db, tender) {
  // Match on category plus meaningful title words — department alone is too broad and
  // exact title matches would almost never hit.
  const keywords = String(tender.title || '')
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w.length > 4)
    .slice(0, 6);

  const similarityClauses = [];
  if (tender.category) similarityClauses.push({ category: tender.category });
  if (tender.department) similarityClauses.push({ department: tender.department });
  keywords.forEach((kw) => similarityClauses.push({ title: { $regex: kw, $options: 'i' } }));

  const [comparableTenders, historicalBids] = await Promise.all([
    db.collection('tenders')
      .find(
        {
          l1_price: { $exists: true, $nin: [null, ''] },
          _id: { $ne: tender._id },
          ...(similarityClauses.length > 0 ? { $or: similarityClauses } : {}),
        },
        {
          projection: {
            title: 1, department: 1, category: 1, district: 1,
            emd_amount: 1, estimated_value: 1, l1_price: 1, l1_winner: 1, last_date: 1,
          },
        }
      )
      .sort({ last_date: -1 })
      .limit(MAX_HISTORY)
      .toArray(),
    db.collection('bids')
      .find(
        { $or: [{ l1_price: { $exists: true, $nin: [null, ''] } }, { status: 'Won' }] },
        {
          projection: {
            bid_no: 1, description: 1, status: 1, contract_value: 1,
            l1_price: 1, l1_winner: 1, created_at: 1,
          },
        }
      )
      .sort({ created_at: -1 })
      .limit(MAX_HISTORY)
      .toArray(),
  ]);

  return { comparableTenders, historicalBids };
}

/**
 * Computes the arithmetic the model should not be asked to do. Giving Gemini pre-computed
 * margins keeps it from mis-adding numbers and makes the output reproducible.
 */
function summariseHistory({ comparableTenders, historicalBids }) {
  const margins = [];
  const competitorWins = new Map();

  const noteWinner = (name) => {
    const clean = String(name || '').trim();
    if (!clean || /^n\/?a$/i.test(clean)) return;
    competitorWins.set(clean, (competitorWins.get(clean) || 0) + 1);
  };

  for (const t of comparableTenders) {
    const l1 = parseIndianAmount(t.l1_price);
    const estimated = estimateTenderValue(t);
    if (l1 && estimated) {
      const marginPct = ((estimated - l1) / estimated) * 100;
      // Clamp to a sane band; anything outside it means the EMD-derived estimate was
      // wrong for that record and would poison the average.
      if (marginPct > -50 && marginPct < 80) margins.push(Number(marginPct.toFixed(2)));
    }
    noteWinner(t.l1_winner);
  }

  for (const b of historicalBids) {
    noteWinner(b.l1_winner);
  }

  const sorted = [...margins].sort((a, b) => a - b);
  const average = margins.length
    ? Number((margins.reduce((s, m) => s + m, 0) / margins.length).toFixed(2))
    : null;
  const median = sorted.length
    ? Number(sorted[Math.floor(sorted.length / 2)].toFixed(2))
    : null;

  return {
    comparable_records: comparableTenders.length,
    bid_records: historicalBids.length,
    observed_margins_pct: sorted,
    average_margin_pct: average,
    median_margin_pct: median,
    competitors: [...competitorWins.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, wins]) => ({ name, wins_observed: wins })),
  };
}

async function isAuthorised(request) {
  const adminToken = String(process.env.ADMIN_TOKEN || '').trim();
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (adminToken && bearer === adminToken) return true;
  const actor = await resolveActorRole(request);
  if (actor.role === 'MD' || actor.designation === DESIGNATIONS.GM) return true;
  if (!adminToken) return true;
  return false;
}

export async function POST(request) {
  try {
    if (!(await isAuthorised(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const geminiApiKey = getGeminiApiKey();
    if (!geminiApiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not configured on this server.' }, { status: 500 });
    }

    const body = await request.json().catch(() => null);
    const tenderId = body?.tender_id ? String(body.tender_id) : null;
    if (!tenderId && !body?.tender) {
      return NextResponse.json(
        { error: 'Provide either tender_id or a tender object.' },
        { status: 400 }
      );
    }

    const db = await getDb();

    // Accept an inline tender for tenders not yet published (e.g. a draft under review).
    const tender = tenderId ? await loadTender(db, tenderId) : { ...body.tender, _id: null };
    if (!tender) {
      return NextResponse.json({ error: 'That tender could not be found.' }, { status: 404 });
    }

    const [history, benchmarks] = await Promise.all([
      loadHistory(db, tender),
      loadBenchmarks(db, tender).catch((err) => {
        // A missing or empty repository must not block a prediction.
        console.warn('[predict-l1] benchmark lookup failed:', err?.message || err);
        return { scope: 'none', records: [], baseline: summariseBaseline([]) };
      }),
    ]);
    const stats = summariseHistory(history);
    const estimatedValue = estimateTenderValue(tender);

    const prompt =
      `${SYSTEM_PROMPT}\n\n` +
      `TENDER UNDER CONSIDERATION\n` +
      `Bid No: ${tender.bid_no || 'n/a'}\n` +
      `Title: ${tender.title || 'n/a'}\n` +
      `Department: ${tender.department || 'n/a'}\n` +
      `District: ${tender.district || 'n/a'}\n` +
      `Category: ${tender.category || 'n/a'}\n` +
      `EMD: ${tender.emd_amount || 'n/a'}\n` +
      `Estimated contract value (INR, derived from EMD at the standard 2% convention ` +
      `unless stated): ${estimatedValue ?? 'unknown'}\n` +
      `Closing date: ${tender.last_date || 'n/a'}\n` +
      (tender.supply_details ? `Supply details: ${tender.supply_details}\n` : '') +
      `\nL1 BENCHMARK REPOSITORY (authoritative — match scope: ${benchmarks.scope})\n` +
      `${JSON.stringify(benchmarks.baseline, null, 2)}\n\n` +
      `BENCHMARK RECORDS\n` +
      `${JSON.stringify(
        benchmarks.records.map((r) => ({
          title: r.tender_title, department: r.department, category: r.category,
          estimate_value: r.estimate_value, l1_price: r.l1_price,
          discount_pct: r.discount_pct, winner: r.winner_name, year: r.award_year,
        })),
        null,
        2
      )}\n` +
      `\nHISTORICAL L1 DATA RECORDED BY THIS CONSULTANCY\n` +
      `${JSON.stringify(stats, null, 2)}\n\n` +
      `RAW COMPARABLE RECORDS\n` +
      `${JSON.stringify(
        history.comparableTenders.map((t) => ({
          title: t.title, category: t.category, department: t.department,
          emd_amount: t.emd_amount, l1_price: t.l1_price, l1_winner: t.l1_winner,
        })),
        null,
        2
      )}\n`;

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    // 🚀 FIX: Google retired gemini-1.5-flash; the new GEMINI_API_KEY's account
    // is not entitled to gemini-2.5-flash either ("no longer available to new
    // users") — Google's own error response points to this model instead.
    const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

    let prediction;
    try {
      const result = await model.generateContent(prompt);
      prediction = parseAIJson(result.response.text());
    } catch (aiError) {
      console.error('[predict-l1] Gemini call failed:', aiError?.message || aiError);
      const safe = publicAiError(aiError);
      return NextResponse.json({ error: safe.message }, { status: safe.status });
    }

    if (!prediction) {
      return NextResponse.json(
        { error: 'The AI returned a response that was not valid JSON. Please retry.' },
        { status: 502 }
      );
    }

    // Normalise so the UI can render without defensive checks on every field.
    const suggestedPct = Number(prediction.suggested_l1_percentage);
    const normalised = {
      likely_competitors: Array.isArray(prediction.likely_competitors)
        ? prediction.likely_competitors.slice(0, 8).map((c) => ({
            name: String(c?.name || 'Unnamed'),
            wins_observed: Number(c?.wins_observed) || 0,
            typical_behaviour: String(c?.typical_behaviour || ''),
          }))
        : [],
      suggested_l1_percentage: Number.isFinite(suggestedPct) ? suggestedPct : null,
      suggested_quote_inr: Number(prediction.suggested_quote_inr) || null,
      confidence: ['high', 'medium', 'low'].includes(String(prediction.confidence).toLowerCase())
        ? String(prediction.confidence).toLowerCase()
        : 'low',
      rationale: String(prediction.rationale || ''),
      jv_recommendation: String(prediction.jv_recommendation || 'Not required'),
      risks: Array.isArray(prediction.risks) ? prediction.risks.map(String).slice(0, 6) : [],
    };

    return NextResponse.json({
      success: true,
      tender: {
        id: tender._id ? String(tender._id) : null,
        bid_no: tender.bid_no || null,
        title: tender.title || null,
        estimated_value: estimatedValue,
      },
      history: stats,
      benchmarks: {
        // Which slice of the repository backed this call, so the MD can judge how much
        // weight the recommendation deserves.
        scope: benchmarks.scope,
        ...benchmarks.baseline,
      },
      prediction: normalised,
    });
  } catch (error) {
    console.error('[predict-l1] fatal error:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

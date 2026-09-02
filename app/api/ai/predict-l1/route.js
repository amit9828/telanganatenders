import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/db';
import { parseAIJson } from '@/lib/ai-extraction';
import { estimateTenderValue, parseIndianAmount } from '@/lib/matchmaking';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MAX_HISTORY = 40;

const SYSTEM_PROMPT = `
You are a Senior Bid Strategist for Indian government e-procurement (GeM and state
e-procurement portals). You advise a tender consultancy on competitive pricing.

You will be given: the tender under consideration, and historical L1 (lowest bidder)
outcomes recorded by this consultancy for comparable tenders.

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
- Set confidence to "low" when there are fewer than 3 comparable historical records, and
  say plainly in the rationale that the sample is thin.
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

function isAuthorised(request) {
  const adminToken = String(process.env.ADMIN_TOKEN || '').trim();
  if (!adminToken) return true; // Nothing configured to check against (local dev).
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return bearer === adminToken;
}

export async function POST(request) {
  try {
    if (!isAuthorised(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!process.env.GEMINI_API_KEY) {
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

    const history = await loadHistory(db, tender);
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

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    let prediction;
    try {
      const result = await model.generateContent(prompt);
      prediction = parseAIJson(result.response.text());
    } catch (aiError) {
      console.error('[predict-l1] Gemini call failed:', aiError?.message || aiError);
      return NextResponse.json(
        { error: `The AI service did not respond: ${aiError?.message || 'unknown error'}` },
        { status: 502 }
      );
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
      prediction: normalised,
    });
  } catch (error) {
    console.error('[predict-l1] fatal error:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

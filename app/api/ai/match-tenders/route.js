import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/staff-auth';
import { isTelanganaOrAndhra } from '@/lib/regions';
import {
  buildMatches,
  clientCapacity,
  estimateTenderValue,
  explainEmptyRun,
} from '@/lib/matchmaking';
import {
  HISTORICAL_COLLECTION,
  summariseBaseline,
  titleKeywords,
} from '@/lib/historical-l1';
import { liveTenderQuery } from '@/lib/tender-expiry';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MAX_TENDERS = 300;
const SUGGESTED_MATCHES_COLLECTION = 'suggested_bid_matches';

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function loadCapacities(db) {
  const rows = await db.collection('bids').aggregate([
    { $match: { status: 'Won' } },
    { $group: { _id: '$client_email', bids: { $push: { contract_value: '$contract_value' } } } },
  ]).toArray();

  const capacities = new Map();
  for (const row of rows) {
    if (!row._id) continue;
    capacities.set(String(row._id).toLowerCase(), clientCapacity(row.bids));
  }
  return capacities;
}

/**
 * Category-first L1 discount from the historical vault. Falls back to overall median.
 * Never invents a figure when the vault is empty.
 */
async function loadDiscountHint(db, tender) {
  const collection = db.collection(HISTORICAL_COLLECTION);
  const attempts = [];
  if (tender.category) {
    attempts.push({ category: { $regex: escapeRegex(tender.category), $options: 'i' } });
  }
  const keywords = titleKeywords(tender.title);
  if (keywords.length > 0) {
    attempts.push({ $or: keywords.map((kw) => ({ tender_title: { $regex: escapeRegex(kw), $options: 'i' } })) });
  }
  attempts.push({});

  for (const filter of attempts) {
    const records = await collection.find(filter, {
      projection: { discount_pct: 1, l1_price: 1, estimate_value: 1, winner_name: 1 },
    }).limit(40).toArray();
    const baseline = summariseBaseline(records);
    if (baseline.median_discount_pct != null) return baseline;
  }
  return summariseBaseline([]);
}

function applyQuote(match, tender, baseline) {
  const estimated = estimateTenderValue(tender) || match.estimated_value || null;
  const discount = baseline.median_discount_pct;
  let suggested_quote = null;
  if (estimated && discount != null) {
    suggested_quote = Math.round(estimated * (1 - discount / 100));
  }
  return {
    suggested_quote,
    l1_discount_pct: discount,
    strategy_notes: [
      ...(match.reasons || []),
      discount != null
        ? `Historical L1 median discount in comparable awards: ${discount}% below estimate.`
        : 'No historical L1 baseline yet — upload past awards into the L1 Benchmark Repository.',
      match.match_type === 'JV' && match.jv_partner
        ? `JV recommended with ${match.jv_partner.company_name} to clear the turnover bar.`
        : null,
    ].filter(Boolean),
  };
}

function shapeMatch(raw, tenderById, clientByEmail, quoteMeta) {
  const tender = tenderById.get(raw.tender_id) || {};
  const client = clientByEmail.get(raw.client_email) || {};
  return {
    match_id: raw._id ? String(raw._id) : `${raw.tender_id}:${raw.client_email}`,
    tender: {
      id: raw.tender_id,
      bid_no: raw.tender_bid_no || tender.bid_no || null,
      title: raw.tender_title || tender.title || 'Untitled tender',
      department: raw.tender_department || tender.department || null,
      last_date: raw.tender_last_date || tender.last_date || null,
      district: raw.tender_district || tender.district || null,
      category: tender.category || null,
      pdf_url: tender.pdf_url || null,
      estimated_value: raw.estimated_value || estimateTenderValue(tender),
    },
    client: {
      id: client._id ? String(client._id) : raw.client_email,
      name: client.client_name || client.name || null,
      company_name: raw.client_company || client.company_name || raw.client_email,
      phone: client.phone || null,
      email: raw.client_email,
      whatsapp_verified: client.whatsapp_verified === true,
      service_category: client.service_category || null,
    },
    match_score: raw.confidence,
    match_type: raw.match_type || 'DIRECT',
    match_reasons: raw.reasons || [],
    category_hits: raw.category_hits || [],
    jv_partner: raw.jv_partner || null,
    suggested_quote: quoteMeta.suggested_quote,
    l1_discount_pct: quoteMeta.l1_discount_pct,
    strategy_notes: quoteMeta.strategy_notes,
    alert_sent_at: raw.alert_sent_at || null,
    status: raw.status || 'new',
  };
}

// GET: return previously persisted suggested matches (no recompute, no WhatsApp).
export async function GET(request) {
  const auth = await requireStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = await getDb();
    const rows = await db.collection(SUGGESTED_MATCHES_COLLECTION)
      .find({ status: { $ne: 'dismissed' } })
      .sort({ match_score: -1, created_at: -1 })
      .limit(200)
      .toArray();

    const tenderIds = [...new Set(rows.map((r) => r.tender_id).filter(Boolean))];
    const emails = [...new Set(rows.map((r) => r.client_email).filter(Boolean))];

    const tenderObjectIds = tenderIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));

    const [tenders, clients] = await Promise.all([
      tenderObjectIds.length
        ? db.collection('tenders').find({ _id: { $in: tenderObjectIds } }).toArray()
        : [],
      emails.length
        ? db.collection('users').find({ email: { $in: emails } }, {
          projection: {
            email: 1, client_name: 1, name: 1, company_name: 1, phone: 1,
            whatsapp_verified: 1, service_category: 1,
          },
        }).toArray()
        : [],
    ]);

    const tenderById = new Map(tenders.map((t) => [String(t._id), t]));
    const clientByEmail = new Map(clients.map((c) => [String(c.email).toLowerCase(), c]));

    const matches = rows.map((row) => shapeMatch(
      row,
      tenderById,
      clientByEmail,
      {
        suggested_quote: row.suggested_quote ?? null,
        l1_discount_pct: row.l1_discount_pct ?? null,
        strategy_notes: row.strategy_notes || row.reasons || [],
      },
    ));

    return NextResponse.json({
      success: true,
      matches,
      summary: {
        total: matches.length,
        alerts_sent: matches.filter((m) => m.alert_sent_at).length,
      },
    });
  } catch (error) {
    console.error('[match-tenders] GET failed:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

// POST: recompute matches on demand. Never sends WhatsApp — that is a separate staff action.
export async function POST(request) {
  const auth = await requireStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = await getDb();

    const [candidateTenders, clients, capacities] = await Promise.all([
      db.collection('tenders')
        .find(
          liveTenderQuery(),
          {
            projection: {
              bid_no: 1, title: 1, department: 1, last_date: 1, district: 1,
              category: 1, emd_amount: 1, supply_details: 1, estimated_value: 1,
              pdf_url: 1, pdf_r2_key: 1, created_at: 1,
            },
          },
        )
        .sort({ created_at: -1 })
        .limit(MAX_TENDERS)
        .toArray(),
      db.collection('users')
        .find(
          { is_approved: true },
          {
            projection: {
              email: 1, client_name: 1, name: 1, company_name: 1, company_type: 1,
              phone: 1, whatsapp_verified: 1, service_category: 1, address: 1,
              district: 1, documents: 1, gstin: 1, udyam: 1, has_gst: 1, has_iso: 1,
            },
          },
        )
        .toArray(),
      loadCapacities(db),
    ]);

    const tenders = candidateTenders.filter(isTelanganaOrAndhra);
    const normalisedClients = clients
      .filter((c) => c.email)
      .map((c) => ({ ...c, email: String(c.email).toLowerCase() }));

    const { matches: rawMatches, diagnostics } = buildMatches(tenders, normalisedClients, capacities);

    const tenderById = new Map(tenders.map((t) => [String(t._id), t]));
    const clientByEmail = new Map(normalisedClients.map((c) => [c.email, c]));

    // Cache baseline lookups per tender so we don't re-query for every client pair.
    const baselineCache = new Map();
    const shaped = [];

    for (const raw of rawMatches) {
      const tender = tenderById.get(raw.tender_id) || {};
      if (!baselineCache.has(raw.tender_id)) {
        baselineCache.set(raw.tender_id, await loadDiscountHint(db, tender));
      }
      const quoteMeta = applyQuote(raw, tender, baselineCache.get(raw.tender_id));

      const filter = { tender_id: raw.tender_id, client_email: raw.client_email };
      const existing = await db.collection(SUGGESTED_MATCHES_COLLECTION).findOne(filter, {
        projection: { _id: 1, alert_sent_at: 1, status: 1 },
      });

      const doc = {
        ...raw,
        suggested_quote: quoteMeta.suggested_quote,
        l1_discount_pct: quoteMeta.l1_discount_pct,
        strategy_notes: quoteMeta.strategy_notes,
        match_score: raw.confidence,
        updated_at: new Date(),
        computed_by: auth.email || auth.actor,
      };

      const result = await db.collection(SUGGESTED_MATCHES_COLLECTION).updateOne(
        filter,
        {
          $set: doc,
          $setOnInsert: {
            created_at: new Date(),
            status: 'new',
            alert_sent_at: null,
          },
        },
        { upsert: true },
      );

      const storedId = result.upsertedId
        ? String(result.upsertedId)
        : (existing?._id ? String(existing._id) : `${raw.tender_id}:${raw.client_email}`);

      shaped.push(shapeMatch(
        {
          ...doc,
          _id: storedId,
          alert_sent_at: existing?.alert_sent_at || null,
          status: existing?.status || 'new',
        },
        tenderById,
        clientByEmail,
        quoteMeta,
      ));
    }

    const explanation = shaped.length === 0
      ? explainEmptyRun(diagnostics, {
        tendersInScope: tenders.length,
        clientCount: normalisedClients.length,
      })
      : null;

    return NextResponse.json({
      success: true,
      matches: shaped,
      explanation,
      stats: {
        tenders_scanned: candidateTenders.length,
        tenders_in_ts_ap: tenders.length,
        approved_clients: normalisedClients.length,
        matches_found: shaped.length,
      },
      // Explicit: matching never dispatches WhatsApp. Staff must click Send Alert.
      whatsapp: { automatic: false },
    });
  } catch (error) {
    console.error('[match-tenders] POST failed:', error);
    return NextResponse.json({ error: error?.message || 'Matching failed' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { isTelanganaOrAndhra } from '@/lib/regions';
import { buildMatches, clientCapacity, explainEmptyRun, formatMatchDigest } from '@/lib/matchmaking';
import { sendWhatsAppAlert } from '@/lib/whatsapp';
import { DESIGNATIONS, resolveActorRole } from '@/lib/staff-auth';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// "Safe" matchmaker: it only ever writes to its own `bid_matches` collection and sends a
// notification. It never touches tenders, users or bids, so a bad run can be cleared by
// deleting the day's matches — no business data is at risk.
const MAX_TENDERS_PER_RUN = 300;
const MAX_ALERT_MATCHES = 5;
// Only look at tenders published recently. Without this the first run would alert on the
// entire historical backlog.
const LOOKBACK_DAYS = 3;

async function isAuthorised(request) {
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const adminToken = String(process.env.ADMIN_TOKEN || '').trim();

  if (cronSecret && bearer === cronSecret) return true;
  if (adminToken && bearer === adminToken) return true;
  const actor = await resolveActorRole(request);
  return actor.role === 'MD' || actor.designation === DESIGNATIONS.GM;
}

function todayISO() {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString().slice(0, 10);
}

/** Sums each client's won-contract value in one aggregation instead of a query per client. */
async function loadCapacities(db) {
  const rows = await db.collection('bids').aggregate([
    { $match: { status: 'Won' } },
    {
      $group: {
        _id: '$client_email',
        // contract_value is stored as free text ("450000", "4.5 lakhs"), so parse it in
        // JS via clientCapacity rather than trusting $toDouble here.
        bids: { $push: { contract_value: '$contract_value' } },
      },
    },
  ]).toArray();

  const capacities = new Map();
  for (const row of rows) {
    if (!row._id) continue;
    capacities.set(String(row._id).toLowerCase(), clientCapacity(row.bids));
  }
  return capacities;
}

async function runMatchmaker({ dryRun = false, fullScan = false } = {}) {
  const db = await getDb();
  const today = todayISO();

  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);

  const tenderQuery = {
    // Open only — a closed tender cannot be bid on.
    last_date: { $gte: today },
  };
  if (!fullScan) {
    tenderQuery.$or = [
      { created_at: { $gte: since } },
      { created_at: { $exists: false } },
    ];
  }

  const [candidateTenders, clients, capacities] = await Promise.all([
    db.collection('tenders')
      .find(tenderQuery, {
        projection: {
          bid_no: 1, title: 1, department: 1, last_date: 1, district: 1,
          category: 1, emd_amount: 1, supply_details: 1, estimated_value: 1, created_at: 1,
        },
      })
      .sort({ created_at: -1 })
      .limit(MAX_TENDERS_PER_RUN)
      .toArray(),
    db.collection('users')
      .find(
        { is_approved: true },
        {
          projection: {
            email: 1, client_name: 1, company_name: 1, company_type: 1,
            service_category: 1, address: 1, district: 1, documents: 1,
            gstin: 1, udyam: 1, has_gst: 1, has_iso: 1, has_msme: 1,
          },
        }
      )
      .toArray(),
    loadCapacities(db),
  ]);

  // Regional filter. Done in JS because the signal lives across several free-text fields;
  // the candidate set is already capped, so this stays cheap.
  const tenders = candidateTenders.filter(isTelanganaOrAndhra);

  const normalisedClients = clients
    .filter((c) => c.email)
    .map((c) => ({ ...c, email: String(c.email).toLowerCase() }));

  const { matches, diagnostics } = buildMatches(tenders, normalisedClients, capacities);

  const stats = {
    tenders_scanned: candidateTenders.length,
    tenders_in_ts_ap: tenders.length,
    approved_clients: normalisedClients.length,
    matches_found: matches.length,
    jv_opportunities: matches.filter((m) => m.match_type === 'JV').length,
  };

  // An empty result is a legitimate outcome, so say why rather than leaving the MD to
  // guess whether the job is broken.
  const explanation = matches.length === 0
    ? explainEmptyRun(diagnostics, { tendersInScope: tenders.length, clientCount: normalisedClients.length })
    : null;

  if (dryRun) {
    return {
      success: true, dry_run: true, ran_at: new Date().toISOString(),
      stats, diagnostics, explanation, matches,
    };
  }

  // Upsert on (tender, client) so a daily re-run refreshes confidence instead of piling
  // up duplicates, and so a match the MD already dismissed is not resurrected as 'new'.
  let inserted = 0;
  let refreshed = 0;

  for (const match of matches) {
    const filter = { tender_id: match.tender_id, client_email: match.client_email };
    const { created_at, status, ...mutable } = match;

    const result = await db.collection('bid_matches').updateOne(
      filter,
      {
        $set: { ...mutable, updated_at: new Date() },
        $setOnInsert: { created_at, status },
      },
      { upsert: true }
    );

    if (result.upsertedCount > 0) inserted += 1;
    else refreshed += 1;
  }

  // Alert only on genuinely new matches — re-notifying the MD about yesterday's list is
  // how alerting channels get muted.
  const newMatches = inserted > 0
    ? await db.collection('bid_matches')
        .find({ status: 'new' })
        .sort({ confidence: -1 })
        .limit(MAX_ALERT_MATCHES)
        .toArray()
    : [];

  let alert = { sent: false, skipped: true, reason: 'No new matches to report.' };
  if (newMatches.length > 0) {
    const digest = formatMatchDigest(newMatches, { limit: MAX_ALERT_MATCHES });
    // sendWhatsAppAlert never throws, so a messaging outage cannot lose the matches we
    // have already written.
    alert = await sendWhatsAppAlert(process.env.MD_PHONE_NUMBER, digest);
  }

  return {
    success: true,
    ran_at: new Date().toISOString(),
    stats: { ...stats, inserted, refreshed },
    diagnostics,
    explanation,
    alert,
  };
}

export async function GET(request) {
  if (!(await isAuthorised(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const result = await runMatchmaker({
      // ?dry_run=1 previews the matches without writing or notifying.
      dryRun: searchParams.get('dry_run') === '1',
      // ?full_scan=1 ignores the lookback window, for the first run or after a backfill.
      fullScan: searchParams.get('full_scan') === '1',
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[matchmaker] fatal error:', error);
    return NextResponse.json({ error: error?.message || 'Matchmaker run failed' }, { status: 500 });
  }
}

// Vercel Cron issues GET; POST exists so the dashboard can trigger the same job.
export const POST = GET;

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireStaff, isStaffRole } from '@/lib/staff-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const COLLECTION = 'live_scraped_bids';
const MAX_RESULTS = 500;

/** Calendar YYYY-MM-DD in Asia/Kolkata (GeM / buyer timezone). */
function todayIsoIst() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

function normaliseDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return text.slice(0, 32) || null;
}

function normaliseGemBidNo(value) {
  const m = String(value || '').trim().match(/GEM\/(\d{4})\/B\/(\d{5,})/i);
  return m ? `GEM/${m[1]}/B/${m[2]}` : null;
}

async function isAuthorised(request, { allowStaffSession = false } = {}) {
  const adminToken = String(process.env.ADMIN_TOKEN || '').trim();
  const agentToken = String(process.env.GEM_AGENT_TOKEN || process.env.CRON_SECRET || '').trim();
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();

  // Local/dev with nothing configured — allow (matches bid-matches behaviour).
  if (!adminToken && !agentToken) return true;
  if (adminToken && bearer === adminToken) return true;
  if (agentToken && bearer === agentToken) return true;
  if (allowStaffSession) {
    const staff = await requireStaff(request);
    if (staff.ok) return true;
  }
  return false;
}

function buildDoc(payload) {
  const bid_no = normaliseGemBidNo(payload?.bid_no);
  if (!bid_no) return null;

  const keywords = Array.isArray(payload?.matched_keywords)
    ? payload.matched_keywords.map((k) => String(k).trim()).filter(Boolean)
    : [];
  const matched_keyword = String(
    payload?.matched_keyword
      || (keywords.length ? keywords.join(', ') : '')
      || ''
  ).trim();

  const start_date = normaliseDate(payload?.start_date || payload?.published_date);
  const last_date = normaliseDate(payload?.last_date) || '';

  return {
    bid_no,
    title: String(payload?.title || bid_no).trim().slice(0, 500),
    department: String(payload?.department || 'GeM').trim().slice(0, 300),
    district: String(payload?.district || '').trim().slice(0, 120),
    state: String(payload?.state || '').trim().slice(0, 120),
    start_date,
    last_date,
    matched_keyword,
    matched_keywords: keywords.length ? keywords : (matched_keyword ? matched_keyword.split(/,\s*/) : []),
    listing_url: payload?.listing_url || payload?.href || null,
    source: 'gem_live_hunter',
    updated_at: new Date(),
  };
}

/**
 * GET — today's live scraped bids (IST), newest first.
 * Query: ?all=1 to skip the today filter (still sorted newest first).
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const db = await getDb();

    let allowed = await isAuthorised(request, { allowStaffSession: true });
    if (!allowed) {
      const email = String(searchParams.get('email') || '').trim().toLowerCase();
      if (email) {
        const user = await db.collection('users').findOne(
          { email },
          { projection: { role: 1, employee_id: 1 } },
        );
        allowed = Boolean(user && (isStaffRole(user.role) || user.employee_id));
      }
    }
    if (!allowed) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const all = searchParams.get('all') === '1' || searchParams.get('all') === 'true';
    const today = todayIsoIst();
    const col = db.collection(COLLECTION);
    await col.createIndex({ bid_no: 1 }, { unique: true }).catch(() => {});
    await col.createIndex({ start_date: -1, updated_at: -1 }).catch(() => {});

    const query = all
      ? {}
      : {
          $or: [
            { start_date: today },
            // Tolerate accidental DD/MM/YYYY leftovers from older writes.
            { start_date: today.split('-').reverse().join('/') },
            { start_date: today.split('-').reverse().join('-') },
          ],
        };

    const tenders = await col
      .find(query)
      .sort({ updated_at: -1, created_at: -1 })
      .limit(MAX_RESULTS)
      .toArray();

    return NextResponse.json({
      tenders,
      today,
      count: tenders.length,
      filter: all ? 'all' : 'today',
    });
  } catch (error) {
    console.error('[live-feed] GET failed:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

/**
 * POST — upsert text-only bid payload(s) from the local GeM hunter.
 * Body: one object, or { bids: [...] }, or a raw array.
 */
export async function POST(request) {
  try {
    if (!isAuthorised(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'JSON body required.' }, { status: 400 });
    }

    const rows = Array.isArray(body)
      ? body
      : Array.isArray(body.bids)
        ? body.bids
        : [body];

    const docs = rows.map(buildDoc).filter(Boolean);
    if (docs.length === 0) {
      return NextResponse.json(
        { error: 'No valid bids. Each row needs bid_no in GEM/YYYY/B/XXXXXXX form.' },
        { status: 400 }
      );
    }

    const db = await getDb();
    const col = db.collection(COLLECTION);
    await col.createIndex({ bid_no: 1 }, { unique: true }).catch(() => {});

    let inserted = 0;
    let updated = 0;
    const results = [];

    for (const doc of docs) {
      const existing = await col.findOne({ bid_no: doc.bid_no }, { projection: { _id: 1 } });
      if (existing) {
        await col.updateOne({ bid_no: doc.bid_no }, { $set: doc });
        updated += 1;
        results.push({ bid_no: doc.bid_no, status: 'updated' });
      } else {
        await col.insertOne({ ...doc, created_at: new Date() });
        inserted += 1;
        results.push({ bid_no: doc.bid_no, status: 'inserted' });
      }
    }

    return NextResponse.json({
      success: true,
      summary: { inserted, updated, total: docs.length },
      results,
    });
  } catch (error) {
    console.error('[live-feed] POST failed:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

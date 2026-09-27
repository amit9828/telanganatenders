import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
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
export async function GET() {
  return NextResponse.json({ tenders: [], retired: true });
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
        const employee = await db.collection('employees').findOne(
          { email },
          { projection: { emp_id: 1, designation: 1 } },
        );
        allowed = Boolean(
          (user && (isStaffRole(user.role) || user.employee_id))
          || employee
        );
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

    const tenders = (await col
      .find(query)
      .limit(MAX_RESULTS)
      .toArray())
      .filter((t) => {
        const ms = t.last_date ? new Date(t.last_date).getTime() : NaN;
        if (Number.isNaN(ms)) return false;
        return ms >= new Date(`${today}T00:00:00`).getTime();
      })
      .sort((a, b) => {
        const aMs = a.last_date ? new Date(a.last_date).getTime() : Number.POSITIVE_INFINITY;
        const bMs = b.last_date ? new Date(b.last_date).getTime() : Number.POSITIVE_INFINITY;
        return aMs - bMs;
      });

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
export async function POST() {
  return NextResponse.json({ error: 'Live hunting has been removed.' }, { status: 410 });
  try {
    // 🚀 FIX: `isAuthorised` is async — calling it without `await` returned a
    // Promise (always truthy), so `!isAuthorised(...)` was always `false` and this
    // check never actually rejected an unauthenticated POST. Anyone could inject
    // fake bids into live_scraped_bids without a valid token.
    if (!(await isAuthorised(request))) {
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

/**
 * DELETE — manual review cleanup for the Admin/Employee Live Scraped grid.
 * Body: { id: "<mongo _id>" } deletes exactly that row, or
 *       { scope: "unmapped" } bulk-deletes every row that never matched an
 *       approved client's keyword profile (matched_keywords empty/missing).
 * Requires one of the two — refuses anything else so a malformed request can
 * never wipe the whole collection.
 */
export async function DELETE() {
  return NextResponse.json({ error: 'Live hunting has been removed.' }, { status: 410 });
  try {
    if (!(await isAuthorised(request, { allowStaffSession: true }))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const id = String(body?.id || '').trim();
    const scope = String(body?.scope || '').trim().toLowerCase();

    const db = await getDb();
    const col = db.collection(COLLECTION);

    if (id) {
      if (!ObjectId.isValid(id)) {
        return NextResponse.json({ error: 'Invalid id.' }, { status: 400 });
      }
      const result = await col.deleteOne({ _id: new ObjectId(id) });
      if (result.deletedCount === 0) {
        return NextResponse.json({ error: 'That row no longer exists.' }, { status: 404 });
      }
      return NextResponse.json({ success: true, deletedCount: 1 });
    }

    if (scope === 'unmapped') {
      const result = await col.deleteMany({
        $or: [
          { matched_keywords: { $exists: false } },
          { matched_keywords: { $size: 0 } },
        ],
      });
      return NextResponse.json({ success: true, deletedCount: result.deletedCount || 0 });
    }

    return NextResponse.json(
      { error: "Provide either { id } or { scope: 'unmapped' }." },
      { status: 400 },
    );
  } catch (error) {
    console.error('[live-feed] DELETE failed:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

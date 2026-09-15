import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { DESIGNATIONS, resolveActorRole } from '@/lib/staff-auth';

export const dynamic = 'force-dynamic';

const MAX_RESULTS = 200;

async function isAuthorised(request) {
  const adminToken = String(process.env.ADMIN_TOKEN || '').trim();
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (adminToken && bearer === adminToken) return true;
  const actor = await resolveActorRole(request);
  if (actor.role === 'MD' || actor.designation === DESIGNATIONS.GM) return true;
  if (!adminToken) return true;
  return false;
}

function matchFilter(id) {
  return ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
}

// GET: the MD's matchmaker feed. Matches are already denormalised by the cron job, so no
// joins are needed here.
export async function GET(request) {
  try {
    if (!(await isAuthorised(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const type = searchParams.get('type');

    const query = {};
    // Dismissed matches stay in the collection for audit but are hidden by default.
    if (status) query.status = status;
    else query.status = { $ne: 'dismissed' };
    if (type) query.match_type = type;

    const db = await getDb();
    const matches = await db.collection('bid_matches')
      .find(query)
      .sort({ confidence: -1, created_at: -1 })
      .limit(MAX_RESULTS)
      .toArray();

    return NextResponse.json({
      matches,
      summary: {
        total: matches.length,
        new: matches.filter((m) => m.status === 'new').length,
        jv: matches.filter((m) => m.match_type === 'JV').length,
      },
    });
  } catch (error) {
    console.error('[bid-matches] GET failed:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

// PATCH: acknowledge or dismiss a match so the feed reflects what the MD has acted on.
export async function PATCH(request) {
  try {
    if (!(await isAuthorised(request))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const id = body?.id;
    const status = String(body?.status || '').trim();

    if (!id) return NextResponse.json({ error: 'Match id is required.' }, { status: 400 });
    if (!['new', 'reviewed', 'dismissed'].includes(status)) {
      return NextResponse.json(
        { error: "status must be one of 'new', 'reviewed' or 'dismissed'." },
        { status: 400 }
      );
    }

    const db = await getDb();
    const result = await db.collection('bid_matches').updateOne(
      matchFilter(id),
      { $set: { status, updated_at: new Date() } }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'That match no longer exists.' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[bid-matches] PATCH failed:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

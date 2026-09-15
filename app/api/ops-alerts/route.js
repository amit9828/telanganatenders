import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { resolveActorRole } from '@/lib/staff-auth';
import { ensureWorkflowIndexes } from '@/lib/workflow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

export async function GET(request) {
  const actor = await resolveActorRole(request);
  if (!actor.role) return json({ error: 'Please sign in.' }, 401);
  const db = await getDb();
  await ensureWorkflowIndexes(db);
  const recipient = actor.role === 'MD' && request.nextUrl.searchParams.get('all') === '1'
    ? null
    : (actor.empId || actor.email);
  const filter = recipient ? { recipient_emp_id: recipient } : {};
  const alerts = await db.collection('ops_alerts').find(filter).sort({ created_at: -1 }).limit(100).toArray();
  return json({ alerts });
}

export async function PUT(request) {
  const actor = await resolveActorRole(request);
  if (!actor.role) return json({ error: 'Please sign in.' }, 401);
  const body = await request.json().catch(() => ({}));
  const id = body.id;
  if (!id || !ObjectId.isValid(id)) return json({ error: 'Alert id required' }, 400);
  const db = await getDb();
  await db.collection('ops_alerts').updateOne(
    { _id: new ObjectId(id) },
    { $set: { status: 'OK', replied_at: new Date(), replied_by: actor.empId || actor.email } }
  );
  return json({ success: true });
}

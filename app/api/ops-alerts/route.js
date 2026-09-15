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

function actorId(actor) {
  if (actor?.role === 'MD') return 'MD';
  return String(actor?.empId || '').trim();
}

export async function GET(request) {
  const actor = await resolveActorRole(request);
  if (!actor.role) return json({ error: 'Please sign in.' }, 401);
  const me = actorId(actor);
  if (!me) return json({ error: 'Employee ID required.' }, 401);
  const db = await getDb();
  await ensureWorkflowIndexes(db);
  const alerts = await db.collection('ops_alerts').find({
    recipient_emp_id: me,
  }).sort({ created_at: -1 }).limit(100).toArray();
  return json({ alerts });
}

export async function POST(request) {
  const actor = await resolveActorRole(request);
  if (!actor.role) return json({ error: 'Please sign in.' }, 401);
  const from = actorId(actor);
  if (!from) return json({ error: 'Employee ID required.' }, 401);
  const body = await request.json().catch(() => ({}));
  const toEmpId = String(body.to_emp_id || '').trim();
  const message = String(body.message || '').trim();
  if (!toEmpId) return json({ error: 'Select an employee.' }, 400);
  if (!message) return json({ error: 'Message is required.' }, 400);
  if (toEmpId === from) return json({ error: 'Cannot alert yourself.' }, 400);

  const db = await getDb();
  await ensureWorkflowIndexes(db);
  if (toEmpId !== 'MD') {
    const emp = await db.collection('employees').findOne({
      emp_id: toEmpId,
      deleted: { $ne: true },
      active: { $ne: false },
    });
    if (!emp) return json({ error: 'Employee not found.' }, 404);
  }

  const doc = {
    recipient_emp_id: toEmpId,
    from_emp_id: from,
    from_name: actor.role === 'MD' ? (actor.name || 'Managing Director') : (actor.name || from),
    type: 'STAFF',
    message,
    job_id: null,
    status: 'OPEN',
    created_at: new Date(),
  };
  const result = await db.collection('ops_alerts').insertOne(doc);
  return json({ success: true, alert: { ...doc, _id: result.insertedId } }, 201);
}

export async function PUT(request) {
  const actor = await resolveActorRole(request);
  if (!actor.role) return json({ error: 'Please sign in.' }, 401);
  const me = actorId(actor);
  const body = await request.json().catch(() => ({}));
  const id = body.id;
  if (!id || !ObjectId.isValid(id)) return json({ error: 'Alert id required' }, 400);
  const db = await getDb();
  const existing = await db.collection('ops_alerts').findOne({ _id: new ObjectId(id) });
  if (!existing) return json({ error: 'Alert not found' }, 404);
  if (existing.recipient_emp_id !== me) return json({ error: 'Not allowed.' }, 403);
  await db.collection('ops_alerts').deleteOne({ _id: existing._id });
  return json({ success: true, deleted: true });
}

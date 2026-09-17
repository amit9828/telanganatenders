import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveActorRole } from '@/lib/staff-auth';
import { chatSenderId } from '@/lib/staff-chat';
import { ensureUniqueEmpIds } from '@/lib/emp-id';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export async function GET(request) {
  const actor = await resolveActorRole(request);
  if (!actor.role) return json({ error: 'Please sign in.' }, 401);
  const from = chatSenderId(actor);
  if (!from) return json({ error: 'Staff chat requires an Employee ID.' }, 401);

  const db = await getDb();
  await ensureUniqueEmpIds(db);
  const team = await db.collection('employees').find({
    deleted: { $ne: true },
    active: { $ne: false },
  }).project({
    emp_id: 1,
    name: 1,
    email: 1,
    designation: 1,
    role: 1,
  }).sort({ name: 1 }).toArray();

  return json({ me: from, team });
}

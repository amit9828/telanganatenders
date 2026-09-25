import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { resolveActorRole } from '@/lib/staff-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function publicLead(doc) {
  return {
    _id: String(doc._id),
    enterprise_name: doc.enterprise_name || doc.enterprise || '',
    client_name: doc.name || doc.client_name || '',
    phone: doc.phone || '',
    area: doc.area || '',
    query: doc.query || '',
    created_at: doc.created_at || null,
    status: doc.status || 'open',
  };
}

export async function GET(request) {
  const actor = await resolveActorRole(request);
  if (actor.role !== 'MD') return json({ error: 'Only MD can view leads.' }, 403);
  const db = await getDb();
  const docs = await db.collection('guest_queries')
    .find({ status: { $ne: 'closed' } })
    .sort({ created_at: -1 })
    .limit(200)
    .toArray();
  return json({ leads: docs.map(publicLead) });
}

export async function PUT(request) {
  const actor = await resolveActorRole(request);
  if (actor.role !== 'MD') return json({ error: 'Only MD can close leads.' }, 403);
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '');
  if (!ObjectId.isValid(id)) return json({ error: 'Invalid ID' }, 400);
  const db = await getDb();
  const result = await db.collection('guest_queries').updateOne(
    { _id: new ObjectId(id) },
    { $set: { status: 'closed', closed_at: new Date() } },
  );
  if (!result.matchedCount) return json({ error: 'Lead not found' }, 404);
  return json({ success: true });
}

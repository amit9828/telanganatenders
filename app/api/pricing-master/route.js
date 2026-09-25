import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveActorRole, resolveClientEmail } from '@/lib/staff-auth';
import { PRICING_COLLECTION, seedPricingMaster } from '@/lib/billing-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

const PUBLIC_PRICE = { service_key: 1, name: 1, base_price: 1, category: 1, bid_credits: 1, _id: 0 };

export async function GET(request) {
  const actor = await resolveActorRole(request);
  const email = await resolveClientEmail(request);
  const db = await getDb();
  await seedPricingMaster(db);
  const signedIn = Boolean(actor.role || email);
  if (!signedIn) {
    const items = await db.collection(PRICING_COLLECTION).find(
      { is_active: { $ne: false }, individually_purchasable: { $ne: false } },
      { projection: PUBLIC_PRICE },
    ).sort({ category: 1, name: 1 }).toArray();
    return json({ items, canEdit: false });
  }
  const items = await db.collection(PRICING_COLLECTION).find({}).sort({ category: 1, name: 1 }).toArray();
  return json({
    items,
    canEdit: actor.role === 'MD',
  });
}

export async function PUT(request) {
  const actor = await resolveActorRole(request);
  if (actor.role !== 'MD') return json({ error: 'Only MD can edit prices.' }, 403);
  const body = await request.json().catch(() => null);
  const rows = Array.isArray(body?.prices) ? body.prices : null;
  if (!rows) return json({ error: 'prices array required' }, 400);

  const db = await getDb();
  const col = db.collection(PRICING_COLLECTION);
  const now = new Date();
  for (const row of rows) {
    const serviceKey = String(row.service_key || '').trim();
    if (!serviceKey) continue;
    const existing = await col.findOne({ service_key: serviceKey });
    if (!existing) continue;
    const basePrice = existing.individually_purchasable === false
      ? 0
      : Math.max(0, Number(row.base_price) || 0);
    await col.updateOne(
      { service_key: serviceKey },
      { $set: { base_price: basePrice, is_active: row.is_active !== false, updated_at: now } },
    );
  }
  const items = await col.find({}).sort({ category: 1, name: 1 }).toArray();
  return json({ items, canEdit: true });
}

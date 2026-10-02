import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveActorRole, resolveClientEmail } from '@/lib/staff-auth';
import { PRICING_COLLECTION, seedPricingMaster } from '@/lib/billing-schema';
import { clearPublicPricingCache, getPublicPricing } from '@/lib/public-pricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

let catalogSeeded = false;

async function ensureCatalogSeeded(db) {
  if (catalogSeeded) return;
  await seedPricingMaster(db);
  catalogSeeded = true;
}

export async function GET(request) {
  const actor = await resolveActorRole(request);
  const email = await resolveClientEmail(request);
  const signedIn = Boolean(actor.role || email);
  if (!signedIn) {
    const items = await getPublicPricing();
    return json({ items, canEdit: false });
  }
  const db = await getDb();
  await ensureCatalogSeeded(db);
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
    const update = { base_price: basePrice, is_active: row.is_active !== false, updated_at: now };
    if (serviceKey === 'custom_bids_10' && row.bid_tiers && typeof row.bid_tiers === 'object') {
      update.bid_tiers = {
        one: Math.max(0, Number(row.bid_tiers.one) || 0),
        two_to_five: Math.max(0, Number(row.bid_tiers.two_to_five) || 0),
        six_to_eight: Math.max(0, Number(row.bid_tiers.six_to_eight) || 0),
        nine_plus: Math.max(0, Number(row.bid_tiers.nine_plus) || 0),
      };
    }
    await col.updateOne(
      { service_key: serviceKey },
      { $set: update },
    );
  }
  clearPublicPricingCache();
  const items = await col.find({}).sort({ category: 1, name: 1 }).toArray();
  return json({ items, canEdit: true });
}

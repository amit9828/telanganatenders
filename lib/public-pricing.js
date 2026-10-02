import { getDb } from '@/lib/db';
import { PRICING_COLLECTION, seedPricingMaster } from '@/lib/billing-schema';

const PUBLIC_PRICE = { service_key: 1, name: 1, base_price: 1, category: 1, bid_credits: 1, bid_tiers: 1, _id: 0 };
const PUBLIC_CATALOG_TTL_MS = 60_000;

let catalogSeeded = false;
let publicCatalog = null;
let publicCatalogAt = 0;

export function clearPublicPricingCache() {
  publicCatalog = null;
  publicCatalogAt = 0;
}

/** Public catalog used by the homepage and unsigned /api/pricing-master. */
export async function getPublicPricing() {
  if (Array.isArray(publicCatalog) && Date.now() - publicCatalogAt < PUBLIC_CATALOG_TTL_MS) {
    return publicCatalog;
  }
  const db = await getDb();
  if (!catalogSeeded) {
    await seedPricingMaster(db);
    catalogSeeded = true;
  }
  const items = await db.collection(PRICING_COLLECTION).find(
    { is_active: { $ne: false }, individually_purchasable: { $ne: false } },
    { projection: PUBLIC_PRICE },
  ).sort({ category: 1, name: 1 }).toArray();
  publicCatalog = items;
  publicCatalogAt = Date.now();
  return items;
}

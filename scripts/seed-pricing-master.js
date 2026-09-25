/**
 * Seeds pricing_master defaults. Existing service_key rows are left unchanged.
 * Usage: node scripts/seed-pricing-master.js
 */
import { loadLocalEnv } from './load-local-env.js';
import { getDb } from '../lib/db.js';
import { ensureBillingIndexes, seedPricingMaster } from '../lib/billing-schema.js';

loadLocalEnv();

const db = await getDb();
await ensureBillingIndexes(db);
const result = await seedPricingMaster(db);
console.log(`pricing_master: inserted ${result.inserted} of ${result.catalog} defaults`);
process.exit(0);

/**
 * Run once at 1 Oct 2026 00:00 IST. Masks discovery for clients with no
 * participate plan and no bid balance. Does not touch workflow jobs.
 * Usage: node scripts/billing-october-lock.js
 */
import { loadLocalEnv } from './load-local-env.js';
import { getDb } from '../lib/db.js';

loadLocalEnv();

const ENFORCE_AT = new Date('2026-09-30T18:30:00.000Z');
const db = await getDb();
const result = await db.collection('users').updateMany(
  {
    $nor: [
      { 'subscription.planType': 'UNLIMITED', 'subscription.status': 'active', 'subscription.expires_at': { $gt: ENFORCE_AT } },
      { bid_balance: { $gt: 0 } },
    ],
  },
  {
    $set: {
      'subscription.participate': false,
      'subscription.paywall': true,
      'subscription.enforced_at': ENFORCE_AT,
    },
  },
);
console.log(`Locked ${result.modifiedCount} users for masked discovery.`);
process.exit(0);

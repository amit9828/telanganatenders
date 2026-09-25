/**
 * Paywall clients who have no participate plan and no bid balance.
 * Does not upsert users and does not touch workflow jobs, vault files, or payments.
 * A second run changes nothing. Usage: node scripts/billing-live-lock.js
 */
import { loadLocalEnv } from './load-local-env.js';
import { getDb } from '../lib/db.js';

loadLocalEnv();

const now = new Date();
const db = await getDb();
const result = await db.collection('users').updateMany(
  {
    'subscription.participate': { $ne: true },
    $nor: [
      { 'subscription.planType': 'UNLIMITED', 'subscription.status': 'active', 'subscription.expires_at': { $gt: now } },
      { bid_balance: { $gt: 0 } },
    ],
    $or: [
      { 'subscription.status': { $ne: 'expired' } },
      { 'subscription.paywall': { $ne: true } },
      { 'subscription.participate': { $ne: false } },
    ],
  },
  {
    $set: {
      'subscription.status': 'expired',
      'subscription.participate': false,
      'subscription.paywall': true,
    },
  },
);
console.log(`Locked ${result.modifiedCount} users onto the paywall.`);
process.exit(0);

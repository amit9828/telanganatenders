import { PLAN_TYPE, PRICING_COLLECTION, REGISTRATION_COMBO_KEYS, gstBreakdown, emptySubscription, normalizeUnlimitedMonths } from '@/lib/billing-schema';

const BID_VALIDITY_MS = 90 * 24 * 60 * 60 * 1000;
const TRACK_DAYS = { track_1m: 30, track_3m: 90, track_6m: 180, track_12m: 365 };
const GRANT_CLAIM_MS = 2 * 60 * 1000;
// A failed UPI attempt can mark the order before a later attempt on the same order succeeds.
const GRANTABLE_STATUSES = ['PENDING', 'FAILED', 'CANCELLED', 'USER_DROPPED', 'VOID'];

function asDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date, months) {
  const next = new Date(date);
  const day = next.getDate();
  next.setMonth(next.getMonth() + months);
  if (next.getDate() !== day) next.setDate(0);
  return next;
}

/** Dotted subscription.* writes fail when the stored value is null or not an object. */
async function normalizeSubscription(db, email) {
  await db.collection('users').updateOne(
    { email, subscription: { $not: { $type: 'object' } } },
    { $set: { subscription: emptySubscription() } },
  );
}

export function unlimitedActive(user, now = new Date()) {
  const sub = user?.subscription || {};
  const expires = asDate(sub.expires_at);
  return sub.planType === PLAN_TYPE.UNLIMITED && sub.status === 'active' && Boolean(expires && expires > now);
}

export function paygActive(user, now = new Date()) {
  if (unlimitedActive(user, now)) return false;
  const expiry = asDate(user?.bid_expiry);
  return Number(user?.bid_balance) > 0 && Boolean(expiry && expiry > now);
}

export function trackingActive(user, now = new Date()) {
  const until = asDate(user?.subscription?.tracking_until);
  return Boolean(until && until > now);
}

export function canParticipate(user, now = new Date()) {
  if (!user) return false;
  if (unlimitedActive(user, now)) return true;
  return paygActive(user, now);
}

export function hasCorePlanView(user, now = new Date()) {
  return unlimitedActive(user, now) || paygActive(user, now);
}

export function canViewTender(user, tenderId, now = new Date()) {
  if (!user) return false;
  if (hasCorePlanView(user, now)) return true;
  const sub = user.subscription || {};
  const viewUntil = sub.view_until ? new Date(sub.view_until) : null;
  if (sub.view_source === 'pricing_master' && viewUntil && viewUntil > now) return true;
  const id = String(tenderId || '');
  return Array.isArray(user.view_unlocks) && user.view_unlocks.some((row) => String(row.tender_id) === id);
}

export async function assertPurchasable(db, planId) {
  const key = String(planId || '').trim();
  if (!key) return { error: 'Select a plan.', status: 400 };
  if (key === 'udyam') return { error: 'Udyam is included with a registration combo and cannot be bought alone.', status: 400 };
  const item = await db.collection(PRICING_COLLECTION).findOne({ service_key: key, is_active: { $ne: false } });
  if (!item) return { error: 'That service is not available.', status: 404 };
  if (item.individually_purchasable === false) {
    return { error: 'Udyam is included with a registration combo and cannot be bought alone.', status: 400 };
  }
  return { item };
}

export function comboIncludesUdyam(planId) {
  return REGISTRATION_COMBO_KEYS.includes(String(planId || ''));
}

export function orderAmount(item) {
  return gstBreakdown(item.base_price);
}

/** Idempotent grant after a PENDING order flips to SUCCESS. */
export async function grantPaidOrder(db, order, now = new Date()) {
  const email = String(order.email || '').toLowerCase();
  const item = await db.collection(PRICING_COLLECTION).findOne({ service_key: order.plan_id });
  if (!email || !item) return;
  await normalizeSubscription(db, email);
  const user = await db.collection('users').findOne({ email });
  const set = { billing_paid: true, updated_at: now };
  const keys = Array.isArray(order.plan_ids) && order.plan_ids.length ? order.plan_ids : [order.plan_id];
  const single = keys.length === 1;

  if (item.plan_type === PLAN_TYPE.UNLIMITED) {
    const existing = asDate(user?.subscription?.expires_at);
    const live = user?.subscription?.planType === PLAN_TYPE.UNLIMITED && existing && existing > now;
    const base = live ? existing : now;
    const months = normalizeUnlimitedMonths(order.months);
    set['subscription.status'] = 'active';
    set['subscription.planType'] = PLAN_TYPE.UNLIMITED;
    set['subscription.expires_at'] = addMonths(base, months);
    set['subscription.plan_months'] = months;
    set['subscription.paywall'] = false;
    set['subscription.participate'] = true;
    await db.collection('users').updateOne({ email }, { $set: set });
    return;
  }

  if (item.plan_type === PLAN_TYPE.CUSTOM_BIDS) {
    if (unlimitedActive(user, now)) return;
    const selected = Number(order.bid_count);
    const count = selected > 0 ? selected : (Number(item.bid_credits) || 0);
    const expiry = asDate(user?.bid_expiry);
    const live = Boolean(expiry && expiry > now);
    set.bid_balance = (live ? (Number(user?.bid_balance) || 0) : 0) + count;
    set.bid_expiry = new Date(now.getTime() + BID_VALIDITY_MS);
    set['subscription.planType'] = PLAN_TYPE.CUSTOM_BIDS;
    set['subscription.participate'] = true;
    set['subscription.paywall'] = false;
    await db.collection('users').updateOne({ email }, { $set: set });
    return;
  }

  if (single && item.category === 'view' && item.service_key === 'view_single') {
    await db.collection('users').updateOne(
      { email },
      { $set: set, $addToSet: { view_unlocks: { tender_id: order.tender_id || null, at: now } } },
    );
    return;
  }

  if (single && item.category === 'view') {
    set['subscription.view_until'] = addDays(now, item.service_key === 'view_year' ? 365 : 30);
    set['subscription.view_source'] = 'pricing_master';
    await db.collection('users').updateOne({ email }, { $set: set });
    return;
  }

  const rows = [];
  for (const key of keys) {
    const doc = key === item.service_key ? item : await db.collection(PRICING_COLLECTION).findOne({ service_key: key });
    rows.push({ service_key: key, name: doc?.name || key, order_id: order.order_id, at: now });
  }
  if (order.includes_udyam) {
    rows.push({ service_key: 'udyam', name: 'Udyam', order_id: order.order_id, at: now, included_free: true });
  }
  const trackKey = keys.find((key) => TRACK_DAYS[key]);
  if (trackKey) {
    const existing = asDate(user?.subscription?.tracking_until);
    const start = existing && existing > now ? existing : now;
    set['subscription.tracking_until'] = addDays(start, TRACK_DAYS[trackKey]);
  }
  await db.collection('users').updateOne(
    { email },
    { $set: set, $push: { purchased_services: { $each: rows } } },
  );
}

async function revokePaidOrder(db, order, now = new Date()) {
  const email = String(order.email || '').toLowerCase();
  const item = order.plan_id
    ? await db.collection(PRICING_COLLECTION).findOne({ service_key: order.plan_id })
    : null;
  if (!email) return;
  if (item?.plan_type === PLAN_TYPE.UNLIMITED) {
    await db.collection('users').updateOne(
      { email },
      { $set: { 'subscription.participate': false, 'subscription.paywall': true, 'subscription.status': 'none', updated_at: now } },
    );
  } else if (item?.service_key === 'view_single') {
    await db.collection('users').updateOne(
      { email },
      { $pull: { view_unlocks: { tender_id: order.tender_id || null } } },
    );
  } else if (item?.category === 'view') {
    await db.collection('users').updateOne(
      { email },
      { $unset: { 'subscription.view_until': '', 'subscription.view_source': '' } },
    );
  }
  await db.collection('payments').updateOne(
    { order_id: order.order_id },
    { $push: { ledger: { kind: 'revoke', at: now, plan_id: order.plan_id || null } } },
  );
}

async function markPendingPaymentStatus(db, email, order, status) {
  if (order.pending_payment_id) {
    await db.collection('users').updateOne(
      { email, 'pending_payments.id': String(order.pending_payment_id) },
      { $set: { 'pending_payments.$.status': status } },
    );
    return;
  }
  if (order.reason) {
    await db.collection('users').updateOne(
      { email, 'pending_payments.reason': order.reason },
      { $set: { 'pending_payments.$.status': status } },
    );
  }
}

/** Orders created before pricing_master (no plan_id): single PDF, month/year, track_*, custom_bids_10. */
export async function grantLegacyPlan(db, order, now = new Date()) {
  const email = String(order.email || '').toLowerCase();
  if (!email) return;
  await markPendingPaymentStatus(db, email, order, 'PAID');
  const plan = String(order.plan || '');
  const users = db.collection('users');

  if (plan === 'single' && order.tenderId && !order.pending_payment_id) {
    await users.updateOne(
      { email },
      { $addToSet: { purchases: order.tenderId, view_unlocks: { tender_id: String(order.tenderId), unlocked_at: now } } },
      { upsert: true },
    );
    return;
  }

  if (plan === 'month' || plan === 'year' || plan === 'saas_unlimited') {
    await normalizeSubscription(db, email);
    const user = await users.findOne({ email }, { projection: { subscription: 1 } });
    const existing = asDate(user?.subscription?.expires_at);
    const base = user?.subscription?.status === 'active' && existing && existing > now ? existing : now;
    await users.updateOne(
      { email },
      { $set: {
        'subscription.status': 'active',
        'subscription.plan': plan,
        'subscription.planType': PLAN_TYPE.UNLIMITED,
        'subscription.expires_at': addDays(base, plan === 'year' ? 365 : 30),
        updated_at: now,
      } },
      { upsert: true },
    );
    return;
  }

  if (plan.startsWith('track_')) {
    const match = plan.match(/track_(\d+)m/);
    const months = match ? parseInt(match[1], 10) : 1;
    const user = await users.findOne({ email }, { projection: { payment_tracking: 1 } });
    const existing = asDate(user?.payment_tracking?.expires_at);
    const base = user?.payment_tracking?.status === 'active' && existing && existing > now ? existing : now;
    await users.updateOne({ email }, { $set: { payment_tracking: { status: 'active', expires_at: addDays(base, months * 30) } } });
    return;
  }

  if (plan === 'custom_bids_10') {
    const bids = order.bidCount ? parseInt(order.bidCount, 10) : 1;
    await users.updateOne({ email }, { $inc: { bid_balance: bids } });
  }
}

/**
 * Runs the grant exactly once for an order flipped to SUCCESS. Verify and the webhook
 * both call this, so whichever arrives after a failed grant finishes it.
 */
export async function ensureGranted(db, orderId, now = new Date()) {
  const payments = db.collection('payments');
  const claimed = await payments.findOneAndUpdate(
    {
      order_id: orderId,
      status: 'SUCCESS',
      grant_pending: true,
      $or: [
        { grant_claimed_at: { $exists: false } },
        { grant_claimed_at: { $lt: new Date(now.getTime() - GRANT_CLAIM_MS) } },
      ],
    },
    { $set: { grant_claimed_at: now } },
    { returnDocument: 'after' },
  );
  const order = claimed?.value !== undefined ? claimed.value : claimed;
  if (!order?.order_id) return false;
  try {
    if (order.plan_id) await grantPaidOrder(db, order, now);
    else await grantLegacyPlan(db, order, now);
    await payments.updateOne(
      { order_id: orderId },
      { $set: { granted_at: new Date() }, $unset: { grant_pending: '', grant_claimed_at: '' } },
    );
    return true;
  } catch (err) {
    console.error('[billing] grant failed for', orderId, err?.message || err);
    await payments.updateOne({ order_id: orderId }, { $unset: { grant_claimed_at: '' } });
    return false;
  }
}

/** One writer for verify and the Cashfree webhook. Grants once when the order first turns SUCCESS. */
export async function applyPayment(db, orderId, source = {}) {
  const status = String(source.paymentStatus || '').toUpperCase();
  const eventId = source.eventId || null;
  const now = new Date();
  if (eventId) {
    const seen = await db.collection('payments').findOne({ cashfree_event_id: eventId });
    if (seen) return null;
  }
  if (status === 'SUCCESS' || status === 'PAID') {
    const paymentRecord = await db.collection('payments').findOneAndUpdate(
      { order_id: orderId, status: { $in: GRANTABLE_STATUSES } },
      { $set: { status: 'SUCCESS', paid_at: now, cashfree_event_id: eventId, grant_pending: true, updated_at: now } },
      { returnDocument: 'after' },
    );
    const paid = paymentRecord?.value || paymentRecord;
    if (paid?.order_id) await ensureGranted(db, orderId);
    return paid?.order_id ? paid : null;
  }
  if (status === 'REFUND' || status === 'PAYMENT_FAILED_AFTER_SUCCESS') {
    const paymentRecord = await db.collection('payments').findOneAndUpdate(
      { order_id: orderId, status: 'SUCCESS' },
      { $set: { status: 'REFUNDED', cashfree_event_id: eventId, updated_at: now } },
      { returnDocument: 'before' },
    );
    const prior = paymentRecord?.value || paymentRecord;
    if (prior?.status === 'SUCCESS') await revokePaidOrder(db, prior, now);
    return prior || null;
  }
  return null;
}

/** An unexpired Unlimited plan skips the debit. Otherwise one unexpired bid is spent. */
export async function spendParticipateBid(db, user, cost = 1) {
  if (unlimitedActive(user)) return { ok: true };
  const email = String(user?.email || '').toLowerCase();
  if (!email) return { ok: false, error: 'not enough bids' };
  const session = db.client.startSession();
  try {
    let spent = false;
    await session.withTransaction(async () => {
      const current = await db.collection('users').findOne({ email }, { session });
      const expiry = asDate(current?.bid_expiry);
      if (!expiry || expiry <= new Date()) {
        await db.collection('users').updateOne(
          { email },
          { $set: { bid_balance: 0, updated_at: new Date() } },
          { session },
        );
        throw new Error('NOT_ENOUGH');
      }
      const updated = await db.collection('users').findOneAndUpdate(
        { email, bid_balance: { $gte: cost }, bid_expiry: { $gt: new Date() } },
        { $inc: { bid_balance: -cost } },
        { returnDocument: 'after', session },
      );
      const doc = updated?.value || updated;
      if (!doc) throw new Error('NOT_ENOUGH');
      await db.collection('bid_ledger').insertOne({
        email,
        delta: -cost,
        balance_after: Number(doc.bid_balance) || 0,
        at: new Date(),
      }, { session });
      spent = true;
    });
    return spent ? { ok: true } : { ok: false, error: 'not enough bids' };
  } catch (err) {
    if (String(err?.message || '').includes('NOT_ENOUGH')) return { ok: false, error: 'not enough bids' };
    throw err;
  } finally {
    await session.endSession();
  }
}

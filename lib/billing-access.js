import { PLAN_TYPE, PRICING_COLLECTION, REGISTRATION_COMBO_KEYS, gstBreakdown } from '@/lib/billing-schema';

export function canParticipate(user, now = new Date()) {
  if (!user) return false;
  const sub = user.subscription || {};
  const expires = sub.expires_at ? new Date(sub.expires_at) : null;
  const unlimited = sub.planType === PLAN_TYPE.UNLIMITED && sub.status === 'active' && expires && expires > now;
  if (unlimited) return true;
  return Number(user.bid_balance) > 0;
}

export function canViewTender(user, tenderId, now = new Date()) {
  if (!user) return false;
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
  const set = { billing_paid: true, updated_at: now };
  const inc = {};
  if (item.plan_type === PLAN_TYPE.UNLIMITED) {
    const expires = new Date(now);
    expires.setDate(expires.getDate() + 30);
    set['subscription.status'] = 'active';
    set['subscription.planType'] = PLAN_TYPE.UNLIMITED;
    set['subscription.expires_at'] = expires;
    set['subscription.paywall'] = false;
    set['subscription.participate'] = true;
  } else if (item.plan_type === PLAN_TYPE.CUSTOM_BIDS) {
    set['subscription.planType'] = PLAN_TYPE.CUSTOM_BIDS;
    set['subscription.participate'] = true;
    set['subscription.paywall'] = false;
    inc.bid_balance = Number(item.bid_credits) || 0;
  } else if (item.category === 'view' && item.service_key === 'view_single') {
    await db.collection('users').updateOne(
      { email },
      { $set: set, $addToSet: { view_unlocks: { tender_id: order.tender_id || null, at: now } } },
    );
    return;
  } else if (item.category === 'view') {
    const expires = new Date(now);
    expires.setDate(expires.getDate() + (item.service_key === 'view_year' ? 365 : 30));
    set['subscription.view_until'] = expires;
    set['subscription.view_source'] = 'pricing_master';
  }
  const update = { $set: set };
  if (inc.bid_balance) update.$inc = inc;
  await db.collection('users').updateOne({ email }, update);
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
  } else if (item?.plan_type === PLAN_TYPE.CUSTOM_BIDS) {
    const credits = Number(item.bid_credits) || 0;
    if (credits > 0) {
      await db.collection('users').updateOne(
        { email, bid_balance: { $gte: credits } },
        { $inc: { bid_balance: -credits }, $set: { updated_at: now } },
      );
    }
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

/** One writer for verify and the Cashfree webhook. Grants only while status is PENDING. */
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
      { order_id: orderId, status: 'PENDING' },
      { $set: { status: 'SUCCESS', paid_at: now, cashfree_event_id: eventId, updated_at: now } },
      { returnDocument: 'after' },
    );
    const paid = paymentRecord?.value || paymentRecord;
    if (paid?.plan_id) await grantPaidOrder(db, paid);
    return paid || null;
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

/** UNLIMITED skips the debit. CUSTOM_BIDS spends one credit in a transaction. */
export async function spendParticipateBid(db, user, cost = 1) {
  const planType = user?.subscription?.planType;
  if (planType === PLAN_TYPE.UNLIMITED) return { ok: true };
  if (planType !== PLAN_TYPE.CUSTOM_BIDS) return { ok: false, error: 'not enough bids' };
  const email = String(user.email || '').toLowerCase();
  const session = db.client.startSession();
  try {
    let spent = false;
    await session.withTransaction(async () => {
      const updated = await db.collection('users').findOneAndUpdate(
        { email, 'subscription.planType': PLAN_TYPE.CUSTOM_BIDS, bid_balance: { $gte: cost } },
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

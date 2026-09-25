import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveClientEmail } from '@/lib/staff-auth';
import { createCashfreeOrder } from '@/lib/payments';
import { assertPurchasable, comboIncludesUdyam, orderAmount } from '@/lib/billing-access';
import { pendingOrderDoc } from '@/lib/billing-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

export async function POST(request) {
  const email = await resolveClientEmail(request);
  if (!email) return json({ error: 'Sign in with Google before checkout.' }, 401);
  const body = await request.json().catch(() => ({}));
  const db = await getDb();
  const ids = (Array.isArray(body.plan_ids) && body.plan_ids.length ? body.plan_ids : [body.plan_id])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (!ids.length || ids.every((id) => id === 'udyam')) {
    return json({ error: 'Udyam is included with a registration combo and cannot be bought alone.' }, 400);
  }
  let base = 0;
  const names = [];
  let includesUdyam = false;
  let primary = null;
  let bidCount = null;
  for (const id of ids) {
    const check = await assertPurchasable(db, id);
    if (check.error) return json({ error: check.error }, check.status);
    primary = primary || check.item;
    names.push(check.item.name);
    if (comboIncludesUdyam(id)) includesUdyam = true;
    if (id === 'custom_bids_10') {
      bidCount = Math.min(10, Math.max(1, Number(body.bid_count) || 10));
      base += ((Number(check.item.base_price) || 0) / 10) * bidCount;
    } else {
      base += Number(check.item.base_price) || 0;
    }
  }
  const money = orderAmount({ base_price: base });
  const orderId = `order_${Date.now()}`;
  const draft = pendingOrderDoc({
    orderId,
    email,
    planId: primary.service_key,
    basePrice: base,
  });
  draft.plan_ids = ids;
  draft.bid_count = bidCount;
  draft.tender_id = body.tender_id || null;
  draft.includes_udyam = includesUdyam;
  draft.return_to = '/client?step=agreement';
  await db.collection('payments').insertOne(draft);

  const cashfree = await createCashfreeOrder(db, {
    email,
    plan: 'single',
    customAmount: money.total_amount,
    tenderId: body.tender_id || null,
    return_to: '/client?step=agreement',
    reason: names.join(', '),
    order_id: orderId,
  });
  const payload = await cashfree.json();
  if (!cashfree.ok) {
    await db.collection('payments').updateOne({ order_id: orderId }, { $set: { status: 'FAILED', updated_at: new Date() } });
    return json(payload, cashfree.status);
  }
  return json({
    ...payload,
    order_id: orderId,
    subtotal: money.subtotal,
    gst_amount: money.gst_amount,
    total_amount: money.total_amount,
    includes_udyam: includesUdyam,
  });
}

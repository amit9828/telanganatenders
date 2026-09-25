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
  const check = await assertPurchasable(db, body.plan_id);
  if (check.error) return json({ error: check.error }, check.status);
  const money = orderAmount(check.item);
  const orderId = `order_${Date.now()}`;
  const draft = pendingOrderDoc({
    orderId,
    email,
    planId: check.item.service_key,
    basePrice: check.item.base_price,
  });
  draft.tender_id = body.tender_id || null;
  draft.includes_udyam = comboIncludesUdyam(check.item.service_key);
  draft.return_to = '/client?step=agreement';
  await db.collection('payments').insertOne(draft);

    const cashfree = await createCashfreeOrder(db, {
    email,
    plan: 'single',
    customAmount: money.total_amount,
    tenderId: body.tender_id || null,
    return_to: '/client?step=agreement',
    reason: check.item.name,
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
    includes_udyam: draft.includes_udyam,
  });
}

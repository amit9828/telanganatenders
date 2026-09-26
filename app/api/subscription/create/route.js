import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
// 🚀 FIX: The frontend (app/page.js `executePayment`) posts monthly/yearly plans to
// `/api/subscription/create`, but that route never existed — every subscription
// purchase attempt 404'd. Cashfree order-creation logic already branches on
// plan === 'month' | 'year' | 'single' (see lib/payments.js), so this route simply
// reuses the same `createCashfreeOrder` helper used by `/api/payment/order`,
// restricted to the two subscription plans, without touching the existing
// single-PDF purchase flow at all.
import { createCashfreeOrder } from '@/lib/payments';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

function json(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
    }
  });
}

export async function POST(request) {
  try {
    const db = await getDb();
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'Invalid JSON body' }, 400);

    if (!body.email) return json({ error: 'email is required' }, 400);
    if (body.plan !== 'month' && body.plan !== 'year') {
      return json({ error: "Invalid plan. Subscriptions must be 'month' or 'year'." }, 400);
    }

    return await createCashfreeOrder(db, body, request);
  } catch (error) {
    console.error('Subscription create error:', error);
    return json({ error: 'Server Error' }, 500);
  }
}

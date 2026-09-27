import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
// 🚀 ARCHITECTURE FIX: All Cashfree (Order/Verify/Webhook) + Offline Ledger business
// logic now lives in lib/payments.js. Next.js App Router route.js files must only
// export the HTTP verb handlers (+ a small allow-list of route config) — exporting
// arbitrary helper functions like `createCashfreeOrder` from a route.js (as this file
// used to) is an anti-pattern that breaks the route's build contract. This file now
// only wires those pure functions to HTTP methods.
import { createCashfreeOrder, verifyCashfreeOrder, handleCashfreeWebhook, recordOfflineLedgerPayment } from '@/lib/payments';

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

// =====================================================================
// 🚀 Direct route handlers for /api/payments (action-based)
// These let this endpoint be called directly (e.g. /api/payments?action=order),
// in addition to being used by app/api/[[...path]]/route.js for the existing
// /api/payment/order, /api/payment/verify, /api/payment/webhook and
// /api/payments/offline URLs that the frontend already calls.
// =====================================================================
export async function POST(request) {
  const db = await getDb();
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    // 🚀 SECURITY FIX: Webhooks must be verified against the exact RAW body text, so
    // this path reads text() and skips JSON parsing entirely — parsing then
    // re-stringifying would alter the payload and break HMAC signature verification.
    if (action === 'webhook') {
      const rawBody = await request.text();
      return await handleCashfreeWebhook(db, request, rawBody);
    }

    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'Invalid JSON body' }, 400);

    if (action === 'order') return await createCashfreeOrder(db, body, request);
    if (action === 'verify') return await verifyCashfreeOrder(db, body, request);

    return json({ error: 'Unknown payment action', action }, 404);
  } catch (error) {
    console.error('Payments POST Error:', error);
    return json({ error: 'Server Error' }, 500);
  }
}

export async function PUT(request) {
  const db = await getDb();

  try {
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'Invalid JSON body' }, 400);

    return await recordOfflineLedgerPayment(db, body);
  } catch (error) {
    console.error('Payments PUT Error:', error);
    return json({ error: 'Server Error' }, 500);
  }
}

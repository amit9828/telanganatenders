import { NextResponse } from 'next/server';
import { applyPayment, ensureGranted } from '@/lib/billing-access';
import { resolveClientEmail } from '@/lib/staff-auth';

// 🚀 ARCHITECTURE FIX: This logic used to live in `app/api/payments/route.js` and was
// imported directly into `app/api/[[...path]]/route.js`. Next.js App Router route.js
// files may only export the HTTP verb handlers (GET/POST/etc.) and a small allow-list
// of route config (dynamic, revalidate, ...) — any other named export is an
// anti-pattern that breaks the route's build-time contract. Moving the actual business
// logic into this plain lib module lets BOTH route files import the same functions
// safely.
//
// This project talks to Cashfree via its plain REST API (fetch calls below), not the
// Cashfree Node SDK, so no dedicated Cashfree SDK import is required here. If you later
// switch to the official SDK, add its import here, e.g.:
// import { Cashfree } from 'cashfree-pg';

// 🚀 STRICT RULE: ప్రతీ పేమెంట్ API రెస్పాన్స్ కి No-Cache హెడర్స్ పంపడం
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

const SITE_URL = String(process.env.NEXT_PUBLIC_APP_URL || 'https://www.tgtenders.in').replace(/\/+$/, '');
const CASHFREE_PG = 'https://api.cashfree.com/pg';
const CASHFREE_API_VERSION = '2023-08-01';
const CASHFREE_TIMEOUT_MS = 5000;

/** Same host the browser called, so Cashfree returns to this site's /payment-status. */
export function paymentStatusOrigin(request) {
  const host = String(request?.headers?.get('x-forwarded-host') || request?.headers?.get('host') || '').split(',')[0].trim();
  if (!host) return SITE_URL;
  const forwarded = String(request.headers.get('x-forwarded-proto') || '').split(',')[0].trim();
  const proto = forwarded || (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`.replace(/\/+$/, '');
}

/**
 * Where the payer should land once /payment-status has verified the order.
 *
 * Only same-site absolute paths are accepted — the value arrives from the browser and
 * is later handed to router.push(), so an attacker-supplied "//evil.example" or
 * "https://evil.example" must never survive this filter.
 */
export function sanitizeReturnPath(value) {
  const path = String(value || '').trim();
  if (!path.startsWith('/') || path.startsWith('//')) return null;
  return path.slice(0, 300);
}

function cashfreeHeaders() {
  return {
    'x-client-id': process.env.CASHFREE_APP_ID,
    'x-client-secret': process.env.CASHFREE_SECRET_KEY,
    'x-api-version': CASHFREE_API_VERSION,
  };
}

// =====================================================================
// 🚀 CASHFREE: Order Creation
// =====================================================================
export async function createCashfreeOrder(db, body, request) {
  const sessionEmail = await resolveClientEmail(request);
  if (!sessionEmail) return json({ error: 'Please sign in.' }, 401);
  body = { ...body, email: sessionEmail };
  const plan = body.plan;
  let amount = 1000; // డిఫాల్ట్ ₹10 (1000 పైసలు)

  if (plan === 'month') amount = 14900;
  else if (plan === 'year') amount = 149900;
  else if (plan === 'single') {
    // 🚀 FIX: కస్టమ్ అమౌంట్ ₹10 కంటే ఎక్కువ ఉంటే దాన్ని తీసుకుంటుంది, లేకపోతే మినిమమ్ ₹10 ఉంటుంది.
    const custom = Number(body.customAmount);
    if (body.order_id) {
      if (!(custom > 0)) return json({ error: 'This service is not priced yet.' }, 400);
      amount = Math.round(custom * 100);
    } else if (custom && custom > 10) {
      amount = custom * 100;
    } else {
      amount = 1000;
    }
  }

  const orderId = body.order_id || ('order_' + Date.now());
  // 🚀 FIX: a client paying an invoice from /client?tab=finance used to be dumped on the
  // public home page after verification, which reads as a silent logout. The page they
  // started from travels with the order so /payment-status can send them back there.
  const returnTo = sanitizeReturnPath(body.return_to);
  const customerId = body.email ? body.email.replace(/[^a-zA-Z0-9]/g, '').substring(0, 50) : 'cust_' + Date.now();
  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;

  if (!appId || !secretKey) return json({ error: 'Keys missing' }, 500);

  try {
    const cashfreeResponse = await fetch(`${CASHFREE_PG}/orders`, {
      method: 'POST',
      headers: { ...cashfreeHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_amount: amount / 100, order_currency: 'INR', order_id: orderId,
        customer_details: { customer_id: customerId, customer_email: body.email || 'guest@example.com', customer_phone: '9999999999' },
        // Must match the JS SDK's returnUrl: both flows have to land on /payment-status,
        // which is the only page that calls /api/payment/verify and unlocks access.
        order_meta: { return_url: `${paymentStatusOrigin(request)}/payment-status?order_id={order_id}` }
      })
    });

    const data = await cashfreeResponse.json();
    if (data.payment_session_id) {
      if (!body.order_id) {
        await db.collection('payments').insertOne({
          order_id: orderId, email: body.email, amount: amount / 100, plan: plan,
          tenderId: body.tenderId || null,
          pending_payment_id: body.pending_payment_id || null,
          reason: body.reason || null,
          return_to: returnTo,
          status: 'PENDING', created_at: new Date()
        });
      }
      return json({ payment_session_id: data.payment_session_id, order: { id: orderId, amount: amount } });
    } else {
      return json({ error: data.message || 'Rejected' }, 400);
    }
  } catch (err) {
    return json({ error: 'Cashfree Error' }, 500);
  }
}

/**
 * PAID, FAILED (order expired/terminated with no successful attempt), or PENDING.
 * Any Cashfree API error is PENDING so the status page keeps waiting instead of failing.
 */
async function cashfreeGet(path) {
  try {
    const res = await fetch(`${CASHFREE_PG}${path}`, {
      headers: cashfreeHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(CASHFREE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn('[payments] Cashfree GET', path, 'returned', res.status);
      return null;
    }
    return await res.json().catch(() => null);
  } catch (err) {
    console.warn('[payments] Cashfree GET', path, 'failed:', err?.name || err?.message || err);
    return null;
  }
}

const TERMINAL_FAIL = new Set(['FAILED', 'CANCELLED', 'USER_DROPPED', 'VOID']);

async function cashfreeOrderState(orderId) {
  const id = encodeURIComponent(orderId);
  // UPI can report the payment SUCCESS while the order still reads ACTIVE, so both are read together.
  const [order, attempts] = await Promise.all([
    cashfreeGet(`/orders/${id}`),
    cashfreeGet(`/orders/${id}/payments`),
  ]);
  const orderStatus = String(order?.order_status || '').toUpperCase();
  if (orderStatus === 'PAID') return 'PAID';
  const statuses = Array.isArray(attempts)
    ? attempts.map((p) => String(p?.payment_status || '').toUpperCase()).filter(Boolean)
    : [];
  if (statuses.some((s) => s === 'SUCCESS')) return 'PAID';
  if (orderStatus === 'EXPIRED' || orderStatus === 'TERMINATED') return 'FAILED';
  if (statuses.length > 0 && statuses.every((s) => TERMINAL_FAIL.has(s))) return 'FAILED';
  return 'PENDING';
}

/**
 * Where a paid order should land. View plans never go to the full-client agreement.
 * An invoice that already stored a client tab, such as /client?tab=finance, keeps it.
 */
function tenderPdfPath(order) {
  const tenderId = String(order?.tender_id || order?.tenderId || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(tenderId)) return '';
  return `/api/tenders/${tenderId}/pdf`;
}

export function paymentDestination(order, user) {
  const planId = String(order?.plan_id || '');
  if (planId === 'view_single') return tenderPdfPath(order) || '/visitor-account';
  if (planId === 'view_month' || planId === 'view_year') return '/visitor-account';

  const stored = sanitizeReturnPath(order?.return_to);
  const keptClientPath = stored && stored.startsWith('/client') && stored !== '/client?step=agreement';
  if (keptClientPath) return stored;
  if (user?.agreement_signed) return '/client';
  return '/client?step=agreement';
}

function failedPaymentPath(order) {
  const planId = String(order?.plan_id || '');
  if (planId === 'view_single' || planId === 'view_month' || planId === 'view_year') return '/visitor-account';
  return sanitizeReturnPath(order?.return_to);
}

async function verifiedResponse(db, order) {
  const email = String(order?.email || '').toLowerCase();
  const user = email
    ? await db.collection('users').findOne(
      { email },
      { projection: { agreement_signed: 1, onboarding_complete: 1 } },
    )
    : null;
  return json({
    success: true,
    status: 'PAID',
    message: 'Verified',
    tenderId: order?.tenderId || order?.tender_id,
    return_to: paymentDestination(order, user),
  });
}

function processingResponse(message = 'Payment processing at bank...') {
  return json({ success: false, status: 'PROCESSING', message }, 202);
}

// =====================================================================
// 🚀 CASHFREE: Payment Verification
// =====================================================================
/**
 * Looks the order up by order_id only. UPI in-app browsers (PhonePe/GPay) often return
 * without the site's cookies, so this must never depend on a session.
 */
export async function verifyCashfreeOrder(db, body) {
  const orderId = String(body?.order_id || '').trim();
  if (!orderId) return json({ error: 'Missing ID' }, 400);

  const owned = await db.collection('payments').findOne({ order_id: orderId });
  if (!owned) return json({ error: 'Order not found' }, 404);

  if (owned.status === 'SUCCESS') {
    await ensureGranted(db, orderId);
    return verifiedResponse(db, owned);
  }
  if (owned.status === 'REFUNDED') {
    return json({ success: false, status: 'FAILED', error: 'This payment was refunded.', return_to: failedPaymentPath(owned) }, 400);
  }
  if (TERMINAL_FAIL.has(String(owned.status || '').toUpperCase())) {
    return json({
      success: false,
      status: String(owned.status).toUpperCase(),
      error: 'Not paid',
      return_to: failedPaymentPath(owned),
    }, 400);
  }
  if (!process.env.CASHFREE_APP_ID || !process.env.CASHFREE_SECRET_KEY) {
    return json({ error: 'Keys missing' }, 500);
  }

  try {
    const state = await cashfreeOrderState(orderId);
    if (state === 'PAID') {
      await applyPayment(db, orderId, { paymentStatus: 'PAID', eventId: `verify:${orderId}` });
      await ensureGranted(db, orderId);
      return verifiedResponse(db, owned);
    }
    if (state === 'FAILED') {
      const attemptStatus = String(owned.status || '').toUpperCase();
      return json({
        success: false,
        status: TERMINAL_FAIL.has(attemptStatus) ? attemptStatus : 'FAILED',
        error: 'Not paid',
        return_to: failedPaymentPath(owned),
      }, 400);
    }
    return processingResponse();
  } catch (err) {
    console.error('[payments] verify lookup failed for', orderId, err?.message || err);
    return processingResponse('Still confirming with the bank...');
  }
}

// =====================================================================
// 🚀 CASHFREE: Webhook
// =====================================================================
export async function handleCashfreeWebhook(db, request, rawBody) {
  try {
    const signature = request.headers.get('x-webhook-signature');
    const timestamp = request.headers.get('x-webhook-timestamp');
    const secretKey = process.env.CASHFREE_SECRET_KEY;

    if (!signature || !timestamp || !secretKey) return json({ error: 'Unauthorized: Missing Signature' }, 400);

    const crypto = require('crypto');
    let computedSignature;
    try {
      computedSignature = crypto.createHmac('sha256', secretKey).update(timestamp + (rawBody || ''), 'utf8').digest('base64');
    } catch (hmacError) {
      return json({ error: 'Unauthorized: Signature verification failed' }, 400);
    }

    const expectedBuf = Buffer.from(computedSignature);
    const receivedBuf = Buffer.from(signature);
    if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
      return json({ error: 'Unauthorized: Invalid Signature' }, 400);
    }

    let body;
    try { body = JSON.parse(rawBody); } catch (parseError) { return json({ error: 'Invalid JSON body' }, 400); }

    const orderId = body?.data?.order?.order_id;
    const eventType = String(body?.type || '').toUpperCase();
    let paymentStatus = String(body?.data?.payment?.payment_status || '').toUpperCase();
    if (!paymentStatus && eventType === 'PAYMENT_SUCCESS_WEBHOOK') paymentStatus = 'SUCCESS';
    const eventId = body?.data?.payment?.cf_payment_id ? String(body.data.payment.cf_payment_id) : null;

    if (orderId && ['SUCCESS', 'REFUND', 'PAYMENT_FAILED_AFTER_SUCCESS'].includes(paymentStatus)) {
      await applyPayment(db, orderId, { paymentStatus, eventId });
      if (paymentStatus === 'SUCCESS') await ensureGranted(db, orderId);
    } else if (orderId && ['FAILED', 'CANCELLED', 'USER_DROPPED', 'VOID'].includes(paymentStatus)) {
      await db.collection('payments').updateOne(
        { order_id: orderId, status: 'PENDING' },
        { $set: { status: paymentStatus, updated_at: new Date() } }
      );
    }
    return json({ success: true, message: 'Webhook Processed Successfully' });
  } catch (error) {
    return json({ error: 'Webhook Error' }, 500);
  }
}
// =====================================================================
// 🚀 OFFLINE LEDGER: Mark a payment as Paid Offline + Add to Finance Ledger
// =====================================================================
export async function recordOfflineLedgerPayment(db, body) {
  const { id, amount, reason, client_id } = body;

  // 🚀 FIX: యూజర్ అకౌంట్‌లో పెండింగ్ పేమెంట్ ని PAID అని మార్చడం
  if (id && client_id) {
    await db.collection('users').updateOne(
      { email: client_id.toLowerCase(), "pending_payments.id": id },
      { $set: { "pending_payments.$.status": "PAID" } }
    );
  }

  // బ్యాలెన్స్ షీట్ (లెడ్జర్) లో యాడ్ చేయడం
  await db.collection('finance_ledger').insertOne({
    type: 'CREDIT',
    amount: Number(amount),
    reason: reason || 'Offline Payment Collected',
    client_id: client_id || 'N/A',
    payment_mode: 'OFFLINE',
    proof_base64: null,
    created_at: new Date()
  });

  return json({ success: true, message: 'Marked as Paid Offline and Added to Ledger' });
}

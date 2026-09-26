import { NextResponse } from 'next/server';
import { applyPayment } from '@/lib/billing-access';

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

async function markPendingPaymentStatus(db, email, paymentRecord, status) {
  if (!email || !paymentRecord) return;
  const pendingId = paymentRecord.pending_payment_id;
  if (pendingId) {
    await db.collection('users').updateOne(
      { email, 'pending_payments.id': String(pendingId) },
      { $set: { 'pending_payments.$.status': status } }
    );
    return;
  }
  if (paymentRecord.reason) {
    await db.collection('users').updateOne(
      { email, 'pending_payments.reason': paymentRecord.reason },
      { $set: { 'pending_payments.$.status': status } }
    );
  }
}

// =====================================================================
// 🚀 CASHFREE: Order Creation
// =====================================================================
export async function createCashfreeOrder(db, body, request) {
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
    const cashfreeResponse = await fetch('https://api.cashfree.com/pg/orders', {
      method: 'POST',
      headers: { 'x-client-id': appId, 'x-client-secret': secretKey, 'x-api-version': '2023-08-01', 'Content-Type': 'application/json' },
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

// =====================================================================
// 🚀 CASHFREE: Payment Verification
// =====================================================================
export async function verifyCashfreeOrder(db, body) {
  const orderId = body.order_id;
  if (!orderId) return json({ error: 'Missing ID' }, 400);
  const appId = process.env.CASHFREE_APP_ID;
  const secretKey = process.env.CASHFREE_SECRET_KEY;

  try {
    const cfRes = await fetch(`https://api.cashfree.com/pg/orders/${orderId}`, {
      method: 'GET',
      headers: { 'x-client-id': appId, 'x-client-secret': secretKey, 'x-api-version': '2023-08-01' }
    });
    const cfData = await cfRes.json();

    if (cfData.order_status === 'PAID') {
      const paid = await applyPayment(db, orderId, { paymentStatus: 'PAID', eventId: `verify:${orderId}` });
      if (paid && !paid.plan_id && paid.email) {
        const email = paid.email.toLowerCase();
        await markPendingPaymentStatus(db, email, paid, 'PAID');
        if (paid.plan === 'single' && paid.tenderId && !paid.pending_payment_id && !paid.plan_id) {
          await db.collection('users').updateOne({ email }, { $addToSet: { purchases: paid.tenderId } }, { upsert: true });
        } else if ((paid.plan === 'month' || paid.plan === 'year') && !paid.plan_id) {
          const days = paid.plan === 'year' ? 365 : 30;
          const expireDate = new Date();
          expireDate.setDate(expireDate.getDate() + days);
          await db.collection('users').updateOne({ email }, { $set: { subscription: { status: 'active', plan: paid.plan, expires_at: expireDate } } }, { upsert: true });
        }
      }
      const current = paid || await db.collection('payments').findOne({ order_id: orderId });
      return json({
        success: true,
        message: 'Verified',
        tenderId: current?.tenderId || current?.tender_id,
        return_to: sanitizeReturnPath(current?.return_to),
      });
    } else {
      return json({ success: false, error: 'Not paid', return_to: null }, 400);
    }
  } catch (err) {
    return json({ error: 'Verify failed' }, 500);
  }
}

// =====================================================================
// 🚀 CASHFREE: Webhook
// =====================================================================
// 🚀 SECURITY FIX: `rawBody` MUST be the exact, unparsed request body text.
// Cashfree signs the raw bytes it sent us — parsing to JSON and re-stringifying
// changes key order/whitespace and makes the signature check fail, so the caller
// is responsible for passing `await request.text()` here (never a parsed object).
export async function handleCashfreeWebhook(db, request, rawBody) {
  try {
    const signature = request.headers.get('x-webhook-signature');
    const timestamp = request.headers.get('x-webhook-timestamp');
    const secretKey = process.env.CASHFREE_SECRET_KEY;

    if (!signature || !timestamp || !secretKey) {
      console.error('Webhook rejected: missing signature/timestamp header or secret key.');
      return json({ error: 'Unauthorized: Missing Signature' }, 400);
    }

    // 🚀 Compute the expected signature ourselves. Wrapped in try/catch so a malformed
    // or empty raw body can never crash the server — it just fails verification safely.
    let computedSignature;
    try {
      computedSignature = crypto
        .createHmac('sha256', secretKey)
        .update(timestamp + (rawBody || ''), 'utf8')
        .digest('base64');
    } catch (hmacError) {
      console.error('Webhook rejected: HMAC computation failed.', hmacError);
      return json({ error: 'Unauthorized: Signature verification failed' }, 400);
    }

    const expectedBuf = Buffer.from(computedSignature);
    const receivedBuf = Buffer.from(signature);
    const isValidSignature =
      expectedBuf.length === receivedBuf.length && crypto.timingSafeEqual(expectedBuf, receivedBuf);

    if (!isValidSignature) {
      console.error('Webhook rejected: signature mismatch.');
      return json({ error: 'Unauthorized: Invalid Signature' }, 400);
    }

    // Only parse the body into JSON AFTER the signature has been verified against the raw text.
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch (parseError) {
      console.error('Webhook rejected: malformed JSON payload.', parseError);
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const orderId = body?.data?.order?.order_id;
    const paymentStatus = body?.data?.payment?.payment_status;

    const eventId = body?.data?.payment?.cf_payment_id ? String(body.data.payment.cf_payment_id) : null;
    if (orderId && (paymentStatus === 'SUCCESS' || ['REFUND', 'PAYMENT_FAILED_AFTER_SUCCESS'].includes(String(paymentStatus || '').toUpperCase()))) {
      const paid = await applyPayment(db, orderId, { paymentStatus, eventId });
      if (paid && paymentStatus === 'SUCCESS' && !paid.plan_id && paid.email) {
        const email = paid.email.toLowerCase();
        await markPendingPaymentStatus(db, email, paid, 'PAID');
        if (paid.plan === 'single' && paid.tenderId && !paid.pending_payment_id) {
          await db.collection('users').updateOne({ email }, { $addToSet: { purchases: paid.tenderId } }, { upsert: true });
        } else if (paid.plan === 'month' || paid.plan === 'year') {
          const days = paid.plan === 'year' ? 365 : 30;
          const expireDate = new Date();
          expireDate.setDate(expireDate.getDate() + days);
          await db.collection('users').updateOne({ email }, { $set: { subscription: { status: 'active', plan: paid.plan, expires_at: expireDate } } }, { upsert: true });
        }
      }
    } else if (orderId && ['FAILED', 'CANCELLED', 'USER_DROPPED', 'VOID'].includes(String(paymentStatus || '').toUpperCase())) {
      await db.collection('payments').updateOne(
        { order_id: orderId, status: { $ne: 'SUCCESS' } },
        { $set: { status: String(paymentStatus).toUpperCase(), updated_at: new Date() } }
      );
    }
    return json({ success: true, message: 'Webhook Processed Successfully' });
  } catch (error) {
    console.error('Webhook processing error:', error);
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

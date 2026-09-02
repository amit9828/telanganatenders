import { NextResponse } from 'next/server';
import crypto from 'crypto';

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
export async function createCashfreeOrder(db, body) {
  const plan = body.plan;
  let amount = 1000; // డిఫాల్ట్ ₹10 (1000 పైసలు)

  if (plan === 'month') amount = 14900;
  else if (plan === 'year') amount = 149900;
  else if (plan === 'single') {
    // 🚀 FIX: కస్టమ్ అమౌంట్ ₹10 కంటే ఎక్కువ ఉంటే దాన్ని తీసుకుంటుంది, లేకపోతే మినిమమ్ ₹10 ఉంటుంది.
    const custom = Number(body.customAmount);
    if (custom && custom > 10) {
      amount = custom * 100;
    } else {
      amount = 1000;
    }
  }

  const orderId = 'order_' + Date.now();
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
        order_meta: { return_url: "https://www.tgtenders.in/client?tab=finance" }
      })
    });

    const data = await cashfreeResponse.json();
    if (data.payment_session_id) {
      await db.collection('payments').insertOne({
        order_id: orderId, email: body.email, amount: amount / 100, plan: plan,
        tenderId: body.tenderId || null,
        pending_payment_id: body.pending_payment_id || null,
        reason: body.reason || null, // 🚀 FIX: ఏ పర్పస్ కోసం పే చేస్తున్నారో ఇక్కడ సేవ్ చేస్తాం
        status: 'PENDING', created_at: new Date()
      });
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
      const paymentRecord = await db.collection('payments').findOne({ order_id: orderId });
      if (paymentRecord && paymentRecord.status !== 'SUCCESS') {
        await db.collection('payments').updateOne({ order_id: orderId }, { $set: { status: 'SUCCESS', paid_at: new Date() } });
        const email = paymentRecord.email.toLowerCase();

        await markPendingPaymentStatus(db, email, paymentRecord, 'PAID');

        if (paymentRecord.plan === 'single' && paymentRecord.tenderId && !paymentRecord.pending_payment_id) {
          await db.collection('users').updateOne({ email }, { $addToSet: { purchases: paymentRecord.tenderId } }, { upsert: true });
        } else if (paymentRecord.plan === 'month' || paymentRecord.plan === 'year') {
          const days = paymentRecord.plan === 'year' ? 365 : 30;
          const expireDate = new Date();
          expireDate.setDate(expireDate.getDate() + days);
          await db.collection('users').updateOne({ email }, { $set: { subscription: { status: 'active', plan: paymentRecord.plan, expires_at: expireDate } } }, { upsert: true });
        }
      }
      return json({ success: true, message: 'Verified', tenderId: paymentRecord?.tenderId });
    } else {
      return json({ success: false, error: 'Not paid' }, 400);
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

    if (orderId && paymentStatus === 'SUCCESS') {
      const paymentRecord = await db.collection('payments').findOne({ order_id: orderId });
      if (paymentRecord && paymentRecord.status !== 'SUCCESS') {
        await db.collection('payments').updateOne({ order_id: orderId }, { $set: { status: 'SUCCESS', paid_at: new Date() } });
        const email = paymentRecord.email.toLowerCase();

        await markPendingPaymentStatus(db, email, paymentRecord, 'PAID');

        if (paymentRecord.plan === 'single' && paymentRecord.tenderId && !paymentRecord.pending_payment_id) {
          await db.collection('users').updateOne({ email }, { $addToSet: { purchases: paymentRecord.tenderId } }, { upsert: true });
        } else if (paymentRecord.plan === 'month' || paymentRecord.plan === 'year') {
          const days = paymentRecord.plan === 'year' ? 365 : 30;
          const expireDate = new Date();
          expireDate.setDate(expireDate.getDate() + days);
          await db.collection('users').updateOne({ email }, { $set: { subscription: { status: 'active', plan: paymentRecord.plan, expires_at: expireDate } } }, { upsert: true });
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

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
// 🚀 NOTE: This project talks to Cashfree via its plain REST API (fetch calls below),
// not the Cashfree Node SDK, so no dedicated Cashfree SDK import is required here.
// If you later switch to the official SDK, add its import here, e.g.:
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

        // 🚀 FIX: Pending Payment ని 'PAID' గా మార్చడం
        if (paymentRecord.reason) {
          await db.collection('users').updateOne(
            { email: email, "pending_payments.reason": paymentRecord.reason },
            { $set: { "pending_payments.$.status": "PAID" } }
          );
        }

        if (paymentRecord.plan === 'single' && paymentRecord.tenderId) {
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
export async function handleCashfreeWebhook(db, request, body) {
  try {
    // 🚀 FIX: Cashfree Webhook Security Check
    const signature = request.headers.get('x-webhook-signature');
    if (!signature && process.env.NODE_ENV === 'production') {
      return json({ error: 'Unauthorized: Missing Signature' }, 401);
    }

    const orderId = body?.data?.order?.order_id;
    const paymentStatus = body?.data?.payment?.payment_status;

    if (orderId && paymentStatus === 'SUCCESS') {
      const paymentRecord = await db.collection('payments').findOne({ order_id: orderId });
      if (paymentRecord && paymentRecord.status !== 'SUCCESS') {
        await db.collection('payments').updateOne({ order_id: orderId }, { $set: { status: 'SUCCESS', paid_at: new Date() } });
        const email = paymentRecord.email.toLowerCase();

        // 🚀 FIX: Pending Payment ని 'PAID' గా మార్చడం
        if (paymentRecord.reason) {
          await db.collection('users').updateOne(
            { email: email, "pending_payments.reason": paymentRecord.reason },
            { $set: { "pending_payments.$.status": "PAID" } }
          );
        }

        if (paymentRecord.plan === 'single' && paymentRecord.tenderId) {
          await db.collection('users').updateOne({ email }, { $addToSet: { purchases: paymentRecord.tenderId } }, { upsert: true });
        } else if (paymentRecord.plan === 'month' || paymentRecord.plan === 'year') {
          const days = paymentRecord.plan === 'year' ? 365 : 30;
          const expireDate = new Date();
          expireDate.setDate(expireDate.getDate() + days);
          await db.collection('users').updateOne({ email }, { $set: { subscription: { status: 'active', plan: paymentRecord.plan, expires_at: expireDate } } }, { upsert: true });
        }
      }
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
    const body = await request.json().catch(() => null);
    if (!body) return json({ error: 'Invalid JSON body' }, 400);

    if (action === 'order') return await createCashfreeOrder(db, body);
    if (action === 'verify') return await verifyCashfreeOrder(db, body);
    if (action === 'webhook') return await handleCashfreeWebhook(db, request, body);

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

import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';

// ---------------- Mongo connection (cached) ----------------
let _client;
let _db;
async function getDb() {
  if (_db) return _db;
  _client = new MongoClient(process.env.MONGO_URL);
  await _client.connect();
  _db = _client.db(process.env.DB_NAME || 'tender_portal');
  // create indexes (best effort)
  try {
    await _db.collection('tenders').createIndex({ id: 1 }, { unique: true });
    await _db.collection('users').createIndex({ email: 1 }, { unique: true });
    await _db.collection('payments').createIndex({ email: 1 });
  } catch (e) {}
  return _db;
}

// ---------------- helpers ----------------
const json = (data, status = 200) =>
  NextResponse.json(data, {
    status,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    },
  });

function isAdmin(request) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return token && token === process.env.ADMIN_TOKEN;
}

async function hasAccess(db, email, tenderId) {
  if (!email) return false;
  const now = new Date();
  // active subscription (month/year)
  const sub = await db.collection('payments').findOne({
    email: email.toLowerCase(),
    status: 'paid',
    plan: { $in: ['month', 'year'] },
    expires_at: { $gt: now },
  });
  if (sub) return true;
  // single PDF access
  if (tenderId) {
    const single = await db.collection('payments').findOne({
      email: email.toLowerCase(),
      status: 'paid',
      plan: 'single',
      tender_id: tenderId,
    });
    if (single) return true;
  }
  return false;
}

function sendMockEmail(to, subject, body) {
  // In MVP, just log; real Resend integration can replace this later.
  console.log(`[MOCK EMAIL] to=${to} | subject=${subject}\n${body}`);
}

// ---------------- ROUTE HANDLERS ----------------
export async function OPTIONS() {
  return json({ ok: true });
}

export async function GET(request, { params }) {
  const db = await getDb();
  const path = (params?.path || []).join('/');
  const url = new URL(request.url);

  try {
    // health
    if (path === '' || path === 'health') {
      return json({ status: 'ok', service: 'telangana-tenders' });
    }

    // GET /api/tenders?district=&month=&year=&q=&scope=
    if (path === 'tenders') {
      const district = url.searchParams.get('district');
      const month = url.searchParams.get('month'); // 1-12
      const year = url.searchParams.get('year');
      const qstr = (url.searchParams.get('q') || '').trim();
      const scope = url.searchParams.get('scope'); // 'all' to skip month filter
      const q = {};
      if (district && district !== 'all') q.district = district;
      if (scope !== 'all' && month && year) {
        const m = parseInt(month, 10) - 1;
        const y = parseInt(year, 10);
        const start = new Date(y, m, 1);
        const end = new Date(y, m + 1, 1);
        q.last_date = { $gte: start, $lt: end };
      }
      if (qstr) {
        const rx = new RegExp(qstr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        q.$or = [
          { title: rx },
          { department: rx },
          { supply_details: rx },
          { district: rx },
        ];
      }
      const list = await db
        .collection('tenders')
        .find(q, { projection: { pdf_base64: 0 } })
        .sort({ last_date: 1, created_at: -1 })
        .limit(500)
        .toArray();
      return json({ tenders: list });
    }

    // GET /api/me?email=...  user account summary
    if (path === 'me') {
      const email = (url.searchParams.get('email') || '').toLowerCase();
      if (!email) return json({ error: 'email required' }, 400);
      const user = await db.collection('users').findOne({ email });
      const payments = await db
        .collection('payments')
        .find({ email, status: 'paid' })
        .sort({ paid_at: -1 })
        .toArray();
      const now = new Date();
      const active = payments.find(
        (p) => ['month', 'year'].includes(p.plan) && p.expires_at && new Date(p.expires_at) > now
      );
      // single unlocked tenders
      const singleIds = payments.filter((p) => p.plan === 'single' && p.tender_id).map((p) => p.tender_id);
      const unlockedTenders = singleIds.length
        ? await db
            .collection('tenders')
            .find({ id: { $in: singleIds } }, { projection: { pdf_base64: 0 } })
            .toArray()
        : [];
      return json({
        user: user || { email },
        subscription: active
          ? { plan: active.plan, expires_at: active.expires_at, paid_at: active.paid_at }
          : null,
        payments: payments.map((p) => ({
          plan: p.plan,
          amount: p.amount,
          tender_id: p.tender_id,
          paid_at: p.paid_at,
          expires_at: p.expires_at,
        })),
        unlocked_tenders: unlockedTenders,
      });
    }

    // GET /api/tenders/calendar?year=&month=
    if (path === 'tenders/calendar') {
      const month = parseInt(url.searchParams.get('month') || '0', 10);
      const year = parseInt(url.searchParams.get('year') || '0', 10);
      if (!month || !year) return json({ days: {} });
      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 1);
      const tenders = await db
        .collection('tenders')
        .find(
          { last_date: { $gte: start, $lt: end } },
          { projection: { id: 1, title: 1, last_date: 1, district: 1 } }
        )
        .toArray();
      const days = {};
      for (const t of tenders) {
        const d = new Date(t.last_date).getDate();
        days[d] = days[d] || [];
        days[d].push(t);
      }
      return json({ days });
    }

    // GET /api/tenders/{id}
    if (path.startsWith('tenders/') && !path.endsWith('/pdf')) {
      const id = path.split('/')[1];
      const tender = await db
        .collection('tenders')
        .findOne({ id }, { projection: { pdf_base64: 0 } });
      if (!tender) return json({ error: 'Not found' }, 404);
      return json({ tender });
    }

    // GET /api/tenders/{id}/pdf?email=
    if (path.startsWith('tenders/') && path.endsWith('/pdf')) {
      const id = path.split('/')[1];
      const email = (url.searchParams.get('email') || '').toLowerCase();
      const tender = await db.collection('tenders').findOne({ id });
      if (!tender) return json({ error: 'Not found' }, 404);
      const allowed = isAdmin(request) || (await hasAccess(db, email, id));
      if (!allowed) return json({ error: 'Payment required', locked: true }, 402);
      return json({
        id: tender.id,
        title: tender.title,
        pdf_base64: tender.pdf_base64,
        pdf_filename: tender.pdf_filename,
      });
    }

    // GET /api/access?email=&tenderId=
    if (path === 'access') {
      const email = (url.searchParams.get('email') || '').toLowerCase();
      const tenderId = url.searchParams.get('tenderId') || null;
      const ok = await hasAccess(db, email, tenderId);
      const sub = await db
        .collection('payments')
        .findOne(
          {
            email,
            status: 'paid',
            plan: { $in: ['month', 'year'] },
            expires_at: { $gt: new Date() },
          },
          { sort: { expires_at: -1 } }
        );
      return json({
        access: ok,
        subscription: sub
          ? { plan: sub.plan, expires_at: sub.expires_at }
          : null,
      });
    }

    // GET /api/admin/tenders (full incl. pdf flag)
    if (path === 'admin/tenders') {
      if (!isAdmin(request)) return json({ error: 'Unauthorized' }, 401);
      const list = await db
        .collection('tenders')
        .find({}, { projection: { pdf_base64: 0 } })
        .sort({ created_at: -1 })
        .toArray();
      return json({ tenders: list });
    }

    // GET /api/admin/stats
    if (path === 'admin/stats') {
      if (!isAdmin(request)) return json({ error: 'Unauthorized' }, 401);
      const [tenders, users, payments] = await Promise.all([
        db.collection('tenders').countDocuments(),
        db.collection('users').countDocuments(),
        db
          .collection('payments')
          .find({ status: 'paid' })
          .toArray(),
      ]);
      const revenue = payments.reduce((s, p) => s + (p.amount || 0), 0);
      return json({
        tenders,
        users,
        payments: payments.length,
        revenue,
      });
    }

    return json({ error: 'Not found', path }, 404);
  } catch (e) {
    console.error('GET error:', e);
    return json({ error: e.message }, 500);
  }
}

export async function POST(request, { params }) {
  const db = await getDb();
  const path = (params?.path || []).join('/');

  try {
    const body = await request.json().catch(() => ({}));

    // POST /api/users  { email, name? }
    if (path === 'users') {
      const email = (body.email || '').toLowerCase().trim();
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
        return json({ error: 'Invalid email' }, 400);
      const existing = await db.collection('users').findOne({ email });
      if (existing) return json({ user: existing });
      const user = {
        id: uuidv4(),
        email,
        name: body.name || '',
        created_at: new Date(),
      };
      await db.collection('users').insertOne(user);
      return json({ user });
    }

    // POST /api/admin/login { email, password }
    if (path === 'admin/login') {
      if (
        body.email === process.env.ADMIN_EMAIL &&
        body.password === process.env.ADMIN_PASSWORD
      ) {
        return json({ token: process.env.ADMIN_TOKEN });
      }
      return json({ error: 'Invalid credentials' }, 401);
    }

    // POST /api/tenders  (admin)
    if (path === 'tenders') {
      if (!isAdmin(request)) return json({ error: 'Unauthorized' }, 401);
      const required = ['title', 'department', 'last_date', 'district'];
      for (const k of required)
        if (!body[k]) return json({ error: `Missing ${k}` }, 400);
      const tender = {
        id: uuidv4(),
        title: body.title,
        department: body.department,
        last_date: new Date(body.last_date),
        supply_details: body.supply_details || '',
        district: body.district,
        pdf_base64: body.pdf_base64 || '',
        pdf_filename: body.pdf_filename || 'tender.pdf',
        created_at: new Date(),
        published_date: new Date(),
      };
      await db.collection('tenders').insertOne(tender);

      // auto-notify all users (mock)
      const users = await db
        .collection('users')
        .find({}, { projection: { email: 1 } })
        .toArray();
      const subj = `New Tender Published: ${tender.title}`;
      const bodyTxt = `A new tender has been published.\n\nTitle: ${tender.title}\nDepartment: ${tender.department}\nDistrict: ${tender.district}\nLast Date: ${tender.last_date.toDateString()}\n\nLogin to view full PDF.`;
      for (const u of users) sendMockEmail(u.email, subj, bodyTxt);

      const { pdf_base64, ...safe } = tender;
      return json({ tender: safe, notified: users.length });
    }

    // POST /api/payment/order { email, plan, tenderId? }
    if (path === 'payment/order') {
      const email = (body.email || '').toLowerCase().trim();
      const plan = body.plan; // single | month | year
      if (!email || !plan) return json({ error: 'Missing fields' }, 400);
      const amounts = { single: 9, month: 149, year: 1499 };
      if (!(plan in amounts)) return json({ error: 'Invalid plan' }, 400);
      const order = {
        id: 'order_' + uuidv4().replace(/-/g, '').slice(0, 16),
        amount: amounts[plan] * 100, // paise
        currency: 'INR',
        plan,
        email,
        tender_id: body.tenderId || null,
        created_at: new Date(),
      };
      // store pending payment
      await db.collection('payments').insertOne({
        id: uuidv4(),
        order_id: order.id,
        email,
        plan,
        tender_id: body.tenderId || null,
        amount: amounts[plan],
        status: 'created',
        created_at: new Date(),
      });
      return json({ order, key_id: process.env.RAZORPAY_KEY_ID });
    }

    // POST /api/payment/verify { order_id, email, plan, tenderId? }
    // MVP: auto-success (mocked Razorpay).
    if (path === 'payment/verify') {
      const { order_id, email, plan, tenderId } = body;
      if (!order_id || !email || !plan)
        return json({ error: 'Missing fields' }, 400);
      const expires_at =
        plan === 'month'
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          : plan === 'year'
          ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
          : null;
      await db.collection('payments').updateOne(
        { order_id },
        {
          $set: {
            status: 'paid',
            payment_id: 'pay_' + uuidv4().replace(/-/g, '').slice(0, 16),
            paid_at: new Date(),
            expires_at,
            tender_id: tenderId || null,
            email: email.toLowerCase(),
            plan,
          },
        },
        { upsert: true }
      );
      return json({ success: true, message: 'Payment verified, access unlocked.' });
    }

    // POST /api/payment/webhook  (Razorpay webhook auto-verification)
    if (path === 'payment/webhook') {
      // In real flow: verify x-razorpay-signature with RAZORPAY_WEBHOOK_SECRET (HMAC SHA256)
      // For MVP we just mark order paid if event = payment.captured.
      const event = body.event;
      const payload = body.payload || {};
      if (event === 'payment.captured') {
        const order_id = payload?.payment?.entity?.order_id;
        if (order_id) {
          const existing = await db
            .collection('payments')
            .findOne({ order_id });
          if (existing) {
            const expires_at =
              existing.plan === 'month'
                ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                : existing.plan === 'year'
                ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
                : null;
            await db.collection('payments').updateOne(
              { order_id },
              { $set: { status: 'paid', paid_at: new Date(), expires_at } }
            );
          }
        }
      }
      return json({ received: true });
    }

    // POST /api/notify  (admin manually broadcast)
    if (path === 'notify') {
      if (!isAdmin(request)) return json({ error: 'Unauthorized' }, 401);
      const users = await db.collection('users').find({}).toArray();
      for (const u of users)
        sendMockEmail(u.email, body.subject || 'Update', body.message || '');
      return json({ sent: users.length });
    }

    return json({ error: 'Not found', path }, 404);
  } catch (e) {
    console.error('POST error:', e);
    return json({ error: e.message }, 500);
  }
}

export async function DELETE(request, { params }) {
  const db = await getDb();
  const path = (params?.path || []).join('/');
  try {
    if (path.startsWith('tenders/')) {
      if (!isAdmin(request)) return json({ error: 'Unauthorized' }, 401);
      const id = path.split('/')[1];
      await db.collection('tenders').deleteOne({ id });
      return json({ deleted: true });
    }
    return json({ error: 'Not found' }, 404);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

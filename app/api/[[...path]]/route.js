import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import Razorpay from 'razorpay';
import { Resend } from 'resend';
import crypto from 'crypto';

// ---------------- Razorpay & Resend ----------------
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});
const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = process.env.RESEND_FROM || 'Telangana Tenders <onboarding@resend.dev>';

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

async function sendBrandedEmail(to, subject, htmlBody) {
  try {
    const res = await resend.emails.send({
      from: FROM_EMAIL,
      to: Array.isArray(to) ? to : [to],
      subject,
      html: htmlBody,
    });
    if (res.error) console.error('[RESEND ERROR]', res.error);
    return res;
  } catch (e) {
    console.error('[RESEND EXCEPTION]', e?.message || e);
    return { error: e };
  }
}

function sendMockEmail(to, subject, body) {
  // Legacy fallback (no-op now, kept for backwards compat in callers)
  console.log(`[EMAIL FALLBACK LOG] to=${to} | subject=${subject}`);
}

function tenderEmailHtml(tender) {
  const lastDate = new Date(tender.last_date).toDateString();
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f5f7fb;">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
  <div style="background:#0A2647;padding:20px 24px;color:#ffffff;">
    <div style="font-size:20px;font-weight:bold;">Telangana <span style="color:#16a34a;">Tenders</span></div>
    <div style="font-size:12px;opacity:.8;">Official Government Tender Portal</div>
  </div>
  <div style="padding:24px;">
    <span style="background:#16a34a;color:#fff;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:bold;">NEW TENDER</span>
    <h2 style="color:#0A2647;margin:14px 0 4px;font-size:20px;line-height:1.3;">${tender.title}</h2>
    <p style="margin:0 0 14px;color:#6b7280;font-size:13px;">${tender.department}</p>
    <table cellpadding="6" style="border-collapse:collapse;width:100%;font-size:13px;color:#374151;margin-bottom:14px;">
      <tr><td style="color:#6b7280;width:30%;">District</td><td style="font-weight:bold;color:#0A2647;">${tender.district}</td></tr>
      <tr><td style="color:#6b7280;">Last Date</td><td style="font-weight:bold;color:#0A2647;">${lastDate}</td></tr>
    </table>
    ${
      tender.supply_details
        ? `<div style="background:#f9fafb;border-left:3px solid #16a34a;padding:10px 14px;color:#374151;font-size:13px;border-radius:4px;margin-bottom:18px;"><strong style="color:#0A2647;">Supply / Details:</strong><br/>${tender.supply_details}</div>`
        : ''
    }
    <a href="${process.env.NEXT_PUBLIC_BASE_URL || ''}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;font-size:14px;">View Tender on Portal →</a>
    <p style="color:#9ca3af;font-size:11px;margin-top:24px;">You are receiving this because you registered on Telangana Tenders portal.</p>
  </div>
</div>
</body></html>`;
}

// ---------------- PDF Watermarking ----------------
async function watermarkPdf(base64, email) {
  try {
    const buf = Buffer.from(base64, 'base64');
    const pdfDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const stamp = `Licensed to ${email} • ${new Date().toISOString().slice(0, 10)} • Telangana Tenders`;
    const pages = pdfDoc.getPages();
    for (const page of pages) {
      const { width, height } = page.getSize();
      // Diagonal large watermark
      page.drawText(email, {
        x: width / 6,
        y: height / 2,
        size: Math.max(36, width / 18),
        font,
        color: rgb(0.85, 0.15, 0.15),
        opacity: 0.18,
        rotate: degrees(45),
      });
      // Footer stamp on every page
      page.drawRectangle({
        x: 0,
        y: 0,
        width,
        height: 18,
        color: rgb(0.04, 0.15, 0.28),
        opacity: 0.9,
      });
      page.drawText(stamp, {
        x: 8,
        y: 5,
        size: 8,
        font,
        color: rgb(1, 1, 1),
      });
      // Top right ID
      page.drawText(`ID: ${uuidv4().slice(0, 8).toUpperCase()}`, {
        x: width - 90,
        y: height - 12,
        size: 7,
        font,
        color: rgb(0.04, 0.15, 0.28),
        opacity: 0.7,
      });
    }
    const out = await pdfDoc.save();
    return Buffer.from(out).toString('base64');
  } catch (e) {
    console.error('Watermark failed, returning original PDF:', e.message);
    return base64;
  }
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
      const admin = isAdmin(request);
      const allowed = admin || (await hasAccess(db, email, id));
      if (!allowed) return json({ error: 'Payment required', locked: true }, 402);
      let pdf_base64 = tender.pdf_base64 || '';
      let watermarked = false;
      if (!admin && pdf_base64 && email) {
        pdf_base64 = await watermarkPdf(pdf_base64, email);
        watermarked = true;
      }
      return json({
        id: tender.id,
        title: tender.title,
        pdf_base64,
        pdf_filename: tender.pdf_filename,
        watermarked,
      });
    }

    // GET /api/settings (public — returns logo + brand info)
    if (path === 'settings') {
      const s = await db.collection('settings').findOne({ id: 'main' });
      return json({
        logo_base64: s?.logo_base64 || '',
        logo_mime: s?.logo_mime || 'image/png',
        brand_name: s?.brand_name || 'Telangana Tenders',
        tagline: s?.tagline || 'Official Government Tender Portal',
        updated_at: s?.updated_at || null,
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

      // Send real Resend broadcast email to all users
      const users = await db
        .collection('users')
        .find({}, { projection: { email: 1 } })
        .toArray();
      const subj = `[New Tender] ${tender.title} — ${tender.district}`;
      const html = tenderEmailHtml(tender);
      let sent = 0;
      let failed = 0;
      // Resend allows multiple recipients per call; we'll batch in 50s
      const emails = users.map((u) => u.email).filter(Boolean);
      for (let i = 0; i < emails.length; i += 50) {
        const batch = emails.slice(i, i + 50);
        try {
          const r = await sendBrandedEmail(batch, subj, html);
          if (r.error) failed += batch.length;
          else sent += batch.length;
        } catch (e) {
          failed += batch.length;
        }
      }

      const { pdf_base64, ...safe } = tender;
      return json({ tender: safe, notified: sent, failed });
    }

    // POST /api/payment/order { email, plan, tenderId? }
    if (path === 'payment/order') {
      const email = (body.email || '').toLowerCase().trim();
      const plan = body.plan; // single | month | year
      if (!email || !plan) return json({ error: 'Missing fields' }, 400);
      const amounts = { single: 9, month: 149, year: 1499 };
      if (!(plan in amounts)) return json({ error: 'Invalid plan' }, 400);
      // Create real Razorpay order
      let rzpOrder;
      try {
        rzpOrder = await razorpay.orders.create({
          amount: amounts[plan] * 100, // paise
          currency: 'INR',
          receipt: `tt-${plan}-${Date.now()}`,
          notes: {
            email,
            plan,
            tender_id: body.tenderId || '',
            portal: 'telangana-tenders',
          },
        });
      } catch (err) {
        console.error('[RAZORPAY ORDER ERROR]', err?.error?.description || err.message);
        return json({ error: err?.error?.description || 'Razorpay order failed' }, 502);
      }
      // store pending payment
      await db.collection('payments').insertOne({
        id: uuidv4(),
        order_id: rzpOrder.id,
        email,
        plan,
        tender_id: body.tenderId || null,
        amount: amounts[plan],
        status: 'created',
        created_at: new Date(),
      });
      return json({
        order: {
          id: rzpOrder.id,
          amount: rzpOrder.amount,
          currency: rzpOrder.currency,
          plan,
          email,
          tender_id: body.tenderId || null,
        },
        key_id: process.env.RAZORPAY_KEY_ID,
      });
    }

    // POST /api/payment/verify { razorpay_order_id, razorpay_payment_id, razorpay_signature, email, plan, tenderId? }
    if (path === 'payment/verify') {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        email,
        plan,
        tenderId,
      } = body;
      if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        return json({ error: 'Missing payment fields' }, 400);
      }
      // Verify HMAC SHA256 signature
      const expected = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');
      if (expected !== razorpay_signature) {
        console.warn('[RZP] Signature mismatch — possible tampering');
        return json({ error: 'Invalid signature' }, 400);
      }
      const expires_at =
        plan === 'month'
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          : plan === 'year'
          ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
          : null;
      await db.collection('payments').updateOne(
        { order_id: razorpay_order_id },
        {
          $set: {
            status: 'paid',
            payment_id: razorpay_payment_id,
            signature: razorpay_signature,
            paid_at: new Date(),
            expires_at,
            tender_id: tenderId || null,
            email: (email || '').toLowerCase(),
            plan,
          },
        },
        { upsert: true }
      );
      return json({
        success: true,
        message: 'Payment verified, access unlocked.',
      });
    }

    // POST /api/payment/webhook  (Razorpay webhook auto-verification)
    if (path === 'payment/webhook') {
      // Note: webhook signature must be verified against RAW body, not parsed JSON.
      // We re-serialize the parsed body here as a best-effort fallback when
      // signature header missing or differs. Razorpay POSTs JSON with header
      // 'x-razorpay-signature'.
      const signature = request.headers.get('x-razorpay-signature') || '';
      const rawBody = JSON.stringify(body);
      const expected = crypto
        .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');
      if (signature && signature !== expected) {
        console.warn('[RZP WEBHOOK] Signature mismatch');
        return json({ error: 'Invalid signature' }, 400);
      }
      const event = body.event;
      const payload = body.payload || {};
      if (event === 'payment.captured' || event === 'payment.authorized') {
        const order_id = payload?.payment?.entity?.order_id;
        const payment_id = payload?.payment?.entity?.id;
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
              {
                $set: {
                  status: 'paid',
                  payment_id,
                  paid_at: new Date(),
                  expires_at,
                  webhook_event: event,
                },
              }
            );
          }
        }
      }
      return json({ received: true });
    }

    // POST /api/notify  (admin manually broadcast)
    if (path === 'notify') {
      if (!isAdmin(request)) return json({ error: 'Unauthorized' }, 401);
      const users = await db
        .collection('users')
        .find({}, { projection: { email: 1 } })
        .toArray();
      const emails = users.map((u) => u.email).filter(Boolean);
      const subject = body.subject || 'Update from Telangana Tenders';
      const html = body.html || `<p>${(body.message || '').replace(/\n/g, '<br/>')}</p>`;
      let sent = 0;
      for (let i = 0; i < emails.length; i += 50) {
        const batch = emails.slice(i, i + 50);
        const r = await sendBrandedEmail(batch, subject, html);
        if (!r.error) sent += batch.length;
      }
      return json({ sent });
    }

    // POST /api/admin/settings  (logo + brand)
    if (path === 'admin/settings') {
      if (!isAdmin(request)) return json({ error: 'Unauthorized' }, 401);
      const update = {
        updated_at: new Date(),
      };
      if (body.logo_base64 !== undefined) update.logo_base64 = body.logo_base64;
      if (body.logo_mime !== undefined) update.logo_mime = body.logo_mime;
      if (body.brand_name !== undefined) update.brand_name = body.brand_name;
      if (body.tagline !== undefined) update.tagline = body.tagline;
      await db.collection('settings').updateOne(
        { id: 'main' },
        { $set: update, $setOnInsert: { id: 'main', created_at: new Date() } },
        { upsert: true }
      );
      return json({ ok: true });
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

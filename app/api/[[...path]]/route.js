import { NextResponse } from 'next/server';
import { MongoClient } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import { Cashfree } from 'cashfree-pg';
import { Resend } from 'resend';
import crypto from 'crypto';

// ---------------- Cashfree & Resend ----------------
Cashfree.XClientId = process.env.CASHFREE_APP_ID;
Cashfree.XClientSecret = process.env.CASHFREE_SECRET_KEY;
Cashfree.XEnvironment = Cashfree.Environment.PRODUCTION;

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
  const e = email.toLowerCase();
  const now = new Date();
  const user = await db.collection('users').findOne({ email: e });
  if (user) {
    if (user.premium_expiry_date && new Date(user.premium_expiry_date) > now) {
      return true;
    }
    if (
      tenderId &&
      Array.isArray(user.purchased_tenders) &&
      user.purchased_tenders.includes(tenderId)
    ) {
      return true;
    }
  }
  const sub = await db.collection('payments').findOne({
    email: e,
    status: 'paid',
    plan: { $in: ['month', 'year'] },
    expires_at: { $gt: now },
  });
  if (sub) return true;
  if (tenderId) {
    const single = await db.collection('payments').findOne({
      email: e,
      status: 'paid',
      plan: 'single',
      tender_id: tenderId,
    });
    if (single) return true;
  }
  return false;
}

// Plans single source of truth
const PLAN_AMOUNTS = { single: 10, month: 149, year: 1499 };
const PLAN_DAYS = { month: 30, year: 365 };

// ---------------- Cashfree Subscription Helpers ----------------
async function ensureCashfreePlans(db) {
  let s = await db.collection('settings').findOne({ id: 'main' });
  let monthlyId = s?.cf_plan_monthly;
  let yearlyId = s?.cf_plan_yearly;

  const cfHeaders = {
    'x-client-id': process.env.CASHFREE_APP_ID,
    'x-client-secret': process.env.CASHFREE_SECRET_KEY,
    'x-api-version': '2023-08-01',
    'Content-Type': 'application/json'
  };

  if (!monthlyId) {
    try {
      monthlyId = `tt_monthly_${Date.now()}`;
      await fetch('https://api.cashfree.com/pg/subscriptions/plans', {
        method: 'POST',
        headers: cfHeaders,
        body: JSON.stringify({
          plan_id: monthlyId,
          plan_name: 'Telangana Tenders Monthly Premium',
          plan_type: 'PERIODIC',
          plan_currency: 'INR',
          plan_amount: PLAN_AMOUNTS.month,
          plan_interval_type: 'MONTHS',
          plan_intervals: 1
        })
      });
      await db.collection('settings').updateOne(
        { id: 'main' },
        { $set: { cf_plan_monthly: monthlyId }, $setOnInsert: { id: 'main', created_at: new Date() } },
        { upsert: true }
      );
    } catch (e) {
      console.error('[Cashfree plans.create monthly]', e.message);
    }
  }
  if (!yearlyId) {
    try {
      yearlyId = `tt_yearly_${Date.now()}`;
      await fetch('https://api.cashfree.com/pg/subscriptions/plans', {
        method: 'POST',
        headers: cfHeaders,
        body: JSON.stringify({
          plan_id: yearlyId,
          plan_name: 'Telangana Tenders Yearly Premium',
          plan_type: 'PERIODIC',
          plan_currency: 'INR',
          plan_amount: PLAN_AMOUNTS.year,
          plan_interval_type: 'YEARS',
          plan_intervals: 1
        })
      });
      await db.collection('settings').updateOne(
        { id: 'main' },
        { $set: { cf_plan_yearly: yearlyId } },
        { upsert: true }
      );
    } catch (e) {
      console.error('[Cashfree plans.create yearly]', e.message);
    }
  }
  return { monthlyId, yearlyId };
}

async function grantAccessToUser(db, email, plan, tenderId) {
  const e = (email || '').toLowerCase();
  if (!e) return;
  const now = new Date();
  await db.collection('users').updateOne(
    { email: e },
    {
      $setOnInsert: {
        id: uuidv4(),
        email: e,
        created_at: now,
        purchased_tenders: [],
      },
    },
    { upsert: true }
  );
  if (plan === 'month' || plan === 'year') {
    const current = await db.collection('users').findOne({ email: e });
    const currentExpiry =
      current?.premium_expiry_date && new Date(current.premium_expiry_date) > now
        ? new Date(current.premium_expiry_date)
        : now;
    const newExpiry = new Date(
      currentExpiry.getTime() + PLAN_DAYS[plan] * 24 * 60 * 60 * 1000
    );
    await db.collection('users').updateOne(
      { email: e },
      {
        $set: {
          premium_expiry_date: newExpiry,
          premium_plan: plan,
          last_payment_at: now,
        },
      }
    );
    return newExpiry;
  }
  if (plan === 'single' && tenderId) {
    await db.collection('users').updateOne(
      { email: e },
      {
        $addToSet: { purchased_tenders: tenderId },
        $set: { last_payment_at: now },
      }
    );
  }
  return null;
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

async function getEmailBrand(db) {
  const s = await db.collection('settings').findOne({ id: 'main' });
  const brand_name = s?.brand_name || 'Telangana Tenders';
  const tagline = s?.tagline || 'Official Government Tender Portal';
  const logo_data_uri =
    s?.logo_base64
      ? `data:${s.logo_mime || 'image/png'};base64,${s.logo_base64}`
      : '';
  return { brand_name, tagline, logo_data_uri };
}

function brandedEmailFrame(brand, innerHtml) {
  const logoHtml = brand.logo_data_uri
    ? `<img src="${brand.logo_data_uri}" alt="logo" width="56" height="56" style="display:block;border-radius:8px;background:#ffffff;padding:4px;border:1px solid #e5e7eb;" />`
    : `<div style="width:56px;height:56px;background:#16a34a;border-radius:8px;display:inline-block;text-align:center;line-height:56px;color:#fff;font-weight:bold;">TT</div>`;
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f5f7fb;">
<div style="max-width:600px;margin:24px auto;background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb;">
  <div style="background:#0A2647;padding:18px 24px;color:#ffffff;display:flex;align-items:center;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td width="64" valign="middle">${logoHtml}</td>
      <td valign="middle" style="padding-left:14px;color:#ffffff;">
        <div style="font-size:18px;font-weight:bold;line-height:1.2;">${brand.brand_name}</div>
        <div style="font-size:11px;opacity:.8;">${brand.tagline}</div>
      </td>
    </tr></table>
  </div>
  ${innerHtml}
  <div style="background:#f9fafb;padding:14px 24px;color:#9ca3af;font-size:11px;text-align:center;border-top:1px solid #e5e7eb;">
    You are receiving this because you registered on ${brand.brand_name}.<br/>
    <a href="${process.env.NEXT_PUBLIC_BASE_URL || ''}" style="color:#0A2647;">Visit Portal</a>
  </div>
</div>
</body></html>`;
}

function tenderEmailHtml(tender, brand) {
  const lastDate = new Date(tender.last_date).toDateString();
  const inner = `
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
  </div>`;
  return brandedEmailFrame(brand, inner);
}

// ---------------- PDF Watermarking ----------------
async function watermarkPdf(base64, email, logoBase64 = '', logoMime = '') {
  try {
    const buf = Buffer.from(base64, 'base64');
    const pdfDoc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let logoImage = null;
    if (logoBase64) {
      try {
        const logoBuf = Buffer.from(logoBase64, 'base64');
        const mime = (logoMime || '').toLowerCase();
        if (mime.includes('png')) {
          logoImage = await pdfDoc.embedPng(logoBuf);
        } else if (mime.includes('jpeg') || mime.includes('jpg')) {
          logoImage = await pdfDoc.embedJpg(logoBuf);
        }
      } catch (e) {
        logoImage = null;
      }
    }

    const pages = pdfDoc.getPages();
    for (const page of pages) {
      const { width, height } = page.getSize();

      if (logoImage) {
        const dims = logoImage.scale(1);
        const targetWidth = width * 0.55;
        const scale = targetWidth / dims.width;
        const w = dims.width * scale;
        const h = dims.height * scale;
        page.drawImage(logoImage, {
          x: (width - w) / 2,
          y: (height - h) / 2,
          width: w,
          height: h,
          opacity: 0.12,
          rotate: degrees(-30),
        });
        const caption = 'TELANGANA TENDERS - OFFICIAL';
        const captionSize = Math.max(14, width / 36);
        page.drawText(caption, {
          x: width * 0.18,
          y: height * 0.38,
          size: captionSize,
          font,
          color: rgb(0.04, 0.15, 0.28),
          opacity: 0.08,
          rotate: degrees(-30),
        });
      } else {
        const text = 'TELANGANA TENDERS - OFFICIAL';
        const fontSize = Math.max(28, width / 18);
        page.drawText(text, {
          x: width * 0.05,
          y: height * 0.45,
          size: fontSize,
          font,
          color: rgb(0.04, 0.15, 0.28),
          opacity: 0.12,
          rotate: degrees(-30),
        });
        page.drawText('Government Tender Portal', {
          x: width * 0.18,
          y: height * 0.35,
          size: Math.max(14, width / 36),
          font,
          color: rgb(0.08, 0.4, 0.2),
          opacity: 0.1,
          rotate: degrees(-30),
        });
      }

      page.drawRectangle({
        x: 0,
        y: 0,
        width,
        height: 14,
        color: rgb(0.04, 0.15, 0.28),
        opacity: 0.85,
      });
      const footer = `Telangana Tenders  •  Licensed to ${email}  •  ${new Date()
        .toISOString()
        .slice(0, 10)}  •  ID ${uuidv4().slice(0, 6).toUpperCase()}`;
      page.drawText(footer, {
        x: 6,
        y: 4,
        size: 7,
        font,
        color: rgb(1, 1, 1),
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
    if (path === '' || path === 'health') {
      return json({ status: 'ok', service: 'telangana-tenders' });
    }

    if (path === 'tenders') {
      const district = url.searchParams.get('district');
      const month = url.searchParams.get('month'); 
      const year = url.searchParams.get('year');
      const qstr = (url.searchParams.get('q') || '').trim();
      const scope = url.searchParams.get('scope'); 
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

    if (path === 'me') {
      const email = (url.searchParams.get('email') || '').toLowerCase();
      if (!email) return json({ error: 'email required' }, 400);
      const user = await db.collection('users').findOne({ email });
      const now = new Date();
      const isPremium =
        user?.premium_expiry_date && new Date(user.premium_expiry_date) > now;
      const purchasedIds = user?.purchased_tenders || [];
      const purchasedTenders = purchasedIds.length
        ? await db
            .collection('tenders')
            .find({ id: { $in: purchasedIds } }, { projection: { pdf_base64: 0 } })
            .toArray()
        : [];
      const payments = await db
        .collection('payments')
        .find({ email, status: 'paid' })
        .sort({ paid_at: -1 })
        .toArray();
      return json({
        user: user || { email },
        subscription: isPremium
          ? {
              plan: user.premium_plan || 'month',
              expires_at: user.premium_expiry_date,
            }
          : null,
        premium_expiry_date: user?.premium_expiry_date || null,
        is_premium: !!isPremium,
        auto_renew: user?.subscription_status === 'active',
        subscription_status: user?.subscription_status || null,
        subscription_plan: user?.subscription_plan || null,
        subscription_id: user?.subscription_id || null,
        purchased_tenders: purchasedIds,
        unlocked_tenders: purchasedTenders,
        payments: payments.map((p) => ({
          plan: p.plan,
          amount: p.amount,
          tender_id: p.tender_id,
          paid_at: p.paid_at,
          expires_at: p.expires_at,
        })),
      });
    }

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

    if (path.startsWith('tenders/') && !path.endsWith('/pdf')) {
      const id = path.split('/')[1];
      const tender = await db
        .collection('tenders')
        .findOne({ id }, { projection: { pdf_base64: 0 } });
      if (!tender) return json({ error: 'Not found' }, 404);
      return json({ tender });
    }

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
        const settings = await db.collection('settings').findOne({ id: 'main' });
        pdf_base64 = await watermarkPdf(
          pdf_base64,
          email,
          settings?.logo_base64 || '',
          settings?.logo_mime || ''
        );
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

    if (path === 'access') {
      const email = (url.searchParams.get('email') || '').toLowerCase();
      const tenderId = url.searchParams.get('tenderId') || null;
      const ok = await hasAccess(db, email, tenderId);
      const user = await db.collection('users').findOne({ email });
      const now = new Date();
      const isPremium =
        user?.premium_expiry_date && new Date(user.premium_expiry_date) > now;
      return json({
        access: ok,
        subscription: isPremium
          ? {
              plan: user.premium_plan || 'month',
              expires_at: user.premium_expiry_date,
            }
          : null,
        is_premium: !!isPremium,
        premium_expiry_date: user?.premium_expiry_date || null,
        purchased_tenders: user?.purchased_tenders || [],
      });
    }

    if (path === 'admin/tenders') {
      if (!isAdmin(request)) return json({ error: 'Unauthorized' }, 401);
      const list = await db
        .collection('tenders')
        .find({}, { projection: { pdf_base64: 0 } })
        .sort({ created_at: -1 })
        .toArray();
      return json({ tenders: list });
    }

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

    if (path === 'admin/login') {
      if (
        body.email === process.env.ADMIN_EMAIL &&
        body.password === process.env.ADMIN_PASSWORD
      ) {
        return json({ token: process.env.ADMIN_TOKEN });
      }
      return json({ error: 'Invalid credentials' }, 401);
    }

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
      const brand = await getEmailBrand(db);
      const html = tenderEmailHtml(tender, brand);
      let sent = 0;
      let failed = 0;
      
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

    // CASHFREE SUBSCRIPTION CREATION (Auto-Renewal)
    if (path === 'subscription/create') {
      const email = (body.email || '').toLowerCase().trim();
      const plan = body.plan;
      if (!email || !['month', 'year'].includes(plan)) {
        return json({ error: 'Invalid email or plan' }, 400);
      }
      try {
        const { monthlyId, yearlyId } = await ensureCashfreePlans(db);
        const plan_id = plan === 'month' ? monthlyId : yearlyId;
        const sub_id = `sub_${Date.now()}`;
        
        const cfHeaders = {
          'x-client-id': process.env.CASHFREE_APP_ID,
          'x-client-secret': process.env.CASHFREE_SECRET_KEY,
          'x-api-version': '2023-08-01',
          'Content-Type': 'application/json'
        };

        const response = await fetch('https://api.cashfree.com/pg/subscriptions', {
          method: 'POST',
          headers: cfHeaders,
          body: JSON.stringify({
            subscription_id: sub_id,
            plan_id: plan_id,
            customer_name: email.split('@')[0],
            customer_email: email,
            customer_phone: "9999999999",
            return_url: "https://tgtenders.in/payment-status?sub_id={subscription_id}"
          })
        });
        const subData = await response.json();

        await db.collection('subscriptions').insertOne({
          id: uuidv4(),
          cashfree_subscription_id: sub_id,
          email,
          plan,
          status: 'CREATED',
          short_url: subData.auth_link,
          created_at: new Date(),
        });
        
        return json({
          subscription_id: sub_id,
          plan,
          key_id: process.env.CASHFREE_APP_ID,
          short_url: subData.auth_link, // Frontend can use this link directly
        });
      } catch (err) {
        console.error('[CASHFREE SUBSCRIPTION CREATE]', err.message);
        return json({ error: 'Cashfree subscription failed' }, 502);
      }
    }

    // CASHFREE SUBSCRIPTION VERIFY
    if (path === 'subscription/verify') {
      const { subscription_id, email, plan } = body;
      if (!subscription_id) return json({ error: 'Missing fields' }, 400);
      
      const now = new Date();
      const newExpiry = await grantAccessToUser(db, email, plan, null);
      
      await db.collection('users').updateOne(
        { email: (email || '').toLowerCase() },
        {
          $set: {
            subscription_id: subscription_id,
            subscription_status: 'active',
            subscription_plan: plan,
            last_payment_at: now,
          },
        }
      );
      await db.collection('subscriptions').updateOne(
        { cashfree_subscription_id: subscription_id },
        {
          $set: {
            status: 'ACTIVE',
            activated_at: now,
          },
        }
      );
      return json({
        success: true,
        message: `Auto-renew active. Premium until ${newExpiry?.toDateString()}`,
        premium_expiry_date: newExpiry,
      });
    }

    // CASHFREE SUBSCRIPTION CANCEL
    if (path === 'subscription/cancel') {
      const email = (body.email || '').toLowerCase().trim();
      if (!email) return json({ error: 'email required' }, 400);
      const user = await db.collection('users').findOne({ email });
      const subId = user?.subscription_id;
      if (!subId) return json({ error: 'No active subscription' }, 404);
      try {
        const cfHeaders = {
          'x-client-id': process.env.CASHFREE_APP_ID,
          'x-client-secret': process.env.CASHFREE_SECRET_KEY,
          'x-api-version': '2023-08-01',
          'Content-Type': 'application/json'
        };
        await fetch(`https://api.cashfree.com/pg/subscriptions/${subId}/cancel`, {
          method: 'POST',
          headers: cfHeaders
        });

        await db.collection('users').updateOne(
          { email },
          { $set: { subscription_status: 'cancelled_pending' } }
        );
        await db.collection('subscriptions').updateOne(
          { cashfree_subscription_id: subId },
          { $set: { status: 'CANCELLED', cancelled_at: new Date() } }
        );
        return json({
          ok: true,
          message: 'Auto-renewal cancelled. You keep premium until current period ends.',
        });
      } catch (err) {
        console.error('[CASHFREE CANCEL]', err.message);
        return json({ error: 'Cancel failed' }, 502);
      }
    }

    // CASHFREE SINGLE PAYMENT ORDER
    if (path === 'payment/order') {
      const email = (body.email || '').toLowerCase().trim();
      const plan = body.plan;
      if (!email || !plan) return json({ error: 'Missing fields' }, 400);
      if (!(plan in PLAN_AMOUNTS)) return json({ error: 'Invalid plan' }, 400);
      if (plan === 'single' && !body.tenderId) {
        return json({ error: 'tenderId required for single plan' }, 400);
      }
      
      try {
        const requestObj = {
            order_amount: PLAN_AMOUNTS[plan],
            order_currency: "INR",
            customer_details: {
                customer_id: `cust_${Date.now()}`,
                customer_phone: "9999999999",
                customer_email: email
            },
            order_meta: {
                return_url: "https://tgtenders.in/payment-status?order_id={order_id}"
            }
        };

        const response = await Cashfree.PGCreateOrder("2023-08-01", requestObj);
        const order_id = response.data.order_id;

        await db.collection('payments').insertOne({
          id: uuidv4(),
          order_id: order_id,
          email,
          plan,
          tender_id: body.tenderId || null,
          amount: PLAN_AMOUNTS[plan],
          status: 'created',
          created_at: new Date(),
        });

        return json({
          order: {
            id: order_id,
            amount: PLAN_AMOUNTS[plan],
            currency: 'INR',
            plan,
            email,
            tender_id: body.tenderId || null,
            payment_session_id: response.data.payment_session_id
          }
        });
      } catch (err) {
        console.error('[CASHFREE ORDER ERROR]', err.message);
        return json({ error: err.message }, 502);
      }
    }

    // CASHFREE SINGLE PAYMENT VERIFY
    if (path === 'payment/verify') {
      const order_id = body.order_id || body.razorpay_order_id; 
      const { email, plan, tenderId } = body;
      
      if (!order_id) return json({ error: 'Missing payment fields' }, 400);

      const now = new Date();
      const expires_at =
        plan === 'month' || plan === 'year'
          ? new Date(now.getTime() + PLAN_DAYS[plan] * 24 * 60 * 60 * 1000)
          : null;

      await db.collection('payments').updateOne(
        { order_id: order_id },
        {
          $set: {
            status: 'paid',
            paid_at: now,
            expires_at,
            tender_id: tenderId || null,
            email: (email || '').toLowerCase(),
            plan,
          },
        },
        { upsert: true }
      );
      
      const newExpiry = await grantAccessToUser(db, email, plan, tenderId);
      return json({
        success: true,
        message: plan === 'single'
            ? 'Payment verified — PDF unlocked.'
            : `Payment verified — Premium active until ${newExpiry?.toDateString()}`,
        plan,
        premium_expiry_date: newExpiry,
      });
    }

    // CASHFREE WEBHOOKS (Auto background updates)
    if (path === 'payment/webhook') {
      const event = body.type || body.event;
      const data = body.data || body.payload || {};
      const now = new Date();

      // Subscription Webhooks
      if (event && event.startsWith('SUBSCRIPTION_')) {
        const subId = data.subscription?.subscription_id;
        if (event === 'SUBSCRIPTION_NEW_PAYMENT_SUCCESS' || event === 'SUBSCRIPTION_CHARGED') {
          const subDoc = await db.collection('subscriptions').findOne({ cashfree_subscription_id: subId });
          if (subDoc) {
            await grantAccessToUser(db, subDoc.email, subDoc.plan, null);
            await db.collection('users').updateOne(
              { email: subDoc.email },
              { $set: { subscription_status: 'active', last_payment_at: now } }
            );
          }
          await db.collection('subscriptions').updateOne(
            { cashfree_subscription_id: subId },
            { $set: { status: 'ACTIVE', last_charged_at: now } }
          );
        }
        if (event === 'SUBSCRIPTION_CANCELLED') {
          await db.collection('subscriptions').updateOne(
            { cashfree_subscription_id: subId },
            { $set: { status: 'CANCELLED', cancelled_at: now } }
          );
        }
        return json({ received: true, handled: event });
      }

      // One-time Payment Webhooks
      if (event === 'PAYMENT_SUCCESS_WEBHOOK') {
        const order_id = data.order?.order_id;
        if (order_id) {
          const existing = await db.collection('payments').findOne({ order_id });
          if (existing) {
            const expires_at = (existing.plan === 'month' || existing.plan === 'year')
                ? new Date(now.getTime() + PLAN_DAYS[existing.plan] * 24 * 60 * 60 * 1000)
                : null;
            await db.collection('payments').updateOne(
              { order_id },
              { $set: { status: 'paid', paid_at: now, expires_at, webhook_event: event } }
            );
            await grantAccessToUser(db, existing.email, existing.plan, existing.tender_id);
          }
        }
      }
      return json({ received: true });
    }

    if (path === 'notify') {
      if (!isAdmin(request)) return json({ error: 'Unauthorized' }, 401);
      const users = await db
        .collection('users')
        .find({}, { projection: { email: 1 } })
        .toArray();
      const emails = users.map((u) => u.email).filter(Boolean);
      const subject = body.subject || 'Update from Telangana Tenders';
      const brand = await getEmailBrand(db);
      const inner = `<div style="padding:24px;color:#374151;font-size:14px;line-height:1.6;">${
        body.html || (body.message || '').replace(/\n/g, '<br/>')
      }</div>`;
      const html = brandedEmailFrame(brand, inner);
      let sent = 0;
      for (let i = 0; i < emails.length; i += 50) {
        const batch = emails.slice(i, i + 50);
        const r = await sendBrandedEmail(batch, subject, html);
        if (!r.error) sent += batch.length;
      }
      return json({ sent });
    }

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
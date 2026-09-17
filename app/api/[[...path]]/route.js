import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { randomUUID } from 'crypto';
import { google } from 'googleapis'; // 🚀 Google Drive Integration
import { getDb, markHostUnhealthy, forceReconnect } from '@/lib/db';
import {
  uploadTenderPDF,
  fetchTenderPDFBuffer,
  isPubliclyServableUrl,
  isValidPDFBuffer,
  isR2Configured,
  uploadVaultDocument,
  fetchVaultDocumentBuffer,
} from '@/lib/cloudflare-r2';
// 🚀 SECURITY: Cashfree (Order/Verify/Webhook) + Offline Ledger logic now lives in
// lib/payments.js (a plain module, not a route.js) so it can be imported safely from
// both this catch-all route AND app/api/payments/route.js without violating
// Next.js's route.js export contract. Only thin delegating calls remain below.
import { createCashfreeOrder, verifyCashfreeOrder, handleCashfreeWebhook, recordOfflineLedgerPayment } from '@/lib/payments';
// 🚀 RBAC: resolves MD vs EMPLOYEE (and the employee's emp_id) from the ADMIN_TOKEN
// bearer or the NextAuth session cookie, for task-ownership stamping/filtering on
// bids and suggestion dispatches. See lib/staff-auth.js for the full contract.
import { resolveActorRole, requireStaff, DESIGNATIONS, normalizeDesignation, isMdEmployee, matchDesignation, isGmActor, resolveStaffDesignation, resolveClientEmail } from '@/lib/staff-auth';
import { createDriveFolder, ensureEntityDriveFolder } from '@/lib/drive';
import { findExistingClient, clientIdentFromRequest } from '@/lib/clients';
import { brandFieldsFromForm, brandFieldsFromJson, sanitizeSettingsForBrowser } from '@/lib/brand-settings';
import { allocateEmpId, ensureUniqueEmpIds } from '@/lib/emp-id';

// 🚀 STRICT RULES: భవిష్యత్తులో ఎప్పుడూ డేటా కాష్ (Cache) అవ్వకుండా కఠినమైన సెట్టింగ్స్
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

// 🚀 PERF: $text search requires a MongoDB text index on `tenders.title`. We lazily
// ensure it exists once per warm server instance (createIndex is a cheap no-op if it
// already exists) instead of on every single search request.
let tendersTextIndexEnsured = false;
async function ensureTendersTextIndex(db) {
  if (tendersTextIndexEnsured) return;
  try {
    await db.collection('tenders').createIndex({ title: 'text' });
    tendersTextIndexEnsured = true;
  } catch (err) {
    console.error('Failed to ensure tenders text index:', err);
  }
}

// 🚀 STRICT RULE: ప్రతీ API రెస్పాన్స్ కి No-Cache హెడర్స్ పంపడం
function canAccessOperatorStorage(actor) {
  if (!actor) return false;
  if (actor.role === 'MD' || actor.role === 'EMPLOYEE') return true;
  if (isGmActor(actor)) return true;
  const designation = matchDesignation(actor.designation);
  return designation === DESIGNATIONS.DOC_TEAM_TL || designation === DESIGNATIONS.DOC_TEAM_MEMBER;
}

async function requireOperatorStorageAccess(request) {
  const auth = await requireStaff(request);
  if (!auth.ok) return { ok: false, response: json({ error: auth.error }, auth.status) };
  const actor = await resolveActorRole(request);
  if (!canAccessOperatorStorage(actor)) {
    return { ok: false, response: json({ error: 'This action is restricted to staff accounts.' }, 403) };
  }
  return { ok: true, auth, actor };
}

function json(data, status = 200) {
  return NextResponse.json(data, { 
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      // 🚀 FIX (Mojibake defense-in-depth): NextResponse.json() doesn't declare a
      // charset by itself. JSON bodies are UTF-8 by spec so most clients decode
      // correctly regardless, but declaring it explicitly removes any ambiguity
      // for proxies/tools that inspect Content-Type before parsing.
      'Content-Type': 'application/json; charset=utf-8',
    }
  });
}

// 🚀 Document viewers are opened as a top-level navigation (window.open), so a JSON
// error body just dumps raw `{"error":...}` into the tab and users read it as "the PDF
// is broken". Serve a readable page for navigations and keep JSON for fetch() callers.
function documentError(request, { status, message, code, details }) {
  const wantsHtml = (request?.headers.get('accept') || '').includes('text/html');
  if (!wantsHtml) return json({ error: message, code, details }, status);

  const escape = (s) => String(s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Document unavailable</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#f1f5f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:32px;max-width:460px;
        box-shadow:0 10px 30px rgba(15,23,42,.08);text-align:center}
  h1{margin:0 0 10px;font-size:19px;color:#0a2647}
  p{margin:0;color:#475569;font-size:14px;line-height:1.6}
  code{display:inline-block;margin-top:18px;font-size:11px;color:#94a3b8}
</style></head>
<body><div class="card">
  <h1>This document can't be opened</h1>
  <p>${escape(message)}</p>
  <code>${escape(code || `HTTP ${status}`)}</code>
</div></body></html>`;

  return new NextResponse(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

// 🚀 FIX: /api/vault/upload accepts any file type, so vault docs and ledger proofs are
// frequently JPEG/PNG scans — but every document endpoint hardcoded
// `Content-Type: application/pdf`. Combined with `X-Content-Type-Options: nosniff`
// the browser refuses to render an image mislabelled as a PDF, producing an empty
// viewer. Detect the real type from the magic bytes instead of guessing.
// Vercel caps a serverless function's request body at ~4.5MB, so a bigger upload is
// rejected by the platform before our handler runs. Staying just under that keeps the
// failure inside our code where we can explain it. (Lifting this ceiling means moving to
// presigned direct-to-R2 uploads from the browser, which bypasses the function entirely.)
const VAULT_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

function sniffContentType(buffer, fileName = '') {
  const head = Buffer.from(buffer.subarray(0, 12));
  const hex = head.toString('hex');

  if (head.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (hex.startsWith('47494638')) return 'image/gif';
  if (hex.startsWith('52494646') && head.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  // ZIP container — .docx/.xlsx/.pptx and plain .zip all share this signature.
  if (hex.startsWith('504b0304')) {
    if (/\.docx$/i.test(fileName)) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (/\.xlsx$/i.test(fileName)) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return 'application/zip';
  }
  return null;
}

// 🚀 FIX (documents opening blank): every base64-backed document endpoint decoded
// with `Buffer.from(str, 'base64')`, which silently returns garbage bytes for
// malformed input instead of throwing — so a 200 response with an unreadable body was
// served and the browser showed an empty viewer with a clean console. Content-Length
// was also missing, which some PDF viewers need in order to render at all.
function streamBase64Document(request, base64, fileName = 'document.pdf') {
  if (typeof base64 !== 'string' || base64.length === 0) {
    return documentError(request, {
      status: 404,
      code: 'FILE_SOURCE_MISSING',
      message: 'The file is missing from storage. Please re-upload the document.',
    });
  }

  const cleanBase64 = base64.replace(/^data:[^;,]*(;base64)?,/, '');
  const buffer = Buffer.from(cleanBase64, 'base64');

  const contentType = sniffContentType(buffer, fileName);
  if (!contentType) {
    console.error(
      `[documents] stored base64 for "${fileName}" (${buffer.length} bytes) did not decode to a ` +
      'recognisable file. Buffer.from() silently accepts malformed base64, so the record is corrupt.'
    );
    return documentError(request, {
      status: 422,
      code: 'FILE_CORRUPT',
      message: 'The stored file is corrupted and cannot be opened. Please re-upload it.',
    });
  }

  // Images and PDFs render in-tab; anything else is safer as a download.
  const inline = contentType === 'application/pdf' || contentType.startsWith('image/');

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${fileName}"`,
      'Cache-Control': 'private, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// 🚀 FIX: CORS మరియు Preflight ఇష్యూస్ ని బ్లాక్ చేయడానికి OPTIONS మెథడ్
export async function OPTIONS(request) {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// =====================================================================
// GET REQUESTS
// =====================================================================
// 🚀 FIX: Transient network flakiness (packet loss / a single Atlas shard
// member briefly timing out — common on mobile data or unstable Wi-Fi) was
// surfacing as a hard 500 on every single dashboard call even though the DB
// itself was healthy and the very next request would succeed. Rather than
// give up on the first hiccup, retry the whole handler once after a short
// delay before returning an error to the client.
function isTransientDbError(error) {
  const text = `${error?.name || ''} ${error?.message || ''}`;
  return /timed out|ETIMEDOUT|ECONNRESET|ReplicaSetNoPrimary|MongoNetworkTimeoutError|MongoServerSelectionError|topology was destroyed/i.test(text);
}

// 🚀 The driver sometimes exposes the specific failing member directly as
// `error.address` / `error.cause.address` (e.g. "ac-htm8mso-shard-00-02...:27017"),
// and otherwise it's only mentioned inside the message text as a bare IP
// (e.g. "connection 6 to 159.41.205.74:27017 timed out", or the IPv6/NAT64
// form "[64:ff9b::9f29:cd4a]:27017"). Try both so `markHostUnhealthy` has a
// real target to blacklist for the retry.
function extractFailingHost(error) {
  const direct = error?.address || error?.cause?.address;
  if (direct) return direct;
  const text = `${error?.message || ''} ${error?.cause?.message || ''}`;
  const match = text.match(/to\s+\[?([0-9a-fA-F:.]+?)\]?:\d+\s+timed out/i);
  return match ? match[1] : null;
}

async function handleGET(request, { params }, attempt = 1) {
  // 🚀 FIX: getDb()/param parsing used to sit OUTSIDE the try block — if the DB
  // connection failed (or params were malformed) it threw an unhandled error before
  // any response body was ever written, causing empty-body 500s that broke
  // res.json() on the frontend with "Unexpected end of JSON input". Everything now
  // lives inside the try so we ALWAYS return valid JSON.
  // 🚀 DEBUG: Temporary high-visibility timing instrumentation to trace exactly
  // where Admin Dashboard requests stall — DB connect vs. query execution vs.
  // total round-trip. Remove once the production bottleneck is confirmed fixed.
  const __reqStart = Date.now();
  try {
    const __dbConnectStart = Date.now();
    const db = await getDb();
    console.log(`🔍 [DB] getDb() resolved in ${Date.now() - __dbConnectStart}ms`);

    const pathArray = params?.path || [];
    const path = pathArray.join('/');
    const { searchParams } = new URL(request.url);
    console.log(`🔍 [API GET] ENTRY path="${path}" at ${new Date().toISOString()}`);

    if (path === 'admin/stats' || path === 'api/admin/stats') {
      const __t = Date.now();
      // 🚀 PERF FIX: Revenue previously fetched every successful payment document
      // just to sum one field in JS. A $group/$sum aggregation does that sum
      // inside MongoDB itself and returns a single number — no document bodies
      // ever cross the network. $convert (with onError/onNull → 0) mirrors the
      // old `Number(p.amount) || 0` defensive fallback in case `amount` was ever
      // stored as a non-numeric string. These four independent queries also now
      // run in parallel instead of sequentially.
      const [tendersCount, usersCount, paymentsCount, revenueAgg] = await Promise.all([
        db.collection('tenders').countDocuments(),
        db.collection('users').countDocuments({ is_approved: { $ne: true }, onboarding_complete: true }),
        db.collection('payments').countDocuments({ status: 'SUCCESS' }),
        db.collection('payments').aggregate([
          { $match: { status: 'SUCCESS' } },
          { $group: { _id: null, total: { $sum: { $convert: { input: '$amount', to: 'double', onError: 0, onNull: 0 } } } } },
        ]).toArray(),
      ]);
      const totalRevenue = revenueAgg[0]?.total || 0;
      console.log(`🔍 [admin/stats] DB queries took ${Date.now() - __t}ms | TOTAL ${Date.now() - __reqStart}ms`);
      return json({ tenders: tendersCount, users: usersCount, payments: paymentsCount, revenue: totalRevenue });
    }

    if (path === 'settings' || path === 'api/settings') {
      const settings = await db.collection('settings').findOne({ id: 'brand' });
      return json({
        settings: sanitizeSettingsForBrowser(settings) || { name: 'Telangana Tenders', logo: null },
      });
    }

    // 🚀 Live Portal Traffic Counter — dedupes via cookies so polling the same
    // browser session doesn't inflate counts on every 15s refresh.
    if (path === 'analytics/visitors' || path === 'api/analytics/visitors') {
      const cookieHeader = request.headers.get('cookie') || '';
      const cookies = Object.fromEntries(
        cookieHeader.split(';').map((c) => c.trim().split('=')).filter(([k]) => k)
      );
      const todayKey = new Date().toISOString().slice(0, 10);

      const isNewVisitor = !cookies['visitor_id'];
      const isNewToday = cookies['visited_today'] !== todayKey;

      if (isNewVisitor || isNewToday) {
        const inc = {};
        if (isNewVisitor) inc.total = 1;
        if (isNewToday) inc[`daily.${todayKey}`] = 1;
        await db.collection('analytics_visitors').updateOne(
          { id: 'stats' },
          { $inc: inc },
          { upsert: true }
        );
      }

      const stats = await db.collection('analytics_visitors').findOne({ id: 'stats' });
      const response = json({ total: stats?.total || 0, today: stats?.daily?.[todayKey] || 0 });

      if (isNewVisitor) {
        response.headers.append('Set-Cookie', `visitor_id=${randomUUID()}; Path=/; Max-Age=31536000; SameSite=Lax`);
      }
      if (isNewToday) {
        response.headers.append('Set-Cookie', `visited_today=${todayKey}; Path=/; Max-Age=86400; SameSite=Lax`);
      }
      return response;
    }

    if (path === 'tenders' || path === 'api/tenders') {
      const district = searchParams.get('district');
      const month = searchParams.get('month');
      const year = searchParams.get('year');
      const scope = searchParams.get('scope');
      const q = searchParams.get('q');

      let query = {};
      if (district && district !== 'all') query.district = district;
      if (q) {
        // 🚀 PERF: Use a MongoDB text index instead of an unanchored regex scan —
        // far cheaper on large collections and lets Mongo use its own relevance/index.
        await ensureTendersTextIndex(db);
        query.$text = { $search: q };
      }

      // 🚀 FIX: Auto-Hide/Delete Expired Tenders from interface
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const __tendersQueryStart = Date.now();
      let allTenders = await db.collection('tenders')
        .find(query)
        .project({ pdf_base64: 0 }) 
        .sort({ last_date: 1 })
        .limit(300)
        .toArray();
      console.log(`🔍 [tenders] DB find().toArray() took ${Date.now() - __tendersQueryStart}ms | returned ${allTenders.length} docs`);

      const isArchive = scope === 'archive';
      let tenders = allTenders.filter(t => {
          const ms = t.last_date ? new Date(t.last_date).getTime() : NaN;
          if (Number.isNaN(ms)) return false;
          if (isArchive) return ms < today.getTime();
          return ms >= today.getTime();
      });
      tenders.sort((a, b) => {
        const aMs = a.last_date ? new Date(a.last_date).getTime() : Number.POSITIVE_INFINITY;
        const bMs = b.last_date ? new Date(b.last_date).getTime() : Number.POSITIVE_INFINITY;
        return aMs - bMs;
      });

      if (month && year && scope !== 'all') {
        tenders = tenders.filter(t => {
          if (!t.last_date) return false;
          const d = new Date(t.last_date);
          return d.getMonth() + 1 === parseInt(month) && d.getFullYear() === parseInt(year);
        });
      }
      console.log(`🔍 [tenders] EXIT | TOTAL ${Date.now() - __reqStart}ms`);
      return json({ tenders });
    }

    // 🚀 FIX: Fetch Vault Document Instantly Without Lag
    if (path === 'vault/document' || path === 'api/vault/document') {
      const email = searchParams.get('email');
      const docId = searchParams.get('docId');
      if (!email || !docId) return json({ error: 'Missing email or docId' }, 400);

      const user = await db.collection('users').findOne(
        { email: email.toLowerCase() },
        { projection: { vault_docs: { $elemMatch: { id: docId } } } }
      );
      const doc = user?.vault_docs?.[0];

      if (!doc) return documentError(request, { status: 404, code: 'DOC_NOT_FOUND', message: 'This vault document no longer exists.' });

      const vaultFileName = doc.file_name || 'document.pdf';

      // 🚀 Only redirect when the URL is genuinely public. The private R2 S3 endpoint
      // answers unsigned browser requests with a 401 XML body, which renders as a blank
      // viewer — so anything else must be streamed through here with credentials.
      if (doc.file_url && isPubliclyServableUrl(doc.file_url)) {
        return NextResponse.redirect(doc.file_url, 307);
      }

      if (doc.file_r2_key || doc.file_url) {
        const buffer = await fetchVaultDocumentBuffer({
          file_r2_key: doc.file_r2_key,
          file_url: doc.file_url,
          file_name: doc.file_name,
          email: email.toLowerCase(),
        });
        if (buffer && buffer.length > 0) {
          const contentType = sniffContentType(buffer, vaultFileName) || doc.content_type || 'application/octet-stream';
          return new NextResponse(new Uint8Array(buffer), {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Content-Length': String(buffer.length),
              'Content-Disposition': `inline; filename="${vaultFileName}"`,
              'Cache-Control': 'private, max-age=0, must-revalidate',
              'X-Content-Type-Options': 'nosniff',
            },
          });
        }
        return documentError(request, {
          status: 404,
          code: 'FILE_SOURCE_MISSING',
          message: 'This document is missing from secure storage. Please re-upload it.',
        });
      }

      // Documents uploaded before the move to R2 still carry the blob inline.
      return streamBase64Document(request, doc.file_base64, vaultFileName);
    }

    if (path === 'tenders/calendar' || path === 'api/tenders/calendar') {
      const month = parseInt(searchParams.get('month'));
      const year = parseInt(searchParams.get('year'));

      // 🚀 PERF FIX: `last_date` is stored as a zero-padded ISO date string
      // (e.g. "2026-09-01"), which sorts identically to a real date lexically.
      // Filtering to the target month directly in the query — instead of
      // pulling every tender in the entire collection and checking each one in
      // JS — lets MongoDB do the filtering, so this stops scaling linearly with
      // total tenders as the collection grows.
      const rangeStart = `${year}-${String(month).padStart(2, '0')}-01`;
      const nextMonth = month === 12 ? 1 : month + 1;
      const nextYear = month === 12 ? year + 1 : year;
      const rangeEnd = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

      const tenders = await db.collection('tenders')
        .find({ last_date: { $gte: rangeStart, $lt: rangeEnd } })
        .project({ pdf_base64: 0 })
        .toArray();

      const days = {};
      tenders.forEach(t => {
        const d = new Date(t.last_date);
        const day = d.getDate();
        if (!days[day]) days[day] = [];
        days[day].push(t);
      });
      return json({ days });
    }

    if (path === 'access' || path === 'api/access') {
      const email = searchParams.get('email');
      if (!email) return json({ subscription: null });
      const user = await db.collection('users').findOne({ email: email.toLowerCase() });
      
      const now = new Date();
      if (user?.subscription?.status === 'active' && user?.subscription?.expires_at) {
         const expiry = new Date(user.subscription.expires_at);
         if (expiry < now) user.subscription.status = 'expired';
      }
      return json({ subscription: user?.subscription || null });
    }

    if (pathArray.length === 3 && (pathArray[0] === 'tenders' || pathArray[0] === 'api') && pathArray[2] === 'pdf') {
      const tenderId = pathArray[1];
      const email = searchParams.get('email');
      const role = searchParams.get('role');
      const format = searchParams.get('format'); 

      if (!email) {
        return documentError(request, {
          status: 400,
          code: 'EMAIL_REQUIRED',
          message: 'You are not signed in. Please log in again and reopen the tender.',
        });
      }

      const user = await db.collection('users').findOne(
        { email: email.toLowerCase() },
        { projection: { subscription: 1, purchases: 1 } }
      );
      
      let hasSubscription = false;
      const now = new Date();
      if (user?.subscription?.status === 'active' && user?.subscription?.expires_at) {
          const expiry = new Date(user.subscription.expires_at);
          if (expiry > now) hasSubscription = true;
      }
      
      const hasBoughtSingle = user?.purchases?.includes(tenderId);

      // 🚀 FIX: Give free access to Clients as well
      if (role === 'client' || role === 'employee' || role === 'admin' || email === 'employee@tgtenders.in' || email === process.env.ADMIN_EMAIL) {
          hasSubscription = true; 
      }

      if (!hasSubscription && !hasBoughtSingle) {
        return documentError(request, {
          status: 402,
          code: 'PAYMENT_REQUIRED',
          message: 'This tender document is locked. Purchase this tender or an active subscription to view it.',
        });
      }

      // 🚀 PERF: `pdf_base64` can be several MB of BSON. Resolve the lightweight
      // metadata first and only pull the blob if we actually end up needing it.
      const metaProjection = {
        projection: { pdf_url: 1, pdf_filename: 1, title: 1, file_url: 1, pdf_r2_key: 1 },
      };
      const idCandidates = [];
      if (ObjectId.isValid(tenderId)) {
        try { idCandidates.push({ _id: new ObjectId(tenderId) }); } catch (_) { /* not a real ObjectId */ }
      }
      idCandidates.push({ _id: tenderId }, { id: tenderId });

      let tender = null;
      let tenderQuery = null;
      for (const candidate of idCandidates) {
        tender = await db.collection('tenders').findOne(candidate, metaProjection);
        if (tender) { tenderQuery = candidate; break; }
      }
      if (!tender) {
        return documentError(request, {
          status: 404,
          code: 'TENDER_NOT_FOUND',
          message: 'This tender no longer exists. It may have been removed by the admin.',
        });
      }

      const pdfFileName = tender.pdf_filename || 'tender_document.pdf';
      const pdfHeaders = (buffer) => ({
        'Content-Type': 'application/pdf',
        'Content-Length': String(buffer.length),
        'Content-Disposition': `inline; filename="${pdfFileName}"`,
        'Cache-Control': 'private, max-age=0, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      });

      const fileUrl = String(tender.pdf_url || tender.file_url || '').trim();

      // 🚀 FIX (blank PDF viewer): we used to 307-redirect to `pdf_url` unconditionally.
      // When CLOUDFLARE_R2_PUBLIC_URL isn't configured, that URL is the private
      // `*.r2.cloudflarestorage.com` S3 API endpoint, which rejects unsigned browser
      // requests with a 401 XML body — the viewer renders it as an empty page. Only
      // redirect to a genuinely public domain; otherwise proxy the bytes ourselves.
      if (fileUrl && format !== 'json' && isPubliclyServableUrl(fileUrl)) {
        try {
          return NextResponse.redirect(new URL(fileUrl).toString(), 307);
        } catch (_) {
          console.warn('[tenders/pdf] stored pdf_url is not a valid absolute URL:', fileUrl);
        }
      }

      // Source 1: the blob stored directly on the tender document.
      const blobDoc = await db.collection('tenders').findOne(tenderQuery, {
        projection: { pdf_base64: 1 },
      });
      if (typeof blobDoc?.pdf_base64 === 'string' && blobDoc.pdf_base64.length > 0) {
        if (format === 'json') {
          return json({
            pdf_base64: blobDoc.pdf_base64,
            pdf_filename: pdfFileName,
            title: tender.title,
            watermarked: true,
          });
        }
        const cleanBase64 = blobDoc.pdf_base64.replace(/^data:[^;,]*(;base64)?,/, '');
        const pdfBuffer = Buffer.from(cleanBase64, 'base64');
        // Buffer.from never throws on malformed base64 — it returns garbage. Validate
        // before serving so a corrupt record doesn't masquerade as a blank PDF.
        if (isValidPDFBuffer(pdfBuffer)) {
          return new NextResponse(new Uint8Array(pdfBuffer), { status: 200, headers: pdfHeaders(pdfBuffer) });
        }
        console.warn(`[tenders/pdf] pdf_base64 on tender ${tenderId} is not a valid PDF; trying R2.`);
      }

      // Source 2: authenticated read from R2 — covers both a private pdf_url and the
      // case where the upload succeeded but pdf_url was never persisted.
      const r2Buffer = await fetchTenderPDFBuffer({
        pdf_url: fileUrl,
        pdf_filename: tender.pdf_filename,
        pdf_r2_key: tender.pdf_r2_key,
      });
      if (r2Buffer && isValidPDFBuffer(r2Buffer)) {
        if (format === 'json') {
          return json({
            pdf_base64: r2Buffer.toString('base64'),
            pdf_filename: pdfFileName,
            title: tender.title,
            watermarked: true,
          });
        }
        return new NextResponse(new Uint8Array(r2Buffer), { status: 200, headers: pdfHeaders(r2Buffer) });
      }

      // Source 3: a non-public URL we couldn't map to an R2 key (e.g. an external
      // host). Fetch it server-side rather than bouncing the browser at it.
      if (fileUrl) {
        try {
          const upstream = await fetch(fileUrl, { cache: 'no-store' });
          if (upstream.ok) {
            const proxied = Buffer.from(await upstream.arrayBuffer());
            if (isValidPDFBuffer(proxied)) {
              if (format === 'json') {
                return json({
                  pdf_base64: proxied.toString('base64'),
                  pdf_filename: pdfFileName,
                  title: tender.title,
                  watermarked: true,
                });
              }
              return new NextResponse(new Uint8Array(proxied), { status: 200, headers: pdfHeaders(proxied) });
            }
          }
          console.warn(`[tenders/pdf] upstream fetch of ${fileUrl} returned ${upstream.status}`);
        } catch (fetchErr) {
          console.warn(`[tenders/pdf] upstream fetch of ${fileUrl} failed:`, fetchErr?.message || fetchErr);
        }
      }

      // 🚀 Explicit, actionable failure. The old generic "PDF not found" made a
      // missing *file* look like a broken *route*. Tenders created while the R2
      // credentials were absent have neither pdf_url nor pdf_base64 and genuinely
      // need the document re-uploaded.
      console.error('[tenders/pdf] no readable source for tender', tenderId, {
        has_pdf_url: Boolean(fileUrl),
        pdf_url_public: fileUrl ? isPubliclyServableUrl(fileUrl) : null,
        has_pdf_base64: typeof blobDoc?.pdf_base64 === 'string',
        has_pdf_r2_key: Boolean(tender.pdf_r2_key),
        r2_configured: isR2Configured(),
      });
      return documentError(request, {
        status: 404,
        code: 'PDF_SOURCE_MISSING',
        message: 'The PDF file for this tender is missing from storage. Please ask the admin to re-upload the tender document.',
        details: {
          has_pdf_url: Boolean(fileUrl),
          has_pdf_base64: typeof blobDoc?.pdf_base64 === 'string',
          has_pdf_r2_key: Boolean(tender.pdf_r2_key),
          r2_configured: isR2Configured(),
        },
      });
    }

    if (path === 'tickets' || path === 'api/tickets') {
      const email = searchParams.get('email');
      const role = searchParams.get('role');
      let query = {};
      if (email && role !== 'admin') query.client_email = email.toLowerCase();
      
      const tickets = await db.collection('tickets').find(query).sort({ created_at: -1 }).toArray();
      return json({ tickets });
    }

    // 🚀 FIX: Fetch Guest Queries Database
    if (path === 'guest-queries' || path === 'api/guest-queries') {
      const queries = await db.collection('guest_queries').find({}).sort({ created_at: -1 }).toArray();
      return json({ queries });
    }

    if (path === 'users/pending' || path === 'api/users/pending') {
      const users = await db.collection('users')
         .find({ is_approved: { $ne: true }, onboarding_complete: true })
         .project({ "vault_docs.file_base64": 0 }) // 🚀 FIX: Block heavy PDF loads
         .sort({ created_at: -1 })
         .toArray();
      return json({ users });
    }

    // NOTE: GET /api/ai/drafts is handled by the dedicated app/api/ai/drafts/route.js
    // (Next.js always prefers a static route over this catch-all), which also matches
    // both 'Pending Review' and 'Pending Verification' statuses. A stale duplicate used
    // to live here — removed to avoid the two copies drifting apart again.
    
    if (path === 'users/approved' || path === 'api/users/approved') {
      const __t = Date.now();
      const users = await db.collection('users')
         .find({ is_approved: true })
         .project({ "vault_docs.file_base64": 0 }) // 🚀 FIX: Block heavy PDF loads
         .sort({ created_at: -1 })
         .toArray();
      console.log(`🔍 [users/approved] DB query took ${Date.now() - __t}ms | returned ${users.length} clients | TOTAL ${Date.now() - __reqStart}ms`);
      return json({ users });
    }
    if (path === 'client-requests' || path === 'api/client-requests') {
      const email = String(searchParams.get('email') || '').trim().toLowerCase();
      const actor = await resolveActorRole(request);
      const canStaffList = actor.role === 'MD' || isGmActor(actor);
      let query = {};
      if (email) {
        const clientEmail = await resolveClientEmail(request);
        if (clientEmail !== email && !canStaffList) {
          return json({ error: 'Not allowed to view these requests.' }, 403);
        }
        query.client_email = email;
      } else if (!canStaffList) {
        return json({ error: 'Only GM can view bid support requests.' }, 403);
      }
      const requests = await db.collection('client_requests').find(query).sort({ created_at: -1 }).toArray();
      return json({ requests });
    }

    if (pathArray.length === 3 && pathArray[0] === 'dispatches' && pathArray[2] === 'file') {
      const taskId = pathArray[1];
      if (!ObjectId.isValid(taskId)) return json({ error: 'Invalid dispatch ID' }, 400);
      const dispatch = await db.collection('dispatches').findOne(
        { _id: new ObjectId(taskId) },
        { projection: { file_base64: 1, file_name: 1 } }
      );
      if (!dispatch) return documentError(request, { status: 404, code: 'DISPATCH_NOT_FOUND', message: 'This dispatch no longer exists.' });
      return streamBase64Document(request, dispatch.file_base64, dispatch.file_name || 'attachment.pdf');
    }

    if (path === 'dispatches' || path === 'api/dispatches') {
      const targetId = searchParams.get('target_id');
      let query = {};
      if (targetId) query.target_id = { $regex: new RegExp(`^${targetId}$`, 'i') }; 
      else {
        // 🚀 RBAC: Employee dashboard call (no target_id — it loads everything and
        // splits client_alert vs employee_task client-side, see mdTasks in
        // app/employee/page.js). Isolate only the 'client_alert' suggestions this
        // employee authored to their own employee_id; 'employee_task' (MD -> employee
        // assignments) and every other target_type stay fully visible so the
        // employee still sees work the MD assigned to them. MD/unresolved: unfiltered.
        const actor = await resolveActorRole(request);
        if (actor.role === 'EMPLOYEE') {
          query.$or = [
            { target_type: { $ne: 'client_alert' } },
            { target_type: 'client_alert', employee_id: actor.empId },
          ];
        }
      }
      const dispatches = await db.collection('dispatches')
         .find(query)
         .project({ file_base64: 0 }) // 🚀 FIX: Block heavy task attachment loads
         .sort({ created_at: -1 })
         .toArray();
      return json({ dispatches });
    }

    // 🚀 RBAC: MD-only global module — every officer's client_alert tender
    // suggestions across the whole team, with employee attribution, so the MD can
    // see who suggested what without any employee seeing a teammate's suggestions
    // (that isolation lives in the plain 'dispatches' branch above).
    if (path === 'dispatches/suggestions' || path === 'api/dispatches/suggestions') {
      const actor = await resolveActorRole(request);
      if (actor.role !== 'MD') return json({ error: 'This view is restricted to the MD.' }, 403);

      const [suggestions, clientDirectory] = await Promise.all([
        db.collection('dispatches').find({ target_type: 'client_alert' }).sort({ created_at: -1 }).toArray(),
        db.collection('users').find({}, { projection: { email: 1, company_name: 1, client_name: 1, name: 1, client_id: 1 } }).toArray(),
      ]);

      // Same in-memory-map lookup pattern as `nameByEmail` in the finance/ledger
      // handler below — target_id on a client_alert dispatch is always the
      // client's email (proved by the client-dashboard read at target_id: user.email).
      const nameByEmail = new Map(
        clientDirectory.map(u => [String(u.email || '').toLowerCase(), u.company_name || u.client_name || u.name || u.email])
      );

      const enriched = suggestions.map(s => ({
        ...s,
        client_display_name: nameByEmail.get(String(s.target_id || '').toLowerCase()) || s.target_id || 'Unknown Client',
        employee_name: s.employee_name || 'Legacy / Unassigned',
      }));

      return json({ suggestions: enriched });
    }

    if (path === 'gov-officers' || path === 'api/gov-officers') {
      const officers = await db.collection('gov_officers').find({}).sort({ created_at: -1 }).toArray();
      return json({ officers });
    }

    // 🚀 Operator Docs GET
    if (pathArray.length === 4 && pathArray[0] === 'operator' && pathArray[1] === 'docs' && pathArray[3] === 'file') {
       const gate = await requireOperatorStorageAccess(request);
       if (!gate.ok) return gate.response;
       const docId = pathArray[2];
       if (!ObjectId.isValid(docId)) return json({ error: 'Invalid document ID' }, 400);
       const doc = await db.collection('operator_storage').findOne(
         { _id: new ObjectId(docId) },
         { projection: { file_base64: 1, name: 1 } }
       );
       if (!doc) return documentError(request, { status: 404, code: 'DOC_NOT_FOUND', message: 'This document no longer exists in operator storage.' });
       return streamBase64Document(request, doc.file_base64, doc.name || 'document.pdf');
    }

    if (path === 'operator/docs' || path === 'api/operator/docs') {
       const gate = await requireOperatorStorageAccess(request);
       if (!gate.ok) return gate.response;
       const docs = await db.collection('operator_storage')
         .find({})
         .project({ file_base64: 0 }) // 🚀 FIX: Block heavy storage loads
         .sort({ created_at: -1 })
         .toArray();
       return json({ docs });
    }
    
    if (path === 'bids' || path === 'api/bids') {
      const clientEmail = searchParams.get('client_email');
      let query = {};
      if (clientEmail) {
        // Client's own "My Bids" view — scoped by client, never by employee.
        query.client_email = clientEmail.toLowerCase();
      } else {
        // 🚀 RBAC: Employee dashboard call (no client_email). Strictly isolate to
        // bids this employee created/claimed; MD (and unresolved/legacy callers)
        // keep the unfiltered global view.
        const actor = await resolveActorRole(request);
        if (actor.role === 'EMPLOYEE') query.employee_id = actor.empId;
      }
      const bids = await db.collection('bids').find(query).sort({ created_at: -1 }).toArray();
      return json({ bids });
    }

    // 🚀 RBAC: MD-only global module — every live (non-terminal) bid across the
    // whole team, with employee attribution.
    if (path === 'bids/tracking' || path === 'api/bids/tracking') {
      const actor = await resolveActorRole(request);
      if (actor.role !== 'MD') return json({ error: 'This view is restricted to the MD.' }, 403);

      const [tracking, clientDirectory] = await Promise.all([
        db.collection('bids').find({ status: { $nin: ['Won', 'Lost'] } }).sort({ created_at: -1 }).toArray(),
        db.collection('users').find({}, { projection: { email: 1, company_name: 1, client_name: 1, name: 1, client_id: 1 } }).toArray(),
      ]);

      const nameByEmail = new Map(
        clientDirectory.map(u => [String(u.email || '').toLowerCase(), u.company_name || u.client_name || u.name || u.email])
      );

      const enriched = tracking.map(b => ({
        ...b,
        client_display_name: nameByEmail.get(String(b.client_email || '').toLowerCase()) || b.client_email || 'Unknown Client',
        employee_name: b.employee_name || 'Legacy / Unassigned',
      }));

      return json({ tracking: enriched });
    }

    if (path === 'employees' || path === 'api/employees') {
      const actor = await resolveActorRole(request);
      const isMd = actor.role === 'MD';
      const isGm = isGmActor(actor);
      const isTl = matchDesignation(actor.designation) === DESIGNATIONS.DOC_TEAM_TL;

      let docs = [];
      if (isMd) {
        docs = await db.collection('employees').find({}).sort({ created_at: -1 }).toArray();
      } else if (isGm) {
        const all = await db.collection('employees').find({
          deleted: { $ne: true },
          active: { $ne: false },
        }).sort({ created_at: -1 }).toArray();
        docs = all.filter((emp) => {
          const role = resolveStaffDesignation(emp);
          return role === DESIGNATIONS.DOC_TEAM_TL || role === DESIGNATIONS.DOC_TEAM_MEMBER;
        });
      } else if (isTl && actor.empId) {
        docs = await db.collection('employees').find({
          $or: [{ emp_id: actor.empId }, { team_id: actor.empId }],
          deleted: { $ne: true },
          active: { $ne: false },
        }).sort({ created_at: -1 }).toArray();
      } else if (actor.role === 'EMPLOYEE' && actor.empId) {
        docs = await db.collection('employees').find({
          emp_id: actor.empId,
          deleted: { $ne: true },
          active: { $ne: false },
        }).toArray();
      }
      return json({ team: docs });
    }

    if (path === 'finance/ledger' || path === 'api/finance/ledger') {
      // 🚀 FIX: Cashfree payments only ever landed in the `payments` collection, so the
      // Balance Sheet Book (which reads `finance_ledger`) showed offline collections
      // only, while the Net Balance figure added online revenue on top — the money was
      // in the total but had no matching line item. Successful online payments are now
      // projected into the same ledger view as read-only CREDIT rows. Doing it on read
      // rather than writing duplicate ledger documents means every historical payment
      // shows up immediately and there is no way for the two stores to drift apart.
      const [manualTxns, onlinePayments, clientDirectory] = await Promise.all([
        db.collection('finance_ledger').find({}).project({ proof_base64: 0 }).sort({ created_at: -1 }).toArray(),
        db.collection('payments').find({ status: 'SUCCESS' }).sort({ paid_at: -1 }).toArray(),
        db.collection('users').find({}, { projection: { email: 1, company_name: 1, client_name: 1, name: 1, client_id: 1 } }).toArray(),
      ]);

      const nameByEmail = new Map(
        clientDirectory.map(u => [String(u.email || '').toLowerCase(), u.company_name || u.client_name || u.name || u.email])
      );

      const onlineTxns = onlinePayments.map(p => {
        const email = String(p.email || '').toLowerCase();
        return {
          _id: `online-${p.order_id || p._id}`,
          type: 'CREDIT',
          amount: Number(p.amount) || 0,
          reason: p.reason || `${p.plan === 'single' ? 'Tender/Service' : `${p.plan} subscription`} payment`,
          client_id: email || 'N/A',
          client_name: nameByEmail.get(email) || email,
          email,
          payment_mode: 'ONLINE',
          source: 'cashfree',
          order_id: p.order_id || null,
          // Projected from `payments`, so there is no ledger document to edit or delete.
          readonly: true,
          created_at: p.paid_at || p.created_at || new Date(),
        };
      });

      // Oldest → newest so each row can carry the balance as it stood after that entry,
      // then flipped back to newest-first for display.
      const chronological = [...manualTxns, ...onlineTxns]
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      let running = 0;
      for (const txn of chronological) {
        running += (txn.type === 'DEBIT' ? -1 : 1) * (Number(txn.amount) || 0);
        txn.running_balance = running;
      }
      const transactions = chronological.reverse();

      const sum = (rows, type) => rows
        .filter(t => t.type === type)
        .reduce((total, t) => total + (Number(t.amount) || 0), 0);

      // The MD can also tag a hand-entered ledger row as ONLINE (a bank transfer, for
      // example), so the split follows how the money arrived rather than which
      // collection it lives in.
      const manualOnline = manualTxns.filter(t => t.payment_mode === 'ONLINE');
      const manualOffline = manualTxns.filter(t => t.payment_mode !== 'ONLINE');

      const offlineBalance = sum(manualOffline, 'CREDIT') - sum(manualOffline, 'DEBIT');
      const onlineBalance = sum(manualOnline, 'CREDIT') - sum(manualOnline, 'DEBIT') + sum(onlineTxns, 'CREDIT');

      return json({
        transactions,
        balance: offlineBalance + onlineBalance,
        breakdown: { offline: offlineBalance, online: onlineBalance },
        online_payments: onlineTxns,
      });
    }

    if (path === 'me' || path === 'api/me') {
      const ident = clientIdentFromRequest(request) || searchParams.get('email') || '';
      if (!ident) return json({ error: 'Client identity required' }, 400);

      const found = await findExistingClient(db, ident);
      if (!found) return json({ error: 'Client not found' }, 404);

      const user = await db.collection('users').findOne(
        { _id: found._id },
        { projection: { "vault_docs.file_base64": 0, "officer_queries.file_base64": 0 } }
      );
      if (!user) return json({ error: 'Client not found' }, 404);

      const email = String(user.email || '').toLowerCase();

      // 🚀 PERF FIX: These five lookups are all independent of each other (none
      // depends on another's result) but were previously awaited one-at-a-time,
      // stacking up their round-trip latencies serially. Running them through a
      // single Promise.all lets them execute concurrently instead.
      const purchaseObjectIds = (user.purchases && user.purchases.length > 0)
        ? user.purchases.map(id => { try { return new ObjectId(id); } catch (e) { return id; } })
        : null;

      const [tendersData, payments, custom_requests, active_bids, action_alerts] = await Promise.all([
        purchaseObjectIds
          ? db.collection('tenders')
              .find({ _id: { $in: purchaseObjectIds } })
              .project({ title: 1, department: 1, district: 1 })
              .toArray()
          : Promise.resolve([]),
        db.collection('payments')
          .find({ email: email.toLowerCase(), status: 'SUCCESS' })
          .sort({ paid_at: -1 })
          .toArray(),
        db.collection('client_requests').find({ client_email: email.toLowerCase() }).sort({ created_at: -1 }).toArray(),
        db.collection('bids').find({ client_email: email.toLowerCase() }).sort({ created_at: -1 }).toArray(),
        db.collection('dispatches').find({
          target_type: 'client_alert',
          $or: [
            { target_id: email },
            { target_id: user.email },
          ],
        }).sort({ created_at: -1 }).toArray(),
      ]);

      const unlocked_tenders = tendersData.map(t => ({
        id: t._id.toString(),
        title: t.title,
        department: t.department,
        district: t.district
      }));

       // 🚀 FIX: Calculate Contract Values and add to Total Revenue
       const won_bids = active_bids.filter(b => b.status === 'Won');
       const won_contracts_value = won_bids.reduce((sum, b) => {
           const val = Number(String(b.contract_value || '0').replace(/[^0-9.-]+/g,""));
           return sum + val;
       }, 0);
       const total_revenue = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0) + won_contracts_value;

       const calculatedStats = {
          recommended: action_alerts.filter(a => a?.subject?.includes('Suggestion') && a.status !== 'Completed').length,
          participated: active_bids.length,
          ongoing: active_bids.filter(b => b.status !== 'Won' && b.status !== 'Lost').length,
          won: won_bids.length,
          lost: active_bids.filter(b => b.status === 'Lost').length,
          revenue: total_revenue
       };
      
      return json({
        email,
        client_id: user.client_id || null,
        unlocked_tenders: unlocked_tenders,
        payments: payments,
        auto_renew: user.auto_renew !== false,
        onboarding_complete: user.onboarding_complete || false,
        is_approved: user.is_approved || false,
        profile: {
          company_type: user.company_type || '',
          has_gst: user.has_gst || false,
          has_msme: user.has_msme || false,
          has_iso: user.has_iso || false,
          client_name: user.client_name || '',
          company_name: user.company_name || '',
          phone: user.phone || '',
          address: user.address || '',
          service_category: user.service_category || '',
          documents: user.documents || {},
          profile_score: user.profile_score || 0
        },
        action_alerts: action_alerts || [],
        emd_ledger: user.emd_ledger || [],
        tender_workspaces: user.tender_workspaces || [],
        custom_requests: custom_requests || [],
        active_bids: active_bids || [],
        officer_queries: user.officer_queries || [],
        // 👆 (పైన ఉండే కోడ్: "api/me" కి సంబంధించిన చివర భాగం ఇది)
        pending_payments: user.pending_payments || [],
        vault_docs: user.vault_docs || [], 
        stats: calculatedStats 
      });
    }
    // 🚀 FIX: Live Tracking GET route for Admin Dashboard
    if (path === 'payments/requests' || path === 'api/payments/requests') {
       // 🚀 PERF FIX: `users` documents average ~1.5MB (embedded vault_docs/
       // officer_queries base64 attachments). This endpoint only ever reads
       // `email` + `pending_payments`, so an inclusion projection fetches just
       // those two fields instead of dragging every user's full profile
       // (PDFs included) across the network on every poll.
       const usersWithPayments = await db.collection('users').find(
           { pending_payments: { $exists: true, $not: { $size: 0 } } },
           { projection: { email: 1, pending_payments: 1 } }
       ).toArray();

       let allRequests = [];
       usersWithPayments.forEach(user => {
           user.pending_payments.forEach(req => {
               const st = String(req.status || '').toUpperCase();
               if (st !== 'PAID' && st !== 'SUCCESS' && st !== 'CANCELLED' && st !== 'FAILED') {
                   allRequests.push({
                       id: req.id,
                       db_id: req.id, 
                       client_id: user.email,
                       amount: req.amount,
                       reason: req.reason,
                       status: req.status === 'UNPAID' ? 'sent' : req.status,
                       sent_time: new Date(req.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
                       created_at: req.date
                   });
               }
           });
       });

       allRequests.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
       return json({ requests: allRequests });
    }

    // ⬆️ ఇక్కడి వరకు పేస్ట్ చేయాలి ⬆️

    // 👇 (కింద ఉండే పాత కోడ్: GET ఫంక్షన్ ముగింపు ఇది)
    return json({ error: 'GET endpoint not found', path }, 404);
  } catch (error) {
    // 🔍 DEBUG: This is exactly what fires if getDb() times out / MongoDB is
    // unreachable — check the error message + elapsed time in Vercel logs first.
    console.error(`🔍 [API GET] ERROR after ${Date.now() - __reqStart}ms:`, error);

    if (isTransientDbError(error) && attempt < 2) {
      const badHost = extractFailingHost(error);
      if (badHost) {
        // 🚀 Exclude the specific node that just failed from the next
        // connection attempt entirely, instead of blindly retrying and
        // risking landing on the same broken member again.
        markHostUnhealthy(badHost);
        forceReconnect();
      }
      console.warn(`🔍 [API GET] Transient DB error${badHost ? ` (bad host: ${badHost})` : ''}, retrying once (attempt ${attempt + 1})...`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      return handleGET(request, { params }, attempt + 1);
    }

    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET(request, { params }) {
  return handleGET(request, { params });
}

// =====================================================================
// PUT REQUESTS (Updating Data)
// =====================================================================
export async function PUT(request, { params }) {
  // 🚀 FIX: Entire handler (db connection + param parsing included) now lives inside
  // the try/catch so a failure never produces an empty, unparseable response body.
  try {
     const db = await getDb();
     const pathArray = params?.path || [];
     const path = pathArray.join('/');

     const body = await request.json().catch(() => null);
     if (!body) return json({ error: 'Invalid JSON body' }, 400);

     if (path === 'employees' || path === 'api/employees') {
        const actor = await resolveActorRole(request);
        if (actor.role !== 'MD' && !isGmActor(actor)) {
          return json({ error: 'Only MD or GM can update employees.' }, 403);
        }
        const url = new URL(request.url);
        const empId = String(url.searchParams.get('id') || body.emp_id || '').trim();
        if (!empId) return json({ error: 'Missing Employee ID' }, 400);
        const existing = ObjectId.isValid(empId)
          ? await db.collection('employees').findOne({ _id: new ObjectId(empId) })
          : await db.collection('employees').findOne({ emp_id: empId });
        if (!existing) return json({ error: 'Employee not found' }, 404);

        const nextDesignation = body.designation
          ? normalizeDesignation(body.designation)
          : existing.designation;
        if (isGmActor(actor) && nextDesignation === DESIGNATIONS.GM) {
          return json({ error: 'GM can update TL and Member only.' }, 403);
        }

        const $set = { updated_at: new Date() };
        if (body.name != null) $set.name = String(body.name).trim();
        if (body.email != null) $set.email = String(body.email).trim().toLowerCase();
        if (body.password != null && String(body.password).trim()) $set.password = String(body.password);
        if (body.designation != null) {
          $set.designation = nextDesignation;
          $set.role = body.role || nextDesignation;
        }
        if (nextDesignation === DESIGNATIONS.DOC_TEAM_TL) {
          $set.team_id = existing.emp_id;
        } else if (body.team_id != null) {
          $set.team_id = String(body.team_id).trim() || null;
        }

        await db.collection('employees').updateOne({ _id: existing._id }, { $set });
        const updated = await db.collection('employees').findOne({ _id: existing._id });
        return json({ success: true, employee: updated });
     }

     if (pathArray.length === 2 && (pathArray[0] === 'tenders' || pathArray[0] === 'api')) {
        const gate = await requireOperatorStorageAccess(request);
        if (!gate.ok) return gate.response;
        const tenderId = pathArray[1];
        if (!ObjectId.isValid(tenderId)) return json({ error: 'Invalid Tender ID' }, 400);
        let updateFields = { ...body, updated_at: new Date() };
        delete updateFields._id; 

        // 🚀 FIX: Editing a tender with a new PDF crashed the server because the raw
        // base64 was passed straight to MongoDB (exceeding the 16MB BSON doc limit /
        // never uploaded to R2). Mirror the same Cloudflare R2 offload used on create.
        const unsetFields = {};
        let storageWarning = null;

        if (updateFields.pdf_base64) {
           const cleanBase64 = updateFields.pdf_base64.replace(/^data:[^;,]*(;base64)?,/, '');
           const fileBuffer = Buffer.from(cleanBase64, 'base64');

           if (!isValidPDFBuffer(fileBuffer)) {
              return json({ error: 'The uploaded file is not a readable PDF. Please re-select the file and try again.' }, 400);
           }

           try {
              const safeFileName = `${Date.now()}-${updateFields.pdf_filename || 'tender.pdf'}`;
              const uploaded = await uploadTenderPDF(fileBuffer, safeFileName);
              if (uploaded?.url) {
                 updateFields.pdf_url = uploaded.url;
                 updateFields.pdf_r2_key = uploaded.key;
                 delete updateFields.pdf_base64;
                 // 🚀 FIX: `delete` only drops the field from this $set payload — the
                 // OLD pdf_base64 stayed on the document, and since the reader prefers
                 // the in-document blob it kept serving the previous file forever.
                 // Explicitly clear it so the replacement actually takes effect.
                 unsetFields.pdf_base64 = '';
              } else {
                 storageWarning = isR2Configured()
                    ? 'Cloudflare R2 upload failed. The PDF was stored in the database instead.'
                    : 'Cloudflare R2 is not configured on this server. The PDF was stored in the database instead.';
                 // The new blob stays in updateFields, so drop the now-stale R2 pointers.
                 unsetFields.pdf_url = '';
                 unsetFields.pdf_r2_key = '';
                 delete updateFields.pdf_url;
                 delete updateFields.pdf_r2_key;
                 console.error(`Tender PDF upload to Cloudflare R2 failed during edit; keeping pdf_base64 so the file remains readable. ${storageWarning}`);
              }
           } catch (uploadError) {
              storageWarning = 'Cloudflare R2 upload errored. The PDF was stored in the database instead.';
              console.error('Failed to process tender PDF for upload during edit:', uploadError);
           }
        }

        const updateDoc = { $set: updateFields };
        if (Object.keys(unsetFields).length > 0) updateDoc.$unset = unsetFields;

        await db.collection('tenders').updateOne({ _id: new ObjectId(tenderId) }, updateDoc);
        return json({ success: true, message: 'Tender Updated', storage_warning: storageWarning });
     }

     if (path === 'client-requests/reply' || path === 'api/client-requests/reply') {
        const actor = await resolveActorRole(request);
        if (!isGmActor(actor)) return json({ error: 'Only GM can process bid support requests.' }, 403);
        const { req_id, status, reply } = body;
        if (!ObjectId.isValid(req_id)) return json({ error: 'Invalid Request ID' }, 400);
        await db.collection('client_requests').updateOne(
           { _id: new ObjectId(req_id) },
           { $set: { status, reply, updated_at: new Date() } }
        );
        return json({ success: true, message: 'Request Updated' });
     }

     if (path === 'client-requests/assign' || path === 'api/client-requests/assign') {
        const actor = await resolveActorRole(request);
        if (!isGmActor(actor)) return json({ error: 'Only GM can assign bid support requests.' }, 403);
        const { req_id, emp_id, emp_name, status, reply } = body;
        if (!ObjectId.isValid(req_id)) return json({ error: 'Invalid Request ID' }, 400);

        await db.collection('client_requests').updateOne(
           { _id: new ObjectId(req_id) },
           { $set: { status: `Assigned to ${emp_name} (${emp_id})`, reply, updated_at: new Date() } }
        );

        const reqData = await db.collection('client_requests').findOne({ _id: new ObjectId(req_id) });
        if (reqData) {
            await db.collection('dispatches').insertOne({
                target_type: 'employee_task',
                target_id: emp_id, 
                subject: `Assigned Task: Client ${reqData.client_email}`,
                message: reply || reqData.description,
                status: 'Sent',
                priority: 'High',
                client_request_id: req_id, // 🚀 FIX: Links dispatch back to originating client request
                created_at: new Date()
            });
        }
        return json({ success: true, message: 'Assigned successfully' });
     }

     if (path === 'bids/update' || path === 'api/bids/update') {
        const { bid_id, status, bid_no, description, contract_value, validity } = body;
        if (!ObjectId.isValid(bid_id)) return json({ error: 'Invalid Bid ID' }, 400);
        let updateData = { updated_at: new Date() };
        if (status) updateData.status = status;
        if (bid_no !== undefined) updateData.bid_no = bid_no;
        if (description !== undefined) updateData.description = description;
        if (contract_value !== undefined) updateData.contract_value = contract_value;
        if (validity !== undefined) updateData.validity = validity;

        await db.collection('bids').updateOne(
           { _id: new ObjectId(bid_id) },
           { $set: updateData }
        );

        // 🚀 RBAC: auto-claim on first touch. Bids created before this rollout (or by
        // the MD) have no employee_id; the first employee to update one becomes its
        // owner for isolation going forward. The $exists:false filter guarantees this
        // never overwrites a bid another employee already claimed.
        const actor = await resolveActorRole(request);
        if (actor.role === 'EMPLOYEE') {
           await db.collection('bids').updateOne(
              { _id: new ObjectId(bid_id), employee_id: { $exists: false } },
              { $set: { employee_id: actor.empId, employee_email: actor.email, employee_name: actor.name } }
           );
        }

        return json({ success: true });
     }

     if (path === 'dispatches/complete' || path === 'api/dispatches/complete') {
        const { task_id } = body;
        if (!ObjectId.isValid(task_id)) return json({ error: 'Invalid Dispatch ID' }, 400);
        await db.collection('dispatches').updateOne(
           { _id: new ObjectId(task_id) },
           { $set: { status: 'Completed', completed_at: new Date() } }
        );
        return json({ success: true });
     }

     if (path === 'dispatches/update' || path === 'api/dispatches/update') {
        const { task_id, status, reply, file_name, file_base64 } = body;
        if (!ObjectId.isValid(task_id)) return json({ error: 'Invalid Dispatch ID' }, 400);
        let updateData = { status: status, updated_at: new Date() };
        if(reply) updateData.client_reply = reply;
        
        // 🚀 FIX: ఫైల్ ని డేటాబేస్ లో సేవ్ చేయడం
        if(file_name) updateData.file_name = file_name;
        if(file_base64) updateData.file_base64 = file_base64;

        await db.collection('dispatches').updateOne(
           { _id: new ObjectId(task_id) },
           { $set: updateData }
        );

        // 🚀 FIX: Broken Triangle — sync the employee's reply/status/attachment back
        // onto the originating client request so the client actually sees the update.
        const updatedDispatch = await db.collection('dispatches').findOne({ _id: new ObjectId(task_id) });
        if (updatedDispatch?.client_request_id && ObjectId.isValid(updatedDispatch.client_request_id)) {
           let clientRequestUpdate = { updated_at: new Date() };
           if (reply) clientRequestUpdate.reply = reply;
           if (status === 'Completed') clientRequestUpdate.status = 'Resolved by Employee';
           if (file_base64) {
              clientRequestUpdate.file_base64 = file_base64;
              clientRequestUpdate.file_name = file_name || null;
           }

           await db.collection('client_requests').updateOne(
              { _id: new ObjectId(updatedDispatch.client_request_id) },
              { $set: clientRequestUpdate }
           );
        }

        return json({ success: true, message: `Dispatch status updated to ${status}` });
     }
     // 🚀 FIX: Vault Document Approval + Rename + Duplicate Check + Auto Google Drive Sync
     if (path === 'vault/verify' || path === 'api/vault/verify') {
        const { email, docId, status, reject_reason, custom_file_name, overwrite } = body;
        const targetEmail = email.toLowerCase();
        
        const user = await db.collection('users').findOne({ email: targetEmail });
        const doc = user?.vault_docs?.find(d => d.id === docId);

        let finalFileName = doc?.file_name || `${docId}.pdf`;
        
        if (status === 'verified' && custom_file_name) {
            finalFileName = custom_file_name.toLowerCase().endsWith('.pdf') 
                ? custom_file_name 
                : `${custom_file_name}.pdf`;
            
            const isDuplicate = user?.vault_docs?.some(d => d.id !== docId && d.file_name === finalFileName);
            if (isDuplicate && !overwrite) {
                return json({ 
                    error: 'Duplicate_Found', 
                    message: 'ఈ పేరుతో ఇప్పటికే ఫైల్ ఉంది. పాతదాన్ని రీప్లేస్ చేయాలా?' 
                }, 409);
            }
        }

        await db.collection('users').updateOne(
            { email: targetEmail, "vault_docs.id": docId },
            { $set: { 
                "vault_docs.$.status": status,
                "vault_docs.$.reject_reason": reject_reason || null,
                "vault_docs.$.file_name": finalFileName 
              } 
            }
        );

        if (status === 'verified') {
            if (user?.drive_folder_id && doc && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) {
               try {
                   // 🚀 The document body now lives in R2, so fetch it back for the Drive
                   // copy; older records still carry it inline.
                   let buffer = null;
                   if (doc.file_r2_key || doc.file_url) {
                       buffer = await fetchVaultDocumentBuffer({
                           file_r2_key: doc.file_r2_key,
                           file_url: doc.file_url,
                           file_name: doc.file_name,
                           email: targetEmail,
                       });
                   }
                   if (!buffer && doc.file_base64) {
                       buffer = Buffer.from(doc.file_base64.replace(/^data:(.*,)?/, ''), 'base64');
                   }

                   if (buffer && buffer.length > 0) {
                       const auth = new google.auth.JWT(
                           process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, null,
                           process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                           ['https://www.googleapis.com/auth/drive.file']
                       );
                       const drive = google.drive({ version: 'v3', auth });

                       const stream = require('stream');
                       const bufferStream = new stream.PassThrough();
                       bufferStream.end(buffer);

                       await drive.files.create({
                           requestBody: { name: finalFileName, parents: [user.drive_folder_id] },
                           media: {
                               mimeType: sniffContentType(buffer, finalFileName) || 'application/pdf',
                               body: bufferStream,
                           },
                           fields: 'id'
                       });
                   } else {
                       console.warn('[vault/verify] no readable file body for Drive sync:', docId);
                   }
               } catch(err) {
                   console.error("Drive upload failed silently:", err);
               }
            }
        }
        return json({ success: true, saved_file_name: finalFileName });
     }

     if (path === 'finance/ledger' || path === 'api/finance/ledger') {
        const { id, ...updateFields } = body;
        if (!id) return json({ error: 'Missing Transaction ID' }, 400);
        if (!ObjectId.isValid(id)) return json({ error: 'Invalid Transaction ID' }, 400);
        await db.collection('finance_ledger').updateOne(
            { _id: new ObjectId(id) },
            { $set: { ...updateFields, updated_at: new Date() } }
        );
        return json({ success: true, message: 'Ledger Entry Updated' });
     }

     if (path === 'payments/offline' || path === 'api/payments/offline') {
        // 🚀 Extracted to app/api/payments/route.js (Offline Ledger logic)
        return await recordOfflineLedgerPayment(db, body);
     }

     return json({ error: 'PUT endpoint not found' }, 404);
  } catch (error) {
     console.error('API Error:', error);
     return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

// =====================================================================
// DELETE REQUESTS 
// =====================================================================
export async function DELETE(request, { params }) {
  // 🚀 FIX: getDb()/param parsing used to sit OUTSIDE the try block (like the old
  // GET/PUT/POST bug already fixed elsewhere in this file) — a transient DB hiccup
  // threw an unhandled error before any response body was ever written, so callers
  // like "Cancel Request" just saw a bare failed fetch with no diagnosable JSON body.
  try {
    const pathArray = params?.path || [];
    const path = pathArray.join('/');
    const { searchParams } = new URL(request.url);
    const db = await getDb();

    if (path === 'users' || path === 'api/users') {
       const email = searchParams.get('email');
       if (!email) return json({ error: 'Missing Client Email' }, 400);

       const targetEmail = email.toLowerCase();

       await db.collection('users').deleteOne({ email: targetEmail });
       await db.collection('bids').deleteMany({ client_email: targetEmail });
       await db.collection('client_requests').deleteMany({ client_email: targetEmail });
       await db.collection('tickets').deleteMany({ client_email: targetEmail });
       await db.collection('dispatches').deleteMany({ target_id: targetEmail });
       
       return json({ success: true, message: 'Client and all associated data permanently wiped out.' });
    }

    // 🚀 FIX: Guest Queries Deletion Route
    if (path === 'guest-queries' || path === 'api/guest-queries') {
       const id = searchParams.get('id');
       if (!id) return json({ error: 'Missing ID' }, 400);
       // 🚀 FIX: `new ObjectId(id)` throws on a malformed id, which crashed this route
       // with an unhandled 500 instead of a clean validation error.
       if (!ObjectId.isValid(id)) return json({ error: 'Invalid ID' }, 400);
       await db.collection('guest_queries').deleteOne({ _id: new ObjectId(id) });
       return json({ success: true, message: 'Query resolved and deleted' });
    }

    if (pathArray.length === 2 && (pathArray[0] === 'tenders' || pathArray[0] === 'api')) {
      const gate = await requireOperatorStorageAccess(request);
      if (!gate.ok) return gate.response;
      const id = pathArray[1];
      if (!id) return json({ error: 'Missing Tender ID' }, 400);

      const collection = db.collection('tenders');
      let result = null;

      if (ObjectId.isValid(id)) result = await collection.deleteOne({ _id: new ObjectId(id) });
      if (!result || result.deletedCount === 0) result = await collection.deleteOne({ _id: id });
      if (!result || result.deletedCount === 0) result = await collection.deleteOne({ id: id });

      if (result && result.deletedCount > 0) return json({ success: true, message: 'Tender deleted successfully' });
      else return json({ error: 'Tender not found in database' }, 404);
    }

    if (path === 'bids' || path === 'api/bids') {
      const id = searchParams.get('id');
      if (!id) return json({ error: 'Missing Bid ID' }, 400);

      const collection = db.collection('bids');
      let result = null;

      if (ObjectId.isValid(id)) result = await collection.deleteOne({ _id: new ObjectId(id) });
      if (!result || result.deletedCount === 0) result = await collection.deleteOne({ _id: id });
      if (!result || result.deletedCount === 0) result = await collection.deleteOne({ id: id });

      if (result && result.deletedCount > 0) return json({ success: true, message: 'Bid tracking removed' });
      else return json({ error: 'Bid not found' }, 404);
    }

    if (path === 'tickets' || path === 'api/tickets') {
      const id = searchParams.get('id');
      if (!id) return json({ error: 'Missing Ticket ID' }, 400);
      let result = null;
      if (ObjectId.isValid(id)) result = await db.collection('tickets').deleteOne({ _id: new ObjectId(id) });
      if (!result || result.deletedCount === 0) result = await db.collection('tickets').deleteOne({ _id: id });
      if (result && result.deletedCount > 0) return json({ success: true, message: 'Ticket deleted' });
      return json({ error: 'Ticket not found' }, 404);
    }

    if (path === 'employees' || path === 'api/employees') {
      const actor = await resolveActorRole(request);
      if (actor.role !== 'MD') {
        return json({ error: 'Only MD can delete employees.' }, 403);
      }
      const id = searchParams.get('id');
      if (!id) return json({ error: 'Missing Employee ID' }, 400);
      const filter = ObjectId.isValid(id)
        ? { $or: [{ _id: new ObjectId(id) }, { emp_id: id }, { _id: id }] }
        : { $or: [{ emp_id: id }, { _id: id }] };
      const result = await db.collection('employees').updateOne(filter, {
        $set: {
          deleted: true,
          active: false,
          deleted_at: new Date(),
          deleted_by: actor.email || actor.empId || 'MD',
        },
      });
      if (!result.matchedCount) return json({ error: 'Employee not found' }, 404);
      return json({ success: true, message: 'Employee login revoked.' });
    }

    if (path === 'finance/ledger' || path === 'api/finance/ledger') {
       const id = searchParams.get('id');
       if (!id) return json({ error: 'Missing Transaction ID' }, 400);
       if (!ObjectId.isValid(id)) return json({ error: 'Invalid Transaction ID' }, 400);
       await db.collection('finance_ledger').deleteOne({ _id: new ObjectId(id) });
       return json({ success: true, message: 'Transaction Deleted' });
    }

    if (path === 'client-requests' || path === 'api/client-requests') {
       const actor = await resolveActorRole(request);
       if (!isGmActor(actor)) return json({ error: 'Only GM can delete bid support requests.' }, 403);
       const id = searchParams.get('id');
       if (!id) return json({ error: 'Missing Request ID' }, 400);
       if (!ObjectId.isValid(id)) return json({ error: 'Invalid Request ID' }, 400);
       await db.collection('client_requests').deleteOne({ _id: new ObjectId(id) });
       return json({ success: true, message: 'Request Deleted Permanently' });
    }

    if (path === 'dispatches' || path === 'api/dispatches') {
       const id = searchParams.get('id');
       if (!id) return json({ error: 'Missing Dispatch ID' }, 400);
       if (!ObjectId.isValid(id)) return json({ error: 'Invalid Dispatch ID' }, 400);
       await db.collection('dispatches').deleteOne({ _id: new ObjectId(id) });
       return json({ success: true, message: 'Dispatch Task Deleted' });
    }

    if (path === 'payments/requests' || path === 'api/payments/requests') {
       const id = searchParams.get('id');
       if (!id) return json({ error: 'Missing Request ID' }, 400);
       await db.collection('users').updateOne(
           { "pending_payments.id": id },
           { $pull: { pending_payments: { id: id } } }
       );
       return json({ success: true, message: 'Payment Request Cancelled' });
    }

    return json({ error: 'DELETE endpoint not found' }, 404);
  } catch (error) {
    console.error('Delete API Error:', error);
    return json({ error: 'Server Error', details: error.message }, 500);
  }
}

// =====================================================================
// POST REQUESTS (Creating Data)
// =====================================================================
export async function POST(request, { params }) {
  // 🚀 FIX: Entire handler (db connection + param parsing included) now lives inside
  // the try/catch so a failure never produces an empty, unparseable response body.
  try {
    const db = await getDb();
    const pathArray = params?.path || [];
    const path = pathArray.join('/');

    if (path === 'vault/upload' || path === 'api/vault/upload') {
       try {
         const formData = await request.formData();
         const file = formData.get('file');
         const docId = formData.get('docId');
         const email = formData.get('email');
         const customName = formData.get('customName');

         if (!file || !email || !docId) return json({ error: 'Missing data' }, 400);
         if (typeof file.arrayBuffer !== 'function') return json({ error: 'Uploaded value is not a file.' }, 400);

         // 🚀 The ceiling is Vercel's ~4.5MB serverless request body limit, not R2 —
         // a larger file never reaches this handler at all, so reject it here with an
         // explanation rather than letting the platform return an opaque 413.
         if (file.size > VAULT_MAX_UPLOAD_BYTES) {
           return json({
             error: `This file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The maximum upload size is ` +
                    `${VAULT_MAX_UPLOAD_BYTES / 1024 / 1024}MB — please compress the scan or split the document.`,
           }, 400);
         }
         if (file.size === 0) return json({ error: 'The selected file is empty.' }, 400);

         const targetEmail = String(email).toLowerCase();
         const buffer = Buffer.from(await file.arrayBuffer());
         const fileName = file.name || `${docId}.pdf`;
         const contentType = sniffContentType(buffer, fileName) || file.type || 'application/octet-stream';

         const newDoc = {
             id: docId,
             name: customName ? String(customName) : String(docId).replace(/_/g, ' ').toUpperCase(),
             file_name: fileName,
             file_size: file.size,
             content_type: contentType,
             status: 'uploaded', // This tells MD it's under review
             upload_date: new Date().toLocaleDateString(),
             uploaded_at: new Date(),
         };

         // 🚀 STORAGE: the document body goes to Cloudflare R2 and MongoDB keeps only the
         // pointer. Embedding base64 here used to push `users` records past 1.5MB, which
         // slowed down every query that touched a client.
         if (isR2Configured()) {
           const uploaded = await uploadVaultDocument(buffer, fileName, { email: targetEmail, contentType });
           if (!uploaded?.key) {
             return json({ error: 'Secure storage upload failed. Please try again in a moment.' }, 502);
           }
           newDoc.file_url = uploaded.url;
           newDoc.file_r2_key = uploaded.key;
         } else {
           // Local development without R2 credentials: fall back to the legacy inline
           // blob so the vault stays usable, and say so in the response.
           console.warn('[vault/upload] R2 is not configured — falling back to inline storage.');
           newDoc.file_base64 = buffer.toString('base64');
         }

         await db.collection('users').updateOne(
             { email: targetEmail },
             { $pull: { vault_docs: { id: docId } } }
         );
         await db.collection('users').updateOne(
             { email: targetEmail },
             { $push: { vault_docs: newDoc } }
         );

         return json({
           success: true,
           message: 'File uploaded securely. It is now pending MD verification.',
           storage: newDoc.file_r2_key ? 'r2' : 'inline',
         });
       } catch(e) {
         console.error('[vault/upload] failed:', e);
         return json({ error: `File upload failed: ${e?.message || 'unknown error'}` }, 500);
       }
    }

    // 🚀 SECURITY FIX: Cashfree webhook signatures are computed over the RAW request
    // body text. We must read it with request.text() BEFORE any JSON parsing happens
    // below — parsing then re-stringifying would change the payload and break HMAC
    // signature verification in handleCashfreeWebhook.
    if (path === 'payment/webhook' || path === 'api/payment/webhook') {
      const rawBody = await request.text();
      return await handleCashfreeWebhook(db, request, rawBody);
    }

    if (path === 'settings' || path === 'api/settings') {
      const contentType = request.headers.get('content-type') || '';
      const existing = await db.collection('settings').findOne({ id: 'brand' }) || {};
      let $set;
      if (contentType.includes('application/json')) {
        const body = await request.json();
        $set = await brandFieldsFromJson(body, existing);
      } else if (contentType.includes('multipart/form-data')) {
        const form = await request.formData();
        for (const value of form.values()) {
          if (value && typeof value !== 'string') {
            return json({ error: 'Upload each image separately first, then save settings.' }, 400);
          }
        }
        $set = await brandFieldsFromForm(form, existing);
      } else {
        return json({ error: 'Settings must be sent as JSON.' }, 415);
      }
      await db.collection('settings').updateOne({ id: 'brand' }, { $set }, { upsert: true });
      return json({ success: true });
    }

    // 🚀 FIX: Missing/empty/malformed JSON bodies (e.g. Adblock-mangled requests)
    // used to bail out early with a 400 before routes like system/verify could even
    // run. Default to {} instead so downstream routes can safely destructure it.
    let body = {};
    try { body = await request.json(); } catch (e) { body = {}; }

    if (path === 'system/verify' || path === 'api/system/verify' || (pathArray.length === 2 && pathArray[0] === 'system' && pathArray[1] === 'verify')) {
      const { email, password } = body || {};
      // 🚀 FIX: Windows .env files (and copy-pasted credentials) can smuggle in
      // trailing \r / \n / whitespace, silently breaking a strict === comparison.
      // Trim both sides so the check only cares about the actual credential value.
      const cleanEmail = String(email || '').trim();
      const cleanPassword = String(password || '').trim();
      const cleanAdminEmail = String(process.env.ADMIN_EMAIL || '').trim();
      const cleanAdminPassword = String(process.env.ADMIN_PASSWORD || '').trim();

      if (cleanEmail === cleanAdminEmail && cleanPassword === cleanAdminPassword) {
        return NextResponse.json({ success: true, token: process.env.ADMIN_TOKEN || 'admin_success' }, { status: 200 });
      }

      const identifier = cleanEmail.toLowerCase();
      const mdEmployee = await db.collection('employees').findOne({
        $or: [
          { email: identifier },
          { emp_id: new RegExp(`^${cleanEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
        ],
        password: cleanPassword,
        deleted: { $ne: true },
        active: { $ne: false },
      });
      if (mdEmployee && isMdEmployee(mdEmployee)) {
        return NextResponse.json({ success: true, token: process.env.ADMIN_TOKEN || 'admin_success' }, { status: 200 });
      }

      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    if (path === 'tenders' || path === 'api/tenders' || path === 'admin/tenders' || path === 'api/admin/tenders') {
      // 🚀 FIX: Offload PDF storage to Cloudflare R2 instead of MongoDB. Only the
      // resulting `pdf_url` is persisted, keeping tender documents lightweight.
      const { pdf_base64, ...tenderFields } = body;
      let pdf_url = tenderFields.pdf_url || null;
      let storageWarning = null;

      if (pdf_base64) {
        const cleanBase64 = pdf_base64.replace(/^data:[^;,]*(;base64)?,/, '');
        const fileBuffer = Buffer.from(cleanBase64, 'base64');

        // 🚀 Reject a bad upload here rather than storing bytes that will later open
        // as a blank PDF for every client. Buffer.from() won't throw on malformed
        // base64, so the magic-header check is the only real guard.
        if (!isValidPDFBuffer(fileBuffer)) {
          return json({ error: 'The uploaded file is not a readable PDF. Please re-select the file and try again.' }, 400);
        }

        try {
          const safeFileName = `${Date.now()}-${tenderFields.pdf_filename || 'tender.pdf'}`;
          const uploaded = await uploadTenderPDF(fileBuffer, safeFileName);
          if (uploaded?.url) {
            pdf_url = uploaded.url;
            tenderFields.pdf_r2_key = uploaded.key;
          } else {
            storageWarning = isR2Configured()
              ? 'Cloudflare R2 upload failed. The PDF was stored in the database instead.'
              : 'Cloudflare R2 is not configured on this server. The PDF was stored in the database instead.';
            console.error(`Tender PDF upload to Cloudflare R2 failed; keeping pdf_base64 so the file remains readable. ${storageWarning}`);
          }
        } catch (uploadError) {
          storageWarning = 'Cloudflare R2 upload errored. The PDF was stored in the database instead.';
          console.error('Failed to process tender PDF for upload:', uploadError);
        }
      }

      const newTender = { ...tenderFields, pdf_url, created_at: new Date() };
      if (!pdf_url && pdf_base64) newTender.pdf_base64 = pdf_base64;
      const result = await db.collection('tenders').insertOne(newTender);
      return json({ success: true, message: 'Tender published successfully', id: result.insertedId, storage_warning: storageWarning });
    }

    if (path === 'settings' || path === 'api/settings') {
      return json({ error: 'Settings must be saved as FormData or a JSON payload via the dedicated handler.' }, 400);
    }

    if (path === 'users' || path === 'api/users') {
      const ident = body.email || body.client_id || '';
      const existing = await findExistingClient(db, ident);
      if (!existing) return json({ error: 'Client not found' }, 404);
      await db.collection('users').updateOne(
        { _id: existing._id },
        { $set: { last_login: new Date(), ...(body.name ? { name: body.name } : {}) } },
      );
      return json({ success: true, client_id: existing.client_id || null, email: existing.email });
    }

    // 🚀 FIX: Guest Queries POST Route
    if (path === 'guest-queries' || path === 'api/guest-queries') {
       const result = await db.collection('guest_queries').insertOne({ ...body, created_at: new Date() });
       return json({ success: true, id: result.insertedId });
    }

    if (path === 'subscription/cancel' || path === 'api/subscription/cancel') {
      if (!body.email) return json({ error: 'Email required' }, 400);
      await db.collection('users').updateOne(
        { email: body.email.toLowerCase() },
        { $set: { 'subscription.status': 'cancelled_pending', auto_renew: false } }
      );
      return json({ success: true, message: 'Auto-renewal cancelled successfully.' });
    }

    if (path === 'tickets' || path === 'api/tickets') {
      const { email, department, subject, message } = body;
      const createdAt = new Date();
      const deadline = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000); 
      
      const newTicket = {
        client_email: email.toLowerCase(), department, subject, message,
        status: 'OPEN', created_at: createdAt, sla_deadline: deadline, reply: null
      };
      const result = await db.collection('tickets').insertOne(newTicket);
      return json({ success: true, message: 'Ticket raised successfully.', id: result.insertedId });
    }

    if (path === 'tickets/reply' || path === 'api/tickets/reply') {
      const { ticket_id, reply, admin_email } = body;
      if (!ObjectId.isValid(ticket_id)) return json({ error: 'Invalid Ticket ID' }, 400);
      await db.collection('tickets').updateOne(
        { _id: new ObjectId(ticket_id) },
        { $set: { status: 'RESOLVED', reply: reply, replied_by: admin_email, replied_at: new Date() } }
      );
      return json({ success: true, message: 'Ticket Resolved.' });
    }

    // 🚀 FIX: Profile saving logic with mandatory fields
    if (path === 'users/profile' || path === 'api/users/profile') {
      const { 
        email, client_name, company_name, company_type, phone, address, 
        service_category, gstin, udyam, has_gst, has_msme, has_iso, documents, status, agreement_signed 
      } = body;
      const userEmail = String(email || '').trim().toLowerCase();
      const existingProfile = await findExistingClient(db, userEmail);
      if (!existingProfile) return json({ error: 'Client not found' }, 404);

      // అగ్రిమెంట్ కోసం స్పెషల్ చెక్
      if (agreement_signed) {
          await db.collection('users').updateOne(
            { _id: existingProfile._id },
            { $set: { agreement_signed: true, status: 'active' } }
          );
          return json({ success: true });
      }

      // మిగతా ప్రొఫైల్ డేటా సేవ్
      await db.collection('users').updateOne(
        { _id: existingProfile._id },
        { $set: { 
            company_type, has_gst, has_msme, has_iso,
            client_name, company_name, phone, address, service_category, 
            gstin: gstin ? gstin.toUpperCase() : '',
            udyam: udyam ? udyam.toUpperCase() : '',
            documents: documents || {}, 
            status: status || 'pending', 
            onboarding_complete: true, 
            profile_score: 100 
          } 
        }
      );
      return json({ success: true });
    }

    if (path === 'users/approve' || path === 'api/users/approve') {
      const { email } = body;
      const userEmail = email.toLowerCase();
      
      const existingUser = await db.collection('users').findOne({ email: userEmail });
      let finalClientId = existingUser?.client_id;
      
      if (!finalClientId) {
          const count = await db.collection('users').countDocuments({ client_id: { $exists: true } });
          finalClientId = `CLI-${1000 + count + 1}`;
      }

      await db.collection('users').updateOne(
        { email: userEmail },
        { $set: { is_approved: true, status: 'approved', client_id: finalClientId } }
      );
      try {
        const display = existingUser?.company_name || existingUser?.client_name || existingUser?.name || userEmail;
        await ensureEntityDriveFolder({
          db,
          collection: 'users',
          query: { email: userEmail },
          folderName: `Client - ${finalClientId} - ${display}`,
          email: userEmail,
        });
      } catch (err) {
        console.error('[users/approve] Drive folder failed:', err?.message || err);
      }
      const refreshed = await db.collection('users').findOne({ email: userEmail }, { projection: { drive_folder_id: 1, drive_folder_link: 1 } });
      return json({
        success: true,
        client_id: finalClientId,
        drive_folder_id: refreshed?.drive_folder_id || null,
        drive_folder_link: refreshed?.drive_folder_link || null,
      });
    }

    if (path === 'users/request-payment' || path === 'api/users/request-payment') {
       const { email, amount, reason } = body;
       const reqId = new ObjectId().toString(); // 🚀 FIX: Generate a unique ID

       await db.collection('users').updateOne(
         { email: email.toLowerCase() },
         { $push: { pending_payments: { id: reqId, amount, reason, date: new Date(), status: 'UNPAID' } } }
       );
       
       return json({ success: true, id: reqId }); // 🚀 FIX: Return ID to frontend
    }
    
    // NOTE: DELETE /api/ai/drafts is handled by the dedicated app/api/ai/drafts/route.js
    // (see matching note above the removed GET duplicate).
    
    if (path === 'client-requests' || path === 'api/client-requests') {
       const { client_email, client_id, link_or_id, description } = body;
       const result = await db.collection('client_requests').insertOne({
          client_email: client_email.toLowerCase(), client_id, link_or_id, description,
          status: 'Pending Officer Review', reply: '', created_at: new Date()
       });
       return json({ success: true, id: result.insertedId });
    }

    if (path === 'dispatches' || path === 'api/dispatches') {
       const { target_type, target_id, subject, message } = body;
       // 🚀 RBAC: 'client_alert' is an officer suggesting a tender to a client
       // (handleSuggestTender in app/employee/page.js) — stamp who made the
       // suggestion so it isolates per-employee (GET /api/dispatches below).
       // 'employee_task' (MD assigning work to an employee) and every other
       // target_type already carries its own meaning via target_id and is untouched.
       const actor = await resolveActorRole(request);
       const ownerFields = (target_type === 'client_alert' && actor.role === 'EMPLOYEE')
          ? { employee_id: actor.empId, employee_email: actor.email, employee_name: actor.name }
          : {};
       const result = await db.collection('dispatches').insertOne({
          target_type, target_id, subject, message, status: 'Sent', created_at: new Date(), ...ownerFields
       });
       return json({ success: true, id: result.insertedId });
    }

    if (path === 'gov-officers' || path === 'api/gov-officers') {
       const result = await db.collection('gov_officers').insertOne({
          ...body, created_at: new Date()
       });
       return json({ success: true, id: result.insertedId });
    }

    if (path === 'bids' || path === 'api/bids') {
       const status = body.status || 'Doc Preparation';
       // 🚀 RBAC: stamp task ownership at creation — the employee who added this bid
       // tracking row is the only one who should see it later (GET /api/bids below).
       // MD-created rows (admin_token) get no employee_id, same bucket as legacy data.
       const actor = await resolveActorRole(request);
       const ownerFields = actor.role === 'EMPLOYEE'
          ? { employee_id: actor.empId, employee_email: actor.email, employee_name: actor.name }
          : {};
       const result = await db.collection('bids').insertOne({
          ...body, status: status, created_at: new Date(), ...ownerFields
       });
       return json({ success: true, id: result.insertedId });
    }

    if (path === 'employee/activity' || path === 'api/employee/activity') {
       const { email, action, details } = body;
       await db.collection('employee_logs').insertOne({
          email: email.toLowerCase(),
          action,
          details,
          timestamp: new Date()
       });
       return json({ success: true });
    }
    // 🚀 FIX: Delete Route to Cancel a Payment Request
    if (path === 'payments/requests' || path === 'api/payments/requests') {
       const id = searchParams.get('id');
       if (!id) return json({ error: 'Missing Request ID' }, 400);

       await db.collection('users').updateOne(
           { "pending_payments.id": id },
           { $pull: { pending_payments: { id: id } } }
       );
       return json({ success: true, message: 'Payment Request Cancelled' });
    }
    if (path === 'queries/send' || path === 'api/queries/send') {
      const { client_email, subject, message } = body;
      const queryId = new ObjectId().toString();
      await db.collection('users').updateOne(
        { email: client_email.toLowerCase() },
        { $push: { officer_queries: { id: queryId, subject, message, created_at: new Date() } } }
      );
      return json({ success: true, id: queryId });
    }

    // 🚀 FIX: Client submits reply (Updates query with data instead of deleting)
    if (path === 'queries/reply' || path === 'api/queries/reply') {
      const { queryId, email, description, fileName } = body;
      // 🚀 FIX: the client form already marks this field required, but the API
      // trusted that blindly — a stripped/empty request body silently saved a
      // blank reply as if the officer's query had genuinely been answered.
      if (!queryId || !email) {
        return json({ error: 'Missing queryId or email' }, 400);
      }
      if (!String(description || '').trim()) {
        return json({ error: 'Reply description cannot be empty' }, 400);
      }
      await db.collection('users').updateOne(
        { email: email.toLowerCase(), "officer_queries.id": queryId },
        { $set: { 
            "officer_queries.$.reply_submitted": true,
            "officer_queries.$.reply_text": description,
            "officer_queries.$.reply_file": fileName,
            "officer_queries.$.replied_at": new Date()
          } 
        }
      );
      return json({ success: true });
    }

   // 🚀 FIX: Admin/Employee closes the query (Moves to History instead of Delete)
    if (path === 'queries/close' || path === 'api/queries/close') {
      const { queryId, email } = body;
      await db.collection('users').updateOne(
        { email: email.toLowerCase(), "officer_queries.id": queryId },
        { $set: { "officer_queries.$.is_closed": true, "officer_queries.$.closed_at": new Date() } }
      );
      return json({ success: true });
    }
    if (path === 'finance/ledger' || path === 'api/finance/ledger') {
        const newTxn = {
            type: body.type, 
            amount: Number(body.amount),
            reason: body.reason,
            client_id: body.client_id || 'N/A',
            payment_mode: body.payment_mode || 'OFFLINE',
            proof_base64: body.proof_base64 || null,
            created_at: new Date()
        };
        await db.collection('finance_ledger').insertOne(newTxn);
        return json({ success: true, message: 'Transaction Added' });
    }
    // 🚀 Operator Docs POST (Store)
    if (path === 'operator/docs' || path === 'api/operator/docs') {
       const gate = await requireOperatorStorageAccess(request);
       if (!gate.ok) return gate.response;
       const { name, file_base64 } = body;
       const uploaded_by = gate.actor.email || gate.actor.empId || gate.auth.email || 'staff';
       const result = await db.collection('operator_storage').insertOne({
          name, file_base64, uploaded_by, created_at: new Date()
       });
       return json({ success: true, id: result.insertedId });
    }

    // 🚀 Operator Share Doc with Client
    if (path === 'operator/share' || path === 'api/operator/share') {
       const gate = await requireOperatorStorageAccess(request);
       if (!gate.ok) return gate.response;
       const { docId, client_email } = body;
       if (!ObjectId.isValid(docId)) return json({ error: 'Invalid Document ID' }, 400);
       const doc = await db.collection('operator_storage').findOne({ _id: new ObjectId(docId) });
       if (!doc) return json({ error: 'Document not found' }, 404);

       const sharedQuery = {
          id: new ObjectId().toString(),
          subject: `Shared Proforma Document: ${doc.name}`,
          message: `Operations team has shared a reference document with you: ${doc.name}`,
          file_base64: doc.file_base64,
          file_name: doc.name,
          reply_submitted: false,
          created_at: new Date()
       };

       await db.collection('users').updateOne(
          { email: client_email.toLowerCase() },
          { $push: { officer_queries: sharedQuery } }
       );
       return json({ success: true });
    }
    if (path === 'employees' || path === 'api/employees') {
        const actor = await resolveActorRole(request);
        if (!actor.role) return json({ error: 'Please sign in.' }, 401);
        const designation = normalizeDesignation(body.designation || body.role);
        if (actor.role === 'EMPLOYEE' && actor.designation === DESIGNATIONS.DOC_TEAM_MEMBER) {
          return json({ error: 'Employees cannot create staff logins.' }, 403);
        }
        if (actor.designation === DESIGNATIONS.DOC_TEAM_TL) {
          return json({ error: 'Team Leads cannot create staff logins.' }, 403);
        }
        if (isGmActor(actor) && designation === DESIGNATIONS.GM) {
          return json({ error: 'GM can create TL and Member only.' }, 403);
        }

        let teamId = null;
        if (designation === DESIGNATIONS.DOC_TEAM_MEMBER) {
          teamId = String(body.team_id || '').trim();
          if (!teamId) return json({ error: 'Members must belong to a Team Lead (team_id).' }, 400);
          const tl = await db.collection('employees').findOne({ emp_id: teamId });
          if (!tl || normalizeDesignation(tl.designation) !== DESIGNATIONS.DOC_TEAM_TL) {
            return json({ error: 'team_id must be a Doc Team TL emp_id.' }, 400);
          }
        }

        await ensureUniqueEmpIds(db);
        const newEmpId = await allocateEmpId(db);
        if (designation === DESIGNATIONS.DOC_TEAM_TL) teamId = newEmpId;

        const newEmployee = { 
            emp_id: newEmpId, 
            name: body.name, 
            email: body.email.toLowerCase(), 
            password: body.password, 
            role: body.role || designation,
            designation,
            team_id: teamId,
            created_at: new Date() 
        };
        const result = await db.collection('employees').insertOne(newEmployee);
        try {
          const folder = await createDriveFolder({ folderName: `${newEmpId} - ${body.name || designation}` });
          await db.collection('employees').updateOne(
            { _id: result.insertedId },
            { $set: { drive_folder_id: folder.folderId, drive_folder_link: folder.folderLink } }
          );
        } catch (err) {
          console.error('[employees] Drive folder failed:', err?.message || err);
        }
        return json({ success: true, emp_id: newEmpId, id: result.insertedId, designation, team_id: teamId });
    }

    if (path === 'drive/create-folder' || path === 'api/drive/create-folder') {
       const { folderName, email, collection, emp_id } = body;
       try {
          const folder = await createDriveFolder({ folderName: folderName || `Client - ${email || emp_id || 'Folder'}` });
          if (collection === 'employees' && emp_id) {
             await db.collection('employees').updateOne(
                { emp_id },
                { $set: { drive_folder_id: folder.folderId, drive_folder_link: folder.folderLink } }
             );
          } else if (email) {
             await db.collection('users').updateOne(
                { email: String(email).toLowerCase() },
                { $set: { drive_folder_id: folder.folderId, drive_folder_link: folder.folderLink } }
             );
          }
          return json({ success: true, folderId: folder.folderId, folderLink: folder.folderLink });
       } catch (error) {
          console.error('Drive API Error:', error);
          return json({ error: error.message || 'Failed to create Google Drive folder' }, 500);
       }
    }

    if (path === 'payment/order' || path === 'api/payment/order') {
      // 🚀 Extracted to app/api/payments/route.js (Cashfree Order Creation)
      return await createCashfreeOrder(db, body);
    }
    if (path === 'payment/verify' || path === 'api/payment/verify') {
      // 🚀 Extracted to app/api/payments/route.js (Cashfree Verification)
      return await verifyCashfreeOrder(db, body);
    }

    
    // చివర్లో ఇది కచ్చితంగా ఉండాలి, లేకపోతే ఎర్రర్ వస్తుంది.
    return json({ error: 'POST not found', path }, 404);
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/db';
import { buildDocumentPrompt, DOC_TYPES, findDocType } from '@/lib/document-templates';
import { sanitizeGeneratedHtml } from '@/lib/html-sanitize';
import { findTenderByAnyId } from '@/lib/tender-lookup';
import { fetchStationeryBuffer, isPubliclyServableUrl } from '@/lib/cloudflare-r2';
import { bufferToDataUrl, wrapWithStationery } from '@/lib/stationery-html';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MAX_INSTRUCTION_CHARS = 1000;

/**
 * Establishes who is asking and what they may generate.
 *
 * A generated document embeds the client's full KYC profile — GSTIN, Udyam number,
 * address, contact details — so this endpoint cannot be left open the way some of the
 * older email-in-the-body routes are. A client may only generate for themselves; staff
 * may generate for anyone.
 */
async function authorise(request, requestedEmail) {
  const adminToken = String(process.env.ADMIN_TOKEN || '').trim();
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (adminToken && bearer === adminToken) {
    return { ok: true, email: requestedEmail, actor: 'admin' };
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.email) {
    return { ok: false, status: 401, error: 'Please sign in to generate documents.' };
  }

  const role = String(token.role || '').toLowerCase();
  const isStaff = role === 'admin' || role === 'md' || role.includes('employee') || role.includes('officer');
  const sessionEmail = String(token.email).toLowerCase();

  if (isStaff) {
    return { ok: true, email: requestedEmail || sessionEmail, actor: role };
  }

  // A client is pinned to their own record regardless of what the body claims.
  if (requestedEmail && requestedEmail !== sessionEmail) {
    return { ok: false, status: 403, error: 'You can only generate documents for your own account.' };
  }
  return { ok: true, email: sessionEmail, actor: 'client' };
}

async function loadTender(db, tenderId) {
  return findTenderByAnyId(db, tenderId, {
    projection: {
      bid_no: 1, title: 1, department: 1, last_date: 1, district: 1,
      category: 1, emd_amount: 1, supply_details: 1,
    },
  });
}

async function loadStationerySrc(url, r2Key) {
  if (url && isPubliclyServableUrl(url)) return url;
  const fetched = await fetchStationeryBuffer({ file_url: url, file_r2_key: r2Key });
  if (!fetched?.buffer) return null;
  return bufferToDataUrl(fetched.buffer, fetched.contentType);
}

// Exposes the catalogue so the client dropdown and the server can never drift apart.
export async function GET() {
  return NextResponse.json({
    doc_types: DOC_TYPES.map(({ id, label, description }) => ({ id, label, description })),
  });
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    const requestedEmail = body?.client_email ? String(body.client_email).trim().toLowerCase() : '';

    const auth = await authorise(request, requestedEmail);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const docType = findDocType(body?.doc_type);
    if (!docType) {
      return NextResponse.json(
        { error: `Unknown document type. Choose one of: ${DOC_TYPES.map((t) => t.label).join(', ')}.` },
        { status: 400 }
      );
    }
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not configured on this server.' }, { status: 500 });
    }

    const db = await getDb();

    const client = await db.collection('users').findOne(
      { email: auth.email },
      {
        projection: {
          email: 1, client_name: 1, company_name: 1, company_type: 1, phone: 1,
          address: 1, gstin: 1, udyam: 1, service_category: 1,
          letterhead_url: 1, letterhead_r2_key: 1, signature_url: 1, signature_r2_key: 1,
        },
      }
    );
    if (!client) {
      return NextResponse.json({ error: 'Client profile not found.' }, { status: 404 });
    }

    // The tender is optional: a declaration or RTI request is often drafted before a
    // specific tender is chosen.
    const tenderId = body?.tender_id ? String(body.tender_id).trim() : '';
    const tender = tenderId ? await loadTender(db, tenderId) : null;
    if (tenderId && !tender) {
      return NextResponse.json({ error: 'That tender could not be found.' }, { status: 404 });
    }

    const prompt = buildDocumentPrompt({
      docType,
      client,
      tender,
      instructions: String(body?.instructions || '').trim().slice(0, MAX_INSTRUCTION_CHARS),
    });

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // 🚀 FIX: gemini-1.5-flash is retired; gemini-3.6-flash is what this account's
    // GEMINI_API_KEY is actually entitled to (verified live).
    const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

    let rawHtml;
    try {
      const result = await model.generateContent(prompt);
      rawHtml = result.response.text();
    } catch (aiError) {
      console.error('[generate-doc] Gemini call failed:', aiError?.message || aiError);
      return NextResponse.json(
        { error: `The AI service did not respond: ${aiError?.message || 'unknown error'}` },
        { status: 502 }
      );
    }

    // Models wrap HTML in markdown fences despite instructions not to.
    const unfenced = String(rawHtml || '')
      .replace(/^\s*```(?:html)?/i, '')
      .replace(/```\s*$/, '')
      .trim();

    // 🚀 SECURITY: the result is rendered with dangerouslySetInnerHTML in the client
    // dashboard. Sanitize here, server-side, so the browser never receives raw model
    // output — a tender PDF is untrusted input and could carry a prompt injection.
    const html = sanitizeGeneratedHtml(unfenced);

    if (!html) {
      return NextResponse.json(
        { error: 'The AI returned an empty document. Please try again.' },
        { status: 502 }
      );
    }

    // Letterhead and signature are fetched here and inlined as data URLs so the print
    // preview does not depend on a public R2 domain or a follow-up authenticated <img>.
    const [letterheadSrc, signatureSrc] = await Promise.all([
      loadStationerySrc(client.letterhead_url, client.letterhead_r2_key),
      loadStationerySrc(client.signature_url, client.signature_r2_key),
    ]);

    return NextResponse.json({
      success: true,
      html: wrapWithStationery(html, { letterheadSrc, signatureSrc }),
      body_html: html,
      stationery: {
        letterhead: Boolean(letterheadSrc),
        signature: Boolean(signatureSrc),
      },
      doc_type: { id: docType.id, label: docType.label },
      generated_at: new Date().toISOString(),
      client: {
        company_name: client.company_name || client.client_name || client.email,
        address: client.address || '',
        phone: client.phone || '',
        email: client.email,
        gstin: client.gstin || '',
        udyam: client.udyam || '',
      },
      tender: tender
        ? { id: String(tender._id), bid_no: tender.bid_no || null, title: tender.title || null }
        : null,
    });
  } catch (error) {
    console.error('[generate-doc] fatal error:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

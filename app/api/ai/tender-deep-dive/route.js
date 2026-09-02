import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/staff-auth';
import { findTenderByAnyId } from '@/lib/tender-lookup';
import { extractTenderLinks, isSafeRemoteUrl } from '@/lib/tender-links';
import { fetchTenderPDFBuffer, isValidPDFBuffer } from '@/lib/cloudflare-r2';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// A single deep dive reads at most this many documents. Government portals attach a long
// tail of corrigenda; reading all of them would blow the function timeout for no gain.
const MAX_DOCUMENTS = 3;
const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20000;

const DEEP_DIVE_PROMPT = `
You are a Senior GeM Bidding Expert reading the actual tender documents for a consultancy
that is about to bid.

Extract the exact Scope of Work, Technical Deliverables, and Additional Terms & Conditions
(ATC) required for bidding.

Format your answer as markdown with these exact headings, in this order:

## Scope of Work
## Technical Deliverables
## Additional Terms & Conditions (ATC)
## Eligibility & Documents Required
## Key Dates & Financials

Rules:
- Under every heading use strict bullet points ("- "). Never write paragraphs.
- Quote figures, percentages, durations, quantities and clause numbers exactly as printed
  in the document. Do not round or convert them.
- If the documents do not cover a heading, write exactly: "- Not specified in the supplied
  documents."
- Never infer, generalise, or fill gaps from general GeM knowledge. Everything you write
  must be traceable to the supplied documents.
- Keep each bullet to one sentence where possible.
`;

/**
 * Downloads a remote tender document, following redirects, with a hard size and time cap.
 * Government portals are slow and frequently serve HTML error pages with a 200 status, so
 * the content is validated rather than trusted.
 */
async function fetchRemoteDocument(url) {
  if (!isSafeRemoteUrl(url)) {
    return { ok: false, error: 'Blocked: the link does not point at a public host.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // Several state portals return 403 to a default fetch user-agent.
        'User-Agent': 'Mozilla/5.0 (compatible; TGTendersBot/1.0; +https://www.tgtenders.in)',
        Accept: 'application/pdf,application/octet-stream,*/*',
      },
    });

    if (!response.ok) {
      return { ok: false, error: `The portal returned HTTP ${response.status}.` };
    }

    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_DOCUMENT_BYTES) {
      return { ok: false, error: `The document is ${(declaredLength / 1024 / 1024).toFixed(1)}MB, which is too large to read.` };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) return { ok: false, error: 'The portal returned an empty document.' };
    if (buffer.length > MAX_DOCUMENT_BYTES) {
      return { ok: false, error: 'The document exceeded the size limit while downloading.' };
    }

    if (!isValidPDFBuffer(buffer)) {
      // Almost always a login wall or "session expired" page served with a 200.
      const peek = buffer.subarray(0, 200).toString('latin1').toLowerCase();
      const looksLikeHtml = peek.includes('<html') || peek.includes('<!doctype');
      return {
        ok: false,
        error: looksLikeHtml
          ? 'The link returned a web page, not a PDF — the portal probably requires a login.'
          : 'The downloaded file is not a readable PDF.',
      };
    }

    return { ok: true, buffer };
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    return {
      ok: false,
      error: aborted
        ? `The portal did not respond within ${FETCH_TIMEOUT_MS / 1000}s.`
        : `Could not reach the portal: ${error?.message || 'network error'}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request) {
  try {
    const auth = await requireStaff(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not configured on this server.' }, { status: 500 });
    }

    const body = await request.json().catch(() => null);
    const tenderId = body?.tender_id ? String(body.tender_id).trim() : '';
    if (!tenderId) return NextResponse.json({ error: 'tender_id is required.' }, { status: 400 });

    const db = await getDb();
    const tender = await findTenderByAnyId(db, tenderId);
    if (!tender) return NextResponse.json({ error: 'That tender could not be found.' }, { status: 404 });

    // Reading three PDFs through Gemini costs real time and tokens, so a completed dive is
    // cached on the tender and replayed unless the caller explicitly asks to redo it.
    if (tender.deep_dive?.markdown && !body?.force) {
      return NextResponse.json({
        success: true,
        cached: true,
        tender: { id: String(tender._id), bid_no: tender.bid_no || null, title: tender.title || null },
        markdown: tender.deep_dive.markdown,
        documents_read: tender.deep_dive.documents_read || [],
        generated_at: tender.deep_dive.generated_at || null,
      });
    }

    const links = extractTenderLinks(tender);

    const parts = [];
    const documentsRead = [];
    const skipped = [];

    for (const link of links) {
      if (parts.length >= MAX_DOCUMENTS) {
        skipped.push({ url: link.url, type: link.type, reason: 'Document limit reached for one deep dive.' });
        continue;
      }
      const result = await fetchRemoteDocument(link.url);
      if (result.ok) {
        parts.push({ inlineData: { data: result.buffer.toString('base64'), mimeType: 'application/pdf' } });
        documentsRead.push({ url: link.url, type: link.type, source: link.source, bytes: result.buffer.length });
      } else {
        skipped.push({ url: link.url, type: link.type, reason: result.error });
      }
    }

    // Fall back to the copy of the bid document we already hold in R2. This is the normal
    // path for GeM tenders, whose links expire or sit behind a session.
    if (parts.length === 0) {
      const stored = await fetchTenderPDFBuffer({
        pdf_r2_key: tender.pdf_r2_key,
        pdf_url: tender.pdf_url,
        pdf_filename: tender.pdf_filename || tender.pdf_file_name,
      }).catch(() => null);

      if (stored && isValidPDFBuffer(stored)) {
        parts.push({ inlineData: { data: stored.toString('base64'), mimeType: 'application/pdf' } });
        documentsRead.push({ url: tender.pdf_url || null, type: 'BID_DOCUMENT', source: 'r2_storage', bytes: stored.length });
      }
    }

    if (parts.length === 0) {
      return NextResponse.json({
        error: 'No readable tender document could be fetched for this bid.',
        detail: links.length === 0
          ? 'The tender record contains no external SOW/ATC links and no stored PDF.'
          : 'Every linked document failed to download — see attempts for details.',
        attempts: skipped,
      }, { status: 422 });
    }

    const contextHeader =
      `TENDER METADATA (for orientation only — do not treat as document content)\n` +
      `Bid No: ${tender.bid_no || 'n/a'}\n` +
      `Title: ${tender.title || 'n/a'}\n` +
      `Department: ${tender.department || 'n/a'}\n` +
      `District: ${tender.district || 'n/a'}\n` +
      `Closing date: ${tender.last_date || 'n/a'}\n` +
      `EMD: ${tender.emd_amount || 'n/a'}\n\n` +
      `Documents supplied: ${documentsRead.map((d) => d.type).join(', ')}\n`;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    let markdown;
    try {
      const result = await model.generateContent([DEEP_DIVE_PROMPT, contextHeader, ...parts]);
      markdown = String(result.response.text() || '').trim();
    } catch (aiError) {
      console.error('[tender-deep-dive] Gemini call failed:', aiError?.message || aiError);
      return NextResponse.json(
        { error: `The AI service could not read the documents: ${aiError?.message || 'unknown error'}` },
        { status: 502 }
      );
    }

    if (!markdown) {
      return NextResponse.json({ error: 'The AI returned an empty analysis. Please retry.' }, { status: 502 });
    }

    const generatedAt = new Date();
    await db.collection('tenders').updateOne(
      { _id: tender._id },
      { $set: { deep_dive: { markdown, documents_read: documentsRead, generated_at: generatedAt, generated_by: auth.email || auth.actor } } }
    ).catch((err) => console.warn('[tender-deep-dive] could not cache result:', err?.message));

    return NextResponse.json({
      success: true,
      cached: false,
      tender: { id: String(tender._id), bid_no: tender.bid_no || null, title: tender.title || null },
      markdown,
      documents_read: documentsRead,
      skipped,
      generated_at: generatedAt,
    });
  } catch (error) {
    console.error('[tender-deep-dive] fatal error:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/staff-auth';
import { findTenderByAnyId, suggestSimilarTenders } from '@/lib/tender-lookup';
import { extractTenderLinks } from '@/lib/tender-links';
import { fetchTenderPDFBuffer, isValidPDFBuffer } from '@/lib/cloudflare-r2';
import { fetchDocumentWithFallback } from '@/lib/remote-document';
import { generateContent, publicAiError } from '@/lib/gemini';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

// A single deep dive reads at most this many documents. Government portals attach a long
// tail of corrigenda; reading all of them would blow the function timeout for no gain.
const MAX_DOCUMENTS = 3;

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

export async function POST(request) {
  try {
    const auth = await requireStaff(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await request.json().catch(() => null);
    const tenderId = body?.tender_id ? String(body.tender_id).trim() : '';
    if (!tenderId) return NextResponse.json({ error: 'tender_id is required.' }, { status: 400 });

    const db = await getDb();
    const tender = await findTenderByAnyId(db, tenderId);
    if (!tender) {
      const suggestions = await suggestSimilarTenders(db, tenderId);
      return NextResponse.json({
        error: suggestions.length
          ? `No tender is recorded under ${tenderId}. Closest matches on file: `
            + `${suggestions.map((s) => s.bid_no || s.id).join(', ')}.`
          : `No tender is recorded under ${tenderId}.`,
        suggestions,
      }, { status: 404 });
    }

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
      const result = await fetchDocumentWithFallback(link.url);
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

    let markdown;
    try {
      // Pro tier: eligibility clauses decide whether a bid is worth entering.
      const result = await generateContent({
        parts: [DEEP_DIVE_PROMPT, contextHeader, ...parts],
        tier: 'pro',
      });
      markdown = result.text.trim();
    } catch (aiError) {
      console.error('[tender-deep-dive] Gemini call failed:', aiError?.message || aiError);
      const safe = publicAiError(aiError);
      return NextResponse.json({ error: safe.message }, { status: safe.status });
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

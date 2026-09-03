// Builds a bid's document dossier and pushes it into per-bid vector context.
//
// A GeM bid is never one document. The real obligations live in the Scope of Work and the
// buyer's Additional Terms, which are separate PDFs linked from inside the bid document.
// Until they are read, the Co-Pilot answers a scope question from the cover page and
// sounds confident while being wrong.
//
// Two properties drive the shape of this route:
//
//   1. ONE DOCUMENT PER CALL. Reading a full PDF through Gemini takes 15-40s. Three to
//      five of them in a single request would exceed the serverless limit, so a call
//      ingests exactly one pending document and reports what remains. The client loops.
//
//   2. FETCH ONCE, EVER. Portal links expire and are often session-bound, so every
//      document that downloads successfully is mirrored to R2 under bid_dossier/.

import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireDashboardStaff } from '@/lib/staff-auth';
import { findTenderByAnyId, rememberBidNoAlias, suggestSimilarTenders, normaliseBidNo } from '@/lib/tender-lookup';
import {
  fetchTenderPDFBuffer,
  fetchObjectByKey,
  isValidPDFBuffer,
  uploadBidDossierDocument,
} from '@/lib/cloudflare-r2';
import { fetchDocumentWithFallback } from '@/lib/remote-document';
import { discoverTenderDocuments } from '@/lib/tender-link-agent';
import { ingestDocumentVectors, bidDocumentId, deleteBidVectors } from '@/lib/rag-ingest';
import { ensureVectorIndex } from '@/lib/gem-embeddings';
import { generateContent } from '@/lib/gemini';

export const runtime = 'nodejs';
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

const MAX_DOSSIER_DOCUMENTS = 6;
const MAX_EXTRACT_CHARS = 180000;

const STATUS = {
  PENDING: 'pending',
  INGESTED: 'ingested',
  FAILED: 'failed',
  NEEDS_LOCAL_AGENT: 'needs_local_agent',
  REFERENCE_ONLY: 'reference_only',
};

// Verbatim, not summarised: the Co-Pilot's whole value is quoting the clause that decides
// a bid, and a summary drops exactly the thresholds and dates that matter.
const EXTRACTION_PROMPT = `
Transcribe this government procurement document into clean, complete plain text.

Rules:
- Reproduce ALL substantive content. Do not summarise, shorten, comment or editorialise.
- Preserve clause numbers, section headings, annexure labels and their hierarchy.
- Render tables row by row as "Column: value" pairs so each row stands alone when read
  out of context. Never drop a table.
- Keep every figure, percentage, date, duration and monetary amount exactly as printed.
- Keep any Telugu or other Indic text in its original script; do not translate it.
- Skip pure page furniture (page numbers, repeated headers/footers, watermarks).
- Output only the transcription. No preamble, no markdown fences.
`.trim();

function documentKey(entry) {
  return entry.url || `ref::${entry.type}::${entry.name}`;
}

/** Manifest entry as it is stored on the tender and shown in the UI. */
function toManifestEntry(source) {
  return {
    key: documentKey(source),
    url: source.url || null,
    name: source.name || source.label || null,
    type: source.type || 'OTHER',
    origin: source.source || 'record',
    status: source.status || STATUS.PENDING,
    chars: 0,
    chunks: 0,
    r2_key: null,
    error: null,
    ingested_at: null,
  };
}

async function loadPrimaryPdf(tender) {
  const buffer = await fetchTenderPDFBuffer({
    pdf_url: tender.pdf_url,
    pdf_filename: tender.pdf_filename,
    pdf_r2_key: tender.pdf_r2_key,
  }).catch(() => null);

  if (buffer && isValidPDFBuffer(buffer)) return buffer;

  if (typeof tender.pdf_base64 === 'string') {
    const legacy = Buffer.from(tender.pdf_base64.replace(/^data:[^;,]*(;base64)?,/, ''), 'base64');
    if (isValidPDFBuffer(legacy)) return legacy;
  }
  return null;
}

/**
 * Plans the dossier: which documents exist, and which still need reading.
 *
 * Runs the two-stage link discovery once per bid and caches the plan on the tender, since
 * the link list of a published bid does not change.
 */
async function buildManifest(db, tender, { refresh }) {
  const existing = tender.bid_dossier;
  if (!refresh && existing?.documents?.length) return existing;

  const primaryPdf = await loadPrimaryPdf(tender);
  const { links, referencedDocuments, pdfBidNo, discoveryError } = await discoverTenderDocuments(tender, primaryPdf);

  if (pdfBidNo) await rememberBidNoAlias(db, tender._id, pdfBidNo);

  const documents = [];

  // The stored bid PDF is always document one — it is the only one guaranteed to exist,
  // and it carries the definitions the other documents refer back to.
  if (primaryPdf) {
    documents.push({
      ...toManifestEntry({ type: 'BID_DOCUMENT', name: 'Bid document', source: 'r2_storage' }),
      key: 'primary::BID_DOCUMENT',
    });
  }

  for (const link of links) {
    if (documents.length >= MAX_DOSSIER_DOCUMENTS) break;
    // The primary PDF's own URL would otherwise be read a second time.
    if (link.source === 'pdf_url' && primaryPdf) continue;
    documents.push(toManifestEntry(link));
  }

  // Named but not linked: nothing to fetch, but the officer needs to know it is missing.
  for (const ref of referencedDocuments.slice(0, 8)) {
    documents.push({ ...toManifestEntry(ref), status: STATUS.REFERENCE_ONLY });
  }

  return {
    bid_no: normaliseBidNo(pdfBidNo || tender.bid_no) || tender.bid_no || String(tender._id),
    documents,
    discovery_error: discoveryError,
    pdf_bid_no: pdfBidNo,
    started_at: new Date(),
    completed_at: null,
  };
}

/** Downloads one document: R2 cache, then plain HTTPS, then the local browser agent. */
async function acquireDocument(tender, entry) {
  if (entry.r2_key) {
    const cached = await fetchObjectByKey(entry.r2_key);
    if (cached && isValidPDFBuffer(cached.buffer)) return { ok: true, buffer: cached.buffer, fromCache: true };
  }

  if (entry.key === 'primary::BID_DOCUMENT') {
    const buffer = await loadPrimaryPdf(tender);
    return buffer
      ? { ok: true, buffer, fromCache: true }
      : { ok: false, status: STATUS.FAILED, error: 'The stored bid PDF could not be opened.' };
  }

  if (!entry.url) {
    return {
      ok: false,
      status: STATUS.REFERENCE_ONLY,
      error: 'This document is named in the bid but no download link is published.',
    };
  }

  const result = await fetchDocumentWithFallback(entry.url);
  if (result.ok) return { ok: true, buffer: result.buffer, fromCache: false };

  return {
    ok: false,
    // A login wall is recoverable from the office machine; everything else is not.
    status: result.reason === 'login_wall' ? STATUS.NEEDS_LOCAL_AGENT : STATUS.FAILED,
    error: result.error,
  };
}

export async function POST(request) {
  const auth = await requireDashboardStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => null);
    const tenderId = String(body?.tender_id || '').trim();
    const refresh = Boolean(body?.refresh);
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

    const isFirstCall = refresh || !tender.bid_dossier?.documents?.length;
    if (isFirstCall) {
      // A refresh means the old chunks describe documents we are about to replace.
      if (refresh && tender.bid_dossier?.bid_no) {
        await deleteBidVectors(db, tender.bid_dossier.bid_no).catch(() => {});
      }
      // Cheap and idempotent, but it is what makes filtered per-bid retrieval possible,
      // so it runs before the first chunk is written rather than at query time.
      ensureVectorIndex(db).catch((err) => console.warn('[dossier] ensureVectorIndex:', err?.message));
    }

    const dossier = await buildManifest(db, tender, { refresh: isFirstCall });
    const bidNo = dossier.bid_no;

    // "Retry" is the officer saying they have now started the local browser agent, or that
    // the portal was simply down. A document named without a link can never be retried.
    if (body?.retry) {
      for (const doc of dossier.documents) {
        if (doc.status === STATUS.FAILED || doc.status === STATUS.NEEDS_LOCAL_AGENT) {
          doc.status = STATUS.PENDING;
          doc.error = null;
        }
      }
    }

    const pending = dossier.documents.filter((d) => d.status === STATUS.PENDING);

    if (pending.length === 0) {
      const summary = summarise(dossier);
      if (isFirstCall) await persist(db, tender._id, dossier, summary);
      return NextResponse.json({ done: true, remaining: 0, current: null, ...summary, dossier });
    }

    const entry = pending[0];
    const acquired = await acquireDocument(tender, entry);

    if (!acquired.ok) {
      entry.status = acquired.status;
      entry.error = acquired.error;
    } else {
      // Cache before extraction: if Gemini fails we still never re-download.
      if (!acquired.fromCache && !entry.r2_key) {
        const stored = await uploadBidDossierDocument(acquired.buffer, { bidNo, docType: entry.type });
        if (stored) entry.r2_key = stored.key;
      }

      try {
        const { text } = await generateContent({
          tier: 'flash',
          parts: [
            EXTRACTION_PROMPT,
            { inlineData: { data: acquired.buffer.toString('base64'), mimeType: 'application/pdf' } },
          ],
        });

        const extracted = String(text || '').slice(0, MAX_EXTRACT_CHARS);
        if (extracted.trim().length < 200) {
          entry.status = STATUS.FAILED;
          entry.error = 'The document produced no readable text — it may be an unreadable scan.';
        } else {
          const { chunks } = await ingestDocumentVectors(db, {
            documentId: bidDocumentId(bidNo, entry.type, dossier.documents.indexOf(entry)),
            title: `${bidNo} — ${entry.name || entry.type}`,
            text: extracted,
            sourceUrl: entry.url,
            bidNo,
            docType: entry.type,
          });

          entry.status = STATUS.INGESTED;
          entry.chars = extracted.length;
          entry.chunks = chunks;
          entry.error = null;
          entry.ingested_at = new Date();
        }
      } catch (err) {
        console.error('[dossier] extraction/ingest failed:', err?.message || err);
        entry.status = STATUS.FAILED;
        entry.error = `Could not read the document: ${err?.message || 'unknown error'}`;
      }
    }

    const remaining = dossier.documents.filter((d) => d.status === STATUS.PENDING).length;
    if (remaining === 0) dossier.completed_at = new Date();

    const summary = summarise(dossier);
    await persist(db, tender._id, dossier, summary);

    return NextResponse.json({
      done: remaining === 0,
      remaining,
      current: {
        name: entry.name || entry.type,
        type: entry.type,
        status: entry.status,
        chunks: entry.chunks,
        error: entry.error,
      },
      ...summary,
      dossier,
    });
  } catch (error) {
    console.error('[tenders/dossier] fatal error:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

function summarise(dossier) {
  const documents = dossier.documents || [];
  return {
    bid_no: dossier.bid_no,
    total: documents.length,
    ingested: documents.filter((d) => d.status === STATUS.INGESTED).length,
    failed: documents.filter((d) => d.status === STATUS.FAILED).length,
    needs_local_agent: documents.filter((d) => d.status === STATUS.NEEDS_LOCAL_AGENT).length,
    reference_only: documents.filter((d) => d.status === STATUS.REFERENCE_ONLY).length,
    chunks: documents.reduce((sum, d) => sum + (d.chunks || 0), 0),
  };
}

async function persist(db, tenderId, dossier, summary) {
  await db.collection('tenders').updateOne(
    { _id: tenderId },
    { $set: { bid_dossier: { ...dossier, summary, updated_at: new Date() } } },
  ).catch((err) => console.warn('[dossier] could not persist manifest:', err?.message));
}

/** Progress for the UI without triggering any work. */
export async function GET(request) {
  const auth = await requireDashboardStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const tenderId = new URL(request.url).searchParams.get('tender_id');
    if (!tenderId) return NextResponse.json({ error: 'tender_id is required.' }, { status: 400 });

    const db = await getDb();
    const tender = await findTenderByAnyId(db, tenderId, { projection: { bid_dossier: 1, bid_no: 1, title: 1 } });
    if (!tender) return NextResponse.json({ error: `No tender is recorded under ${tenderId}.` }, { status: 404 });

    const dossier = tender.bid_dossier || null;
    return NextResponse.json({
      tender_id: String(tender._id),
      bid_no: tender.bid_no || null,
      ready: Boolean(dossier?.summary?.ingested),
      dossier,
      ...(dossier ? summarise(dossier) : {}),
    });
  } catch (error) {
    console.error('[tenders/dossier] status failed:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

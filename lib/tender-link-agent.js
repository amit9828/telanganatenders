// Finds every document a bid depends on — including the ones nobody recorded.
//
// Stage 1 is regex over the tender record, which only ever sees links somebody already
// captured into a field. In practice the Scope of Work and the buyer's Additional Terms
// are printed *inside the bid PDF body*, so stage 2 asks Gemini to read the document and
// report the URLs and attachment names it can see. That second pass is the difference
// between a dossier that covers the bid and one that covers the cover page.

import { extractTenderLinks, classifyLink, isSafeRemoteUrl } from './tender-links.js';
import { parseAIJson } from './ai-extraction.js';
import { generateContent } from './gemini.js';

const LINK_DISCOVERY_PROMPT = `
You are reading a Government e-Marketplace (GeM) bid document to find every OTHER
document a bidder must also read before quoting.

Report two things:

1. "links" — every http/https URL printed anywhere in this document that points at a
   document, attachment or portal page. Copy each URL character-for-character as printed.
   Do not repair, complete, guess or invent a URL. If a URL is cut off or unreadable,
   leave it out entirely.

2. "referenced_documents" — every document this bid refers to by NAME but does not print
   a URL for (for example "Buyer Added ATC", "Annexure-II Technical Specification",
   "BOQ.xlsx", a corrigendum). These tell the officer what is still missing.

Classify each entry as one of:
SOW, ATC, BOQ, CORRIGENDUM, BID_DOCUMENT, OTHER

Also report "bid_no" exactly as printed on the document, since the recorded number is
sometimes wrong.

Return ONLY this JSON, with no commentary and no markdown fence:
{
  "bid_no": "string or null",
  "links": [{ "url": "string", "label": "string", "type": "SOW" }],
  "referenced_documents": [{ "name": "string", "type": "ATC", "where": "clause or page if stated" }]
}
`.trim();

const VALID_TYPES = new Set(['SOW', 'ATC', 'BOQ', 'CORRIGENDUM', 'BID_DOCUMENT', 'OTHER']);

function normaliseType(value, url = '', label = '') {
  const upper = String(value || '').trim().toUpperCase();
  if (VALID_TYPES.has(upper)) return upper;
  return classifyLink(url, label);
}

/**
 * Stage 2: read the primary bid PDF and report the documents it points at.
 *
 * Never throws — link discovery is an enhancement, and a bid whose PDF cannot be read
 * still deserves the dossier built from stage 1.
 *
 * @param {Buffer} pdfBuffer
 * @returns {Promise<{links: object[], referencedDocuments: object[], bidNo: string|null, error: string|null}>}
 */
export async function discoverLinksInPdf(pdfBuffer) {
  const empty = { links: [], referencedDocuments: [], bidNo: null, error: null };
  if (!pdfBuffer?.length) return { ...empty, error: 'No document to read.' };

  try {
    // Flash tier: this is transcription of visible strings, not judgement, and it runs on
    // every ingest. Pro latency here would be paid on every bid for no accuracy gain.
    const { text } = await generateContent({
      tier: 'flash',
      parts: [
        LINK_DISCOVERY_PROMPT,
        { inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' } },
      ],
    });

    const parsed = parseAIJson(text);
    if (!parsed) return { ...empty, error: 'The model did not return readable JSON.' };

    const links = (Array.isArray(parsed.links) ? parsed.links : [])
      .map((entry) => {
        const url = String(entry?.url || '').trim().replace(/[.,;:!?)\]}>'"]+$/, '');
        if (!url) return null;
        const label = String(entry?.label || '').trim();
        // The URL came out of a PDF via a language model, so it is doubly untrusted:
        // the SSRF guard is the only thing standing between it and our fetcher.
        if (!isSafeRemoteUrl(url)) return null;
        return { url, label: label || null, type: normaliseType(entry?.type, url, label), source: 'pdf_body' };
      })
      .filter(Boolean);

    const referencedDocuments = (Array.isArray(parsed.referenced_documents) ? parsed.referenced_documents : [])
      .map((entry) => {
        const name = String(entry?.name || '').trim();
        if (!name) return null;
        return {
          name: name.slice(0, 200),
          type: normaliseType(entry?.type, '', name),
          where: entry?.where ? String(entry.where).slice(0, 120) : null,
        };
      })
      .filter(Boolean);

    const bidNo = parsed.bid_no ? String(parsed.bid_no).trim().slice(0, 80) : null;

    return { links, referencedDocuments, bidNo, error: null };
  } catch (err) {
    console.warn('[tender-link-agent] PDF link discovery failed:', err?.message || err);
    return { ...empty, error: err?.message || 'Link discovery failed.' };
  }
}

const TYPE_PRIORITY = { SOW: 0, ATC: 1, BID_DOCUMENT: 2, BOQ: 3, CORRIGENDUM: 4, OTHER: 5 };

/**
 * Both stages, merged and de-duplicated.
 *
 * Record-level links win on classification when the same URL appears in both, because a
 * field named `sow_url` is stronger evidence than a model's guess from surrounding prose.
 *
 * @param {object}  tender
 * @param {Buffer} [primaryPdf] The bid document; omit to skip stage 2.
 * @returns {Promise<{links: object[], referencedDocuments: object[], pdfBidNo: string|null, discoveryError: string|null}>}
 */
export async function discoverTenderDocuments(tender, primaryPdf = null) {
  const merged = new Map();

  for (const link of extractTenderLinks(tender)) {
    merged.set(link.url, { ...link, label: null });
  }

  let pdfBidNo = null;
  let discoveryError = null;
  let referencedDocuments = [];

  if (primaryPdf?.length) {
    const found = await discoverLinksInPdf(primaryPdf);
    pdfBidNo = found.bidNo;
    discoveryError = found.error;
    referencedDocuments = found.referencedDocuments;

    for (const link of found.links) {
      if (!merged.has(link.url)) merged.set(link.url, link);
    }
  }

  const links = [...merged.values()].sort(
    (a, b) => (TYPE_PRIORITY[a.type] ?? 5) - (TYPE_PRIORITY[b.type] ?? 5)
  );

  return { links, referencedDocuments, pdfBidNo, discoveryError };
}

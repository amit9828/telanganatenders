// Extracts and classifies the external document links buried in tender records.
//
// GeM and the state e-procurement portals put the real detail — Scope of Work and the
// Additional Terms & Conditions — behind separate URLs that the tender row only mentions
// in free text. Pulling them out reliably is what makes an on-demand deep dive possible.

// Trailing punctuation is almost always sentence punctuation rather than part of the URL.
const URL_PATTERN = /https?:\/\/[^\s<>"'()\[\]{}]+/gi;

// SSRF guard: a tender record is partly AI-extracted from an untrusted PDF, so a URL in
// it is attacker-influenced. Refuse anything that could reach the internal network or a
// cloud metadata service.
const BLOCKED_HOST_PATTERN = new RegExp(
  [
    '^localhost$',
    '^127\\.',
    '^0\\.',
    '^10\\.',
    '^192\\.168\\.',
    '^172\\.(1[6-9]|2\\d|3[01])\\.',
    '^169\\.254\\.',            // link-local, includes AWS/GCP metadata at 169.254.169.254
    '^\\[?::1\\]?$',
    '\\.internal$',
    '\\.local$',
    '^metadata\\.',
  ].join('|'),
  'i'
);

export function isSafeRemoteUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (!parsed.hostname) return false;
  if (BLOCKED_HOST_PATTERN.test(parsed.hostname)) return false;
  // A bare IPv4 literal is never a legitimate government tender portal.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname)) return false;
  return true;
}

/** Guesses what a linked document is, from the URL and the words immediately before it. */
export function classifyLink(url, context = '') {
  const haystack = `${context} ${url}`.toLowerCase();

  if (/\batc\b|additional\s*term|special\s*condition|special\s*term/.test(haystack)) return 'ATC';
  if (/\bsow\b|scope\s*of\s*work|statement\s*of\s*work|technical\s*spec|specification/.test(haystack)) return 'SOW';
  if (/corrigend|amend|addend/.test(haystack)) return 'CORRIGENDUM';
  if (/boq|bill\s*of\s*quant|price\s*schedule/.test(haystack)) return 'BOQ';
  if (/bid\s*document|tender\s*document|nit\b/.test(haystack)) return 'BID_DOCUMENT';
  return 'OTHER';
}

function trimTrailingPunctuation(url) {
  return url.replace(/[.,;:!?)\]}>'"]+$/, '');
}

/**
 * Pulls every usable external document link out of a tender record.
 *
 * Scans the free-text fields (where the AI extractor drops URLs it found in the PDF) as
 * well as the explicit document URL fields.
 *
 * @param {object} tender
 * @returns {Array<{url: string, type: string, source: string}>}
 */
export function extractTenderLinks(tender = {}) {
  const found = new Map(); // url -> entry, de-duplicated

  const addUrl = (rawUrl, { source, context = '' }) => {
    const url = trimTrailingPunctuation(String(rawUrl || '').trim());
    if (!url || !isSafeRemoteUrl(url)) return;
    // First mention wins: an explicit field is scanned before free text and carries the
    // more reliable classification.
    if (found.has(url)) return;
    found.set(url, { url, type: classifyLink(url, context), source });
  };

  // 1. Explicit URL fields, whose names tell us the document type outright.
  const explicitFields = [
    ['sow_url', 'SOW'],
    ['atc_url', 'ATC'],
    ['boq_url', 'BOQ'],
    ['corrigendum_url', 'CORRIGENDUM'],
    ['document_url', 'BID_DOCUMENT'],
    ['bid_document_url', 'BID_DOCUMENT'],
  ];
  for (const [field, type] of explicitFields) {
    const value = tender?.[field];
    if (!value) continue;
    const url = trimTrailingPunctuation(String(value).trim());
    if (isSafeRemoteUrl(url) && !found.has(url)) {
      found.set(url, { url, type, source: field });
    }
  }

  // 2. Free-text fields where the extractor may have left links inline.
  const textFields = ['supply_details', 'description', 'title', 'notes', 'documents_text'];
  for (const field of textFields) {
    const text = String(tender?.[field] || '');
    if (!text) continue;

    for (const match of text.matchAll(URL_PATTERN)) {
      // The 80 characters before the URL usually contain its label ("ATC document: ...").
      const context = text.slice(Math.max(0, match.index - 80), match.index);
      addUrl(match[0], { source: field, context });
    }
  }

  // 3. The tender's own stored PDF, so a deep dive still has something to read when the
  // record carries no external links at all.
  if (tender?.pdf_url && isSafeRemoteUrl(tender.pdf_url) && !found.has(tender.pdf_url)) {
    found.set(tender.pdf_url, { url: tender.pdf_url, type: 'BID_DOCUMENT', source: 'pdf_url' });
  }

  // Rank by usefulness for a scope-of-work question.
  const priority = { SOW: 0, ATC: 1, BID_DOCUMENT: 2, BOQ: 3, CORRIGENDUM: 4, OTHER: 5 };
  return [...found.values()].sort((a, b) => priority[a.type] - priority[b.type]);
}

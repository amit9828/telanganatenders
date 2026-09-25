/**
 * Tender document links and the SSRF guard used before any remote fetch.
 * Named ESM exports: Next.js routes and the local GeM agent both import them this way.
 */

const LINK_FIELDS = [
  ['pdf_url', 'BID_DOCUMENT'],
  ['file_url', 'BID_DOCUMENT'],
  ['sow_url', 'SOW'],
  ['scope_url', 'SOW'],
  ['atc_url', 'ATC'],
  ['boq_url', 'BOQ'],
  ['corrigendum_url', 'CORRIGENDUM'],
];

function ipv4Blocked(host) {
  const parts = host.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

/** Public http(s) only. Blocks localhost, link-local, and private ranges. */
export function isSafeRemoteUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
  if (host === '::1' || host === '0.0.0.0' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return false;
  if (ipv4Blocked(host)) return false;
  return true;
}

/** Classify a link from its label first, then the URL path. */
export function classifyLink(url, label = '') {
  const text = `${label} ${url}`.toLowerCase();
  if (/additional terms|\batc\b/.test(text)) return 'ATC';
  if (/scope of work|\bsow\b/.test(text)) return 'SOW';
  if (/corrigend/.test(text)) return 'CORRIGENDUM';
  if (/bill of quant|\bboq\b|\.xlsx?\b/.test(text)) return 'BOQ';
  if (/bid document|\.pdf\b/.test(text)) return 'BID_DOCUMENT';
  return 'OTHER';
}

function pushLink(out, seen, url, type, source) {
  const clean = String(url || '').trim();
  if (!clean || seen.has(clean) || !isSafeRemoteUrl(clean)) return;
  seen.add(clean);
  out.push({ url: clean, type: type || classifyLink(clean, ''), source });
}

/** Recorded SOW/ATC/bid links on a tender. Unsafe URLs are dropped. */
export function extractTenderLinks(tender) {
  const out = [];
  const seen = new Set();
  if (!tender || typeof tender !== 'object') return out;

  for (const [field, type] of LINK_FIELDS) {
    pushLink(out, seen, tender[field], type, field);
  }

  const lists = [tender.document_links, tender.links, tender.attachments, tender.documents];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (typeof entry === 'string') {
        pushLink(out, seen, entry, classifyLink(entry, ''), 'document_links');
      } else if (entry && typeof entry === 'object') {
        const url = entry.url || entry.href || entry.pdf_url || entry.link;
        const label = entry.label || entry.name || entry.title || '';
        pushLink(out, seen, url, classifyLink(url, label), 'document_links');
      }
    }
  }

  return out;
}

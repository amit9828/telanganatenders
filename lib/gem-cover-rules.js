const AMOUNT_RE = /EMD Amount\s*:?\s*([0-9][0-9,]*)/i;
const REQUIRED_RE = /EMD Detail[\s\S]{0,160}?Required\s+(Yes|No)/i;
const MSE_RE = /MSE Relaxation for (?:Years Of Experience and )?Turnover\s+(Yes|No)/i;

function english(text) {
  return String(text || '')
    .replace(/(\d)[\u0000-\u001f]+(\d)/g, '$1$2')
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function evidenceAround(plain, index, length) {
  const end = Math.min(plain.length, index + length + 16);
  return plain.slice(index, end).trim();
}

function findOnPages(pages, pattern) {
  for (const page of pages) {
    const plain = english(page.text);
    const match = plain.match(pattern);
    if (!match) continue;
    return {
      page: page.page,
      match,
      evidence: evidenceAround(plain, match.index, match[0].length),
    };
  }
  return null;
}

export function emdFrom(pages) {
  const amountHit = findOnPages(pages, AMOUNT_RE);
  if (amountHit) {
    return {
      required: true,
      amount: Number(amountHit.match[1].replace(/,/g, '')),
      evidence: amountHit.evidence,
      page: amountHit.page,
    };
  }
  const requiredHit = findOnPages(pages, REQUIRED_RE);
  if (requiredHit) {
    const yes = requiredHit.match[1].toLowerCase() === 'yes';
    return {
      required: yes,
      amount: null,
      evidence: requiredHit.evidence,
      page: requiredHit.page,
    };
  }
  return { required: null, amount: null, evidence: null, page: null };
}

export function mseFrom(pages) {
  const hit = findOnPages(pages, MSE_RE);
  if (!hit) return { granted: null, evidence: null, page: null };
  return {
    granted: hit.match[1].toLowerCase() === 'yes',
    evidence: hit.evidence,
    page: hit.page,
  };
}

function fileId(url) {
  const match = String(url || '').match(/(\d{6,})\.(pdf|xlsx)/i);
  return match ? match[1] : '';
}

function isGtcUrl(url) {
  return /pdfByDate|downloadOmppdfile/i.test(String(url || ''));
}

function classify(url, namedPdfs, context) {
  const raw = String(url || '');
  if (!/^https?:\/\//i.test(raw) || isGtcUrl(raw)) return null;
  if (/\.(png|jpe?g|gif|svg|css|js)(?:$|\?)/i.test(raw)) return null;
  const id = fileId(raw);
  const named = (namedPdfs || []).find((row) => id && String(row.file || '').startsWith(id));
  const blob = `${named?.label || ''} ${context || ''} ${raw}`;
  let kind = 'other';
  let label = named?.label || 'Linked document';
  if (/scope of work|\bsow\b|specification document|additional specification|technical specification|\bboq\b|\bdrawing\b/i.test(blob)) {
    kind = 'scope_of_work';
    label = named?.label || 'Scope or specification';
  } else if (/payment terms/i.test(blob)) {
    kind = 'payment_terms';
    label = named?.label || 'Payment Terms';
  } else if (/\/bidsla\/|\bsla\b/i.test(blob)) {
    kind = 'sla';
    label = named?.label || 'GeM category SLA';
  } else if (/\/showbiddoc\/|buyer uploaded atc|click here to view the file|corrigendum|\batc\b|certificate/i.test(blob)) {
    kind = 'atc';
    label = named?.label || 'Buyer document';
  }
  return { kind, label };
}

function contextFor(link, pages) {
  if (link?.context) return link.context;
  const page = (pages || []).find((row) => row.page === link?.page);
  const plain = english(page?.text || '');
  const needle = String(link?.url || '').replace(/[?#].*$/, '').slice(-48);
  const at = needle ? plain.toLowerCase().indexOf(needle.toLowerCase()) : -1;
  if (at < 0) return '';
  return plain.slice(Math.max(0, at - 280), at + 40);
}

export function documentsFrom(fixture) {
  const buckets = { scope_of_work: [], payment_terms: [], sla: [], atc: [], other: [] };
  const seen = new Set();
  const pages = Array.isArray(fixture.pages) ? fixture.pages : [];
  for (const link of fixture.links || []) {
    const url = link?.url;
    if (!url) continue;
    const found = classify(url, fixture.named_pdfs, contextFor(link, pages));
    if (!found) continue;
    const key = `${found.kind}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    buckets[found.kind].push({ url, page: link.page, label: found.label, kind: found.kind });
  }
  return buckets;
}

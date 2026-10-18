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

function isBoilerplateUrl(url) {
  return /pdfByDate|downloadOmppdfile|\/bidsla\//i.test(String(url || ''));
}

function buyerAtcContext(context) {
  return /Buyer uploaded ATC document|Click here to view the file|Buyer Added Bid Specific ATC/i.test(String(context || ''));
}

function classify(url, namedPdfs, context) {
  const id = fileId(url);
  const named = (namedPdfs || []).find((row) => id && String(row.file || '').startsWith(id));
  const label = String(named?.label || '');
  const labelLower = label.toLowerCase();
  const urlLower = String(url || '').toLowerCase();

  if (labelLower.startsWith('scope of work')) return { kind: 'scope_of_work', label };
  if (labelLower.includes('payment terms')) return { kind: 'payment_terms', label };
  if (/\batc\b/.test(labelLower) || labelLower.includes('additional terms')) return { kind: 'atc', label };
  if (/\bsla\b/.test(labelLower)) return { kind: 'sla', label };

  if (/integrity/i.test(urlLower)) return null;
  if (/\/bidsla\//i.test(url)) return { kind: 'sla', label: label || 'GeM category SLA' };
  if (/atc/i.test(urlLower) || /\/atc[_-]/i.test(urlLower)) return { kind: 'atc', label: label || 'Buyer ATC upload' };
  if (/sow/i.test(urlLower) && /\.pdf(?:$|\?)/i.test(url)) return { kind: 'scope_of_work', label: label || 'Scope of Work' };
  if (!isBoilerplateUrl(url) && buyerAtcContext(context) && /\.pdf(?:$|\?)/i.test(url)) {
    return { kind: 'atc', label: 'Buyer uploaded ATC document' };
  }
  return null;
}

function contextFor(link, pages) {
  if (link?.context) return link.context;
  const page = (pages || []).find((row) => row.page === link?.page);
  return english(page?.text || '');
}

export function documentsFrom(fixture) {
  const buckets = { scope_of_work: [], payment_terms: [], sla: [], atc: [] };
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
    buckets[found.kind].push({ url, page: link.page, label: found.label });
  }
  return buckets;
}

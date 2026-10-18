/**
 * Step 2 rules over the Step 1 fixtures. No PDF parsing, no Gemini, no network.
 *
 *   node scripts/extract-rules-step2.js
 *
 * Reads fixtures/*.json (skips index.json) and writes fixtures/rules/*.json
 * plus fixtures/rules/index.json.
 *
 * EMD required comes from "EMD Amount <digits>" or, when that is absent, from
 * "EMD Detail ... Required Yes/No". The standard "EMD EXEMPTION" paragraph is
 * ignored. MSE relaxation is only the experience/turnover line.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AMOUNT_RE = /EMD Amount\s*:?\s*([0-9][0-9,]*)/i;
const REQUIRED_RE = /EMD Detail[\s\S]{0,160}?Required\s+(Yes|No)/i;
const MSE_RE = /MSE Relaxation for (?:Years Of Experience and )?Turnover\s+(Yes|No)/i;

function english(text) {
  // A control character between two digits is a broken glyph, not a separator.
  // Every other control character is a line break and becomes a space.
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

function parseArgs(argv) {
  const opts = { input: 'fixtures', output: path.join('fixtures', 'rules') };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--input' && argv[i + 1]) opts.input = argv[++i];
    else if (argv[i] === '--output' && argv[i + 1]) opts.output = argv[++i];
  }
  return opts;
}

function main() {
  const { input, output } = parseArgs(process.argv);
  const inputDir = path.resolve(input);
  const outputDir = path.resolve(output);
  if (!fs.existsSync(inputDir)) {
    console.error(`Missing folder: ${inputDir}`);
    console.error('Run node scripts/prepare-gem-fixtures.js first.');
    process.exit(1);
  }
  const files = fs.readdirSync(inputDir).filter((name) => name.endsWith('.json') && name !== 'index.json').sort();
  if (!files.length) {
    console.error(`No fixtures in ${inputDir}`);
    process.exit(1);
  }
  fs.mkdirSync(outputDir, { recursive: true });

  const index = [];
  for (const name of files) {
    const fixture = JSON.parse(fs.readFileSync(path.join(inputDir, name), 'utf8'));
    const pages = Array.isArray(fixture.pages) ? fixture.pages : [];
    const result = {
      file: fixture.file || name,
      fixture: name,
      sha256: fixture.sha256 || null,
      emd: emdFrom(pages),
      mse_relaxation: mseFrom(pages),
      documents: documentsFrom(fixture),
    };
    fs.writeFileSync(path.join(outputDir, name), `${JSON.stringify(result, null, 2)}\n`);
    const emdLabel = result.emd.required == null
      ? 'not stated'
      : (result.emd.required ? `required ${result.emd.amount ?? 'amount not stated'}` : 'not required');
    const mseLabel = result.mse_relaxation.granted == null ? 'not stated' : (result.mse_relaxation.granted ? 'yes' : 'no');
    const docs = result.documents;
    console.log(`${result.file}: EMD ${emdLabel}; MSE relaxation ${mseLabel}; SOW ${docs.scope_of_work.length}, payment ${docs.payment_terms.length}, SLA ${docs.sla.length}, ATC ${docs.atc.length}`);
    index.push({
      file: result.file,
      fixture: name,
      emd_required: result.emd.required,
      emd_amount: result.emd.amount,
      mse_relaxation: result.mse_relaxation.granted,
      scope_of_work: docs.scope_of_work.length,
      payment_terms: docs.payment_terms.length,
      sla: docs.sla.length,
      atc: docs.atc.length,
    });
  }
  fs.writeFileSync(path.join(outputDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`Wrote ${index.length} result(s) to ${outputDir}`);
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) main();

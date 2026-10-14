/**
 * Local Step 1 dump for GeM bid PDFs. No Gemini, no database, no network.
 *
 * Put 8–10 bid PDFs in sample_tenders, then:
 *   node scripts/prepare-gem-fixtures.js
 *
 * Writes one JSON file per unique PDF into fixtures/, plus fixtures/index.json.
 * A second file with the same bytes is recorded as a duplicate and not extracted again.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';
import { MIN_EXTRACT_CHARS } from '../lib/pdf-text.js';

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/gi;
const NAMED_PDF_RE = /([A-Za-z][A-Za-z0-9 /&(),-]{0,80}?):\s*(\d{5,}\.pdf)/g;

function clean(value) {
  const text = Array.isArray(value) ? value.join('\n') : String(value || '');
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function urlsIn(text) {
  const found = String(text || '').match(URL_RE) || [];
  return [...new Set(found.map((raw) => raw.replace(/[.,;:]+$/g, '')))];
}

function namedPdfsIn(text) {
  const rows = [];
  const seen = new Set();
  for (const match of String(text || '').matchAll(NAMED_PDF_RE)) {
    const label = match[1].replace(/\s+/g, ' ').trim();
    const file = match[2];
    const key = `${label}|${file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ label, file });
  }
  return rows;
}

function linkContext(pageText) {
  const plain = clean(pageText)
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const start = plain.search(/Buyer uploaded ATC document|Click here to view the file|Buyer Added Bid Specific ATC/i);
  if (start >= 0) return plain.slice(Math.max(0, start - 60), start + 160);
  const headings = [];
  const scope = plain.match(/Scope of Work[^.]{0,50}/i);
  const payment = plain.match(/Payment Terms[^.]{0,40}/i);
  if (scope) headings.push(scope[0]);
  if (payment) headings.push(payment[0]);
  return headings.join(' | ').slice(0, 240);
}

async function annotationLinks(buffer, pages) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const links = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const annotations = await page.getAnnotations();
    const context = linkContext(pages[pageNumber - 1]?.text || '');
    for (const annotation of annotations) {
      if (annotation.subtype !== 'Link') continue;
      const url = annotation.url || annotation.unsafeUrl || '';
      links.push({
        page: pageNumber,
        url: url || null,
        dest: annotation.dest == null ? null : String(annotation.dest),
        context,
      });
    }
  }
  return links;
}

function parseArgs(argv) {
  const opts = { input: 'sample_tenders', output: 'fixtures' };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--input' && argv[i + 1]) opts.input = argv[++i];
    else if (argv[i] === '--output' && argv[i + 1]) opts.output = argv[++i];
  }
  return opts;
}

async function pagesFrom(buffer) {
  const { totalPages, text } = await extractText(new Uint8Array(buffer), { mergePages: false });
  const rawPages = Array.isArray(text) ? text : [String(text || '')];
  const pages = rawPages.map((page, index) => {
    const body = clean(page);
    return {
      page: index + 1,
      chars: body.length,
      scanned: body.length < MIN_EXTRACT_CHARS,
      text: body,
    };
  });
  return { totalPages: totalPages || pages.length, pages };
}

async function main() {
  const { input, output } = parseArgs(process.argv);
  const inputDir = path.resolve(input);
  const outputDir = path.resolve(output);
  if (!fs.existsSync(inputDir)) {
    console.error(`Missing folder: ${inputDir}`);
    console.error('Create sample_tenders, copy the GeM bid PDFs into it, and run this again.');
    process.exit(1);
  }
  fs.mkdirSync(outputDir, { recursive: true });
  const files = fs.readdirSync(inputDir).filter((name) => name.toLowerCase().endsWith('.pdf')).sort();
  if (!files.length) {
    console.error(`No PDF files in ${inputDir}`);
    process.exit(1);
  }

  const seen = new Map();
  const index = [];
  for (const name of files) {
    const buffer = fs.readFileSync(path.join(inputDir, name));
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    if (seen.has(sha256)) {
      console.log(`skip duplicate ${name} (same bytes as ${seen.get(sha256)})`);
      index.push({ file: name, sha256, duplicate_of: seen.get(sha256), fixture: null });
      continue;
    }
    seen.set(sha256, name);

    let extracted = { totalPages: 0, pages: [] };
    let error = null;
    try {
      extracted = await pagesFrom(buffer);
    } catch (err) {
      error = err?.message || String(err);
    }
    const fullText = extracted.pages.map((page) => page.text).filter(Boolean).join('\n\n');
    const urls = urlsIn(fullText);
    const namedPdfs = namedPdfsIn(fullText);
    let links = [];
    if (!error) {
      try {
        links = await annotationLinks(buffer, extracted.pages);
      } catch (err) {
        error = err?.message || String(err);
      }
    }
    const scannedPages = extracted.pages.filter((page) => page.scanned).map((page) => page.page);
    const fixtureName = `${sha256.slice(0, 16)}.json`;
    const fixture = {
      file: name,
      sha256,
      bytes: buffer.length,
      extracted_at: new Date().toISOString(),
      method: 'local',
      gemini: false,
      total_pages: extracted.totalPages,
      scanned_pages: scannedPages,
      urls,
      named_pdfs: namedPdfs,
      links,
      pages: extracted.pages,
      error,
    };
    fs.writeFileSync(path.join(outputDir, fixtureName), `${JSON.stringify(fixture, null, 2)}\n`);
    index.push({
      file: name,
      sha256,
      duplicate_of: null,
      fixture: fixtureName,
      pages: extracted.totalPages,
      scanned_pages: scannedPages.length,
      urls: urls.length,
      named_pdfs: namedPdfs.length,
      links: links.length,
      error,
    });
    console.log(`${name} -> ${path.join(output, fixtureName)} (${extracted.totalPages} pages, ${scannedPages.length} short, ${urls.length} text urls, ${namedPdfs.length} named pdfs, ${links.length} link annotations)`);
  }

  fs.writeFileSync(path.join(outputDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  console.log(`Wrote ${index.length} row(s) to ${outputDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

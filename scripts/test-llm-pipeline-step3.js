/**
 * Step 3 proof: cut five sections out of one cover bid and its SLA / SOW / ATC /
 * payment files, then translate each point to Telugu. No Gemini key is required.
 *
 *   node scripts/test-llm-pipeline-step3.js --file GeM-Bidding-9764651 --file GeM-Bidding-9747960
 *
 * Writes fixtures/reports/<bid>.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from './load-local-env.js';
import {
  analyzeTenderBuffer,
  buildReport,
  loadTranslationCache,
  renderMarkdown,
  reportFromTexts,
  saveTranslationCache,
} from '../lib/gem-bid-extract.js';
import { exactQuote } from '../lib/gem-quote-resolve.js';

function parseArgs(argv) {
  const opts = {
    files: [],
    rules: path.join('fixtures', 'rules'),
    output: path.join('fixtures', 'reports'),
    pdf: '',
    bid: '',
    jsonOut: '',
  };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--file' && argv[i + 1]) opts.files.push(argv[++i]);
    else if (argv[i] === '--rules' && argv[i + 1]) opts.rules = argv[++i];
    else if (argv[i] === '--output' && argv[i + 1]) opts.output = argv[++i];
    else if (argv[i] === '--pdf' && argv[i + 1]) opts.pdf = argv[++i];
    else if (argv[i] === '--bid' && argv[i + 1]) opts.bid = argv[++i];
    else if (argv[i] === '--json-out' && argv[i + 1]) opts.jsonOut = argv[++i];
  }
  return opts;
}

function loadRules(rulesDir, fileHint) {
  const names = fs.readdirSync(rulesDir).filter((name) => name.endsWith('.json') && name !== 'index.json');
  const hint = fileHint.toLowerCase();
  for (const name of names) {
    const rules = JSON.parse(fs.readFileSync(path.join(rulesDir, name), 'utf8'));
    if (String(rules.file || '').toLowerCase().includes(hint) || name.toLowerCase().includes(hint)) return rules;
  }
  throw new Error(`No rules file matching ${fileHint} in ${rulesDir}`);
}

const TRANSPORT_COVER = [
  'Item Category Goods Transport Services - Per MT - Gypsum /Similar Category As per Bid As per Bid',
  'Document required from seller Experience Criteria,Bidder Turnover,Certificate (Requested in ATC),Additional Doc 1 (Requested in ATC) *In case any bidder is seeking exemption from Experience',
  'Do you want to show documents',
  'Buyer Added Bid Specific Terms and Conditions',
  '1. The seller shall carry the goods described in the specification document.',
  'Disclaimer',
].join(' ');

const TRANSPORT_SOW = 'Scope of Work. Transportation of Gypsum from the loading point at Mancherial to the unloading point at Ramagundam. The quantity for the contract period is 5000 MT. Vehicle requirement is one 25 MT tipper. Loading and unloading shall be arranged by the seller at both ends.';

const TRANSPORT_ATC = 'Additional Doc 1: The bidder shall upload a valid Fitness Certificate, PUC and RTO permit for every offered vehicle. Certificate (Requested in ATC): The bidder shall upload an experience certificate for similar goods transport work during the last three years.';

const TRANSPORT_SLA = 'Late delivery beyond the scheduled date shall attract liquidated damages at 0.5% of the contract value per week, subject to a maximum of 10%. Detention of the vehicle beyond 8 hours shall be charged at Rs. 1500 per day. Short supply shall be deducted at the quoted rate per MT.';

function printPart(title, sections, pick) {
  console.log(`\n${title}`);
  for (const section of sections || []) {
    console.log(section.title);
    const items = pick(section);
    for (const item of items) console.log(`- ${item.title}: ${item.text}`);
  }
}

async function runTransportDemo() {
  const source = [TRANSPORT_SOW, TRANSPORT_ATC, TRANSPORT_SLA].join('\n');
  const invented = exactQuote(source, 'Fitness Certificate issued by the lunar port authority');
  console.log(`Hallucinated certificate kept: ${invented ? 'yes' : 'no'}`);
  const report = await reportFromTexts({
    cover: TRANSPORT_COVER,
    sow: TRANSPORT_SOW,
    atc: TRANSPORT_ATC,
    sla: TRANSPORT_SLA,
    bidNo: 'goods-transport-gypsum',
  });
  printPart('PART B', report.report_en.part_b_scope_of_work.sections, (section) => (section.blocks || []).filter((block) => block.text));
  printPart('PART C', report.report_en.part_c_documents.groups, (group) => group.items || []);
  printPart('PART D', report.report_en.part_d_terms_payment_penalties.sections, (section) => section.items || []);
  const teluguScope = report.report_te.part_b_scope_of_work.sections.find((section) => section.title === 'Transport scope' || /రవాణ|Transport/i.test(section.title));
  console.log('\nTELUGU TRANSPORT', teluguScope ? (teluguScope.blocks || []).map((block) => block.text).join(' | ') : '(translated with the English facts)');
  console.log('pointers_unresolved', report.pointers_unresolved);
  console.log('openai_key', Boolean(process.env.OPENAI_API_KEY));
}

async function main() {
  loadLocalEnv();
  process.env.GEM_OCR_CACHE = process.env.GEM_OCR_CACHE || path.join(process.cwd(), 'fixtures', 'reports');
  const opts = parseArgs(process.argv);
  if (process.argv.includes('--demo-transport')) {
    await runTransportDemo();
    return;
  }
  const outputDir = path.resolve(opts.output);
  fs.mkdirSync(outputDir, { recursive: true });
  const cachePath = loadTranslationCache(outputDir);
  if (opts.pdf) {
    const report = await analyzeTenderBuffer(fs.readFileSync(opts.pdf), { bidNo: opts.bid, outputDir });
    const outPath = path.resolve(opts.jsonOut || path.join(outputDir, 'live-bid-report.json'));
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
    saveTranslationCache(cachePath);
    console.log(`Wrote ${outPath}`);
    return;
  }
  const rulesDir = path.resolve(opts.rules);
  const files = opts.files.length
    ? opts.files
    : JSON.parse(fs.readFileSync(path.join(rulesDir, 'index.json'), 'utf8')).map((row) => String(row.file).replace(/\.pdf$/i, ''));
  for (const file of files) {
    const rules = loadRules(rulesDir, file);
    console.log(`\n${rules.file}`);
    const report = await buildReport(rules, rulesDir, outputDir);
    const base = String(rules.file).replace(/\.pdf$/i, '');
    const outPath = path.join(outputDir, `${base}.json`);
    const mdPath = path.join(outputDir, `${base}-Report.md`);
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(mdPath, renderMarkdown(report));
    console.log(`Wrote ${outPath}`);
    console.log(`Wrote ${mdPath}`);
    saveTranslationCache(cachePath);
  }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main().catch((err) => {
    console.error(err?.stack || err?.message || err);
    process.exit(1);
  });
}

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
  saveTranslationCache,
} from '../lib/gem-bid-extract.js';

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

async function main() {
  loadLocalEnv();
  process.env.GEM_OCR_CACHE = process.env.GEM_OCR_CACHE || path.join(process.cwd(), 'fixtures', 'reports');
  const opts = parseArgs(process.argv);
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

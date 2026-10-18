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
import { documentsFrom, emdFrom, mseFrom } from '../lib/gem-cover-rules.js';

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

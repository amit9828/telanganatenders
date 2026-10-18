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
import { extractText, getDocumentProxy } from 'unpdf';
import { loadLocalEnv } from './load-local-env.js';
import { assertNoLeak, buildFourPartReport } from './gem-universal-report.js';
import { documentsFrom, emdFrom, mseFrom } from './extract-rules-step2.js';
import { ocrEmptyPdf } from './ocr-empty-pdf.js';

const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/gi;

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

function squash(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function toEnglish(text) {
  return squash(
    String(text || '')
      .replace(/(\d)[\u0000-\u001f]+(\d)/g, '$1$2')
      .replace(/[\u0000-\u001f]/g, ' ')
      .replace(/[^\x20-\x7e]/g, ' ')
      .replace(/([a-z]{2,})([A-Z][a-z]{2,})/g, '$1 $2'),
  );
}

function decodeEntities(html) {
  return String(html || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&lsquo;|&rsquo;/gi, "'")
    .replace(/&ndash;|&mdash;/gi, ' - ')
    .replace(/&middot;/gi, ' · ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function htmlToText(html) {
  const text = decodeEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const english = toEnglish(text)
    .replace(/Serviceat/g, 'Service at')
    .replace(/Providershall/g, 'Provider shall')
    .replace(/thecompetent/g, 'the competent')
    .replace(/buyer\.This/g, 'buyer. This');
  const start = english.search(/Agreement Overview|\bPreface\b/i);
  const body = start >= 0 ? english.slice(start) : english;
  const footer = body.search(/\bWEB INFO\b|\bTerms of Use\b/i);
  return footer > 400 ? body.slice(0, footer) : body;
}

function isStub(text) {
  return text.length < 400 || /refer\s+gem\s+sla/i.test(text);
}

function sliceBetween(text, startRe, endRe, cap = 7000) {
  const start = text.search(startRe);
  if (start < 0) return '';
  const rest = text.slice(start);
  const end = rest.slice(40).search(endRe);
  return squash(end < 0 ? rest.slice(0, cap) : rest.slice(0, 40 + end));
}

function sentences(text) {
  return squash(text)
    .split(/(?<=[.;])\s+/)
    .map((part) => squash(part))
    .filter((part) => part.length > 25);
}

function unique(points) {
  const seen = new Set();
  const out = [];
  for (const point of points) {
    const value = squash(point);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function section(exact, points) {
  const pointsEn = unique(points).map((point, index) => `Point ${index + 1}: ${point.replace(/^Point\s+\d+:\s*/i, '')}`);
  return { exact_extracted_text: squash(exact), points_en: pointsEn, points_te: [] };
}

async function downloadDocument(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
    headers: { 'User-Agent': 'TGTenders-local-poc', Accept: 'application/pdf,text/html,*/*' },
  });
  if (!response.ok) throw new Error(`Download failed ${response.status} for ${url}`);
  const type = String(response.headers.get('content-type') || '');
  const bytes = Buffer.from(await response.arrayBuffer());
  const looksPdf = bytes.subarray(0, 5).toString() === '%PDF-' || type.includes('pdf');
  if (looksPdf) return { kind: 'pdf', bytes };
  if (type.includes('html') || bytes.subarray(0, 15).toString().includes('<')) {
    return { kind: 'html', text: htmlToText(bytes.toString('utf8')) };
  }
  throw new Error(`URL returned neither a PDF nor HTML (${type || 'unknown type'})`);
}

async function pdfText(buffer) {
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  const raw = Array.isArray(text) ? text.join('\n') : String(text || '');
  const english = toEnglish(raw);
  if (squash(english).length >= 40) return english;
  console.log('  no text layer, reading the scan');
  return toEnglish(await ocrEmptyPdf(buffer));
}

function coverScope(cover) {
  const points = [];
  const category = cover.match(/\/Item Category\s+(.+?)\s+\/(?:Similar Category|Contract Period)/i);
  const nomenclature = cover.match(/Nomenclature of Service[\s\S]{0,120}?functionality\s+(.+?)\s+Regulatory/i);
  const lineRe = /Frequency in each cycle\s*:\s*(\d+)\s+Number of working days in a month\s*:\s*(\d+)\s+Number of cycles during Contract Period\s*:\s*(\d+)([\s\S]{0,1800}?)Nature of Service\s+(.+?)\s+Type of Area\s+(.+?)\s+Area Inclusions\s+(.+?)\s+Floor Type\s+(.+?)\s+Type of Cycle\s+([A-Za-z]+)(?:\s+\/Addon\(s\)\s+Consumables to be provided by Service Provider\s+(Yes|No))?/gi;
  let line = lineRe.exec(cover);
  while (line) {
    const before = cover.slice(Math.max(0, line.index - 24), line.index);
    const areaMatch = before.match(/(\d{6})(\d{1,6})\s*$/);
    const supplies = line[10]
      ? `; consumables ${line[10].toLowerCase() === 'yes' ? 'by the service provider' : 'not by the service provider'}`
      : '';
    const area = areaMatch ? `, ${areaMatch[2]} sq. metre` : '';
    points.push(
      `${squash(line[5])} (${squash(line[6])}${area}): include ${squash(line[7])}; floor ${squash(line[8])}; ${squash(line[9]).toLowerCase()} cycle; ${line[1]} time(s) each cycle, ${line[2]} working days a month, ${line[3]} cycles${supplies}.`,
    );
    line = lineRe.exec(cover);
  }
  if (!points.length && nomenclature) points.push(`Custom bid service: ${squash(nomenclature[1])}.`);
  else if (!points.length && category) points.push(`Service: ${squash(category[1])}.`);
  const exact = [category?.[0] || '', nomenclature?.[0] || '', ...points].filter(Boolean).join(' ');
  return { exact, points };
}

function agreementScope(secondaryText) {
  const overview = sliceBetween(secondaryText, /Agreement Overview/i, /\b\d+\s+Objectives\b/i, 2500);
  const scope = sliceBetween(secondaryText, /\b\d+\s+Scope of (?:Services|Work)\b/i, /\b\d+\s+[A-Z][a-z]{3,}\b/i, 3500);
  const points = [];
  if (overview) points.push(...sentences(overview).slice(0, 2));
  if (scope) {
    const [lead, ...rest] = scope.split(' · ');
    points.push(...sentences(lead).slice(0, 2));
    for (const bullet of rest) {
      const item = squash(bullet).replace(/\*$/, '').trim();
      if (item.length > 8) points.push(item.endsWith('.') ? item : `${item}.`);
    }
  }
  return { exact: [overview, scope].filter(Boolean).join(' '), points };
}

function documentPoints(cover, atcPoints) {
  const match = cover.match(/Document required\s+from seller\s+(.+?)(?=\*In case|Do you want to show)/i);
  const listed = match ? match[1].split(',').map((item) => squash(item)).filter(Boolean) : [];
  const points = listed.map((item) => `Upload ${item}.`);
  if (/\*In case any bidder is seeking exemption from Experience/i.test(cover)) {
    points.push('If experience or turnover exemption is claimed, upload the supporting documents that prove eligibility for that exemption.');
  }
  for (const point of atcPoints) {
    if (/financial standing|bankrupt|liquidation/i.test(point)) {
      points.push('Upload a financial-standing undertaking that the bidder is not bankrupt and is not under liquidation or court receivership.');
    }
    if (/registered at/i.test(point)) {
      const place = point.match(/registered at (?:a |an )?([A-Za-z][A-Za-z .]+?) address/i);
      points.push(`Upload proof that the firm is registered at a ${place ? squash(place[1]) : 'local'} address.`);
    }
  }
  const exact = [
    match ? squash(match[0]) : '',
    cover.match(/\*In case any bidder is seeking exemption from Experience[\s\S]{0,220}?buyer/i)?.[0] || '',
  ].filter(Boolean).join(' ');
  return { exact, points };
}

function summarizeAtc(body) {
  const text = squash(body);
  const points = [];
  const option = text.match(/OPTION CLAUSE\s*(\d+)\s*%/i);
  if (option) {
    points.push(`Option Clause ${option[1]}%: at contract issue the buyer can increase or decrease quantity or duration by up to ${option[1]}%. After issue, only an increase of up to ${option[1]}% is allowed. Bidders must accept the revised quantity or duration.`);
  }
  if (/financial standing|bankrupt|liquidation/i.test(text)) {
    points.push('Bidder financial standing: the bidder must not be under liquidation, court receivership, or bankruptcy, and must upload an undertaking to that effect with the bid.');
  }
  if (/shall not assign|sub-contract/i.test(text)) {
    points.push('No assignment or sub-contracting of the whole or any part of the contract without the buyer\'s prior written consent. The seller stays jointly and severally liable for performance.');
  }
  if (/toll free|dedicated\s*\/?\s*toll/i.test(text)) {
    points.push('The bidder must have a dedicated or toll-free telephone number for service support.');
  }
  if (/liable to be rejected/i.test(text)) {
    points.push('The offer can be rejected if any certificate or document sought in the bid, the ATC, or a corrigendum is not uploaded.');
  }
  const registered = text.match(/registered at\s+([A-Za-z][A-Za-z .]+?)\s+address/i);
  if (registered) points.push(`The firm must be registered at a ${squash(registered[1])} address.`);
  if (points.length) return points;
  if (/Click here to view the file/i.test(text)) {
    return ['The buyer has uploaded a separate ATC file. That file has to be read with these clauses.'];
  }
  if (/text based ATC clauses/i.test(text)) {
    const rest = squash(text.replace(/^.*?text based ATC clauses\s*/i, ''));
    return sentences(rest).length ? sentences(rest) : [rest];
  }
  return sentences(text).slice(0, 2);
}

function coverAtc(cover) {
  const start = cover.search(/Buyer Added Bid Specific Terms and Conditions/i);
  if (start < 0) return { exact: '', points: [] };
  let slice = cover.slice(start);
  const disclaimer = slice.search(/\bDisclaimer\b/i);
  if (disclaimer > 0) slice = slice.slice(0, disclaimer);
  slice = squash(slice.replace(/\b\d{1,2}\s+\/\s+\d{1,2}\b/g, ' '));
  const marks = [...slice.matchAll(/\d+\.\s+(?:Generic|Certificates|Service\s*&\s*Support|Buyer Added Bid Specific ATC)\b/g)];
  const points = [];
  if (!marks.length) {
    points.push(...sentences(slice).slice(0, 8));
  } else {
    for (let i = 0; i < marks.length; i += 1) {
      const from = marks[i].index;
      const to = i + 1 < marks.length ? marks[i + 1].index : slice.length;
      const summarized = summarizeAtc(slice.slice(from, to));
      points.push(...(Array.isArray(summarized) ? summarized : [summarized]));
    }
  }
  return { exact: slice, points };
}

function downloadedAtcPoints(text) {
  if (!text || isStub(text)) return [];
  const slice = text.split(/\bDisclaimer\b/i)[0];
  const marks = [...slice.matchAll(/\d+\.\s+(?:Generic|Certificates|Service\s*&\s*Support|Buyer Added Bid Specific ATC)\b/g)];
  if (marks.length) {
    const points = [];
    for (let i = 0; i < marks.length; i += 1) {
      const from = marks[i].index;
      const to = i + 1 < marks.length ? marks[i + 1].index : slice.length;
      const summarized = summarizeAtc(slice.slice(from, to));
      points.push(...(Array.isArray(summarized) ? summarized : [summarized]));
    }
    return points;
  }
  return sentences(slice).slice(0, 12);
}

function penaltyRow(row) {
  const between = row.match(/Overall Score between\s+([^.]{0,40}%)/i);
  const below = row.match(/Overall Score below\s+([^.]{0,20}%)/i);
  const score = between || below;
  if (score) {
    const label = below && !between ? `below ${squash(score[1])}` : squash(score[1]);
    const rates = [...row.matchAll(/(\d+)\s*%\s+of the Monthly/gi)].map((match) => `${match[1]}% of the monthly cost`);
    return `Service score ${label}: warning, then ${rates.join(', then ') || 'the stated monthly-cost penalty'}. After the third instance the buyer may terminate or continue the last penalty, capped at 10% of the contract value.`;
  }
  if (/Non deployment/i.test(row)) {
    return 'Non-deployment of the service team: after the third instance the buyer may terminate the contract or keep imposing that penalty. The total must not exceed 10% of the contract value.';
  }
  if (/Failure to address deficiencies/i.test(row)) {
    const amounts = [...row.matchAll(/Rs\.?\s*([\d,]+)/gi)].map((match) => `Rs. ${match[1]}`);
    return `Failure to address deficiencies pointed out at inspection: ${amounts.join(', then ') || 'the stated rupee penalty'}.`;
  }
  if (/Misbehavior|unacceptable behavior/i.test(row)) {
    const amounts = [...row.matchAll(/Rs\.?\s*([\d,]+)/gi)].map((match) => `Rs. ${match[1]}`);
    return `Misbehavior by staff: ${amounts.join(', then ')}. After the second instance the service provider must replace that resource.`;
  }
  if (/Damage to Buyer/i.test(row)) {
    return 'Damage to the buyer\'s assets by the service provider\'s staff: pay the value of the damaged or lost article and replace it within 2 days. The buyer may cancel the contract with cancellation charges of 10% of the order value.';
  }
  if (/subcontracting|outsourcing/i.test(row)) {
    return 'Subcontracting or outsourcing any part of the contract: replace the arrangement within 2 days, or cancel the contract with cancellation charges of 10% of the contract value.';
  }
  return '';
}

function penaltyPoints(texts) {
  const joined = texts.filter(Boolean).join(' ');
  const section = sliceBetween(joined, /\b\d+\s+Penalties and Fine\b|\bPenalties and Fine\b/i, /\b\d+\s+Payment Terms\b/i, 6000);
  const points = [];
  const source = section || joined;
  const head = source.split(/Sr\.\s*No\./i)[0];
  const defined = head.match(/Breach of SLA is defined as [^.]+/i);
  if (defined) points.push(`${squash(defined[0])}.`);
  for (const item of head.matchAll(/\b([a-c])\.\s+(.+?)(?=\s+[a-c]\.\s+|\s+Sr\.|$)/gi)) {
    points.push(`Breach condition ${item[1].toUpperCase()}: ${squash(item[2]).replace(/\.$/, '')}.`);
  }
  const table = source.split(/Sr\.\s*No\./i)[1] || '';
  for (const row of table.split(/(?=\d+\.\s+)/).slice(1)) {
    const point = penaltyRow(row);
    if (point) points.push(point);
  }
  const outside = section ? joined.split(section)[0] : '';
  for (const sentence of sentences(outside)) {
    if (!/attract penalties|levy of penalty|liquidated damages|fine\/ penalty|fine\/penalty/i.test(sentence)) continue;
    if (/Labour Codes|Minimum Wages Act|encompasses service level/i.test(sentence)) continue;
    points.push(sentence);
  }
  if (!points.length) {
    for (const sentence of sentences(joined)) {
      if (!/\b(penalt\w*|liquidated damages|deduction|breach)\b/i.test(sentence)) continue;
      if (/Labour Codes|Minimum Wages Act|encompasses service level|Buyer shall define penalties/i.test(sentence)) continue;
      points.push(sentence);
    }
  }
  return { exact: section || points.join(' '), points };
}

function paymentPoints(cover, texts) {
  const points = [];
  const coverClause = cover.match(/Payment Timelines\s+(.+?)(?=\s*\/?\s*Evaluation Method|\s+Arbitration Clause|\s+Mediation Clause|\s+\/Bid Details|\b\d+\s+\/\s+\d+)/i);
  if (coverClause) {
    const clause = squash(coverClause[1]).replace(/(?:\s+X|\s*\\)+\s*$/g, '').trim();
    const days = clause.match(/within (\d+) days/i);
    const replaced = clause.match(/supersession of (\d+) days/i);
    if (days && replaced) {
      points.push(`Payments shall be made to the seller within ${days[1]} days of issue of the service delivery acceptance certificate (SDAC) and online submission of bills. This ${days[1]}-day period replaces the ${replaced[1]}-day period in clause 12 of GeM GTC.`);
    } else points.push(clause);
  }
  const joined = texts.filter(Boolean).join(' ');
  const section = sliceBetween(joined, /\b\d+\s+Payment Terms\b|\bPayment Condition\b/i, /\b\d+\s+Amendment of Contract\b/i, 4000);
  const body = section || '';
  const parts = body.split(/\s+(?=(?:[ivx]{1,4}|[a-c])\.\s+)/i).slice(body ? 1 : 0);
  if (/deduction of payment|faulty service/i.test(body)) {
    points.push('Payment terms include deduction for faulty service.');
  }
  for (const part of parts) {
    const text = squash(part)
      .replace(/^(?:[ivx]{1,4}|[a-c])\.\s+/i, '')
      .replace(/\s+\d+\.\d+\s+[A-Za-z][\w ]*$/g, '')
      .trim();
    if (text.length > 25) points.push(text.endsWith('.') ? text : `${text}.`);
  }
  if (!parts.length && !coverClause) {
    for (const sentence of sentences(joined)) {
      if (/payment shall|within \d+ days|invoice/i.test(sentence)) points.push(sentence);
    }
  }
  return { exact: [coverClause ? squash(coverClause[0]) : '', section].filter(Boolean).join(' '), points };
}

const translationCache = new Map();

function loadTranslationCache(outputDir) {
  const cachePath = path.join(outputDir, '.te-cache.json');
  if (!fs.existsSync(cachePath)) return cachePath;
  const saved = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  for (const [key, value] of Object.entries(saved)) translationCache.set(key, value);
  return cachePath;
}

function saveTranslationCache(cachePath) {
  fs.writeFileSync(cachePath, `${JSON.stringify(Object.fromEntries(translationCache), null, 2)}\n`);
}

function needsTranslation(text) {
  return /[A-Za-z]{3,}/.test(text) && !/^\d{1,2}:\d{2}\s*(?:AM|PM)?$/i.test(text);
}

async function translateOne(text) {
  if (!text || !needsTranslation(text)) return text;
  if (translationCache.has(text)) return translationCache.get(text);
  if (text.length > 650) {
    const parts = [];
    let index = 0;
    while (index < text.length) {
      let end = Math.min(text.length, index + 650);
      if (end < text.length) {
        const space = text.lastIndexOf(' ', end);
        if (space > index + 200) end = space;
      }
      parts.push(text.slice(index, end).trim());
      index = end;
    }
    const translated = [];
    for (const part of parts) translated.push((await translateOne(part)) || part);
    const joined = translated.join(' ').trim();
    if (/[\u0c00-\u0c7f]/.test(joined)) translationCache.set(text, joined);
    return /[\u0c00-\u0c7f]/.test(joined) ? joined : '';
  }
  const query = encodeURIComponent(text);
  const google = await fetch(`https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=en&tl=te&dt=t&q=${query}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (google.ok) {
    const data = await google.json();
    const translated = (data?.[0] || []).map((part) => part?.[0] || '').join('').trim();
    if (translated && /[\u0c00-\u0c7f]/.test(translated)) {
      translationCache.set(text, translated);
      return translated;
    }
  }
  const memory = await fetch(`https://api.mymemory.translated.net/get?langpair=en|te&q=${encodeURIComponent(text.slice(0, 450))}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (memory.ok) {
    const data = await memory.json();
    const translated = String(data?.responseData?.translatedText || '').trim();
    if (translated && /[\u0c00-\u0c7f]/.test(translated) && !/MYMEMORY WARNING|QUERY LENGTH|NO QUERY SPECIFIED/i.test(translated)) {
      translationCache.set(text, translated);
      return translated;
    }
  }
  return '';
}

async function translateWithGemini(lines) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  if (!key) return [];
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const modelName = String(process.env.GEMINI_FLASH_MODEL || 'gemini-2.5-flash').trim();
  const model = new GoogleGenerativeAI(key).getGenerativeModel({
    model: modelName,
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  });
  const result = await model.generateContent([
    { text: 'Translate each English string to Telugu. Return a JSON array of strings in the same order. Do not add facts.' },
    { text: JSON.stringify(lines) },
  ]);
  const parsed = JSON.parse(String(result.response.text() || '[]'));
  return Array.isArray(parsed) ? parsed.map((line) => String(line || '').trim()) : [];
}

async function translatePoints(points) {
  const bodies = points.map((point) => point.replace(/^Point\s+\d+:\s*/i, ''));
  const translated = [];
  const missing = [];
  for (let index = 0; index < bodies.length; index += 1) {
    const cached = translationCache.has(bodies[index]);
    const value = await translateOne(bodies[index]);
    translated.push(value);
    if (!value) missing.push(index);
    if (!cached) await new Promise((resolve) => setTimeout(resolve, 120));
  }
  if (missing.length) {
    const filled = await translateWithGemini(missing.map((index) => bodies[index])).catch(() => []);
    missing.forEach((index, offset) => {
      if (filled[offset]) translated[index] = filled[offset];
    });
  }
  return translated.map((line, index) => `${index + 1}. ${line || bodies[index]}`);
}

function tidyClause(text) {
  return squash(String(text || ''))
    .replace(/(\d)\.:(\d)/g, '$1:$2')
    .replace(/([A-Za-z])(\d{1,2}\s+of\s+\d{1,2})/g, '$1 $2')
    .replace(/\s*\d{1,2}\s+of\s+\d{1,2}(?=\d)/g, ' ')
    .replace(/\s+\d{1,2}\s+of\s+\d{1,2}\b/g, ' ')
    .replace(/\bglovse\b/gi, 'gloves')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitNumbered(text) {
  return tidyClause(text)
    .split(/(?=\s\d+(?:\.\d+)+\.?\s+[A-Z0-9]|\s\d+\.\s+[A-Z0-9]|\s[A-B]\.\s+[A-Z])/)
    .map(tidyClause)
    .filter((part) => part.length >= 8 && !/^\d*\s*Section[-\s]/i.test(part));
}

function between(text, startRe, endRe, max = 5000) {
  const start = text.search(startRe);
  if (start < 0) return '';
  const rest = text.slice(start, start + max);
  const end = rest.slice(30).search(endRe);
  return end < 0 ? rest : rest.slice(0, 30 + end);
}

function point(title, text, children = []) {
  return { title, text: squash(text), children };
}

function findText(list, pattern) {
  return (list || []).find((line) => pattern.test(line)) || '';
}

function stripNumber(text) {
  return tidyClause(text).replace(/^\d+(?:\.\d+)*\.?\s*/, '').replace(/^[A-B]\.\s*/, '');
}

function prettyQuantity(value) {
  const match = String(value || '').match(/(\d+)\s*(day|week|month)/i);
  if (!match) return value || '';
  const unit = /day/i.test(match[2]) ? 'Days' : /week/i.test(match[2]) ? 'Weeks' : 'Months';
  return `${match[1]} ${unit}`;
}

function rupee(value) {
  const amount = Number(String(value || '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(amount)) return value ? `Rs. ${value}` : 'Not stated';
  return `Rs. ${amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function mdCell(value) {
  return String(value || '').replace(/\|/g, '/').replace(/\n/g, ' ');
}

function renderPoints(items, numbered) {
  const lines = [];
  items.forEach((item, index) => {
    const lead = numbered ? `${index + 1}. ` : '- ';
    const title = item.title ? `**${item.title}:** ` : '';
    const duration = item.quantity ? ` — **${item.quantity}**` : '';
    lines.push(`${lead}${title}${item.text || ''}${duration}`.trim());
    for (const child of item.children || []) {
      if (!child.text && !child.title) continue;
      const childTitle = child.title ? `*${child.title}:* ` : '';
      lines.push(`   - ${childTitle}${child.text || ''}`.trimEnd());
    }
  });
  return lines;
}

function renderBlocks(blocks) {
  const lines = [];
  for (const block of blocks) {
    if (block.kind === 'table') {
      lines.push(`| ${block.columns.join(' | ')} |`, `| ${block.columns.map(() => '---').join(' | ')} |`);
      for (const row of block.rows) lines.push(`| ${row.map(mdCell).join(' | ')} |`);
    } else if (block.kind === 'numbered') {
      lines.push(...renderPoints(block.items, true));
    } else {
      lines.push(...renderPoints([block], false));
    }
    lines.push('');
  }
  return lines;
}

function renderReport(heading, report) {
  const lines = [`# ${heading}`, ''];
  const basic = report.part_a_basic_details;
  lines.push('## PART-A: Tender Basic Details', '', '### 1. Table Format', '', '| Sl. No. | Parameter | Tender Details |', '| --- | --- | --- |');
  for (const row of basic.basic_details_table) lines.push(`| ${row.sl} | ${mdCell(row.parameter)} | ${mdCell(row.details)} |`);
  lines.push('', '### 2. Detailed Text Format', '');
  for (const item of basic.basic_details_text) lines.push(`- **${item.title}:** ${item.text}`, '');
  lines.push('## PART-B: Detailed Scope of Work', '');
  for (const section of report.part_b_scope_of_work.sections) {
    lines.push(`### ${section.title}`, '', ...renderBlocks(section.blocks));
  }
  lines.push('## PART-C: Complete Required Documents Checklist', '');
  for (const group of report.part_c_documents.groups) {
    lines.push(`### ${group.title}`, '', ...renderPoints(group.items, group.numbered), '');
  }
  lines.push('## PART-D: Complete Terms & Conditions, Payment Rules & Penalty Table', '');
  for (const section of report.part_d_terms_payment_penalties.sections) {
    lines.push(`### ${section.title}`, '');
    if (section.items) lines.push(...renderPoints(section.items, false), '');
    if (section.table) {
      lines.push(`| ${section.table.columns.join(' | ')} |`, `| ${section.table.columns.map(() => '---').join(' | ')} |`);
      for (const row of section.table.rows) lines.push(`| ${row.map(mdCell).join(' | ')} |`);
      lines.push('');
    }
    if (section.sla_penalties?.length) {
      lines.push('**GeM category SLA penalties:**', '');
      section.sla_penalties.forEach((line, index) => lines.push(`${index + 1}. ${line}`));
      lines.push('');
    }
  }
  return lines.join('\n');
}

function renderMarkdown(bundle) {
  return `${renderReport('SCRIPT 1 (Full Telugu Report)', bundle.report_te)}\n\n${renderReport('SCRIPT 2 (Full Simple English Report)', bundle.report_en)}\n`;
}

function collectStrings(value, bag) {
  if (typeof value === 'string') bag.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, bag));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, bag));
}

function applyStrings(value, translated) {
  if (typeof value === 'string') return translated.get(value) || value;
  if (Array.isArray(value)) return value.map((item) => applyStrings(item, translated));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, applyStrings(item, translated)]));
  }
  return value;
}

async function translateReport(report) {
  const strings = [];
  collectStrings(report, strings);
  const unique = [...new Set(strings)];
  const translated = new Map();
  console.log(`Translating ${unique.length} Telugu string(s)`);
  for (const text of unique) {
    const cached = translationCache.has(text);
    let value = '';
    try {
      value = await translateOne(text);
    } catch (err) {
      value = '';
    }
    translated.set(text, value || text);
    if (!cached) await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return applyStrings(report, translated);
}

async function linksFromPdf(buffer, pages, cover) {
  const links = [];
  const seen = new Set();
  const push = (url, page, context) => {
    const clean = String(url || '').replace(/[.,;:]+$/g, '');
    if (!/^https?:\/\//i.test(clean) || seen.has(clean)) return;
    seen.add(clean);
    links.push({ url: clean, page, context: context || '' });
  };
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const annotations = await page.getAnnotations();
      const context = toEnglish(pages[pageNumber - 1]?.text || '').slice(0, 500);
      for (const annotation of annotations) {
        if (annotation.subtype !== 'Link') continue;
        push(annotation.url || annotation.unsafeUrl || '', pageNumber, context);
      }
    }
  } catch (err) {
    console.log(`  link annotations skipped: ${err.message}`);
  }
  pages.forEach((page) => {
    const context = toEnglish(page.text).slice(0, 500);
    for (const raw of String(page.text || '').match(URL_RE) || []) push(raw, page.page, context);
  });
  for (const raw of String(cover || '').match(URL_RE) || []) push(raw, 1, '');
  return links;
}

function rulesFromCover(cover, file, links) {
  const pages = [{ page: 1, text: cover }];
  return {
    file,
    emd: emdFrom(pages),
    mse_relaxation: mseFrom(pages),
    documents: documentsFrom({ pages, links, named_pdfs: [] }),
  };
}

async function composeReport(cover, rules, outputDir) {
  const downloadDir = path.join(outputDir, 'downloads', String(rules.file || 'bid').replace(/\.pdf$/i, ''));
  fs.mkdirSync(downloadDir, { recursive: true });

  const docs = rules.documents || {};
  const targets = [
    ...(docs.scope_of_work || []),
    ...(docs.atc || []),
    ...(docs.payment_terms || []),
    ...(docs.sla || []),
  ].filter((row) => row?.url);

  const secondary = [];
  for (const target of targets) {
    console.log(`Downloading ${target.label}: ${target.url}`);
    try {
      const doc = await downloadDocument(target.url);
      const safeBase = (target.label || 'document').replace(/[^\w.-]+/g, '_').slice(0, 40);
      let text = '';
      if (doc.kind === 'pdf') {
        fs.writeFileSync(path.join(downloadDir, `${safeBase}.pdf`), doc.bytes);
        text = await pdfText(doc.bytes);
        console.log(`  PDF ${doc.bytes.length} bytes, ${text.length} characters`);
      } else {
        fs.writeFileSync(path.join(downloadDir, `${safeBase}.txt`), doc.text);
        text = doc.text;
        console.log(`  HTML page, ${text.length} characters`);
      }
      secondary.push({ ...target, text });
    } catch (err) {
      console.log(`  skipped: ${err.message}`);
      secondary.push({ ...target, text: '', error: err.message });
    }
  }

  const byRole = (role) => secondary.filter((doc) => (docs[role] || []).some((row) => row.url === doc.url));
  const usable = (rows) => rows.map((doc) => doc.text).filter((text) => text && !isStub(text));
  const scopeDocs = usable(byRole('scope_of_work'));
  const atcDocs = usable(byRole('atc'));
  const paymentDocs = usable(byRole('payment_terms'));
  const slaDocs = usable(byRole('sla'));

  const atc = tidyClause(atcDocs.join('\n'));
  const sow = tidyClause(scopeDocs.join('\n'));
  const paymentText = tidyClause(paymentDocs.join('\n'));
  const slaText = tidyClause(slaDocs.join('\n'));
  const skipped = secondary.filter((doc) => doc.error).map((doc) => doc.label);
  const reportEn = buildFourPartReport({
    cover,
    atc,
    sow,
    paymentText,
    rules,
    coverScopePoints: coverScope(cover).points,
    coverTerms: coverAtc(cover).points,
    paymentLines: paymentPoints(cover, paymentDocs.length ? paymentDocs : slaDocs).points,
    slaPenalties: penaltyPoints(slaDocs).points,
  });
  assertNoLeak(rules.file, { report_en: reportEn }, [cover, atc, sow, paymentText, slaText].join('\n'));
  const onlineCount = reportEn.part_c_documents.groups?.[1]?.items?.length || 0;
  const penaltyCount = reportEn.part_d_terms_payment_penalties.sections?.find((section) => section.table)?.table.rows.length || 0;
  console.log(`English report: ${reportEn.part_b_scope_of_work.sections.length} scope sections, ${onlineCount} online documents, ${penaltyCount} penalty rows`);
  const reportTe = await translateReport(reportEn);
  return {
    core_details: {
      file: rules.file,
      emd: rules.emd,
      mse_relaxation: rules.mse_relaxation,
      downloads_skipped: skipped,
    },
    report_en: reportEn,
    report_te: reportTe,
  };
}

async function buildReport(rules, rulesDir, outputDir) {
  const fixturePath = path.join(path.dirname(rulesDir), rules.fixture);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const cover = toEnglish(fixture.pages.map((page) => page.text).join('\n'));
  return composeReport(cover, rules, outputDir);
}

async function analyzePdfFile(pdfPath, bidNo, outputDir) {
  const buffer = fs.readFileSync(pdfPath);
  const extracted = await extractText(new Uint8Array(buffer), { mergePages: false });
  const pageList = Array.isArray(extracted.text) ? extracted.text : [extracted.text];
  const pages = pageList.map((text, index) => ({ page: index + 1, text: String(text || '') }));
  const joined = toEnglish(pages.map((page) => page.text).join('\n'));
  const cover = squash(joined).length >= 40 ? joined : await pdfText(buffer);
  const links = await linksFromPdf(buffer, pages, cover);
  const file = String(bidNo || path.basename(pdfPath, '.pdf')).replace(/[^\w.-]+/g, '_').slice(0, 80) || 'bid';
  const rules = rulesFromCover(cover, file, links);
  return composeReport(cover, rules, outputDir);
}

async function main() {
  loadLocalEnv();
  const opts = parseArgs(process.argv);
  const outputDir = path.resolve(opts.output);
  fs.mkdirSync(outputDir, { recursive: true });
  const cachePath = loadTranslationCache(outputDir);
  if (opts.pdf) {
    const report = await analyzePdfFile(opts.pdf, opts.bid, outputDir);
    const outPath = path.resolve(opts.jsonOut || path.join(outputDir, 'live-bid-report.json'));
    fs.writeFileSync(outPath, `${JSON.stringify({ ...report, markdown: renderMarkdown(report) }, null, 2)}\n`);
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

const NONE = 'Not stated in this tender';

export const LEAK_MARKERS = [
  '510101004485660',
  'UBIN0533114',
  'sheela@bsnl.co.in',
  'ashwathnarayana.km@bsnl.co.in',
  '29AABCB5576GRZR',
  'mmclaimsofficektk1@gmail.com',
  'Halasuru',
  'Harpic',
  '9448458586',
];

function squash(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function tidy(text) {
  return squash(text)
    .replace(/(\d)\.:(\d)/g, '$1:$2')
    .replace(/([A-Za-z])(\d{1,2}\s+of\s+\d{1,2})/g, '$1 $2')
    .replace(/\s*\d{1,2}\s+of\s+\d{1,2}(?=\d)/g, ' ')
    .replace(/\s+\d{1,2}\s+of\s+\d{1,2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripNumber(text) {
  return tidy(text).replace(/^\d+(?:\.\d+)*\.?\s*/, '').replace(/^[A-B]\.\s*/, '');
}

function point(title, text, children = []) {
  return { title: squash(title), text: squash(text), children };
}

function rupee(value) {
  const amount = Number(String(value || '').replace(/[^\d.]/g, ''));
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return `Rs. ${amount.toLocaleString('en-IN')}`;
}

function labeled(cover, pattern) {
  const match = String(cover || '').match(pattern);
  return match ? squash(match[1]).replace(/%+/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

function splitNumbered(text) {
  return tidy(text)
    .split(/(?=\s\d+(?:\.\d+)+\.?\s+[A-Z0-9]|\s\d+\.\s+[A-Z0-9])/)
    .map(tidy)
    .filter((part) => part.length >= 12 && !/^\d*\s*Section[-\s]/i.test(part) && !/\bDeleted\b/.test(part));
}

function between(text, startRe, endRe, max = 6000) {
  const source = String(text || '');
  const start = source.search(startRe);
  if (start < 0) return '';
  const rest = source.slice(start, start + max);
  const end = rest.slice(40).search(endRe);
  return end < 0 ? rest : rest.slice(0, 40 + end);
}

function indexes(text, pattern) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const copy = new RegExp(pattern.source, flags);
  const hits = [];
  let match = copy.exec(text);
  while (match) {
    hits.push(match.index);
    if (match.index === copy.lastIndex) copy.lastIndex += 1;
    match = copy.exec(text);
  }
  return hits;
}

function firstWords(text, count = 10) {
  return stripNumber(text).split(/\s+/).slice(0, count).join(' ').replace(/[.,;:]+$/, '');
}

function prettyQuantity(value) {
  const match = String(value || '').match(/(\d+)\s*(day|week|month|sq)/i);
  if (!match) return squash(value);
  if (/sq/i.test(match[2])) return `${match[1]} sq.m`;
  const unit = /day/i.test(match[2]) ? 'Days' : /week/i.test(match[2]) ? 'Weeks' : 'Months';
  return `${match[1]} ${unit}`;
}

export function assertNoLeak(file, report, sourceText) {
  if (/9764651/.test(String(file || ''))) return;
  const blob = JSON.stringify(report?.report_en || {});
  const source = String(sourceText || '');
  const leaked = LEAK_MARKERS.filter((marker) => blob.includes(marker) && !source.includes(marker));
  if (leaked.length) throw new Error(`BSNL string leaked into ${file}: ${leaked.join(', ')}`);
}

function basicDetails(cover, extra, rules) {
  const bidNo = labeled(cover, /Bid Number:\s*(GEM\/\d{4}\/B\/\d{7})/i);
  const bidDate = labeled(cover, /Dated:\s*(\d{2}-\d{2}-\d{4})/i);
  const endAt = labeled(cover, /Bid End Date\/Time\s+(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2})/i);
  const openAt = labeled(cover, /Bid Opening\s+Date\/Time\s+(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2})/i);
  const ministry = labeled(cover, /Ministry\/State Name\s+(.+?)\s+\/Department Name/i);
  const department = labeled(cover, /Department Name\s+(.+?)\s+\/Organisation Name/i);
  const organisation = labeled(cover, /Organisation Name\s+(.+?)\s+(?:%|\/Office Name)/i);
  const office = labeled(cover, /Office Name\s+(.+?)\s+(?:%|\/)/i);
  const category = labeled(cover, /Item Category\s+(.+?)\s+\/(?:Similar Category|Contract Period)/i);
  const estimated = labeled(cover, /Estimated Bid Value[\s\S]{0,90}?(\d[\d,]+\.\d+|\d[\d,]+)/i);
  const validity = labeled(cover, /Validity \(From End Date\)\s+(\d+\s*\(Days\))/i);
  const bank = labeled(cover, /Advisory Bank\s+([A-Za-z ]+?)\s+\/?\s*EMD Amount/i);
  const emdRequired = rules?.emd?.required === true;
  const emdAmount = emdRequired ? (rules?.emd?.amount || labeled(cover, /EMD Amount\s+(\d+)/i)) : '';
  const epbgPct = labeled(cover, /ePBG Percentage\(\%\)\s+([\d.]+)/i);
  const epbgMonths = labeled(cover, /Duration of ePBG[\s\S]{0,50}?(\d+)/i);
  const turnover = labeled(cover, /Minimum Average Annual Turnover[\s\S]{0,80}?(\d+\s+Lakh\s*\(s\))/i);
  const experience = labeled(cover, /Years of Past Experience Required[\s\S]{0,40}?(\d+\s+Year\s*\(s\))/i);
  const mseYes = rules?.mse_relaxation?.granted === true || /MSE Relaxation[\s\S]{0,80}Yes/i.test(cover);
  const startupYes = /Startup Relaxation[\s\S]{0,80}Yes/i.test(cover);
  const raEnabled = labeled(cover, /Bid to RA enabled\s+(Yes|No)/i);
  const raRule = labeled(cover, /RA Qualification Rule\s+(.+?)\s+(?:\/|D\s+D)/i);
  const hod = labeled(cover, /HOD Email id\s*:?\s*([^\s]+@[^\s]+)/i);
  const buyer = labeled(cover, /Buyer Email id\s*:?\s*([^\s]+@[^\s]+)/i);
  const phones = [...String(extra || '').matchAll(/(?:Telephone|Mobile|Phone)\s*(?:No\.?)?\s*:?\s*(\d[\d\s/-]{7,}\d)/gi)].map((match) => squash(match[1]));
  const emails = [...String(extra || '').matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)]
    .map((match) => match[0])
    .filter((email) => email !== hod && email !== buyer);
  const extension = String(extra || '').match(/extend(?:ed|able)[\s\S]{0,220}?(?:month|year)/i);
  const msePbg = String(extra || '').match(/including MSEs[\s\S]{0,160}?performance security[\s\S]{0,60}/i);
  const contractBase = labeled(cover, /Contract Period\s+(\d+\s+Year\(s\)|\d+\s+Month\(s\))/i);
  const contract = [contractBase, extension ? tidy(extension[0]) : ''].filter(Boolean).join('. ');
  const emdText = emdRequired
    ? [rupee(emdAmount) || 'Amount stated as required', bank ? `Advisory bank: ${bank}` : ''].filter(Boolean).join('. ')
    : 'Not required on the GeM cover';
  const epbgText = [epbgPct ? `${epbgPct}%` : '', epbgMonths ? `for ${epbgMonths} months` : '', msePbg ? tidy(msePbg[0]) : ''].filter(Boolean).join('. ');
  const orgText = [ministry, department, organisation, office && `Office: ${office}`].filter(Boolean).join('; ');
  const rows = [
    ['1', 'Bid Number & Date', [bidNo, bidDate && `dated ${bidDate}`].filter(Boolean).join(' ')],
    ['2', 'Last Date & Time to Submit', endAt],
    ['3', 'Bid Opening Date & Time', openAt],
    ['4', 'Ministry / Organisation', orgText],
    ['5', 'Service Category', category],
    ['6', 'Estimated Bid Value', estimated ? (rupee(estimated) || estimated) : ''],
    ['7', 'Contract Period (with extension rule)', contract],
    ['8', 'Bid Offer Validity', validity],
    ['9', 'EMD (Bid Security) & Bank', emdText],
    ['10', 'ePBG (Performance Security) & MSE rule', epbgText],
    ['11', 'Minimum Average Annual Turnover', turnover],
    ['12', 'Past Experience Required', experience],
    ['13', 'MSME (MSE) Relaxation', mseYes ? 'Yes | Complete, for the experience and turnover relaxation stated on the GeM cover' : 'No, or not stated'],
    ['14', 'DPIIT Startup Relaxation', startupYes ? 'Yes | Complete, for the experience and turnover relaxation stated on the GeM cover' : 'No, or not stated'],
    ['15', 'Reverse Auction (RA) rule', [raEnabled, raRule].filter(Boolean).join('. ')],
  ];
  const contactBits = [
    hod && `HOD: ${hod}`,
    buyer && `Buyer: ${buyer}`,
    phones.length ? `Phone: ${[...new Set(phones)].slice(0, 4).join(', ')}` : '',
    emails.length ? `Other email: ${[...new Set(emails)].slice(0, 4).join(', ')}` : '',
  ].filter(Boolean);
  return {
    basic_details_table: rows.map(([sl, parameter, details]) => ({ sl, parameter, details: details || NONE })),
    basic_details_text: [
      point('Bid identification and deadlines', [bidNo && `Bid ${bidNo}`, bidDate && `dated ${bidDate}`, orgText, category && `Category: ${category}`, endAt && `Submit by ${endAt}`, openAt && `Opens ${openAt}`, validity && `Offer validity ${validity}`].filter(Boolean).join('. ') || NONE),
      point('Estimated value and security deposits', [estimated && `Estimated value ${rupee(estimated) || estimated}`, contract && `Contract: ${contract}`, `EMD: ${emdText}`, epbgText && `Performance security: ${epbgText}`].filter(Boolean).join('. ') || NONE),
      point('MSME and startup exemptions', `MSE relaxation: ${mseYes ? 'Yes | Complete' : 'No, or not stated'}. Startup relaxation: ${startupYes ? 'Yes | Complete' : 'No, or not stated'}. ${experience ? `Past experience on the cover: ${experience}.` : ''} ${turnover ? `Turnover on the cover: ${turnover}.` : ''}`),
      point('Contact details for clarifications', contactBits.join('. ') || NONE),
    ],
  };
}

function groupClauses(clauses) {
  const groups = [];
  let current = { title: 'Scope of work', items: [] };
  for (const clause of clauses) {
    const bare = stripNumber(clause);
    const number = clause.match(/^(\d+(?:\.\d+)*)/)?.[1] || '';
    const isHeading = number.split('.').length <= 1 && bare.length < 90 && bare.split(/\s+/).length <= 14 && !/\d{3,}/.test(bare);
    if (isHeading) {
      if (current.items.length) groups.push(current);
      current = { title: bare.replace(/:\s*$/, ''), items: [] };
      continue;
    }
    current.items.push(point(number || firstWords(bare, 6), bare));
  }
  if (current.items.length) groups.push(current);
  return groups.filter((group) => group.items.length);
}

function scopeSlice(text) {
  const numbered = indexes(text, /1\.\s+Scope\b/i);
  const named = indexes(text, /Scope of Work/i);
  const start = numbered.length ? numbered[numbered.length - 1] : (named.length ? named[named.length - 1] : -1);
  if (start < 0) return '';
  const rest = text.slice(start);
  const sorHits = indexes(rest, /Schedule of Requirements|Description of Item/i);
  const sor = sorHits.find((index) => index > 80) ?? -1;
  return rest.slice(0, sor > 80 ? sor : Math.min(rest.length, 14000));
}

function extractSchedule(text) {
  const hits = indexes(text, /\d{1,2}:\d{2}\s*(?:AM|PM)/i);
  if (hits.length < 3) return [];
  let best = hits[0];
  let bestCount = 0;
  for (const hit of hits) {
    const count = hits.filter((other) => other >= hit && other < hit + 900).length;
    if (count > bestCount) {
      best = hit;
      bestCount = count;
    }
  }
  if (bestCount < 3) return [];
  const window = text.slice(Math.max(0, best - 40), best + 1600);
  const rows = [];
  const re = /(\d{1,2}:\d{2}\s*(?:AM|PM)?)(?:\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?))?\s+(.{6,120}?)(?=\s+\d{1,2}:\d{2}\s*(?:AM|PM)|$)/gi;
  let slot = re.exec(window);
  while (slot) {
    const activity = tidy(slot[3]);
    if (/[A-Za-z]{3,}/.test(activity)) rows.push([slot[2] ? `${squash(slot[1])} to ${squash(slot[2])}` : squash(slot[1]), activity]);
    slot = re.exec(window);
  }
  return rows.length >= 3 ? rows : [];
}

function extractSor(text) {
  const hits = indexes(text, /Schedule of Requirements|Description of Item|Bill of Quantit/i);
  if (!hits.length) return [];
  const start = hits[hits.length - 1];
  const body = text.slice(start, start + 9000);
  const end = body.search(/General Instructions to Bidders|1\.\s+Definitions/i);
  const slice = tidy(end > 200 ? body.slice(0, end) : body);
  return slice
    .split(/(?=(?:^|\s)(?:[1-9]|[12]\d)\s+[A-Z])/)
    .map(tidy)
    .filter((item) => /^(?:[1-9]|[12]\d)\s+[A-Z]/.test(item) && item.length > 40 && /\d+\s*(?:days|weeks|months|sq\.?\s*m|sqm)/i.test(item))
    .map((item) => {
      const bodyText = item.replace(/^(?:[1-9]|[12]\d)\s+/, '').replace(/\s+\d{1,2}\s*$/, '');
      const qty = bodyText.match(/(\d+\s*(?:Days|weeks|Months|days))\s*$/i);
      const description = tidy(qty ? bodyText.slice(0, qty.index) : bodyText);
      return { ...point(firstWords(description, 12), description), quantity: qty ? prettyQuantity(qty[1]) : '' };
    })
    .filter((row) => row.text.length > 30)
    .slice(0, 40);
}

function uniqueLines(lines) {
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const key = line.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

export function scanFindings(text) {
  let body = String(text || '').replace(/[ \t]+/g, ' ');
  body = body.replace(/\s+(?=(?:List of High end machinery|Machinery required|Local Presence|Site Visit)\b)/gi, '\n');
  body = body.replace(/(\d+\.\d+\s+)/g, '\n$1');
  const lines = body.split(/\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter((line) => line.length > 8);
  const scope = [];
  const eligibility = [];
  const machinery = [];
  const payment = [];
  for (const line of lines) {
    const machineAt = line.search(/list of high end machinery|machinery required/i);
    if (machineAt >= 0) {
      const tail = line.slice(machineAt).trim();
      if (tail.length > 20) machinery.push(tail);
    }
    if (/^\d+\.\d+\s+/.test(line) && /water|prun|mulch|grass|plant|sweep|compost|hedge|garden|sapling|manure|arboricult/i.test(line)) scope.push(line);
    if (/local presence|site visit|visakhapatnam based|only visakhapatnam/i.test(line) && line.length < 1200) eligibility.push(line);
    if (/electronic payment|fall clause|\bIFSC\b|45\s*days/i.test(line) && line.length < 700) payment.push(line);
  }
  return {
    scope: uniqueLines(scope).slice(0, 30),
    eligibility: uniqueLines(eligibility).slice(0, 8),
    machinery: uniqueLines(machinery).slice(0, 20),
    payment: uniqueLines(payment).slice(0, 12),
  };
}

function scopeReport({ atc, sow, coverScopePoints }) {
  const sections = [];
  const buyer = tidy(atc || '');
  const uploaded = tidy(sow || '');
  const primary = buyer.length > 400 ? buyer : uploaded;
  const findings = scanFindings([buyer, uploaded].filter(Boolean).join('\n'));
  const groups = groupClauses(splitNumbered(scopeSlice(primary)));
  for (const group of groups) sections.push({ title: group.title, blocks: group.items });
  if (!groups.length && uploaded && uploaded !== primary) {
    for (const group of groupClauses(splitNumbered(scopeSlice(uploaded) || uploaded.slice(0, 8000)))) {
      sections.push({ title: group.title, blocks: group.items });
    }
  }
  const schedule = extractSchedule(primary);
  if (schedule.length) {
    const weekly = primary.match(/Weekly [\w ]{0,30}(?:shall|to be|will be)[\s\S]{0,140}?\./i);
    sections.push({
      title: 'Timetable',
      blocks: [
        { kind: 'table', columns: ['Time', 'Activity'], rows: schedule },
        ...(weekly ? [point('Schedule note', tidy(weekly[0]))] : []),
      ],
    });
  }
  const sor = extractSor(primary);
  if (sor.length) sections.push({ title: 'Schedule of requirements', blocks: [{ kind: 'numbered', items: sor }] });
  if (findings.scope.length) {
    sections.push({ title: 'Scope of work', blocks: findings.scope.map((line, index) => point(String(index + 1), line)) });
  }
  if (findings.machinery.length) {
    sections.push({ title: 'Machinery required', blocks: [{ kind: 'numbered', items: findings.machinery.map((line, index) => point(String(index + 1), line)) }] });
  }
  if (coverScopePoints?.length) {
    sections.push({
      title: 'Service lines on the GeM cover',
      blocks: coverScopePoints.map((line, index) => point(String(index + 1), line)),
    });
  }
  if (!sections.length) sections.push({ title: 'Scope of work', blocks: [point('Scope of work', NONE)] });
  return { sections };
}

function coverDocuments(cover) {
  const match = String(cover || '').match(/Document required\s+from seller\s+(.+?)(?=\*In case|Do you want to show)/i);
  if (!match) return [];
  return match[1].split(',').map((item) => squash(item)).filter((item) => item.length > 2)
    .map((item) => point(item, `The GeM cover requires the seller to upload this document: ${item}.`));
}

function docTitle(clause, bucket = '') {
  if (/local presence/i.test(clause)) return 'Local presence';
  if (/site visit/i.test(clause)) return 'Site visit';
  if (bucket === 'offline') return 'Offline EMD submission';
  if (bucket === 'post') {
    const annex = clause.match(/Annexure\s*-?\s*[0-9]+/i);
    if (/labour licen/i.test(clause)) return 'Labour licence';
    if (/indemnity/i.test(clause)) return annex ? `Indemnity (${annex[0]})` : 'Indemnity';
    if (/performance security|\bPBG\b|\bePBG\b/i.test(clause)) return 'Performance security';
    if (/insurance|accident/i.test(clause)) return 'Insurance cover';
  }
  const annex = clause.match(/Annexure\s*-?\s*[0-9A-Z]+(?:\s*[-/]\s*[A-Z0-9]+)?/i);
  const named = clause.match(/\b(Power of Attorney|Completion Certificate|Experience|Turnover|Udyam|Udhyam|MSME|URN|PAN|GSTIN|GST|Affidavit|Indemnity|Performance Security|Labour Licen[cs]e|Near-Relationship|Land Border|Black[- ]?list\w*|Declaration|Undertaking|NEFT)\b/i);
  if (named && annex) return `${named[1]} (${annex[0]})`;
  if (named) return named[1];
  if (annex) return annex[0];
  return firstWords(clause, 8) || 'Required document';
}

function clusterDocuments(clauses, bucket = '') {
  const map = new Map();
  for (const clause of clauses) {
    const title = docTitle(clause, bucket);
    const text = stripNumber(clause);
    if (text.length < 20) continue;
    if (!map.has(title)) map.set(title, []);
    map.get(title).push(text);
  }
  return [...map.entries()].map(([title, texts]) => point(title, texts[0], texts.slice(1).map((text) => point('', text))));
}

function isPaymentClause(clause) {
  return /paying authority|\binvoice\b|gstr|debit note|payment will be made|no advance payment|tax invoice/i.test(clause);
}

function operativeText(text) {
  const hits = indexes(String(text || ''), /SECTION-6|Section-6 Annexure/i);
  const start = hits.length ? hits[hits.length - 1] : -1;
  return start > 2000 ? text.slice(0, start) : String(text || '');
}

function documentReport(cover, atc) {
  const clauses = splitNumbered(operativeText(atc)).filter((clause) => !isPaymentClause(clause));
  const offline = [];
  const online = [];
  const postAward = [];
  for (const clause of clauses) {
    const head = clause.slice(0, 220);
    if (/drop box|sealed envelope containing|physical submission/i.test(head)) offline.push(clause);
    else if (/furnish performance security|after placing contract|documents to be provided from successful bidder|labour licen|indemnity bond|deed of indemnity|within \d+ days (?:of|from).{0,40}(?:APO|advance purchase|issuing APO)/i.test(clause)) postAward.push(clause);
    else if (/certificate|undertaking|affidavit|annexure|power of attorney|\bPAN\b|GST|turnover|experience|declaration|licen[cs]e|letterhead|udyam|udhyam|\bMSME\b|black[- ]?list|stamp paper/i.test(head)) online.push(clause);
  }
  const findings = scanFindings(atc);
  for (const line of findings.eligibility) {
    const title = /site visit/i.test(line) ? 'Site visit' : 'Local presence';
    online.push(`${title}. ${line}`);
  }
  const coverItems = coverDocuments(cover).filter((item) => {
    const key = item.title.toLowerCase().split(/\s+/)[0];
    return key.length <= 4 || !online.some((clause) => clause.toLowerCase().includes(key));
  });
  const onlineItems = [...coverItems, ...clusterDocuments(online)];
  return {
    groups: [
      {
        title: '1. Documents to submit offline (before bid closing)',
        numbered: false,
        items: offline.length ? clusterDocuments(offline, 'offline') : [point('Offline submission', 'None required (Online submission only)')],
      },
      {
        title: '2. Documents to upload online',
        numbered: true,
        items: onlineItems.length ? onlineItems : [point('Online documents', NONE)],
      },
      {
        title: '3. Post-award documents',
        numbered: false,
        items: postAward.length ? clusterDocuments(postAward, 'post') : [point('Post-award documents', 'None stated in this tender')],
      },
    ],
  };
}

function termTitle(text) {
  const option = text.match(/option clause\s*(\d+)\s*%/i);
  if (option || /option clause/i.test(text)) return option ? `Option clause (${option[1]}%)` : 'Option clause';
  if (/sub-contract|subcontract/i.test(text)) return 'No sub-contracting';
  if (/short clos/i.test(text)) return 'Short closure';
  if (/fall clause/i.test(text)) return 'Fall clause';
  if (/banning of business|forfeiture of (?:its |the )?performance/i.test(text)) return 'Banning and forfeiture';
  if (/court jurisdiction|resolution of disputes|competent court at/i.test(text)) return 'Dispute resolution and jurisdiction';
  if (/confidential/i.test(text)) return 'Confidentiality';
  if (/toll[- ]?free|dedicated\s*\/?\s*toll/i.test(text)) return 'Service support number';
  if (/financial standing|not be under liquidation|bankrupt/i.test(text)) return 'Financial standing';
  if (/registered at/i.test(text)) return 'Place of registration';
  if (/local presence|site visit/i.test(text)) return 'Eligibility';
  return '';
}

function groupByTitle(lines, titleOf) {
  const map = new Map();
  for (const line of lines) {
    const title = titleOf(line);
    if (!title) continue;
    if (!map.has(title)) map.set(title, []);
    const text = squash(line);
    if (!map.get(title).some((existing) => existing.slice(0, 80) === text.slice(0, 80))) map.get(title).push(text);
  }
  return [...map.entries()].map(([title, texts]) => point(title, texts[0], texts.slice(1).map((text) => point('', text))));
}

function paymentTitle(text) {
  if (/within \d+ days|payment timeline|SDAC/i.test(text)) return 'Payment timeline';
  if (/GSTR/i.test(text)) return 'GST return condition';
  if (/EPF|ESI/i.test(text)) return 'EPF and ESI';
  if (/GSTIN|triplicate|invoice/i.test(text)) return 'Invoice requirements';
  if (/advance/i.test(text)) return 'Advance payment';
  if (/deduct|penalt/i.test(text)) return 'Deductions';
  if (/NEFT|RTGS|e-payment|electronic payment|\bIFSC\b/i.test(text)) return 'Mode of payment';
  if (/45\s*days/i.test(text)) return 'Payment timeline';
  return 'Payment condition';
}

function penaltyTable(text) {
  const hits = indexes(String(text || ''), /The following penalties shall be applicable/i);
  if (!hits.length) return [];
  const window = tidy(text.slice(hits[hits.length - 1], hits[hits.length - 1] + 1600));
  return [...window.matchAll(/(\d{1,2})\s+([A-Z][^0-9]{6,160}?)\s+((?:\d{1,3},)*\d+)\s+(per\s+[A-Za-z][A-Za-z /()-]{2,40}?)(?=\s+\d{1,2}\s+[A-Z]|\s+\d+\s+of\b|$)/g)]
    .map((row) => [row[1], tidy(row[2]), `Rs. ${row[3]} ${tidy(row[4])}`]);
}

function termsReport({ coverTerms, atc, sow, paymentText, paymentLines, slaPenalties }) {
  const corpus = [atc, sow, paymentText].filter(Boolean).join('\n');
  const findings = scanFindings(corpus);
  const body = operativeText(atc);
  const atcTerms = splitNumbered(body).filter((clause) => termTitle(clause));
  const payWindowHits = indexes(body, /Payment Terms and Conditions/i);
  const payStart = payWindowHits.length ? payWindowHits[payWindowHits.length - 1] : -1;
  const payWindow = payStart < 0 ? '' : body.slice(payStart, payStart + 8000);
  const payCut = payWindow.search(/1\.\s+Scope\b|Scope of Work/i);
  const payClauses = splitNumbered(payCut > 80 ? payWindow.slice(0, payCut) : payWindow);
  const terms = groupByTitle([...(coverTerms || []), ...atcTerms, ...findings.payment.filter((line) => /fall clause/i.test(line))], termTitle);
  const payment = groupByTitle([...(paymentLines || []), ...payClauses, ...findings.payment.filter((line) => !/fall clause/i.test(line))], paymentTitle);
  const rows = penaltyTable(atc);
  const sections = [
    { title: '1. Key terms and conditions', items: terms.length ? terms : [point('Additional terms', NONE)] },
    { title: '2. Payment terms and tax rules', items: payment.length ? payment : [point('Payment terms', NONE)] },
  ];
  if (rows.length) {
    sections.push({
      title: '3. Penalty table',
      table: { columns: ['Sl. No.', 'Deficiency / Default', 'Penalty Amount'], rows },
      sla_penalties: slaPenalties || [],
    });
  } else if (slaPenalties?.length) {
    sections.push({
      title: '3. Penalties',
      items: [point('Category agreement penalties', 'This tender text has no separate rupee penalty table. The lines below are the category agreement penalties.')],
      sla_penalties: slaPenalties,
    });
  } else {
    sections.push({ title: '3. Penalties', items: [point('Penalties', NONE)] });
  }
  return { sections };
}

export function buildFourPartReport(input) {
  const extra = [input.atc, input.sow, input.paymentText].filter(Boolean).join('\n');
  return {
    part_a_basic_details: basicDetails(input.cover, extra, input.rules),
    part_b_scope_of_work: scopeReport(input),
    part_c_documents: documentReport(input.cover, extra),
    part_d_terms_payment_penalties: termsReport(input),
  };
}

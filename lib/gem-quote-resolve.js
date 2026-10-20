import OpenAI from 'openai';

function squash(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function sentences(text) {
  return squash(text)
    .split(/(?<!Rs)\.\s+|(?<=;)\s+/)
    .map((part) => squash(part))
    .filter((part) => part.length > 20);
}

/** Copy the quote from the source. A string the model invented does not come back. */
export function exactQuote(source, quote) {
  const flatSource = squash(source);
  const flatQuote = squash(quote);
  if (flatQuote.length < 12) return '';
  const at = flatSource.toLowerCase().indexOf(flatQuote.toLowerCase());
  if (at < 0) return '';
  return flatSource.slice(at, at + flatQuote.length);
}

function sentenceAround(text, index) {
  const flat = squash(text);
  const start = Math.max(0, flat.lastIndexOf('.', index) + 1, flat.lastIndexOf(';', index) + 1);
  const endDot = flat.indexOf('.', index);
  const end = endDot < 0 ? Math.min(flat.length, index + 280) : endDot + 1;
  return squash(flat.slice(start, end));
}

export function transportScopePoints(text) {
  const flat = squash(text);
  if (!flat) return [];
  const points = [];
  const seen = new Set();
  const push = (title, quote) => {
    const textValue = exactQuote(flat, quote) || (flat.toLowerCase().includes(squash(quote).toLowerCase()) ? squash(quote) : '');
    const kept = textValue || squash(quote);
    if (!kept || kept.length < 8 || seen.has(kept.toLowerCase())) return;
    if (!flat.toLowerCase().includes(kept.toLowerCase())) return;
    if (/as per bid/i.test(kept) && !/\bfrom\b|loading and unloading/i.test(kept)) return;
    seen.add(kept.toLowerCase());
    points.push({ title, text: kept });
  };
  const material = flat.match(/\b(gypsum|coal|cement|steel|fly ash|clinker|iron ore|limestone)\b/i);
  if (material) push('Material', sentenceAround(flat, material.index));
  const route = flat.match(/\bfrom\s+(?:the\s+)?(?:loading point at\s+)?([A-Za-z][A-Za-z .'-]{2,40}?)\s+to\s+(?:the\s+)?(?:unloading point at\s+)?([A-Za-z][A-Za-z .'-]{2,40})/i);
  if (route) push('Route', sentenceAround(flat, route.index));
  const qty = flat.match(/\b\d[\d,]*(?:\.\d+)?\s*(?:MT|metric tonnes?|tonnes?)\b/i);
  if (qty) push('Quantity', sentenceAround(flat, qty.index));
  const vehicle = flat.match(/\b\d+\s*MT\s+(?:tipper|truck|trailer|tanker|lorry)\b|\b(?:tipper|truck|trailer|tanker)\b/i);
  if (vehicle) push('Vehicle', sentenceAround(flat, vehicle.index));
  const loading = flat.match(/loading and unloading[^.]*\./i);
  if (loading) push('Loading and unloading', squash(loading[0]));
  return points;
}

const GENERIC_CERTIFICATE = /sought in the bid document|liable to be rejected if they don't upload any of the certificates|upload any of the certificates \/ documents sought/i;
const CONCRETE_DOCUMENT = /fitness certificate|pollution under control|\bpuc\b|rto permit|national permit|goods carriage permit|insurance|registration certificate|experience certificate|driving licen[cs]e|weighbridge|form 23|form 24/i;

function slotWindow(text, item) {
  const flat = squash(text);
  const number = String(item || '').match(/additional doc(?:ument)?\s*(\d+)/i);
  if (number) {
    const re = new RegExp(`Additional\\s+Doc(?:ument)?\\s*${number[1]}\\b[\\s\\S]{0,600}`, 'i');
    const match = flat.match(re);
    if (match) return match[0];
  }
  if (/certificate/i.test(item)) {
    const match = flat.match(/Certificate \(Requested in ATC\)[\s\S]{0,500}/i)
      || flat.match(/following certificates?[\s\S]{0,500}/i);
    if (match) return match[0];
  }
  return flat;
}

export function documentClause(item, atc, cover) {
  const source = squash(`${atc || ''}\n${cover || ''}`);
  if (!/certificate|additional doc/i.test(item || '')) return '';
  if (!squash(atc) && !CONCRETE_DOCUMENT.test(cover || '')) {
    return `${item}: the ATC file was not read, so the document name is not known yet.`;
  }
  const window = slotWindow(source, item);
  const concrete = sentences(window).find((line) => CONCRETE_DOCUMENT.test(line) && !GENERIC_CERTIFICATE.test(line));
  if (concrete) return exactQuote(source, concrete) || concrete;
  const named = window.match(CONCRETE_DOCUMENT);
  if (named) {
    const around = sentenceAround(window, named.index);
    if (around && !GENERIC_CERTIFICATE.test(around)) return exactQuote(source, around) || around;
  }
  const specific = sentences(window).find((line) => !GENERIC_CERTIFICATE.test(line) && /upload|submit|enclose|furnish/i.test(line));
  if (specific && /additional doc|certificate/i.test(window)) return exactQuote(source, specific) || specific;
  return '';
}

export function transportPenaltyPoints(text) {
  const flat = squash(text);
  return sentences(flat).filter((line) => {
    if (!/late delivery|liquidated damages|detention|demurrage|short supply|short delivery/i.test(line)) return false;
    if (!/%|rs\.?|per\s+(?:day|hour|week|mt|ton)/i.test(line)) return false;
    return Boolean(exactQuote(flat, line) || flat.toLowerCase().includes(line.toLowerCase()));
  }).map((line) => exactQuote(flat, line) || line);
}

export function reportBlob(report) {
  const bag = [];
  const walk = (value) => {
    if (typeof value === 'string') bag.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  walk(report);
  return bag.join('\n');
}

export function quoteGaps(report) {
  const scopeBlob = reportBlob(report?.part_b_scope_of_work);
  const docBlob = reportBlob(report?.part_c_documents);
  const penaltySection = (report?.part_d_terms_payment_penalties?.sections || []).find((section) => /penalt/i.test(section.title || ''));
  const penaltyBlob = reportBlob(penaltySection || {});
  return {
    scope: !/\bfrom\b[\s\S]{0,80}\bto\b|loading and unloading|\d[\d,]*\s*MT/i.test(scopeBlob),
    documents: /the ATC file was not read|was not given a document name|GeM cover requires the seller/i.test(docBlob),
    penalties: /Not stated in this tender|SLA file was not read/i.test(penaltyBlob),
  };
}

function sourceBlob({ cover, sow, atc, sla }) {
  return [cover, sow, atc, sla].filter(Boolean).join('\n');
}

export async function quoteOnlyPass(sources) {
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  if (!key) return null;
  const source = sourceBlob(sources).slice(0, 24000);
  if (squash(source).length < 40) return null;
  const client = new OpenAI({ apiKey: key, timeout: 20000 });
  const completion = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'Extract tender facts. Every quote must be copied exactly from the source text. Do not paraphrase, translate, or invent a route, certificate, or penalty. If a fact is absent, return an empty quote.',
      },
      {
        role: 'user',
        content: `${source}\n\nReturn JSON with this shape: {"material":{"quote":""},"route":{"quote":""},"quantity":{"quote":""},"vehicle":{"quote":""},"loading":{"quote":""},"documents":[{"slot":"","name":"","quote":""}],"penalties":[{"event":"","rate":"","quote":""}]}`,
      },
    ],
  });
  const raw = completion.choices?.[0]?.message?.content || '{}';
  let parsed = {};
  try { parsed = JSON.parse(raw); } catch { return null; }
  const keep = (quote) => exactQuote(source, quote);
  const scope = [];
  for (const [title, field] of [
    ['Material', parsed.material],
    ['Route', parsed.route],
    ['Quantity', parsed.quantity],
    ['Vehicle', parsed.vehicle],
    ['Loading and unloading', parsed.loading],
  ]) {
    const quote = keep(field?.quote);
    if (quote) scope.push({ title, text: quote });
  }
  const documents = [];
  for (const row of parsed.documents || []) {
    const quote = keep(row?.quote);
    const name = keep(row?.name) || (quote && exactQuote(quote, row?.name));
    if (!quote || !name) continue;
    documents.push({ slot: squash(row.slot), name, quote });
  }
  const penalties = [];
  for (const row of parsed.penalties || []) {
    const quote = keep(row?.quote);
    if (!quote) continue;
    penalties.push({ event: squash(row.event), rate: squash(row.rate), quote });
  }
  return { scope, documents, penalties };
}

export function applyVerifiedQuotes(report, verified) {
  if (!verified) return report;
  const next = structuredClone(report);
  if (verified.scope?.length) {
    const sections = next.part_b_scope_of_work.sections.filter((section) => section.title !== 'Service lines on the GeM cover');
    sections.push({
      title: 'Transport scope quoted from the linked file',
      blocks: verified.scope.map((item) => ({ title: item.title, text: item.text, children: [] })),
    });
    next.part_b_scope_of_work.sections = sections.filter((section) => {
      const text = reportBlob(section);
      return section.title !== 'Scope of work' || !/Not stated in this tender/.test(text) || sections.length === 1;
    });
  }
  if (verified.documents?.length) {
    for (const group of next.part_c_documents.groups || []) {
      for (const item of group.items || []) {
        const hit = verified.documents.find((row) => {
          const slot = row.slot.toLowerCase();
          const title = String(item.title || '').toLowerCase();
          return slot && (title.includes(slot) || slot.includes(title.slice(0, 18)));
        });
        if (!hit) continue;
        item.text = `${hit.name}. ${hit.quote}`;
      }
    }
  }
  if (verified.penalties?.length) {
    const sections = next.part_d_terms_payment_penalties.sections;
    const penalty = sections.find((section) => /penalt/i.test(section.title));
    const items = verified.penalties.map((row, index) => ({
      title: row.event || `Penalty ${index + 1}`,
      text: row.quote,
      children: [],
    }));
    if (penalty) {
      const stale = (penalty.items || []).every((item) => /Not stated in this tender|was not read/i.test(item.text || ''));
      penalty.items = stale ? items : [...(penalty.items || []).filter((item) => !/Not stated in this tender/i.test(item.text || '')), ...items];
    } else {
      sections.push({ title: '3. Penalties', items });
    }
  }
  return next;
}

export function pointersUnresolved(cover, sources, report) {
  const scopeBlob = reportBlob(report?.part_b_scope_of_work);
  const docBlob = reportBlob(report?.part_c_documents);
  const wantsScope = /as per bid|as per atc/i.test(cover || '');
  const wantsDocs = /requested in atc/i.test(cover || '');
  const scopeOk = !wantsScope || /\bfrom\b[\s\S]{0,80}\bto\b|loading and unloading|\d[\d,]*\s*(?:MT|metric tonne)/i.test(scopeBlob);
  const docsOk = !wantsDocs || !/the ATC file was not read|was not given a document name|GeM cover requires the seller/i.test(docBlob);
  const filesMissing = wantsScope && squash(sources.sow).length < 80 && squash(sources.atc).length < 80;
  return filesMissing || !scopeOk || !docsOk;
}

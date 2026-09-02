// Intent routing for the Gemini Workspace panel.
//
// One text box drives three very different pipelines, so the routing rules live here as
// pure functions that can be unit-tested. Getting this wrong is expensive in both
// directions: a mis-routed deep dive burns 30 seconds fetching PDFs, and a mis-routed
// document request answers a question instead of drafting a letter.

import { DOC_TYPES } from './document-templates.js';

export const INTENTS = {
  DEEP_DIVE: 'deep_dive',
  GENERATE_DOC: 'generate_doc',
  KNOWLEDGE: 'knowledge',
};

const DEEP_DIVE_PATTERN =
  /\b(scope\s*of\s*work|sow|atc|additional\s*terms?|technical\s*deliverable|deliverables|specification|spec\s*sheet|deep\s*[- ]?dive|read\s*the\s*(tender\s*)?document|bid\s*document\s*detail)\b/i;

const GENERATE_PATTERN =
  /\b(generate|draft|prepare|create|write|make)\b/i;

const DOC_NOUN_PATTERN =
  /\b(letter|authorisation|authorization|undertaking|declaration|affidavit|certificate|covering\s*letter|cover\s*letter|rti|reply|representation|proposal|quotation|mandate|document)\b/i;

// GeM bid numbers look like GEM/2026/B/1234567; state portals use similar slashed IDs.
const BID_NO_PATTERN = /\b(?:GEM|GeM|gem)\/\d{4}\/[A-Z]\/\d{3,}\b/;
const CLIENT_ID_PATTERN = /\bCLI[-\s]?(\d{3,})\b/i;
const EMAIL_PATTERN = /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/;

/** Pulls the bid number, client id or client email a prompt names, if any. */
export function extractReferences(prompt) {
  const text = String(prompt || '');
  const bidMatch = text.match(BID_NO_PATTERN);
  const clientMatch = text.match(CLIENT_ID_PATTERN);
  const emailMatch = text.match(EMAIL_PATTERN);

  return {
    bid_no: bidMatch ? bidMatch[0].toUpperCase().replace(/^GEM/i, 'GEM') : null,
    client_id: clientMatch ? `CLI-${clientMatch[1]}` : null,
    client_email: emailMatch ? emailMatch[0].toLowerCase() : null,
  };
}

/**
 * Finds which document type a prompt is asking for by scoring each catalogue entry's
 * label words against the prompt. Returns null when nothing matches convincingly, so the
 * caller can fall back to a general answer rather than drafting the wrong letter.
 */
export function matchDocType(prompt) {
  const text = String(prompt || '').toLowerCase();
  let best = null;
  let bestScore = 0;

  for (const docType of DOC_TYPES) {
    const words = docType.label.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    if (words.length === 0) continue;

    const hits = words.filter((word) => text.includes(word)).length;
    if (hits === 0) continue;

    // Normalise by label length so a two-word label matching both words beats a
    // five-word label matching one generic word.
    const score = hits / words.length;
    if (score > bestScore) { bestScore = score; best = docType; }
  }

  return bestScore >= 0.5 ? best : null;
}

/**
 * Classifies a prompt into one of the three pipelines.
 *
 * @param {string} prompt
 * @param {{ tenderId?: string|null }} [context] Tender the user is currently viewing.
 * @returns {{ intent: string, docType?: object|null, references: object, reason: string }}
 */
export function routePrompt(prompt, context = {}) {
  const text = String(prompt || '').trim();
  const references = extractReferences(text);

  // Document drafting is checked first: "draft the scope of work section of our covering
  // letter" is a document request that merely mentions SOW.
  const docType = matchDocType(text);
  const asksToGenerate = GENERATE_PATTERN.test(text);

  if (asksToGenerate && (docType || DOC_NOUN_PATTERN.test(text))) {
    return {
      intent: INTENTS.GENERATE_DOC,
      docType: docType || null,
      references,
      reason: docType
        ? `Recognised a request to draft a ${docType.label}.`
        : 'Recognised a document drafting request.',
    };
  }

  if (DEEP_DIVE_PATTERN.test(text)) {
    // A deep dive needs a tender to read. Without one there is nothing to fetch, so fall
    // through to the knowledge base rather than failing.
    const tenderId = references.bid_no || context.tenderId || null;
    if (tenderId) {
      return {
        intent: INTENTS.DEEP_DIVE,
        references: { ...references, tender_id: tenderId },
        reason: 'Reading the linked SOW/ATC documents for this tender.',
      };
    }
    return {
      intent: INTENTS.KNOWLEDGE,
      references,
      reason: 'No tender is in context, so answering from the GeM rulebook instead.',
    };
  }

  return {
    intent: INTENTS.KNOWLEDGE,
    references,
    reason: 'Answering from the GeM knowledge base.',
  };
}

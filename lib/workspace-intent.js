// Classifies a staff prompt in the Gemini Workspace so the panel can call the right
// pipeline instead of dumping every question into the general GeM RAG.
//
// Kept free of Next/Mongo imports so the routing rules are unit-testable.

import { DOC_TYPES, findDocType } from './document-templates.js';

export const INTENT = {
  DEEP_DIVE: 'deep_dive',
  GENERATE_DOC: 'generate_doc',
  GENERAL: 'general',
};

const DEEP_DIVE_PATTERN =
  /\b(sow|scope\s+of\s+work|statement\s+of\s+work|atc|additional\s+terms?|technical\s+deliverables?|eligibility\s+criteria|bid\s+document)\b/i;

const GENERATE_PATTERN =
  /\b(generate|draft|write|prepare|make)\b.{0,80}\b(letter|document|authorization|authorisation|undertaking|declaration|rti|oem|cover\s+letter|emd\s+exemption)\b/i;

const GEM_BID_PATTERN = /\bGEM\/\d{4}\/[A-Z]\/\d+\b/i;
const CLI_PATTERN = /\bCLI-([A-Z0-9]{3,})\b/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

export function extractGemBidNo(text) {
  const match = String(text || '').match(GEM_BID_PATTERN);
  return match ? match[0].toUpperCase() : null;
}

export function extractClientHint(text) {
  const raw = String(text || '');
  const cli = raw.match(CLI_PATTERN);
  if (cli) return { kind: 'cli', value: cli[0].toUpperCase() };
  const email = raw.match(EMAIL_PATTERN);
  if (email) return { kind: 'email', value: email[0].toLowerCase() };
  return null;
}

/**
 * Resolves a typed CLI-xxxx / email / company fragment against the staff directory.
 */
export function resolveClient(hint, clients = []) {
  if (!hint || !Array.isArray(clients) || clients.length === 0) return null;
  const list = clients.filter(Boolean);

  if (hint.kind === 'email') {
    return list.find((c) => String(c.email || '').toLowerCase() === hint.value) || null;
  }

  if (hint.kind === 'cli') {
    const needle = hint.value.toUpperCase();
    return list.find((c) => {
      const id = String(c.client_id || '').toUpperCase();
      const derived = c.email ? `CLI-${String(c.email).substring(0, 4).toUpperCase()}X` : '';
      return id === needle || derived === needle;
    }) || null;
  }

  return null;
}

function matchDocTypeFromText(text) {
  const lower = String(text || '').toLowerCase();
  const ordered = [
    [/oem|manufacturer\s+auth/i, 'oem_authorization'],
    [/rti|right\s+to\s+information/i, 'rti_inquiry'],
    [/emd\s+exempt/i, 'emd_exemption'],
    [/cover\s+letter|covering\s+letter/i, 'cover_letter'],
    [/technical\s+compliance/i, 'technical_compliance'],
    [/deliver(y|ies).{0,20}warrant/i, 'delivery_undertaking'],
    [/withdraw/i, 'bid_withdrawal'],
    [/declaration|undertaking/i, 'declaration'],
  ];
  for (const [pattern, id] of ordered) {
    if (pattern.test(lower)) return findDocType(id);
  }
  return DOC_TYPES.find((t) => lower.includes(t.label.toLowerCase())) || null;
}

/**
 * @returns {{
 *   intent: string,
 *   docType: object|null,
 *   tenderHint: string|null,
 *   clientHint: {kind:string,value:string}|null,
 * }}
 */
export function classifyWorkspacePrompt(query) {
  const text = String(query || '').trim();
  const tenderHint = extractGemBidNo(text);
  const clientHint = extractClientHint(text);
  const docType = matchDocTypeFromText(text);

  if (docType || GENERATE_PATTERN.test(text)) {
    return {
      intent: INTENT.GENERATE_DOC,
      docType: docType || findDocType('cover_letter'),
      tenderHint,
      clientHint,
    };
  }

  if (DEEP_DIVE_PATTERN.test(text)) {
    return { intent: INTENT.DEEP_DIVE, docType: null, tenderHint, clientHint };
  }

  return { intent: INTENT.GENERAL, docType: null, tenderHint, clientHint };
}

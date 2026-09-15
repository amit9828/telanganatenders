// Bilingual (English / Telugu) support for the Co-Pilot.
//
// Design decisions worth knowing before changing anything here:
//
// 1. We detect SCRIPT, not language. Telugu script has a clean Unicode block, so a
//    question typed in Telugu is unambiguous. Romanised Telugu ("Tenglish") written in
//    Latin letters cannot be detected reliably, which is why the UI also carries an
//    explicit language selector — detection is the convenience, the selector is the
//    guarantee.
//
// 2. The corpus is English. We never translate source documents, because translation
//    error would then compound into retrieval. Instead the QUERY is translated to English
//    for embedding, retrieval happens against the original English text, and translation
//    happens exactly once — when the answer is written.
//
// 3. Identifiers are never translated. A bid number, a clause reference or a rupee figure
//    rendered into Telugu digits or transliterated is worse than useless in a tender
//    office: it cannot be pasted back into GeM.
//
// This module is deliberately dependency-free so the language selector in the browser can
// import the same option list the server prompts from. The Gemini-backed query translation
// lives in language-server.js.

export const LANGUAGES = {
  ENGLISH: 'en',
  TELUGU: 'te',
  AUTO: 'auto',
};

export const LANGUAGE_OPTIONS = [
  { id: LANGUAGES.AUTO, label: 'Auto', hint: 'Match the language of my question' },
  { id: LANGUAGES.ENGLISH, label: 'English', hint: 'Always answer in English' },
  { id: LANGUAGES.TELUGU, label: 'తెలుగు', hint: 'Always answer in Telugu' },
];

const TELUGU_BLOCK = /[\u0C00-\u0C7F]/;

/** True when the text contains any Telugu script character. */
export function containsTelugu(text) {
  return TELUGU_BLOCK.test(String(text || ''));
}

/**
 * Which language an answer should be written in.
 *
 * @param {string} text        The officer's question.
 * @param {string} [preference] 'en' | 'te' | 'auto'
 * @returns {'en'|'te'}
 */
export function resolveAnswerLanguage(text, preference = LANGUAGES.AUTO) {
  if (preference === LANGUAGES.ENGLISH) return LANGUAGES.ENGLISH;
  if (preference === LANGUAGES.TELUGU) return LANGUAGES.TELUGU;
  return containsTelugu(text) ? LANGUAGES.TELUGU : LANGUAGES.ENGLISH;
}

// Pinned renderings for the terms that recur in every single answer. Without this the
// model picks a different Telugu word for "undertaking" in each reply and officers stop
// trusting that two answers are talking about the same document.
const TELUGU_GLOSSARY = [
  ['Bid', 'బిడ్ (Bid)'],
  ['Tender', 'టెండర్ (Tender)'],
  ['EMD / Earnest Money Deposit', 'ఇఎండి (EMD)'],
  ['Undertaking', 'అండర్‌టేకింగ్ (Undertaking)'],
  ['Declaration', 'డిక్లరేషన్ (Declaration)'],
  ['Eligibility criteria', 'అర్హత ప్రమాణాలు (Eligibility criteria)'],
  ['Turnover', 'టర్నోవర్ (Turnover)'],
  ['Scope of Work (SOW)', 'పని పరిధి / SOW'],
  ['Additional Terms & Conditions (ATC)', 'అదనపు నిబంధనలు (ATC)'],
  ['Bid closing date', 'బిడ్ ముగింపు తేదీ'],
  ['Buyer', 'కొనుగోలుదారు (Buyer)'],
  ['Seller / Bidder', 'బిడ్డర్ (Bidder)'],
  ['Letterhead', 'లెటర్‌హెడ్ (Letterhead)'],
  ['Blacklisted / debarred', 'బ్లాక్‌లిస్ట్ (Blacklisted)'],
];

const NEVER_TRANSLATE = `
NEVER TRANSLATE OR TRANSLITERATE THESE — reproduce them exactly as they appear in the source:
- Bid / tender numbers (GEM/2026/B/1234567)
- Clause numbers, ATC point numbers, section and annexure references
- Statutory and scheme names (GFR 2017, GeM GTC, MSME, Udyam, Make in India, PPP-MII)
- Document titles and file names
- Money amounts, percentages, quantities and dates — keep Arabic numerals (₹1,20,000 stays ₹1,20,000)
- Company names, department names, portal names, URLs and email addresses
`.trim();

const TELUGU_CONTRACT = `
LANGUAGE OF YOUR ANSWER: Telugu.

Write the explanation in natural, professional Telugu as spoken in a Hyderabad tender
consultancy — not literary Telugu, and not a word-for-word translation of English.

${NEVER_TRANSLATE}

On first mention of a technical term, give the Telugu form with the English in brackets,
then use the short form afterwards. Use these exact renderings so your answers stay
consistent with each other:
${TELUGU_GLOSSARY.map(([en, te]) => `- ${en} -> ${te}`).join('\n')}

If the supplied context does not answer the question, say so IN TELUGU and state which
document would be needed. Never silently switch back to English for the refusal.
`.trim();

const ENGLISH_CONTRACT = `
LANGUAGE OF YOUR ANSWER: English.

Write in plain professional English suitable for a bidding officer.

${NEVER_TRANSLATE}
`.trim();

/** The language contract to append to a system prompt. */
export function languageContract(language) {
  return language === LANGUAGES.TELUGU ? TELUGU_CONTRACT : ENGLISH_CONTRACT;
}

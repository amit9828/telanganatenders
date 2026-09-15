// Server-only half of the bilingual layer.
//
// Kept apart from lib/language.js because the language selector is a client component and
// must not drag the Gemini SDK into the browser bundle.

import { containsTelugu } from './language.js';
import { generateContent } from './gemini.js';

/**
 * Translates a Telugu question into English so it can be embedded against an English
 * corpus. Only the query is translated, never the source documents — translating the
 * corpus would bake translation error into every future retrieval.
 *
 * Uses the Flash tier deliberately: this is a short, low-risk string, and spending Pro
 * latency on it would slow every Telugu question down for no accuracy gain.
 *
 * @returns {Promise<string|null>} null when translation is unnecessary or fails.
 */
export async function translateQueryToEnglish(query) {
  const text = String(query || '').trim();
  if (!text || !containsTelugu(text)) return null;

  try {
    const { text: translated } = await generateContent({
      tier: 'flash',
      parts: [
        'Translate this government-procurement question from Telugu into English.\n'
        + 'Keep every bid number, clause reference, figure, date and proper noun exactly as written.\n'
        + 'Output only the translated question, with no preamble and no quotation marks.\n\n'
        + text,
      ],
    });
    const clean = String(translated || '').trim();
    return clean && clean !== text ? clean : null;
  } catch (err) {
    // Retrieval still works on the original text; it is simply less precise.
    console.warn('[language] query translation failed:', err?.message || err);
    return null;
  }
}

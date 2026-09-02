// 🚀 FIX: centralizes GEMINI_API_KEY access instead of 9 separate
// `process.env.GEMINI_API_KEY` copies across the AI routes. Also trims the
// value — this exact codebase has already been bitten once by Windows/editor
// tooling injecting a trailing \r or space into a `.env` value (ADMIN_PASSWORD),
// silently breaking a strict `===` comparison. Centralizing means that class of
// bug can now only ever be fixed/reintroduced in one place.
export function getGeminiApiKey() {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  return key || null;
}

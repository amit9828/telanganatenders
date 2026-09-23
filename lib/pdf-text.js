import { createHash } from 'node:crypto';

/** Below this, the file is treated as a scan and sent to Gemini vision. */
export const MIN_EXTRACT_CHARS = 40;
/** Gemini inline PDF calls reject very large base64 bodies. */
const GEMINI_MAX_BYTES = 8 * 1024 * 1024;

const EXTRACT_PROMPT =
  'Extract the full readable text of this document. Preserve headings, clause numbers ' +
  'and list structure. Do not summarise, do not add commentary, output the text only.';

export function hashBuffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function asText(value) {
  if (Array.isArray(value)) return value.join('\n');
  return String(value || '');
}

export async function extractPdfTextLocal(buffer) {
  const { extractText } = await import('unpdf');
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  return asText(text).replace(/[ \t]+\n/g, '\n').trim();
}

async function extractPdfTextGemini(buffer) {
  const { generateContent } = await import('./gemini.js');
  const { text } = await generateContent({
    tier: 'flash',
    parts: [
      EXTRACT_PROMPT,
      { inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' } },
    ],
  });
  return asText(text).trim();
}

/**
 * Local text first. Gemini vision runs only when the local extract is too short
 * (image-only scans) and the file is small enough to send inline.
 */
export async function extractPdfText(buffer) {
  let localError = null;
  try {
    const text = await extractPdfTextLocal(buffer);
    if (text.length >= MIN_EXTRACT_CHARS) return { ok: true, text, method: 'local' };
    localError = new Error('local extract returned too little text');
  } catch (err) {
    localError = err;
  }

  if (!buffer || buffer.length > GEMINI_MAX_BYTES) {
    return {
      ok: false,
      text: '',
      method: 'local',
      error: localError?.message || 'PDF has no readable text layer',
    };
  }

  try {
    const text = await extractPdfTextGemini(buffer);
    if (text.length >= MIN_EXTRACT_CHARS) return { ok: true, text, method: 'gemini' };
    return { ok: false, text: '', method: 'gemini', error: 'extraction returned too little text' };
  } catch (err) {
    return {
      ok: false,
      text: '',
      method: 'gemini',
      error: err?.message || localError?.message || 'extract failed',
    };
  }
}

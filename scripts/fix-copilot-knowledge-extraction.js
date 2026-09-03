/**
 * One-off maintenance: re-extract (or explicitly flag) `gem_copilot_knowledge`
 * documents that were silently saved with placeholder `content_text` before the
 * extraction_ok fix (see lib/gem-copilot-sync.js, app/api/ai/copilot-upload/route.js,
 * lib/gem-copilot-knowledge.js), or that already carry `extraction_ok: false`.
 *
 * For each candidate:
 *   1. Re-fetch the original bytes (R2 object via r2_key, falling back to source_url).
 *   2. Retry extraction with the current gemini-3.6-flash model (PDF) or HTML
 *      stripping (HTML page).
 *   3. On success: persist the real content_text + extraction_ok: true.
 *   4. On failure: persist extraction_ok: false and an empty content_text (never a
 *      placeholder string), so search continues to exclude it instead of feeding
 *      fake "context" to the Co-Pilot chat.
 *
 * Usage:
 *   node scripts/fix-copilot-knowledge-extraction.js [--dry-run]
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { loadLocalEnv } from './load-local-env.js';
import { getDb } from '../lib/db.js';
import { getGeminiApiKey } from '../lib/env.js';
import { fetchObjectByKey, isR2Configured } from '../lib/cloudflare-r2.js';
import { COPILOT_KNOWLEDGE_COLLECTION, PLACEHOLDER_CONTENT_RE, upsertCopilotKnowledgeDoc } from '../lib/gem-copilot-knowledge.js';

loadLocalEnv();

const DRY_RUN = process.argv.includes('--dry-run');

function log(msg) {
  console.log(`[fix-copilot-kb] ${msg}`);
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchBuffer(url, timeoutMs = 45000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'TelanganaTenders-GeM-CoPilot/1.0 (+https://telanganatenders.com)',
        Accept: '*/*',
      },
      redirect: 'follow',
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(err) {
  const msg = String(err?.message || '');
  const retryIn = msg.match(/Please retry in ([\d.]+)s/i);
  if (retryIn) return Math.min(90000, Math.ceil(Number(retryIn[1]) * 1000) + 2000);
  if (/429|Too Many Requests|quota/i.test(msg)) return 50000;
  return 0;
}

async function extractPdfTextWithRetry(buffer, model, attempts = 2) {
  if (!model) return { ok: false, error: 'GEMINI_API_KEY missing' };
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const result = await model.generateContent([
        'Extract the full readable text of this document. Preserve headings, clause numbers ' +
          'and list structure. Do not summarise, do not add commentary, output the text only.',
        { inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' } },
      ]);
      const text = String(result.response.text() || '').trim();
      if (text && text.length > 40) return { ok: true, text: text.slice(0, 200000) };
      lastError = new Error('extraction returned too little text');
    } catch (err) {
      lastError = err;
      const wait = retryDelayMs(err);
      if (wait && i < attempts - 1) {
        log(`rate-limited — waiting ${Math.round(wait / 1000)}s before retry`);
        await sleep(wait);
      }
    }
  }
  return { ok: false, error: lastError?.message || 'unknown error' };
}

async function reExtractOne(doc, model) {
  let buffer = null;

  if (doc.r2_key && isR2Configured()) {
    const obj = await fetchObjectByKey(doc.r2_key);
    if (obj?.buffer) buffer = obj.buffer;
  }
  if (!buffer && doc.source_url) {
    try {
      buffer = await fetchBuffer(doc.source_url);
    } catch (err) {
      return { ok: false, error: `re-fetch failed: ${err?.message || err}` };
    }
  }
  if (!buffer) return { ok: false, error: 'no r2_key/source_url available to re-fetch' };

  if (doc.content_type === 'application/pdf') {
    return extractPdfTextWithRetry(buffer, model);
  }

  const text = stripHtml(buffer.toString('utf8')).slice(0, 200000);
  if (text.length > 40) return { ok: true, text };
  return { ok: false, error: 'stripped HTML still empty' };
}

async function main() {
  const db = await getDb();
  const col = db.collection(COPILOT_KNOWLEDGE_COLLECTION);

  const geminiApiKey = getGeminiApiKey();
  if (!geminiApiKey) log('⚠️  GEMINI_API_KEY missing — PDF docs cannot be re-extracted, only re-flagged.');
  const model = geminiApiKey
    ? new GoogleGenerativeAI(geminiApiKey).getGenerativeModel({ model: 'gemini-3.6-flash' })
    : null;

  const candidates = await col.find({
    $or: [
      { extraction_ok: false },
      { content_text: { $regex: PLACEHOLDER_CONTENT_RE } },
    ],
  }).toArray();

  log(`found ${candidates.length} placeholder/failed doc(s) to re-check${DRY_RUN ? ' (dry-run — no writes)' : ''}.`);

  let fixed = 0;
  let stillFailing = 0;

  for (const doc of candidates) {
    const result = await reExtractOne(doc, model);
    if (result.ok) {
      fixed += 1;
      log(`fixed          ${doc.doc_id} (${result.text.length} chars)`);
      if (!DRY_RUN) {
        await upsertCopilotKnowledgeDoc(db, {
          ...doc,
          content_text: result.text,
          extraction_ok: true,
        });
      }
    } else {
      stillFailing += 1;
      log(`still failing  ${doc.doc_id} — ${result.error}`);
      if (!DRY_RUN) {
        await col.updateOne(
          { doc_id: doc.doc_id },
          { $set: { extraction_ok: false, content_text: '', char_count: 0, updated_at: new Date() } },
        );
      }
    }
  }

  log('');
  log(`Summary: scanned=${candidates.length} fixed=${fixed} still_failing=${stillFailing}${DRY_RUN ? ' (dry-run, no writes made)' : ''}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[fix-copilot-kb] fatal:', err);
  process.exit(1);
});

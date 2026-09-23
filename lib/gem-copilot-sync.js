import { getDb } from './db.js';
import { uploadCopilotKnowledge } from './cloudflare-r2.js';
import { ingestCopilotPdf } from './copilot-ingest.js';
import {
  COPILOT_FOOTER_SOURCES,
  COPILOT_KNOWLEDGE_COLLECTION,
  slugifyDocId,
  upsertCopilotKnowledgeDoc,
} from './gem-copilot-knowledge.js';

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

function absoluteUrl(href, base) {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function extractLinks(html, pageUrl, matchRe) {
  const links = [];
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = absoluteUrl(m[1], pageUrl);
    if (!href) continue;
    const label = stripHtml(m[2]).slice(0, 200);
    const hay = `${label} ${href}`;
    if (matchRe && !matchRe.test(hay)) continue;
    links.push({ href, label: label || href });
  }
  return links;
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
    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    return { buffer: Buffer.from(ab), contentType, finalUrl: res.url || url };
  } finally {
    clearTimeout(timer);
  }
}

export const COPILOT_QUEUE_COLLECTION = 'gem_copilot_queue';
const QUEUE_BATCH = 6;
const STALE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;

async function enqueuePdf(db, { url, label, category }) {
  const href = String(url || '').trim();
  if (!href) return;
  const col = db.collection(COPILOT_QUEUE_COLLECTION);
  const existing = await col.findOne({ url: href });
  const fresh = existing?.updated_at && (Date.now() - new Date(existing.updated_at).getTime()) < STALE_MS;
  if (existing?.status === 'done' && fresh) return;
  if (existing?.status === 'failed' && Number(existing.attempts) >= MAX_ATTEMPTS && fresh) return;
  if (existing?.status === 'pending') {
    await col.updateOne({ url: href }, {
      $set: { label: label || existing.label || href, category: category || existing.category, updated_at: new Date() },
    });
    return;
  }
  await col.updateOne(
    { url: href },
    {
      $setOnInsert: { url: href, created_at: new Date(), attempts: 0 },
      $set: {
        label: label || href,
        category: category || guessCategory(label, href),
        status: 'pending',
        updated_at: new Date(),
      },
    },
    { upsert: true },
  );
}

async function ingestHtml(db, { title, category, source_url, html }) {
  const text = stripHtml(html).slice(0, 200000);
  const extraction_ok = text.length > 40;
  let r2_key = null;
  let r2_url = null;
  try {
    const uploaded = await uploadCopilotKnowledge(
      Buffer.from(html, 'utf8'),
      `${slugifyDocId(title || source_url)}.html`,
      'text/html; charset=utf-8',
    );
    r2_key = uploaded?.key || null;
    r2_url = uploaded?.url || null;
  } catch {
    // R2 optional for HTML snapshots
  }

  return upsertCopilotKnowledgeDoc(db, {
    doc_id: slugifyDocId(source_url || title),
    title,
    category,
    source_url,
    r2_key,
    r2_url,
    content_type: 'text/html',
    // 🚀 FIX: an empty-text page used to be saved as "[HTML page] <title>" — a
    // placeholder indistinguishable from real content once in the DB. Store it
    // honestly instead so search can exclude it (see extraction_ok below).
    content_text: extraction_ok ? text : '',
    extraction_ok,
  });
}

function guessCategory(label, href) {
  const hay = `${label} ${href}`.toLowerCase();
  if (/handbook/.test(hay)) return 'handbook';
  if (/circular|o\.?m\.?|memorandum/.test(hay)) return 'circulars';
  if (/gtc|terms|condition/.test(hay)) return 'terms';
  if (/policy|manual|guideline/.test(hay)) return 'policies';
  if (/mou/.test(hay)) return 'mous';
  if (/gfr/.test(hay)) return 'gfr';
  if (/faq/.test(hay)) return 'faqs';
  if (/train|module|tutorial|webinar/.test(hay)) return 'training';
  return 'miscellaneous';
}

/**
 * Sunday (or on-demand) sync. HTML indexes are read immediately and every PDF
 * link is queued. One invocation downloads and embeds only `batchSize` PDFs so
 * a short cron window can continue on the next run.
 *
 * @param {{ batchSize?: number, discoveredLinks?: Array<{href:string,label?:string}> }} opts
 */
export async function syncGemCopilotKnowledge({
  batchSize = QUEUE_BATCH,
  discoveredLinks = [],
} = {}) {
  const db = await getDb();
  const queue = db.collection(COPILOT_QUEUE_COLLECTION);
  await queue.createIndex({ url: 1 }, { unique: true }).catch(() => {});
  await queue.createIndex({ status: 1, created_at: 1 }).catch(() => {});
  await db.collection(COPILOT_KNOWLEDGE_COLLECTION)
    .createIndex({ doc_id: 1 }, { unique: true })
    .catch(() => {});

  const staleBefore = new Date(Date.now() - STALE_MS);
  await queue.updateMany(
    { status: 'done', updated_at: { $lt: staleBefore } },
    { $set: { status: 'pending', updated_at: new Date() } },
  );

  const stats = {
    sources: COPILOT_FOOTER_SOURCES.length,
    discovered_links: Array.isArray(discoveredLinks) ? discoveredLinks.length : 0,
    html_pages: 0,
    enqueued: 0,
    pdfs: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  for (const source of COPILOT_FOOTER_SOURCES) {
    try {
      if (source.type === 'pdf') {
        await enqueuePdf(db, { url: source.url, label: source.title, category: source.category });
        stats.enqueued += 1;
        continue;
      }

      const { buffer, finalUrl } = await fetchBuffer(source.url);
      const html = buffer.toString('utf8');
      await ingestHtml(db, {
        title: source.title,
        category: source.category,
        source_url: finalUrl || source.url,
        html,
      });
      stats.html_pages += 1;

      if (source.type === 'html_index' || source.match) {
        const links = extractLinks(html, finalUrl || source.url, source.match);
        for (const link of links) {
          const isPdf = /\.pdf(\?|$)/i.test(link.href) || /pdf/i.test(link.label);
          if (!isPdf) continue;
          await enqueuePdf(db, {
            url: link.href,
            label: link.label || source.title,
            category: source.category,
          });
          stats.enqueued += 1;
        }
      }
    } catch (err) {
      stats.failed += 1;
      stats.errors.push({ url: source.url, error: err?.message || String(err) });
    }
  }

  for (const link of discoveredLinks || []) {
    const href = String(link?.href || '').trim();
    if (!href || !/\.pdf(\?|$)/i.test(href)) continue;
    await enqueuePdf(db, {
      url: href,
      label: link.label || href,
      category: guessCategory(link.label, href),
    });
    stats.enqueued += 1;
  }

  const limit = Math.max(1, Math.min(20, Number(batchSize) || QUEUE_BATCH));
  const pending = await queue.find({ status: 'pending' }).sort({ created_at: 1 }).limit(limit).toArray();

  for (const item of pending) {
    try {
      const pdf = await fetchBuffer(item.url);
      const head = pdf.buffer.subarray(0, 5).toString('latin1');
      if (head !== '%PDF-') throw new Error('Response was not a PDF');
      const result = await ingestCopilotPdf(db, {
        title: item.label || item.url,
        category: item.category,
        origin: 'scrape',
        source_url: item.url,
        buffer: pdf.buffer,
        contentType: pdf.contentType,
      });
      if (!result.skipped && result.extraction?.ok && !result.embedded_chunks) {
        throw new Error(result.embed_error || 'embedding produced no chunks');
      }
      await queue.updateOne({ url: item.url }, {
        $set: { status: 'done', updated_at: new Date(), last_error: null },
      });
      if (result.skipped) stats.skipped += 1;
      else if (!result.extraction?.ok) {
        stats.failed += 1;
        stats.errors.push({ url: item.url, error: result.extraction?.error || 'extract failed' });
      } else stats.pdfs += 1;
    } catch (err) {
      const attempts = Number(item.attempts || 0) + 1;
      await queue.updateOne({ url: item.url }, {
        $set: {
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          updated_at: new Date(),
          last_error: err?.message || String(err),
        },
        $inc: { attempts: 1 },
      });
      stats.failed += 1;
      stats.errors.push({ url: item.url, error: err?.message || String(err) });
    }
  }

  const queue_remaining = await queue.countDocuments({ status: 'pending' });
  stats.queue_remaining = queue_remaining;

  return {
    ok: true,
    collection: COPILOT_KNOWLEDGE_COLLECTION,
    r2_prefix: 'gem_copilot_knowledge',
    stats,
    synced_at: new Date().toISOString(),
  };
}

import { GoogleGenerativeAI } from '@google/generative-ai';
// Relative imports so this module also runs from standalone Node scripts
// (`npm run gem:copilot-kb`) — `@/` aliases only resolve inside Next.js.
import { getDb } from './db.js';
import { uploadCopilotKnowledge } from './cloudflare-r2.js';
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

function getGeminiModel() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const genAI = new GoogleGenerativeAI(key);
  // 🚀 FIX: gemini-1.5-flash is retired; gemini-3.6-flash is what this account's
  // GEMINI_API_KEY is actually entitled to (verified live).
  return genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
}

async function extractPdfText(buffer, model) {
  if (!model) {
    return `[PDF stored in R2 — text extraction skipped: GEMINI_API_KEY missing]`;
  }
  const result = await model.generateContent([
    'Extract the full readable text of this document. Preserve headings, clause numbers ' +
      'and list structure. Do not summarise, do not add commentary, output the text only.',
    { inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' } },
  ]);
  return String(result.response.text() || '').trim();
}

async function ingestPdf(db, model, { title, category, source_url, buffer, contentType }) {
  const safeName = `${slugifyDocId(title || source_url)}.pdf`;
  const uploaded = await uploadCopilotKnowledge(buffer, safeName, contentType || 'application/pdf');

  let content_text = `[PDF stored in R2] ${title}\nSource: ${source_url}`;
  try {
    const extracted = await extractPdfText(buffer, model);
    if (extracted && extracted.length > 40) content_text = extracted.slice(0, 200000);
  } catch (err) {
    console.warn('[gem-copilot-sync] PDF text extract failed:', err?.message || err);
  }

  return upsertCopilotKnowledgeDoc(db, {
    doc_id: slugifyDocId(source_url || title),
    title,
    category,
    source_url,
    r2_key: uploaded?.key || null,
    r2_url: uploaded?.url || null,
    content_type: 'application/pdf',
    content_text,
  });
}

async function ingestHtml(db, { title, category, source_url, html }) {
  const text = stripHtml(html).slice(0, 200000);
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
    content_text: text || `[HTML page] ${title}`,
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
 * Sunday (or on-demand) sync: harvest GeM footer/resource targets into
 * Mongo `gem_copilot_knowledge` + R2 `gem_copilot_knowledge/`.
 *
 * @param {{ maxPdfsPerSource?: number, discoveredLinks?: Array<{href:string,label?:string}> }} opts
 */
export async function syncGemCopilotKnowledge({
  maxPdfsPerSource = 8,
  discoveredLinks = [],
} = {}) {
  const db = await getDb();
  const model = getGeminiModel();

  await db.collection(COPILOT_KNOWLEDGE_COLLECTION)
    .createIndex({ doc_id: 1 }, { unique: true })
    .catch(() => {});
  await db.collection(COPILOT_KNOWLEDGE_COLLECTION)
    .createIndex({ category: 1, updated_at: -1 })
    .catch(() => {});

  const stats = {
    sources: COPILOT_FOOTER_SOURCES.length,
    discovered_links: Array.isArray(discoveredLinks) ? discoveredLinks.length : 0,
    html_pages: 0,
    pdfs: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  const seenUrls = new Set();

  for (const source of COPILOT_FOOTER_SOURCES) {
    try {
      if (source.type === 'pdf') {
        if (seenUrls.has(source.url)) {
          stats.skipped += 1;
          continue;
        }
        seenUrls.add(source.url);
        const { buffer, contentType } = await fetchBuffer(source.url);
        await ingestPdf(db, model, {
          title: source.title,
          category: source.category,
          source_url: source.url,
          buffer,
          contentType,
        });
        stats.pdfs += 1;
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
        let pdfCount = 0;
        for (const link of links) {
          if (seenUrls.has(link.href)) {
            stats.skipped += 1;
            continue;
          }
          const isPdf = /\.pdf(\?|$)/i.test(link.href) || /pdf/i.test(link.label);
          if (!isPdf) continue;
          if (pdfCount >= maxPdfsPerSource) break;
          seenUrls.add(link.href);
          try {
            const pdf = await fetchBuffer(link.href);
            await ingestPdf(db, model, {
              title: link.label || source.title,
              category: source.category,
              source_url: link.href,
              buffer: pdf.buffer,
              contentType: pdf.contentType,
            });
            stats.pdfs += 1;
            pdfCount += 1;
          } catch (err) {
            stats.failed += 1;
            stats.errors.push({ url: link.href, error: err?.message || String(err) });
          }
        }
      }
    } catch (err) {
      stats.failed += 1;
      stats.errors.push({ url: source.url, error: err?.message || String(err) });
    }
  }

  // Extra links discovered by the Playwright footer scraper (optional).
  let extraPdfs = 0;
  for (const link of discoveredLinks || []) {
    const href = String(link?.href || '').trim();
    if (!href || seenUrls.has(href)) {
      if (href) stats.skipped += 1;
      continue;
    }
    const isPdf = /\.pdf(\?|$)/i.test(href);
    if (!isPdf) continue;
    if (extraPdfs >= 20) break;
    seenUrls.add(href);
    try {
      const pdf = await fetchBuffer(href);
      await ingestPdf(db, model, {
        title: link.label || href,
        category: guessCategory(link.label, href),
        source_url: href,
        buffer: pdf.buffer,
        contentType: pdf.contentType,
      });
      stats.pdfs += 1;
      extraPdfs += 1;
    } catch (err) {
      stats.failed += 1;
      stats.errors.push({ url: href, error: err?.message || String(err) });
    }
  }

  return {
    ok: true,
    collection: COPILOT_KNOWLEDGE_COLLECTION,
    r2_prefix: 'gem_copilot_knowledge',
    stats,
    synced_at: new Date().toISOString(),
  };
}

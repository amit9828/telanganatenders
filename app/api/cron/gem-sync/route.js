import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/db';
import { REMOTE_SOURCES, SEED_DOCUMENTS, htmlToText } from '@/lib/gem-knowledge';
import {
  chunkText,
  embedTexts,
  ensureVectorIndex,
  normaliseWhitespace,
  VECTOR_COLLECTION,
} from '@/lib/gem-embeddings';
import { getGeminiApiKey } from '@/lib/env';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const FETCH_TIMEOUT_MS = 20000;
// Below this, a "successful" fetch almost certainly returned a JS shell or an error page
// rather than the document we wanted.
const MIN_USEFUL_TEXT_CHARS = 400;

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'User-Agent': 'TelanganaTenders-GeMSync/1.0' },
    });
  } finally {
    clearTimeout(timer);
  }
}

// PDFs need real text extraction. Rather than add a PDF parsing dependency (most of which
// misbehave under serverless bundling), hand the bytes to Gemini, which reads PDFs
// natively and returns clean prose.
async function extractPdfText(buffer, model) {
  const result = await model.generateContent([
    'Extract the full readable text of this document. Preserve headings, clause numbers ' +
    'and list structure. Do not summarise, do not add commentary, output the text only.',
    { inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' } },
  ]);
  return result.response.text();
}

async function loadRemoteSource(source, model) {
  const res = await fetchWithTimeout(source.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  if (source.type === 'pdf') {
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new Error('Response was not a PDF (likely an HTML error or login page).');
    }
    return normaliseWhitespace(await extractPdfText(buffer, model));
  }

  return normaliseWhitespace(htmlToText(await res.text()));
}

// Re-chunks a document and replaces its vectors atomically enough for our purposes:
// insert the new chunks, then delete anything left over from the previous run. Chunk ids
// are deterministic, so a re-run with unchanged content simply overwrites in place.
async function upsertDocument(collection, { documentId, title, sourceUrl, text }) {
  const chunks = chunkText(text);
  if (chunks.length === 0) return { chunks: 0 };

  const vectors = await embedTexts(chunks, 'RETRIEVAL_DOCUMENT');
  const timestamp = new Date();

  const operations = chunks.map((chunk, index) => ({
    updateOne: {
      filter: { chunk_id: `${documentId}::${index}` },
      update: {
        $set: {
          chunk_id: `${documentId}::${index}`,
          document_id: documentId,
          document_title: title,
          source_url: sourceUrl || null,
          chunk_index: index,
          text: chunk,
          embedding: vectors[index],
          timestamp,
        },
      },
      upsert: true,
    },
  }));

  await collection.bulkWrite(operations, { ordered: false });

  // Drop chunks from a previous, longer version of this document.
  await collection.deleteMany({ document_id: documentId, chunk_index: { $gte: chunks.length } });

  return { chunks: chunks.length };
}

async function runSync() {
  const db = await getDb();
  const collection = db.collection(VECTOR_COLLECTION);

  const indexResult = await ensureVectorIndex(db);

  let model = null;
  const geminiApiKeyForSync = getGeminiApiKey();
  if (geminiApiKeyForSync) {
    const genAI = new GoogleGenerativeAI(geminiApiKeyForSync);
    // 🚀 FIX: gemini-1.5-flash is retired; gemini-3.6-flash is what this account's
    // GEMINI_API_KEY is actually entitled to (verified live).
    model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
  }

  const results = [];

  // 1. Curated baseline. These never fail, so the Co-Pilot always has something to cite.
  for (const doc of SEED_DOCUMENTS) {
    try {
      const { chunks } = await upsertDocument(collection, {
        documentId: doc.id,
        title: doc.title,
        sourceUrl: null,
        text: doc.content,
      });
      results.push({ id: doc.id, title: doc.title, origin: 'seed', status: 'synced', chunks });
    } catch (err) {
      console.error(`[gem-sync] seed "${doc.id}" failed:`, err?.message || err);
      results.push({ id: doc.id, title: doc.title, origin: 'seed', status: 'failed', error: err?.message });
    }
  }

  // 2. Live GeM sources. A single unreachable or JS-rendered page must not abort the run.
  for (const source of REMOTE_SOURCES) {
    try {
      const text = await loadRemoteSource(source, model);
      if (text.length < MIN_USEFUL_TEXT_CHARS) {
        results.push({
          id: source.id,
          title: source.title,
          origin: 'remote',
          status: 'skipped',
          error: `Only ${text.length} chars of readable text — the page is likely client-rendered.`,
        });
        continue;
      }
      const { chunks } = await upsertDocument(collection, {
        documentId: source.id,
        title: source.title,
        sourceUrl: source.url,
        text,
      });
      results.push({ id: source.id, title: source.title, origin: 'remote', status: 'synced', chunks });
    } catch (err) {
      console.error(`[gem-sync] remote "${source.id}" failed:`, err?.message || err);
      results.push({ id: source.id, title: source.title, origin: 'remote', status: 'failed', error: err?.message });
    }
  }

  const totalChunks = await collection.countDocuments();

  return {
    success: true,
    ran_at: new Date().toISOString(),
    vector_index: indexResult,
    summary: {
      synced: results.filter((r) => r.status === 'synced').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: results.filter((r) => r.status === 'failed').length,
      total_chunks_in_kb: totalChunks,
    },
    results,
  };
}

function isAuthorised(request) {
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const adminToken = String(process.env.ADMIN_TOKEN || '').trim();

  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. The admin token is accepted
  // too so the MD can trigger a manual re-sync from the dashboard.
  if (cronSecret && bearer === cronSecret) return true;
  if (adminToken && bearer === adminToken) return true;
  // With neither secret configured there is nothing to verify against; refuse rather than
  // leaving an unauthenticated job that burns API quota.
  return false;
}

export async function GET(request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!getGeminiApiKey()) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is not configured on this server.' }, { status: 500 });
  }

  try {
    return NextResponse.json(await runSync());
  } catch (error) {
    console.error('[gem-sync] fatal error:', error);
    return NextResponse.json({ error: error?.message || 'Sync failed' }, { status: 500 });
  }
}

// Vercel Cron issues GET; POST is here so the dashboard can trigger the same job.
export const POST = GET;

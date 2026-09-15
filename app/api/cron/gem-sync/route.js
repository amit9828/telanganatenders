import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { REMOTE_SOURCES, SEED_DOCUMENTS, htmlToText } from '@/lib/gem-knowledge';
import {
  ensureVectorIndex,
  normaliseWhitespace,
  VECTOR_COLLECTION,
} from '@/lib/gem-embeddings';
import { ingestDocumentVectors } from '@/lib/rag-ingest';
import { generateContent } from '@/lib/gemini';
import { getGeminiApiKey } from '@/lib/env';
import { purgeExpiredChatObjects } from '@/lib/chat-purge';

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
async function extractPdfText(buffer) {
  const { text } = await generateContent({
    tier: 'flash',
    parts: [
      'Extract the full readable text of this document. Preserve headings, clause numbers ' +
      'and list structure. Do not summarise, do not add commentary, output the text only.',
      { inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' } },
    ],
  });
  return text;
}

async function loadRemoteSource(source) {
  const res = await fetchWithTimeout(source.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  if (source.type === 'pdf') {
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw new Error('Response was not a PDF (likely an HTML error or login page).');
    }
    return normaliseWhitespace(await extractPdfText(buffer));
  }

  return normaliseWhitespace(htmlToText(await res.text()));
}

async function runSync() {
  const db = await getDb();
  const collection = db.collection(VECTOR_COLLECTION);

  const indexResult = await ensureVectorIndex(db);

  if (!getGeminiApiKey()) {
    console.warn('[gem-sync] GEMINI_API_KEY missing — remote PDF sources will fail; seed documents still sync.');
  }

  const results = [];

  // 1. Curated baseline. These never fail, so the Co-Pilot always has something to cite.
  for (const doc of SEED_DOCUMENTS) {
    try {
      const { chunks } = await ingestDocumentVectors(db, {
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
      const text = await loadRemoteSource(source);
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
      const { chunks } = await ingestDocumentVectors(db, {
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
    chat_purge: await purgeExpiredChatObjects().catch((err) => {
      console.warn('[gem-sync] chat purge skipped:', err?.message || err);
      return { error: err?.message || 'chat purge failed' };
    }),
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

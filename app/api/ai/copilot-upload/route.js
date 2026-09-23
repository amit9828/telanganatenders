import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireStaff, resolveActorRole } from '@/lib/staff-auth';
import { isValidPDFBuffer } from '@/lib/cloudflare-r2';
import { COPILOT_KNOWLEDGE_COLLECTION, slugifyDocId } from '@/lib/gem-copilot-knowledge';
import { ingestCopilotPdf } from '@/lib/copilot-ingest';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_FILES = 8;
const CONCURRENCY = 3;

async function runPool(items, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

function quotaMessage(message) {
  const text = String(message || '');
  if (/\b429\b|RESOURCE_EXHAUSTED|quota is exhausted/i.test(text)) {
    return 'Gemini embedding quota is exhausted. Wait a minute and upload the PDF again.';
  }
  return text;
}

function guessCategory(fileName) {
  const hay = String(fileName || '').toLowerCase();
  if (/handbook/.test(hay)) return 'handbook';
  if (/circular|o\.?m|memorandum/.test(hay)) return 'circulars';
  if (/gtc|terms|condition/.test(hay)) return 'terms';
  if (/policy|manual|guideline/.test(hay)) return 'policies';
  if (/mou/.test(hay)) return 'mous';
  if (/gfr/.test(hay)) return 'gfr';
  if (/faq/.test(hay)) return 'faqs';
  if (/train/.test(hay)) return 'training';
  return 'manual_training';
}

async function trainOneFile(file, { db, uploadedBy, categoryOverride }) {
  const fileName = file?.name || 'document.pdf';
  if (typeof file?.arrayBuffer !== 'function') {
    return { fileName, status: 'failed', error: 'Not a readable file upload.' };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { fileName, status: 'failed', error: `Exceeds the ${MAX_FILE_BYTES / 1024 / 1024}MB limit.` };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!isValidPDFBuffer(buffer)) {
    return { fileName, status: 'failed', error: 'Only valid PDF files are accepted.' };
  }

  const title = fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim() || fileName;
  const category = categoryOverride || guessCategory(fileName);
  const doc_id = `manual-${slugifyDocId(fileName)}`;

  const result = await ingestCopilotPdf(db, {
    doc_id,
    title,
    category,
    origin: 'manual_upload',
    uploaded_by: uploadedBy,
    original_filename: fileName,
    buffer,
    contentType: 'application/pdf',
  });

  if (result.skipped) {
    return {
      fileName,
      status: 'trained',
      doc_id: result.saved?.doc_id || doc_id,
      title,
      category,
      chunks: result.embedded_chunks,
    };
  }

  if (!result.extraction?.ok) {
    return {
      fileName,
      status: 'failed',
      doc_id: result.saved?.doc_id || doc_id,
      error: result.extraction?.error || 'PDF stored, but text extraction failed.',
    };
  }
  if (!result.embedded_chunks) {
    return {
      fileName,
      status: 'failed',
      doc_id: result.saved?.doc_id || doc_id,
      error: quotaMessage(result.embed_error) || 'Text was saved, but embedding failed.',
    };
  }

  return {
    fileName,
    status: 'trained',
    doc_id: result.saved.doc_id,
    title: result.saved.title,
    category: result.saved.category,
    char_count: result.saved.char_count,
    chunks: result.embedded_chunks,
    r2_key: result.saved.r2_key,
  };
}

export async function GET(request) {
  const auth = await requireStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = await getDb();
    const docs = await db.collection(COPILOT_KNOWLEDGE_COLLECTION)
      .find({ origin: 'manual_upload' })
      .sort({ updated_at: -1 })
      .limit(20)
      .project({
        doc_id: 1, title: 1, category: 1, original_filename: 1,
        char_count: 1, updated_at: 1, r2_key: 1,
        extraction_ok: 1, extraction_error: 1, embedded_chunks: 1,
      })
      .toArray();

    const total = await db.collection(COPILOT_KNOWLEDGE_COLLECTION).countDocuments();
    return NextResponse.json({
      docs: docs.map((d) => ({ ...d, _id: String(d._id) })),
      total,
    });
  } catch (err) {
    console.error('[copilot-upload] list failed:', err);
    return NextResponse.json({ error: err?.message || 'Failed to list knowledge docs' }, { status: 500 });
  }
}

export async function POST(request) {
  const actor = await resolveActorRole(request);
  if (actor.role !== 'MD') {
    return NextResponse.json({ error: 'Only MD can train Co-Pilot.' }, { status: 403 });
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a multipart/form-data upload.' }, { status: 400 });
  }

  const files = [
    ...formData.getAll('files'),
    ...formData.getAll('file'),
  ].filter((f) => f && typeof f.arrayBuffer === 'function');

  if (files.length === 0) {
    return NextResponse.json({ error: 'No PDF file was received.' }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Please upload at most ${MAX_FILES} PDFs at a time.` }, { status: 400 });
  }

  const categoryOverride = String(formData.get('category') || '').trim() || null;
  const uploadedBy = actor.email || String(formData.get('uploadedBy') || 'MD Admin');

  const db = await getDb();

  const results = await runPool(files, async (file) => {
    try {
      return await trainOneFile(file, { db, uploadedBy, categoryOverride });
    } catch (err) {
      return {
        fileName: file?.name || 'document.pdf',
        status: 'failed',
        error: quotaMessage(err?.message) || 'Unexpected server error.',
      };
    }
  });

  const trained = results.filter((r) => r.status === 'trained').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  return NextResponse.json({
    success: trained > 0,
    summary: { trained, failed },
    results,
  });
}

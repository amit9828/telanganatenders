import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/staff-auth';
import { uploadCopilotKnowledge, isR2Configured, isValidPDFBuffer } from '@/lib/cloudflare-r2';
import {
  COPILOT_KNOWLEDGE_COLLECTION,
  slugifyDocId,
  upsertCopilotKnowledgeDoc,
} from '@/lib/gem-copilot-knowledge';
import { getGeminiApiKey } from '@/lib/env';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_FILES = 8;
// 🚀 FIX (Timeout Prevention): up to MAX_FILES PDFs used to be extracted one at a
// time inside maxDuration=60. A batch of 8 large PDFs could easily exceed that
// budget on Vercel's Hobby plan cap. Mirrors the bounded worker pool already used
// by app/api/ai/bulk-upload/route.js so a full batch fits inside the window.
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

const EXTRACT_PROMPT =
  'Extract the full readable text of this document. Preserve headings, clause numbers ' +
  'and list structure. Do not summarise, do not add commentary, output the text only.';

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

async function extractPdfText(buffer, model) {
  const result = await model.generateContent([
    EXTRACT_PROMPT,
    { inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' } },
  ]);
  return String(result.response.text() || '').trim();
}

// 🚀 FIX: extraction only "failed" the whole upload when Gemini *threw* — a call
// that succeeded but returned almost nothing (blank/garbled scan, refusal, etc.)
// fell through to a "[PDF stored in R2] <title>" placeholder and was still saved
// as status: 'trained'. That placeholder then got fed to the Co-Pilot chat as if
// it were real document content, producing "context text extractions are
// empty/missing" replies. One retry covers a transient blip; if it still comes
// back too short we now fail honestly instead of pretending it succeeded.
async function extractPdfTextWithRetry(buffer, model, attempts = 2) {
  let lastError = null;
  for (let i = 0; i < attempts; i++) {
    try {
      const text = await extractPdfText(buffer, model);
      if (text && text.length > 20) return { ok: true, text };
      lastError = new Error('extraction returned too little text');
    } catch (err) {
      lastError = err;
    }
  }
  return { ok: false, error: lastError?.message || 'unknown error' };
}

async function trainOneFile(file, { db, model, uploadedBy, categoryOverride }) {
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
  const r2Name = `${doc_id}-${Date.now()}.pdf`;

  const uploaded = await uploadCopilotKnowledge(buffer, r2Name, 'application/pdf');
  if (!uploaded?.key) {
    return { fileName, status: 'failed', error: 'Upload to Cloudflare R2 failed.' };
  }

  const extraction = await extractPdfTextWithRetry(buffer, model);
  if (!extraction.ok) {
    console.warn('[copilot-upload] text extract failed after retry:', extraction.error);
    return {
      fileName,
      status: 'failed',
      error: `PDF stored, but text extraction failed: ${extraction.error}`,
    };
  }

  const saved = await upsertCopilotKnowledgeDoc(db, {
    doc_id,
    title,
    category,
    origin: 'manual_upload',
    uploaded_by: uploadedBy,
    original_filename: fileName,
    source_url: uploaded.url || null,
    r2_key: uploaded.key,
    r2_url: uploaded.url,
    content_type: 'application/pdf',
    content_text: extraction.text.slice(0, 200000),
    extraction_ok: true,
  });

  return {
    fileName,
    status: 'trained',
    doc_id: saved.doc_id,
    title: saved.title,
    category: saved.category,
    char_count: saved.char_count,
    r2_key: saved.r2_key,
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
  const auth = await requireStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const geminiApiKey = getGeminiApiKey();
  if (!geminiApiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is not configured on this server.' }, { status: 500 });
  }
  if (!isR2Configured()) {
    return NextResponse.json({
      error: 'Cloudflare R2 is not configured. Set CLOUDFLARE_R2_* env vars before training the Co-Pilot.',
    }, { status: 503 });
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
  const uploadedBy = auth.email || String(formData.get('uploadedBy') || 'MD Admin');

  const db = await getDb();
  const genAI = new GoogleGenerativeAI(geminiApiKey);
  // 🚀 FIX: gemini-1.5-flash is retired; gemini-3.6-flash is what this account's
  // GEMINI_API_KEY is actually entitled to (verified live).
  const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

  const results = await runPool(files, async (file) => {
    try {
      return await trainOneFile(file, { db, model, uploadedBy, categoryOverride });
    } catch (err) {
      return {
        fileName: file?.name || 'document.pdf',
        status: 'failed',
        error: err?.message || 'Unexpected server error.',
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

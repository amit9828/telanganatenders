import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/db';
import { uploadTenderPDF, isR2Configured, isValidPDFBuffer } from '@/lib/cloudflare-r2';
import { EXTRACTION_PROMPT, parseAIJson, normaliseExtraction } from '@/lib/ai-extraction';
import { getGeminiApiKey } from '@/lib/env';

// The AI call is the slow part, so keep this on the Node runtime with the longest
// duration the Vercel Hobby plan allows. Files are processed with bounded
// concurrency below so a batch still fits inside the budget.
export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_FILES_PER_BATCH = 25;
// Gemini is rate-limited and each call holds a socket; 3 at a time keeps a typical
// batch inside maxDuration without tripping 429s.
const CONCURRENCY = 3;

async function processFile(file, { db, model, uploadedBy }) {
  const fileName = file?.name || 'document.pdf';

  if (typeof file?.arrayBuffer !== 'function') {
    return { fileName, status: 'failed', error: 'Not a readable file upload.' };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { fileName, status: 'failed', error: `Exceeds the ${MAX_FILE_BYTES / 1024 / 1024}MB limit.` };
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // Trust the bytes, not the browser-reported MIME type.
  if (!isValidPDFBuffer(buffer)) {
    return { fileName, status: 'failed', error: 'Not a valid PDF file.' };
  }

  // 1. Store the document in R2 first. If this fails we abort the file rather than
  // falling back to a base64 blob in MongoDB.
  const safeFileName = `${Date.now()}-${fileName}`;
  const uploaded = await uploadTenderPDF(buffer, safeFileName);
  if (!uploaded?.key) {
    return { fileName, status: 'failed', error: 'Upload to Cloudflare R2 failed.' };
  }

  // 2. Extract the structured fields. The base64 here is request-scoped only — it is
  // sent to Gemini and never persisted.
  let extracted;
  try {
    const result = await model.generateContent([
      EXTRACTION_PROMPT,
      { inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' } },
    ]);
    extracted = parseAIJson(result.response.text());
  } catch (aiError) {
    console.error(`[bulk-upload] Gemini failed for ${fileName}:`, aiError?.message || aiError);
    return { fileName, status: 'failed', error: `AI extraction failed: ${aiError?.message || 'unknown error'}` };
  }

  if (!extracted) {
    return { fileName, status: 'failed', error: 'AI returned a response that was not valid JSON.' };
  }

  const fields = normaliseExtraction(extracted);

  // 3. Skip anything already waiting in the queue or already live.
  if (fields.bid_no) {
    const [draftExists, tenderExists] = await Promise.all([
      db.collection('ai_draft_tenders').findOne({ bid_no: fields.bid_no }, { projection: { _id: 1 } }),
      db.collection('tenders').findOne({ bid_no: fields.bid_no }, { projection: { _id: 1 } }),
    ]);
    if (draftExists) return { fileName, status: 'duplicate', error: 'Already waiting in drafts.' };
    if (tenderExists) return { fileName, status: 'duplicate', error: 'Already published as a live tender.' };
  }

  const draft = {
    ...fields,
    pdf_url: uploaded.url,
    pdf_r2_key: uploaded.key,
    pdf_filename: fileName,
    status: 'Pending Review',
    uploaded_by: uploadedBy,
    created_at: new Date(),
  };

  const inserted = await db.collection('ai_draft_tenders').insertOne(draft);
  return { fileName, status: 'saved', id: String(inserted.insertedId), bid_no: fields.bid_no || null };
}

// Bounded worker pool — keeps `CONCURRENCY` files in flight without spawning one
// promise per file for a 25-file drop.
async function runPool(items, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await worker(items[index]);
      } catch (err) {
        console.error('[bulk-upload] unexpected worker error:', err);
        results[index] = {
          fileName: items[index]?.name || 'document.pdf',
          status: 'failed',
          error: err?.message || 'Unexpected server error.',
        };
      }
    }
  });

  await Promise.all(runners);
  return results;
}

export async function POST(request) {
  try {
    // Matches the guard used by the rest of the admin surface: the dashboard sends the
    // token issued by /api/system/verify.
    const adminToken = String(process.env.ADMIN_TOKEN || '').trim();
    const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (adminToken && bearer !== adminToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const geminiApiKey = getGeminiApiKey();
    if (!geminiApiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY is not configured on this server.' }, { status: 500 });
    }
    // The whole point of this pipeline is that PDFs live in R2, not MongoDB. Without
    // credentials there is no compliant place to put them, so fail before touching AI.
    if (!isR2Configured()) {
      return NextResponse.json({
        error: 'Cloudflare R2 is not configured on this server. Set CLOUDFLARE_R2_ACCESS_KEY_ID, ' +
               'CLOUDFLARE_R2_SECRET_ACCESS_KEY, CLOUDFLARE_R2_ENDPOINT, CLOUDFLARE_R2_BUCKET_NAME ' +
               '(and CLOUDFLARE_R2_PUBLIC_URL) before using the bulk publisher.',
      }, { status: 503 });
    }

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: 'Expected a multipart/form-data upload.' }, { status: 400 });
    }

    const files = formData.getAll('files').filter(Boolean);
    if (files.length === 0) {
      return NextResponse.json({ error: 'No files were received.' }, { status: 400 });
    }
    if (files.length > MAX_FILES_PER_BATCH) {
      return NextResponse.json(
        { error: `Please upload at most ${MAX_FILES_PER_BATCH} files at a time.` },
        { status: 400 }
      );
    }

    const uploadedBy = String(formData.get('uploadedBy') || 'MD Admin');
    const db = await getDb();
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    // 🚀 FIX: gemini-1.5-flash is retired; gemini-3.6-flash is what this account's
    // GEMINI_API_KEY is actually entitled to (verified live).
    const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

    const results = await runPool(files, (file) => processFile(file, { db, model, uploadedBy }));

    const summary = {
      saved: results.filter((r) => r.status === 'saved').length,
      duplicates: results.filter((r) => r.status === 'duplicate').length,
      failed: results.filter((r) => r.status === 'failed').length,
    };

    return NextResponse.json({ success: true, total: results.length, summary, results });
  } catch (error) {
    console.error('[bulk-upload] fatal error:', error);
    return NextResponse.json({ error: `Server error: ${error?.message || 'unknown'}` }, { status: 500 });
  }
}

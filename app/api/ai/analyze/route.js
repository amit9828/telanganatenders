import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/staff-auth';
import { generateContent, publicAiError } from '@/lib/gemini';
import { EXTRACTION_PROMPT, parseAIJson, normaliseExtraction } from '@/lib/ai-extraction';
import { isValidPDFBuffer } from '@/lib/cloudflare-r2';
import { MIN_EXTRACT_CHARS } from '@/lib/pdf-text';
import { CORE_FAST_FIELDS, EMPTY_FAST_FIELDS, firstPagesText, parseGemCover } from '@/lib/tender-fast-extract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ANALYZE_MAX_BYTES = 3 * 1024 * 1024;

const ANALYZE_PROMPT = `${EXTRACTION_PROMPT}

Also include these extra keys when present (use "N/A" or [] if missing):
"turnover_req": "Turnover required if any, or 'N/A'",
"mandatory_docs": ["Doc 1", "Doc 2"]
`;

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function extraFields(raw) {
  const turnover = String(raw?.turnover_req ?? '').trim();
  const docs = Array.isArray(raw?.mandatory_docs)
    ? raw.mandatory_docs.map((d) => String(d || '').trim()).filter(Boolean)
    : [];
  return {
    turnover_req: turnover && turnover.toUpperCase() !== 'N/A' ? turnover : '',
    mandatory_docs: docs,
  };
}

const FAST_AI_TIMEOUT_MS = 1500;

function raceTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('fast analyze timed out')), ms);
  });
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Pages 1-3 only: GeM labels first, then one short Flash try for whatever is still empty. */
async function fastAnalyze(buffer) {
  let text = '';
  try {
    text = await firstPagesText(buffer);
  } catch (err) {
    console.warn('[ai/analyze] fast text read failed:', err?.message || err);
  }
  if (text.length < MIN_EXTRACT_CHARS) {
    return { success: true, data: { ...EMPTY_FAST_FIELDS }, source: 'none' };
  }

  const data = parseGemCover(text);
  const found = Object.values(data).some(Boolean);
  if (CORE_FAST_FIELDS.every((key) => data[key])) {
    return { success: true, data, source: 'local' };
  }

  try {
    const result = await raceTimeout(generateContent({
      tier: 'flash',
      parts: [EXTRACTION_PROMPT, text],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 256, temperature: 0 },
    }), FAST_AI_TIMEOUT_MS);
    const parsed = parseAIJson(result.text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const ai = normaliseExtraction(parsed);
      for (const key of Object.keys(data)) {
        if (!data[key] && ai[key]) data[key] = ai[key];
      }
      return { success: true, data, source: 'local+ai' };
    }
  } catch (err) {
    console.warn('[ai/analyze] fast AI skipped:', err?.message || err);
  }
  return { success: true, data, source: found ? 'local' : 'none' };
}

async function readUpload(request) {
  const contentType = String(request.headers.get('content-type') || '');
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') {
      return { error: 'PDF file is missing.', status: 400 };
    }
    if (file.size > ANALYZE_MAX_BYTES) {
      return {
        error: `This PDF is ${(file.size / 1024 / 1024).toFixed(1)}MB. Upload a file under 3MB.`,
        status: 413,
      };
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (!isValidPDFBuffer(buffer)) {
      return { error: 'The uploaded file is not a readable PDF.', status: 400 };
    }
    return {
      buffer,
      mode: String(form.get('mode') || ''),
      pdfBase64: buffer.toString('base64'),
      fileName: String(file.name || 'tender.pdf'),
      mimeType: 'application/pdf',
      uploadedBy: String(form.get('uploadedBy') || '').trim(),
      saveToDraft: String(form.get('saveToDraft') || '') === 'true',
    };
  }

  const body = await request.json().catch(() => ({}));
  const pdfBase64 = String(body.pdfBase64 || '').replace(/^data:[^;,]*(;base64)?,/, '');
  if (!pdfBase64) return { error: 'PDF data missing', status: 400 };
  const approxBytes = Math.floor((pdfBase64.length * 3) / 4);
  if (approxBytes > ANALYZE_MAX_BYTES) {
    return { error: 'PDF is too large to analyze over JSON. Upload a file under 3MB.', status: 413 };
  }
  const buffer = Buffer.from(pdfBase64, 'base64');
  if (!isValidPDFBuffer(buffer)) {
    return { error: 'The uploaded file is not a readable PDF.', status: 400 };
  }
  return {
    buffer,
    mode: String(body.mode || ''),
    pdfBase64,
    fileName: String(body.fileName || 'tender.pdf'),
    mimeType: body.mimeType || 'application/pdf',
    uploadedBy: String(body.uploadedBy || '').trim(),
    saveToDraft: Boolean(body.saveToDraft),
  };
}

export async function POST(request) {
  const auth = await requireStaff(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  try {
    const upload = await readUpload(request);
    if (upload.error) return json({ error: upload.error }, upload.status);
    if (upload.mode === 'fast') return json(await fastAnalyze(upload.buffer));

    const { pdfBase64, fileName, mimeType, uploadedBy, saveToDraft } = upload;
    const documentPart = { inlineData: { data: pdfBase64, mimeType: mimeType || 'application/pdf' } };

    let responseText = '';
    try {
      let result;
      try {
        result = await generateContent({
          parts: [ANALYZE_PROMPT, documentPart],
          tier: 'pro',
          generationConfig: { responseMimeType: 'application/json' },
        });
      } catch (jsonModeError) {
        console.warn('[ai/analyze] JSON mime mode failed, retrying without it:', jsonModeError?.message || jsonModeError);
        result = await generateContent({
          parts: [ANALYZE_PROMPT, documentPart],
          tier: 'pro',
        });
      }
      responseText = result.text;
    } catch (aiError) {
      console.error('Gemini API Error:', aiError);
      const safe = publicAiError(aiError);
      return json({ error: safe.message }, safe.status);
    }

    const parsedData = parseAIJson(responseText);
    if (!parsedData || typeof parsedData !== 'object' || Array.isArray(parsedData)) {
      return json({ error: 'AI returned a response that was not valid JSON. Enter details manually.' }, 422);
    }

    const fields = normaliseExtraction(parsedData);
    const extras = extraFields(parsedData);
    const data = { ...parsedData, ...fields, ...extras };

    if (saveToDraft) {
      try {
        const db = await getDb();
        if (data.bid_no) {
          const existing = await db.collection('ai_draft_tenders').findOne(
            { bid_no: data.bid_no },
            { projection: { _id: 1 } },
          );
          if (existing) return json({ error: 'Already exists in drafts' }, 409);
        }
        const draftData = {
          ...data,
          pdf_filename: fileName,
          pdf_base64: pdfBase64,
          status: 'Pending Verification',
          uploaded_by: uploadedBy || 'Admin',
          created_at: new Date(),
        };
        await db.collection('ai_draft_tenders').insertOne(draftData);
        return json({ success: true, data: draftData });
      } catch (dbError) {
        console.error('MongoDB Error:', dbError);
        return json({ error: `Database Error: ${dbError.message}` }, 500);
      }
    }

    return json({ success: true, data });
  } catch (error) {
    console.error('Server Crash:', error);
    return json({ error: `Server Crash: ${error.message}` }, 500);
  }
}

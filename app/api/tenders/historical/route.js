import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/staff-auth';
import { parseAIJson } from '@/lib/ai-extraction';
import {
  HISTORICAL_COLLECTION,
  normaliseHistoricalRow,
  parseCsv,
  summariseBaseline,
} from '@/lib/historical-l1';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_FILES = 10;
const MAX_ROWS_PER_FILE = 200;

const EXTRACTION_PROMPT = `
You are reading a past Indian government tender outcome document (a tender result sheet,
award letter, comparative statement, or AOC).

Extract EVERY awarded tender result you can find. Return STRICTLY a JSON array, nothing
else, where each element is:

{
  "tender_title": "the work / item description",
  "department": "awarding department or organisation",
  "category": "short procurement category, e.g. Housekeeping Services, IT Hardware",
  "l1_price": 0,
  "estimate_value": 0,
  "winner_name": "the L1 / awarded firm",
  "award_year": 2024
}

Rules:
- l1_price and estimate_value must be plain numbers in rupees, with no commas, symbols or
  words. Convert "12.5 Lakh" to 1250000 and "1.2 Cr" to 12000000.
- Use null for any field the document does not state. Never guess a price or a firm name.
- Skip rows that have no awarded price.
- Output raw JSON only. No markdown fences, no commentary.
`;

// Gemini reads PDFs natively; CSV/TSV is passed through as text. XLSX is a zip archive it
// cannot read and there is no spreadsheet parser in this project, so it is refused with
// an actionable message instead of failing obscurely.
function classifyUpload(fileName, buffer) {
  const name = String(fileName || '').toLowerCase();
  const isPdf = buffer.subarray(0, 5).toString('latin1') === '%PDF-';

  if (isPdf) return { kind: 'pdf' };
  if (/\.(csv|tsv|txt)$/.test(name)) return { kind: 'csv' };
  if (/\.(xlsx|xls|ods)$/.test(name)) {
    return { kind: 'unsupported', error: 'Excel files cannot be read directly — please re-save the sheet as CSV and upload that.' };
  }
  if (/\.(png|jpe?g|webp)$/.test(name)) return { kind: 'image', mimeType: name.endsWith('.png') ? 'image/png' : 'image/jpeg' };
  return { kind: 'unsupported', error: 'Unsupported file type. Upload a PDF, a scanned image, or a CSV export.' };
}

async function extractRowsWithAI(model, parts) {
  const result = await model.generateContent([EXTRACTION_PROMPT, ...parts]);
  const parsed = parseAIJson(result.response.text());
  if (Array.isArray(parsed)) return parsed;
  // Models occasionally wrap the array in a key despite the instruction.
  if (parsed && typeof parsed === 'object') {
    const arrayValue = Object.values(parsed).find(Array.isArray);
    if (arrayValue) return arrayValue;
  }
  return [];
}

/**
 * De-duplicates against what is already stored. The same result sheet gets uploaded twice
 * often enough that without this the median discount would drift.
 */
async function insertRows(db, rows, meta) {
  const collection = db.collection(HISTORICAL_COLLECTION);
  let inserted = 0;
  let duplicates = 0;

  for (const row of rows) {
    const existing = await collection.findOne({
      tender_title: row.tender_title,
      l1_price: row.l1_price,
    }, { projection: { _id: 1 } });

    if (existing) { duplicates += 1; continue; }

    await collection.insertOne({ ...row, ...meta });
    inserted += 1;
  }

  return { inserted, duplicates };
}

// GET: list stored benchmarks, optionally filtered, plus the aggregate baseline.
export async function GET(request) {
  try {
    const auth = await requireStaff(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const { searchParams } = new URL(request.url);
    const category = (searchParams.get('category') || '').trim();
    const search = (searchParams.get('search') || '').trim();
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 100, 1), 500);

    const filter = {};
    if (category) filter.category = { $regex: category, $options: 'i' };
    if (search) {
      filter.$or = [
        { tender_title: { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } },
        { winner_name: { $regex: search, $options: 'i' } },
      ];
    }

    const db = await getDb();
    const [records, total, categories] = await Promise.all([
      db.collection(HISTORICAL_COLLECTION).find(filter).sort({ created_at: -1 }).limit(limit).toArray(),
      db.collection(HISTORICAL_COLLECTION).countDocuments(filter),
      db.collection(HISTORICAL_COLLECTION).distinct('category', { category: { $nin: [null, ''] } }),
    ]);

    return NextResponse.json({
      success: true,
      total,
      records: records.map((r) => ({ ...r, _id: String(r._id) })),
      categories: categories.sort(),
      baseline: summariseBaseline(records),
    });
  } catch (error) {
    console.error('[tenders/historical] GET failed:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

// POST: ingest past outcomes, either as uploaded documents or as explicit JSON rows.
export async function POST(request) {
  try {
    const auth = await requireStaff(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const contentType = request.headers.get('content-type') || '';
    const uploadedBy = auth.email || auth.actor;
    const db = await getDb();

    // --- Manual / programmatic rows -------------------------------------------------
    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => null);
      const inputRows = Array.isArray(body?.records) ? body.records : (body?.record ? [body.record] : []);
      if (inputRows.length === 0) {
        return NextResponse.json({ error: 'Provide a `records` array or a single `record`.' }, { status: 400 });
      }

      const normalised = inputRows
        .slice(0, MAX_ROWS_PER_FILE)
        .map((row) => normaliseHistoricalRow(row))
        .filter(Boolean);

      if (normalised.length === 0) {
        return NextResponse.json(
          { error: 'No usable rows. Each record needs at least a tender_title and an l1_price.' },
          { status: 400 }
        );
      }

      const { inserted, duplicates } = await insertRows(db, normalised, { source: 'manual', uploaded_by: uploadedBy });
      return NextResponse.json({ success: true, summary: { inserted, duplicates, rejected: inputRows.length - normalised.length } });
    }

    // --- Document uploads -----------------------------------------------------------
    let formData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: 'Expected a multipart/form-data upload or a JSON body.' }, { status: 400 });
    }

    const files = formData.getAll('files').filter((f) => f && typeof f.arrayBuffer === 'function');
    if (files.length === 0) return NextResponse.json({ error: 'No files were received.' }, { status: 400 });
    if (files.length > MAX_FILES) {
      return NextResponse.json({ error: `Please upload at most ${MAX_FILES} files at a time.` }, { status: 400 });
    }

    const defaultCategory = String(formData.get('category') || '').trim();

    // CSV needs no AI, so only require a key when a document actually has to be read.
    const needsAI = files.some((f) => !/\.(csv|tsv|txt)$/i.test(f.name || ''));
    let model = null;
    if (needsAI) {
      if (!process.env.GEMINI_API_KEY) {
        return NextResponse.json(
          { error: 'GEMINI_API_KEY is not configured, so PDFs cannot be read. Upload a CSV export instead.' },
          { status: 500 }
        );
      }
      // 🚀 FIX: gemini-1.5-flash is retired; gemini-3.6-flash is what this account's
      // GEMINI_API_KEY is actually entitled to (verified live).
      model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ model: 'gemini-3.6-flash' });
    }

    const results = [];
    let totalInserted = 0;
    let totalDuplicates = 0;

    for (const file of files) {
      const fileName = file.name || 'upload';
      try {
        if (file.size > MAX_FILE_BYTES) {
          results.push({ fileName, status: 'failed', error: `File is larger than ${MAX_FILE_BYTES / 1024 / 1024}MB.` });
          continue;
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        if (buffer.length === 0) {
          results.push({ fileName, status: 'failed', error: 'The file is empty.' });
          continue;
        }

        const classified = classifyUpload(fileName, buffer);
        if (classified.kind === 'unsupported') {
          results.push({ fileName, status: 'failed', error: classified.error });
          continue;
        }

        let rawRows = [];
        if (classified.kind === 'csv') {
          rawRows = parseCsv(buffer.toString('utf8'));
          if (rawRows.length === 0) {
            results.push({ fileName, status: 'failed', error: 'No data rows found. The first line must be a header row.' });
            continue;
          }
        } else {
          const mimeType = classified.kind === 'pdf' ? 'application/pdf' : classified.mimeType;
          rawRows = await extractRowsWithAI(model, [
            { inlineData: { data: buffer.toString('base64'), mimeType } },
          ]);
        }

        const normalised = rawRows
          .slice(0, MAX_ROWS_PER_FILE)
          .map((row) => normaliseHistoricalRow(row, { category: defaultCategory }))
          .filter(Boolean);

        if (normalised.length === 0) {
          results.push({
            fileName,
            status: 'failed',
            error: 'No awarded results with a price could be read from this file.',
          });
          continue;
        }

        const { inserted, duplicates } = await insertRows(db, normalised, {
          source: classified.kind === 'csv' ? 'csv_upload' : 'ai_extraction',
          source_file: fileName,
          uploaded_by: uploadedBy,
        });

        totalInserted += inserted;
        totalDuplicates += duplicates;
        results.push({ fileName, status: 'processed', rows_found: normalised.length, inserted, duplicates });
      } catch (fileError) {
        console.error(`[tenders/historical] ${fileName} failed:`, fileError?.message || fileError);
        results.push({ fileName, status: 'failed', error: fileError?.message || 'Unexpected error while reading the file.' });
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        files: files.length,
        inserted: totalInserted,
        duplicates: totalDuplicates,
        failed: results.filter((r) => r.status === 'failed').length,
      },
      results,
    });
  } catch (error) {
    console.error('[tenders/historical] POST failed:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

// DELETE: remove a mis-read benchmark row so it stops skewing predictions.
export async function DELETE(request) {
  try {
    const auth = await requireStaff(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const id = (new URL(request.url).searchParams.get('id') || '').trim();
    if (!ObjectId.isValid(id)) return NextResponse.json({ error: 'A valid id is required.' }, { status: 400 });

    const db = await getDb();
    const { deletedCount } = await db.collection(HISTORICAL_COLLECTION).deleteOne({ _id: new ObjectId(id) });
    if (deletedCount === 0) return NextResponse.json({ error: 'Record not found.' }, { status: 404 });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[tenders/historical] DELETE failed:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

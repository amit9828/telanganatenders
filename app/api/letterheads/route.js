import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { requireDashboardStaff } from '@/lib/staff-auth';
import {
  isR2Configured,
  isValidPDFBuffer,
  uploadLetterheadTemplate,
} from '@/lib/cloudflare-r2';
import { LETTERHEAD_COLLECTION } from '@/lib/letterhead-compose';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 🚀 FIX: Vercel hard-caps the whole serverless request body at ~4.5MB regardless of
// what this constant says — a file between 4.5MB and the old 8MB limit was rejected by
// the platform with an opaque 413 before this handler ever ran. 4MB (still multipart,
// no base64 inflation) leaves a safe margin under that ceiling.
const MAX_ASSET_BYTES = 4 * 1024 * 1024;

function sniffType(buffer) {
  const hex = Buffer.from(buffer.subarray(0, 12)).toString('hex');
  if (hex.startsWith('25504446')) return { kind: 'pdf', contentType: 'application/pdf' };
  if (hex.startsWith('89504e470d0a1a0a')) return { kind: 'image', contentType: 'image/png' };
  if (hex.startsWith('ffd8ff')) return { kind: 'image', contentType: 'image/jpeg' };
  return null;
}

export async function GET(request) {
  const auth = await requireDashboardStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const db = await getDb();
    await db.collection(LETTERHEAD_COLLECTION).createIndex({ created_at: -1 }).catch(() => {});
    const docs = await db.collection(LETTERHEAD_COLLECTION)
      .find({})
      .sort({ created_at: -1 })
      .limit(80)
      .project({ r2_url: 0 })
      .toArray();

    return NextResponse.json({
      letterheads: docs.map((d) => ({
        id: String(d._id),
        name: d.name,
        kind: d.kind,
        content_type: d.content_type,
        original_filename: d.original_filename,
        created_at: d.created_at,
        uploaded_by: d.uploaded_by || null,
        preview_url: `/api/letterheads/file?id=${String(d._id)}`,
      })),
    });
  } catch (error) {
    console.error('[letterheads] GET failed:', error);
    return NextResponse.json({ error: error?.message || 'Failed to list letterheads.' }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await requireDashboardStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!isR2Configured()) {
    return NextResponse.json({
      error: 'Cloudflare R2 is not configured, so letterheads cannot be stored.',
    }, { status: 503 });
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a multipart/form-data upload.' }, { status: 400 });
  }

  const file = formData.get('file');
  const name = String(formData.get('name') || file?.name || 'Letterhead').trim().slice(0, 120);

  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'No letterhead file was received.' }, { status: 400 });
  }
  if (file.size > MAX_ASSET_BYTES) {
    return NextResponse.json({ error: `File exceeds the ${MAX_ASSET_BYTES / 1024 / 1024}MB limit.` }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sniffed = sniffType(buffer);
  if (!sniffed) {
    return NextResponse.json({
      error: 'Letterhead must be a PNG, JPEG image or a PDF template.',
    }, { status: 400 });
  }
  if (sniffed.kind === 'pdf' && !isValidPDFBuffer(buffer)) {
    return NextResponse.json({ error: 'That PDF is not valid.' }, { status: 400 });
  }

  const uploaded = await uploadLetterheadTemplate(
    buffer,
    file.name || `${name}.${sniffed.kind === 'pdf' ? 'pdf' : 'png'}`,
    sniffed.contentType,
  );
  if (!uploaded?.key) {
    return NextResponse.json({ error: 'Upload to Cloudflare R2 failed.' }, { status: 502 });
  }

  const db = await getDb();
  const doc = {
    name,
    kind: sniffed.kind,
    content_type: sniffed.contentType,
    original_filename: file.name || name,
    r2_key: uploaded.key,
    r2_url: uploaded.url,
    uploaded_by: auth.email || auth.actor,
    created_at: new Date(),
    updated_at: new Date(),
  };
  const result = await db.collection(LETTERHEAD_COLLECTION).insertOne(doc);

  return NextResponse.json({
    success: true,
    letterhead: {
      id: String(result.insertedId),
      name: doc.name,
      kind: doc.kind,
      content_type: doc.content_type,
      original_filename: doc.original_filename,
      preview_url: `/api/letterheads/file?id=${String(result.insertedId)}`,
    },
  });
}

export async function DELETE(request) {
  const auth = await requireDashboardStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const id = (new URL(request.url).searchParams.get('id') || '').trim();
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'A valid letterhead id is required.' }, { status: 400 });
  }

  const db = await getDb();
  await db.collection(LETTERHEAD_COLLECTION).deleteOne({ _id: new ObjectId(id) });
  return NextResponse.json({ success: true });
}

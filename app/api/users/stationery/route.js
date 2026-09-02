import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/staff-auth';
import {
  isR2Configured,
  isStationeryUsable,
  STATIONERY_KINDS,
  uploadStationeryAsset,
} from '@/lib/cloudflare-r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Vercel caps a serverless request body at ~4.5MB. A letterhead scan or signature PNG
// should be far smaller than this; anything larger is a full-resolution scan that would
// bloat every generated document anyway.
const MAX_ASSET_BYTES = 3 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

// Trust the bytes, not the browser-declared MIME type.
function sniffImageType(buffer) {
  const hex = Buffer.from(buffer.subarray(0, 12)).toString('hex');
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('52494646') && Buffer.from(buffer.subarray(8, 12)).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

// GET: current stationery for one client.
export async function GET(request) {
  const auth = await requireStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const email = (new URL(request.url).searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return NextResponse.json({ error: 'email is required.' }, { status: 400 });

  try {
    const db = await getDb();
    const user = await db.collection('users').findOne(
      { email },
      { projection: { email: 1, company_name: 1, letterhead_url: 1, signature_url: 1, stationery_updated_at: 1 } }
    );
    if (!user) return NextResponse.json({ error: 'Client not found.' }, { status: 404 });

    return NextResponse.json({
      email: user.email,
      company_name: user.company_name || null,
      letterhead_url: user.letterhead_url || null,
      signature_url: user.signature_url || null,
      stationery_updated_at: user.stationery_updated_at || null,
      publicly_servable: isStationeryUsable(),
    });
  } catch (error) {
    console.error('[users/stationery] GET failed:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

// POST: upload a letterhead background or a signature/stamp image.
export async function POST(request) {
  const auth = await requireStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    if (!isR2Configured()) {
      return NextResponse.json({
        error: 'Cloudflare R2 is not configured on this server, so stationery cannot be stored.',
      }, { status: 503 });
    }

    let formData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: 'Expected a multipart/form-data upload.' }, { status: 400 });
    }

    const file = formData.get('file');
    const email = String(formData.get('email') || '').trim().toLowerCase();
    const kind = String(formData.get('kind') || '').trim().toLowerCase();

    if (!email) return NextResponse.json({ error: 'email is required.' }, { status: 400 });
    if (!STATIONERY_KINDS.includes(kind)) {
      return NextResponse.json(
        { error: `kind must be one of: ${STATIONERY_KINDS.join(', ')}.` },
        { status: 400 }
      );
    }
    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'No file was received.' }, { status: 400 });
    }
    if (file.size === 0) return NextResponse.json({ error: 'The selected file is empty.' }, { status: 400 });
    if (file.size > MAX_ASSET_BYTES) {
      return NextResponse.json({
        error: `This image is ${(file.size / 1024 / 1024).toFixed(1)}MB. The maximum is ` +
               `${MAX_ASSET_BYTES / 1024 / 1024}MB — please export it at a lower resolution.`,
      }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const contentType = sniffImageType(buffer);
    if (!contentType || !ALLOWED_IMAGE_TYPES[contentType]) {
      return NextResponse.json({
        error: 'Stationery must be a PNG, JPEG or WebP image. A transparent PNG works best for signatures.',
      }, { status: 400 });
    }

    const db = await getDb();
    const client = await db.collection('users').findOne({ email }, { projection: { _id: 1 } });
    if (!client) return NextResponse.json({ error: 'Client not found.' }, { status: 404 });

    const uploaded = await uploadStationeryAsset(buffer, file.name || `${kind}.png`, { email, kind, contentType });
    if (!uploaded?.key) {
      return NextResponse.json({ error: 'Upload to secure storage failed. Please retry.' }, { status: 502 });
    }

    const field = kind === 'letterhead' ? 'letterhead_url' : 'signature_url';
    await db.collection('users').updateOne(
      { email },
      {
        $set: {
          [field]: uploaded.url,
          [`${field.replace('_url', '')}_r2_key`]: uploaded.key,
          stationery_updated_at: new Date(),
          stationery_updated_by: auth.email || auth.actor,
        },
      }
    );

    return NextResponse.json({
      success: true,
      kind,
      url: uploaded.url,
      // A URL on the private S3 endpoint will not render in an <img>; tell the caller so
      // it can warn rather than showing a broken image in the document preview.
      publicly_servable: isStationeryUsable(),
      warning: isStationeryUsable()
        ? null
        : 'CLOUDFLARE_R2_PUBLIC_URL is not set, so this image will not display in generated ' +
          'documents until a public bucket domain is configured.',
    });
  } catch (error) {
    console.error('[users/stationery] POST failed:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

// DELETE: clear one stationery slot (the object is left in R2 for audit).
export async function DELETE(request) {
  const auth = await requireStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(request.url);
    const email = (searchParams.get('email') || '').trim().toLowerCase();
    const kind = (searchParams.get('kind') || '').trim().toLowerCase();

    if (!email) return NextResponse.json({ error: 'email is required.' }, { status: 400 });
    if (!STATIONERY_KINDS.includes(kind)) {
      return NextResponse.json({ error: `kind must be one of: ${STATIONERY_KINDS.join(', ')}.` }, { status: 400 });
    }

    const field = kind === 'letterhead' ? 'letterhead_url' : 'signature_url';
    const db = await getDb();
    await db.collection('users').updateOne(
      { email },
      { $unset: { [field]: '', [`${field.replace('_url', '')}_r2_key`]: '' } }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[users/stationery] DELETE failed:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { fetchR2Buffer, fetchObjectByKey } from '@/lib/cloudflare-r2';
import { brandFileId, brandObjectKey, fetchBrandFileById } from '@/lib/brand-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_KEY = /^brand\/[A-Za-z0-9._-]+$/;

function sniffImageType(buffer, fallback = 'application/octet-stream') {
  if (!buffer || buffer.length < 12) return fallback;
  const hex = Buffer.from(buffer.subarray(0, 12)).toString('hex');
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('47494638')) return 'image/gif';
  if (hex.startsWith('52494646') && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return fallback;
}

function imageResponse(buffer, mime) {
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': sniffImageType(buffer, mime || 'application/octet-stream'),
      'Content-Length': String(buffer.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

export async function GET(request) {
  const idRaw = request.nextUrl.searchParams.get('id') || '';
  const keyRaw = request.nextUrl.searchParams.get('key') || '';

  if (idRaw) {
    const id = brandFileId(idRaw);
    if (!id) {
      return NextResponse.json({ error: 'Invalid brand file key.' }, { status: 400 });
    }
    const file = await fetchBrandFileById(id);
    if (!file?.buffer?.length) {
      return NextResponse.json({ error: 'Brand file not found.' }, { status: 404 });
    }
    return imageResponse(file.buffer, file.mime);
  }

  const key = brandObjectKey(keyRaw);
  if (!key || !ALLOWED_KEY.test(key)) {
    return NextResponse.json({ error: 'Invalid brand file key.' }, { status: 400 });
  }

  let buffer = await fetchR2Buffer(key);
  if (!buffer?.length) {
    const fetched = await fetchObjectByKey(key);
    buffer = fetched?.buffer || null;
  }
  if (!buffer?.length) {
    return NextResponse.json({ error: 'Brand file not found.' }, { status: 404 });
  }

  return imageResponse(buffer);
}

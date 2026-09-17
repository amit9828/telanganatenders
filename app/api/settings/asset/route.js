import { NextResponse } from 'next/server';
import { requireDashboardStaff } from '@/lib/staff-auth';
import { persistUploadedFile, MAX_BRAND_IMAGE_BYTES } from '@/lib/brand-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

function json(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

export async function POST(request) {
  const auth = await requireDashboardStaff(request);
  if (!auth.ok) return json({ error: auth.error || 'Please sign in.' }, auth.status || 401);

  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return json({ error: 'Image must be sent as multipart/form-data.' }, 415);
    }

    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
      return json({ error: 'Choose an image to upload.' }, 400);
    }
    if (typeof file.size === 'number' && file.size > MAX_BRAND_IMAGE_BYTES) {
      return json({ error: 'Image size must be under 2MB' }, 413);
    }
    if (file.type && !String(file.type).startsWith('image/')) {
      return json({ error: 'Please upload an image file' }, 400);
    }

    const url = await persistUploadedFile(file, file.name || 'asset.png');
    if (!url) return json({ error: 'Could not store the image.' }, 500);
    return json({ success: true, url });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return json({ error: error?.message || 'Failed to upload image' }, status);
  }
}

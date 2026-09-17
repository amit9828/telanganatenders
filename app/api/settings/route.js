import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { brandFieldsFromForm, MAX_BRAND_IMAGE_BYTES } from '@/lib/brand-settings';

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

export async function GET() {
  try {
    const db = await getDb();
    const settings = await db.collection('settings').findOne({ id: 'brand' });
    return json({ settings: settings || { name: 'Telangana Tenders', logo: null } });
  } catch (error) {
    return json({ error: error?.message || 'Failed to load settings' }, 500);
  }
}

export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return json({ error: 'Settings must be sent as multipart/form-data, not JSON.' }, 415);
    }

    const form = await request.formData();
    for (const value of form.values()) {
      if (value && typeof value !== 'string' && typeof value.size === 'number' && value.size > MAX_BRAND_IMAGE_BYTES) {
        return json({ error: 'Image size must be under 2MB' }, 413);
      }
    }

    const db = await getDb();
    const existing = await db.collection('settings').findOne({ id: 'brand' }) || {};
    const $set = await brandFieldsFromForm(form, existing);
    await db.collection('settings').updateOne({ id: 'brand' }, { $set }, { upsert: true });
    return json({ success: true });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return json({ error: error?.message || 'Failed to save settings' }, status);
  }
}

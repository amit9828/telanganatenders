import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireDashboardStaff } from '@/lib/staff-auth';
import { brandFieldsFromForm, brandFieldsFromJson, sanitizeSettingsForBrowser } from '@/lib/brand-settings';

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
    return json({
      settings: sanitizeSettingsForBrowser(settings) || { name: 'Telangana Tenders', logo: null },
    });
  } catch (error) {
    return json({ error: error?.message || 'Failed to load settings' }, 500);
  }
}

export async function POST(request) {
  const auth = await requireDashboardStaff(request);
  if (!auth.ok) return json({ error: auth.error || 'Please sign in.' }, auth.status || 401);

  try {
    const contentType = request.headers.get('content-type') || '';
    const db = await getDb();
    const existing = await db.collection('settings').findOne({ id: 'brand' }) || {};
    let $set;

    if (contentType.includes('application/json')) {
      const body = await request.json();
      $set = await brandFieldsFromJson(body, existing);
    } else if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      for (const value of form.values()) {
        if (value && typeof value !== 'string') {
          return json({ error: 'Upload each image separately first, then save settings.' }, 400);
        }
      }
      $set = await brandFieldsFromForm(form, existing);
    } else {
      return json({ error: 'Settings must be sent as JSON.' }, 415);
    }

    await db.collection('settings').updateOne({ id: 'brand' }, { $set }, { upsert: true });
    return json({ success: true });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return json({ error: error?.message || 'Failed to save settings' }, status);
  }
}

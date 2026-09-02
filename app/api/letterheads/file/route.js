import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { requireDashboardStaff } from '@/lib/staff-auth';
import { fetchStationeryBuffer } from '@/lib/cloudflare-r2';
import { LETTERHEAD_COLLECTION } from '@/lib/letterhead-compose';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const auth = await requireDashboardStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const id = (new URL(request.url).searchParams.get('id') || '').trim();
  if (!id || !ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  }

  try {
    const db = await getDb();
    const doc = await db.collection(LETTERHEAD_COLLECTION).findOne({ _id: new ObjectId(id) });
    if (!doc) return NextResponse.json({ error: 'Letterhead not found.' }, { status: 404 });

    const fetched = await fetchStationeryBuffer({
      file_url: doc.r2_url,
      file_r2_key: doc.r2_key,
    });
    if (!fetched?.buffer) {
      return NextResponse.json({ error: 'Letterhead file is missing from storage.' }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(fetched.buffer), {
      status: 200,
      headers: {
        'Content-Type': doc.content_type || fetched.contentType || 'application/octet-stream',
        'Content-Length': String(fetched.buffer.length),
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[letterheads/file] GET failed:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

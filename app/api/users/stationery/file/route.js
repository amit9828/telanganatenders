import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/staff-auth';
import { STATIONERY_KINDS, fetchStationeryBuffer } from '@/lib/cloudflare-r2';

export const dynamic = 'force-dynamic';

// Streams a client's letterhead or signature so the dashboard preview can render it
// without depending on a public R2 domain. Print still prefers data URLs inlined by
// /api/ai/generate-doc; this route is for the stationery uploader preview.
export async function GET(request) {
  const auth = await requireStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const email = (searchParams.get('email') || '').trim().toLowerCase();
  const kind = (searchParams.get('kind') || '').trim().toLowerCase();

  if (!email) return NextResponse.json({ error: 'email is required.' }, { status: 400 });
  if (!STATIONERY_KINDS.includes(kind)) {
    return NextResponse.json({ error: `kind must be one of: ${STATIONERY_KINDS.join(', ')}.` }, { status: 400 });
  }

  try {
    const db = await getDb();
    const user = await db.collection('users').findOne(
      { email },
      { projection: { letterhead_url: 1, letterhead_r2_key: 1, signature_url: 1, signature_r2_key: 1 } }
    );
    if (!user) return NextResponse.json({ error: 'Client not found.' }, { status: 404 });

    const url = kind === 'letterhead' ? user.letterhead_url : user.signature_url;
    const r2Key = kind === 'letterhead' ? user.letterhead_r2_key : user.signature_r2_key;
    const fetched = await fetchStationeryBuffer({ file_url: url, file_r2_key: r2Key });
    if (!fetched?.buffer) {
      return NextResponse.json({ error: 'No stationery file is stored for this slot.' }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(fetched.buffer), {
      status: 200,
      headers: {
        'Content-Type': fetched.contentType || 'image/png',
        'Content-Length': String(fetched.buffer.length),
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[users/stationery/file] GET failed:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

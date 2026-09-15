import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { resolveActorRole } from '@/lib/staff-auth';
import { fetchR2Buffer } from '@/lib/cloudflare-r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function senderId(actor) {
  if (actor?.role === 'MD') return 'MD';
  return String(actor?.empId || '').trim();
}

export async function GET(request) {
  const actor = await resolveActorRole(request);
  if (!actor.role) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const from = senderId(actor);
  if (!from) return NextResponse.json({ error: 'Employee ID required.' }, { status: 401 });
  const id = String(request.nextUrl.searchParams.get('id') || '').trim();
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = await getDb();
  const doc = await db.collection('staff_chats').findOne({ _id: new ObjectId(id) });
  if (!doc?.file_r2_key) return NextResponse.json({ error: 'File not found.' }, { status: 404 });
  if (doc.from_emp_id !== from && doc.to_emp_id !== from) {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  }

  const buf = await fetchR2Buffer(doc.file_r2_key);
  if (!buf) return NextResponse.json({ error: 'Could not read file.' }, { status: 500 });
  const name = encodeURIComponent(doc.file_name || 'attachment');
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `inline; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

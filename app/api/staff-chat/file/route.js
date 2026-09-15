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

function mimeFromName(name, stored) {
  if (stored && stored !== 'application/octet-stream') return stored;
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.gif')) return 'image/gif';
  if (n.endsWith('.webp')) return 'image/webp';
  return stored || 'application/octet-stream';
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
  const contentType = mimeFromName(doc.file_name, doc.file_content_type);
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

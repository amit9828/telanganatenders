import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { resolveActorRole } from '@/lib/staff-auth';
import { chatSenderId, fetchChatFileBuffer, mimeFromName } from '@/lib/staff-chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const actor = await resolveActorRole(request);
  if (!actor.role) return NextResponse.json({ error: 'Please sign in.' }, { status: 401 });
  const from = chatSenderId(actor);
  if (!from) return NextResponse.json({ error: 'Employee ID required.' }, { status: 401 });
  const id = String(request.nextUrl.searchParams.get('id') || '').trim();
  if (!id || !ObjectId.isValid(id)) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = await getDb();
  const doc = await db.collection('staff_chats').findOne({ _id: new ObjectId(id) });
  if (!doc) return NextResponse.json({ error: 'File not found.' }, { status: 404 });
  if (doc.from_emp_id !== from && doc.to_emp_id !== from) {
    return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
  }

  const stored = await fetchChatFileBuffer(doc);
  if (!stored?.buffer?.length) return NextResponse.json({ error: 'Could not read file.' }, { status: 500 });
  const name = encodeURIComponent(doc.file_name || 'attachment');
  const contentType = stored.mime || mimeFromName(doc.file_name, doc.file_content_type);
  const download = request.nextUrl.searchParams.get('download') === '1';
  return new NextResponse(new Uint8Array(stored.buffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}

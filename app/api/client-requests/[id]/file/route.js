import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveActorRole, resolveClientEmail, isGmActor } from '@/lib/staff-auth';
import { asRequestObjectId, fetchClientRequestFileBuffer } from '@/lib/client-requests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function sniffContentType(buffer, fileName = '') {
  const head = Buffer.from(buffer.subarray(0, 12));
  const hex = head.toString('hex');
  if (head.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  if (hex.startsWith('504b0304')) return 'application/zip';
  if (/\.pdf$/i.test(fileName)) return 'application/pdf';
  if (/\.zip$/i.test(fileName)) return 'application/zip';
  return 'application/octet-stream';
}

export async function GET(request, { params }) {
  const id = asRequestObjectId(params?.id);
  if (!id) return NextResponse.json({ error: 'Invalid Request ID' }, { status: 400 });

  const actor = await resolveActorRole(request);
  const canStaff = actor.role === 'MD' || isGmActor(actor);
  const clientEmail = canStaff ? null : await resolveClientEmail(request);

  const db = await getDb();
  const doc = await db.collection('client_requests').findOne({ _id: id });
  if (!doc) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });

  if (!canStaff) {
    const owner = String(doc.client_email || '').toLowerCase();
    if (!clientEmail || clientEmail !== owner) {
      return NextResponse.json({ error: 'Not allowed.' }, { status: 403 });
    }
  }

  const buffer = await fetchClientRequestFileBuffer(doc);
  if (!buffer?.length) {
    return NextResponse.json({ error: 'No document is attached to this request.' }, { status: 404 });
  }

  const fileName = doc.file_name || 'attachment.pdf';
  const contentType = doc.file_content_type || sniffContentType(buffer, fileName);
  const inline = contentType === 'application/pdf' || String(contentType).startsWith('image/');
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(fileName)}"`,
      'Content-Length': String(buffer.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

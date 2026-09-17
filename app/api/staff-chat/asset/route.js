import { NextResponse } from 'next/server';
import { resolveActorRole } from '@/lib/staff-auth';
import {
  CHAT_MAX_BYTES,
  chatSenderId,
  isAllowedChatFile,
  mimeFromName,
  storeChatBuffer,
} from '@/lib/staff-chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

export async function POST(request) {
  const actor = await resolveActorRole(request);
  if (!actor.role) return json({ error: 'Please sign in.' }, 401);
  const from = chatSenderId(actor);
  if (!from) return json({ error: 'Staff chat requires an Employee ID.' }, 401);

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return json({ error: 'File must be sent as multipart/form-data.' }, 415);
  }

  const form = await request.formData();
  const file = form.get('file');
  const toEmpId = String(form.get('to_emp_id') || '').trim();
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') {
    return json({ error: 'Choose a file to send.' }, 400);
  }
  if (typeof file.size === 'number' && file.size > CHAT_MAX_BYTES) {
    return json({ error: 'File must be 4 MB or smaller.' }, 413);
  }
  const mime = file.type || mimeFromName(file.name);
  if (!isAllowedChatFile(mime, file.name, file.size)) {
    return json({ error: 'Send an image or PDF under 4 MB.' }, 400);
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!buffer.length) return json({ error: 'The attached file was empty.' }, 400);

  try {
    const stored = await storeChatBuffer(buffer, { name: file.name, mime, from, toEmpId });
    if (!stored?.mongo_id) return json({ error: 'Could not store the file.' }, 500);
    return json({
      success: true,
      file_id: String(stored.mongo_id),
      name: stored.name,
      content_type: stored.content_type,
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return json({ error: error?.message || 'Upload failed.' }, status);
  }
}

import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { resolveActorRole } from '@/lib/staff-auth';
import { ensureWorkflowIndexes } from '@/lib/workflow';
import { uploadWorkflowDocument, deleteR2Key } from '@/lib/cloudflare-r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function threadKey(a, b) {
  return [String(a || ''), String(b || '')].sort().join('::');
}

function senderId(actor) {
  if (actor?.role === 'MD') return 'MD';
  return String(actor?.empId || '').trim();
}

async function actorOr401(request) {
  const actor = await resolveActorRole(request);
  if (!actor.role) return { error: json({ error: 'Please sign in.' }, 401) };
  const from = senderId(actor);
  if (!from) return { error: json({ error: 'Staff chat requires an Employee ID.' }, 401) };
  return { actor, from };
}

export async function GET(request) {
  const gate = await actorOr401(request);
  if (gate.error) return gate.error;
  const { from } = gate;
  const peer = String(request.nextUrl.searchParams.get('peer') || '').trim();
  const jobId = String(request.nextUrl.searchParams.get('job_id') || '').trim();
  const db = await getDb();
  await ensureWorkflowIndexes(db);

  if (!peer) {
    const recent = await db.collection('staff_chats').find({
      $or: [{ from_emp_id: from }, { to_emp_id: from }],
    }).sort({ created_at: -1 }).limit(200).toArray();
    return json({ messages: recent });
  }

  const key = threadKey(from, peer);
  const filter = {
    thread_key: key,
    $or: [{ from_emp_id: from }, { to_emp_id: from }],
  };
  if (jobId) filter.job_id = jobId;
  const messages = await db.collection('staff_chats').find(filter).sort({ created_at: 1 }).toArray();
  return json({ messages, thread_key: key });
}

export async function POST(request) {
  const gate = await actorOr401(request);
  if (gate.error) return gate.error;
  const { actor, from } = gate;
  const db = await getDb();
  await ensureWorkflowIndexes(db);

  const contentType = request.headers.get('content-type') || '';
  let toEmpId = '';
  let text = '';
  let jobId = '';
  let forwardedFromId = '';
  let hadFile = false;
  let fileMeta = null;

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    toEmpId = String(form.get('to_emp_id') || '').trim();
    text = String(form.get('text') || form.get('body') || '').trim();
    jobId = String(form.get('job_id') || '').trim();
    forwardedFromId = String(form.get('forwarded_from_id') || '').trim();
    const file = form.get('file');
    if (file && typeof file !== 'string' && file.arrayBuffer) {
      hadFile = true;
      const buf = Buffer.from(await file.arrayBuffer());
      if (buf.length) {
        const uploaded = await uploadWorkflowDocument(buf, file.name || 'chat.bin', {
          jobId: `chat_${threadKey(from, toEmpId)}`,
          contentType: file.type || 'application/octet-stream',
        });
        if (!uploaded) return json({ error: 'File upload failed. Try again.' }, 400);
        fileMeta = { r2_key: uploaded.key, url: uploaded.url, name: file.name };
      }
    }
  } else {
    const body = await request.json().catch(() => ({}));
    toEmpId = String(body.to_emp_id || '').trim();
    text = String(body.text || body.body || '').trim();
    jobId = String(body.job_id || '').trim();
    forwardedFromId = String(body.forwarded_from_id || '').trim();
  }

  if (!toEmpId) return json({ error: 'to_emp_id is required' }, 400);
  if (toEmpId === from) return json({ error: 'Cannot message yourself.' }, 400);

  let forwardedFrom = null;
  if (forwardedFromId && ObjectId.isValid(forwardedFromId)) {
    const original = await db.collection('staff_chats').findOne({ _id: new ObjectId(forwardedFromId) });
    if (!original) return json({ error: 'Original message not found.' }, 404);
    const involved = original.from_emp_id === from || original.to_emp_id === from;
    if (!involved) return json({ error: 'You can only forward messages from your own threads.' }, 403);
    forwardedFrom = {
      id: String(original._id),
      from_emp_id: original.from_emp_id,
      from_name: original.from_name,
      text: original.text,
      file_name: original.file_name,
    };
    if (!text) text = original.text || '';
    if (!fileMeta && original.file_r2_key) {
      fileMeta = { r2_key: original.file_r2_key, url: original.file_url, name: original.file_name };
    }
  }

  if (hadFile && !fileMeta) return json({ error: 'File upload failed. Try again.' }, 400);
  if (!text && !fileMeta) return json({ error: 'Message or file required' }, 400);

  const doc = {
    thread_key: threadKey(from, toEmpId),
    job_id: jobId || null,
    from_emp_id: from,
    from_name: actor.role === 'MD' ? (actor.name || 'Managing Director') : (actor.name || from),
    to_emp_id: toEmpId,
    text,
    file_r2_key: fileMeta?.r2_key || null,
    file_url: fileMeta?.url || null,
    file_name: fileMeta?.name || null,
    forwarded_from: forwardedFrom,
    created_at: new Date(),
  };
  const result = await db.collection('staff_chats').insertOne(doc);
  return json({ success: true, message: { ...doc, _id: result.insertedId } }, 201);
}

export async function PATCH(request) {
  const gate = await actorOr401(request);
  if (gate.error) return gate.error;
  const { from } = gate;
  const body = await request.json().catch(() => ({}));
  const id = String(body.id || '').trim();
  const text = String(body.text || '').trim();
  if (!id || !ObjectId.isValid(id)) return json({ error: 'id required' }, 400);
  if (!text) return json({ error: 'text required' }, 400);
  const db = await getDb();
  const doc = await db.collection('staff_chats').findOne({ _id: new ObjectId(id) });
  if (!doc) return json({ error: 'Message not found' }, 404);
  if (doc.from_emp_id !== from) return json({ error: 'You can only edit your own messages.' }, 403);
  await db.collection('staff_chats').updateOne(
    { _id: doc._id },
    { $set: { text, edited_at: new Date() } },
  );
  return json({ success: true });
}

export async function DELETE(request) {
  const gate = await actorOr401(request);
  if (gate.error) return gate.error;
  const { from } = gate;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return json({ error: 'id required' }, 400);
  const db = await getDb();
  const doc = await db.collection('staff_chats').findOne({ _id: new ObjectId(id) });
  if (!doc) return json({ error: 'Message not found' }, 404);
  if (doc.from_emp_id !== from) return json({ error: 'You can only delete your own messages.' }, 403);
  if (doc.file_r2_key) await deleteR2Key(doc.file_r2_key);
  await db.collection('staff_chats').deleteOne({ _id: doc._id });
  return json({ success: true });
}

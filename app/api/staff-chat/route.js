import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { resolveActorRole } from '@/lib/staff-auth';
import { ensureWorkflowIndexes } from '@/lib/workflow';
import {
  assertLivePeer,
  chatSenderId,
  cloneChatFile,
  ensureStaffChatIndexes,
  fileMetaOnMessage,
  isAllowedChatFile,
  loadChatFileMeta,
  markThreadRead,
  mimeFromName,
  pairFilter,
  peerReadAt,
  peerTyping,
  presenceMap,
  publicChatMessage,
  readsForInbox,
  releaseChatFile,
  setTyping,
  storeChatBuffer,
  threadKey,
  touchPresence,
} from '@/lib/staff-chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
}

async function actorOr401(request) {
  const actor = await resolveActorRole(request);
  if (!actor.role) return { error: json({ error: 'Please sign in.' }, 401) };
  const from = chatSenderId(actor);
  if (!from) return { error: json({ error: 'Staff chat requires an Employee ID.' }, 401) };
  return { actor, from };
}

async function readyDb() {
  const db = await getDb();
  await ensureWorkflowIndexes(db);
  await ensureStaffChatIndexes(db);
  return db;
}

export async function GET(request) {
  const gate = await actorOr401(request);
  if (gate.error) return gate.error;
  const { from } = gate;
  const peer = String(request.nextUrl.searchParams.get('peer') || '').trim();
  const jobId = String(request.nextUrl.searchParams.get('job_id') || '').trim();
  const db = await readyDb();
  await touchPresence(db, from);

  if (!peer) {
    const recent = await db.collection('staff_chats').find({
      $or: [{ from_emp_id: from }, { to_emp_id: from }],
    }).project({ file_base64: 0, file_url: 0 }).sort({ created_at: -1 }).limit(200).toArray();
    const messages = recent.map(publicChatMessage);
    const ids = messages.flatMap((m) => [m.from_emp_id, m.to_emp_id]);
    return json({
      me: from,
      messages,
      reads: await readsForInbox(db, from, recent),
      presence: await presenceMap(db, ids),
    });
  }

  const key = threadKey(from, peer);
  const filter = { thread_key: key, ...pairFilter(from, peer) };
  if (jobId) filter.job_id = jobId;
  const messages = await db.collection('staff_chats').find(filter)
    .project({ file_base64: 0, file_url: 0 })
    .sort({ created_at: 1 })
    .toArray();
  return json({
    me: from,
    messages: messages.map(publicChatMessage),
    thread_key: key,
    peer_read_at: await peerReadAt(db, from, peer),
    peer_typing: await peerTyping(db, from, peer),
    presence: await presenceMap(db, [peer, from]),
  });
}

export async function POST(request) {
  const gate = await actorOr401(request);
  if (gate.error) return gate.error;
  const { actor, from } = gate;
  const db = await readyDb();
  await touchPresence(db, from);

  const contentType = request.headers.get('content-type') || '';
  let toEmpId = '';
  let text = '';
  let jobId = '';
  let forwardedFromId = '';
  let fileId = '';
  let typing = null;
  let hadFile = false;
  let fileMeta = null;

  if (contentType.includes('application/json')) {
    const body = await request.json().catch(() => ({}));
    toEmpId = String(body.to_emp_id || body.peer || '').trim();
    text = String(body.text || body.body || '').trim();
    jobId = String(body.job_id || '').trim();
    forwardedFromId = String(body.forwarded_from_id || '').trim();
    fileId = String(body.file_id || '').trim();
    if (body.typing != null) typing = Boolean(body.typing);
  } else {
    const form = await request.formData().catch(() => null);
    if (!form) return json({ error: 'Invalid body.' }, 400);
    toEmpId = String(form.get('to_emp_id') || form.get('peer') || '').trim();
    text = String(form.get('text') || form.get('body') || '').trim();
    jobId = String(form.get('job_id') || '').trim();
    forwardedFromId = String(form.get('forwarded_from_id') || '').trim();
    fileId = String(form.get('file_id') || '').trim();
    const file = form.get('file');
    if (file && typeof file !== 'string') {
      hadFile = true;
      const buf = Buffer.from(await file.arrayBuffer());
      if (!buf.length) return json({ error: 'The attached file was empty.' }, 400);
      const mime = file.type || mimeFromName(file.name);
      if (!isAllowedChatFile(mime, file.name, buf.length)) {
        return json({ error: 'Send an image or PDF under 4 MB.' }, 400);
      }
      fileMeta = await storeChatBuffer(buf, { name: file.name, mime, from, toEmpId });
    }
  }

  if (typing != null) {
    if (!toEmpId) return json({ error: 'to_emp_id is required' }, 400);
    await setTyping(db, from, toEmpId, typing);
    return json({ success: true, typing });
  }

  if (fileId) {
    fileMeta = await loadChatFileMeta(db, fileId, from);
    if (!fileMeta) return json({ error: 'Upload the file again.' }, 400);
  }

  if (!toEmpId) return json({ error: 'to_emp_id is required' }, 400);
  if (toEmpId === from) return json({ error: 'Cannot message yourself.' }, 400);
  if (!(await assertLivePeer(db, toEmpId))) {
    return json({ error: 'Recipient is not an active employee.' }, 404);
  }

  let forwardedFrom = null;
  if (forwardedFromId && ObjectId.isValid(String(forwardedFromId))) {
    const original = await db.collection('staff_chats').findOne({ _id: new ObjectId(String(forwardedFromId)) });
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
    if (!fileMeta && (original.file_r2_key || original.file_mongo_id || original.file_base64)) {
      fileMeta = await cloneChatFile(original, from, toEmpId);
    }
  }

  if (hadFile && !fileMeta) return json({ error: 'The attached file was empty.' }, 400);
  if (!text && !fileMeta) return json({ error: 'Message or file required' }, 400);

  const doc = {
    thread_key: threadKey(from, toEmpId),
    job_id: jobId || null,
    from_emp_id: from,
    from_name: actor.name || (from === 'MD' ? 'Managing Director' : from),
    to_emp_id: toEmpId,
    text,
    ...fileMetaOnMessage(fileMeta),
    forwarded_from: forwardedFrom,
    created_at: new Date(),
  };
  const result = await db.collection('staff_chats').insertOne(doc);
  await setTyping(db, from, toEmpId, false);
  return json({ success: true, me: from, message: publicChatMessage({ ...doc, _id: result.insertedId }) }, 201);
}

export async function PATCH(request) {
  const gate = await actorOr401(request);
  if (gate.error) return gate.error;
  const { from } = gate;
  const body = await request.json().catch(() => ({}));
  const db = await readyDb();
  await touchPresence(db, from);

  const peer = String(body.peer || body.to_emp_id || '').trim();
  if (peer && !body.id) {
    await markThreadRead(db, from, peer);
    return json({ success: true, me: from, peer_read_at: await peerReadAt(db, from, peer) });
  }

  const id = String(body.id || '').trim();
  const text = String(body.text || '').trim();
  if (!id || !ObjectId.isValid(id)) return json({ error: 'id required' }, 400);
  if (!text) return json({ error: 'text required' }, 400);
  const doc = await db.collection('staff_chats').findOne({ _id: new ObjectId(id) });
  if (!doc) return json({ error: 'Message not found' }, 404);
  if (doc.from_emp_id !== from) return json({ error: 'You can only edit your own messages.' }, 403);
  await db.collection('staff_chats').updateOne(
    { _id: doc._id },
    { $set: { text, edited_at: new Date() } },
  );
  return json({ success: true, me: from });
}

export async function DELETE(request) {
  const gate = await actorOr401(request);
  if (gate.error) return gate.error;
  const { from } = gate;
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !ObjectId.isValid(id)) return json({ error: 'id required' }, 400);
  const db = await readyDb();
  const doc = await db.collection('staff_chats').findOne({ _id: new ObjectId(id) });
  if (!doc) return json({ error: 'Message not found' }, 404);
  if (doc.from_emp_id !== from) return json({ error: 'You can only delete your own messages.' }, 403);
  await releaseChatFile(db, doc);
  await db.collection('staff_chats').deleteOne({ _id: doc._id });
  return json({ success: true, me: from });
}

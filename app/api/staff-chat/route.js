import { NextResponse } from 'next/server';
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
  return actor?.role === 'MD' ? 'MD' : (actor?.empId || actor?.email || 'MD');
}

async function actorOr401(request) {
  const actor = await resolveActorRole(request);
  if (!actor.role) return { error: json({ error: 'Please sign in.' }, 401) };
  return { actor };
}

export async function GET(request) {
  const gate = await actorOr401(request);
  if (gate.error) return gate.error;
  const { actor } = gate;
  const peer = request.nextUrl.searchParams.get('peer');
  const jobId = String(request.nextUrl.searchParams.get('job_id') || '').trim();
  const db = await getDb();
  await ensureWorkflowIndexes(db);
  const from = senderId(actor);

  if (jobId) {
    const messages = await db.collection('staff_chats').find({ job_id: jobId }).sort({ created_at: 1 }).toArray();
    return json({ messages, thread_key: `job::${jobId}` });
  }

  if (!peer) {
    const recent = await db.collection('staff_chats').find({
      $or: [{ from_emp_id: from }, { to_emp_id: from }],
    }).sort({ created_at: -1 }).limit(200).toArray();
    return json({ messages: recent });
  }

  const key = threadKey(from, peer);
  const messages = await db.collection('staff_chats').find({ thread_key: key }).sort({ created_at: 1 }).toArray();
  return json({ messages, thread_key: key });
}

export async function POST(request) {
  const gate = await actorOr401(request);
  if (gate.error) return gate.error;
  const { actor } = gate;
  const db = await getDb();
  await ensureWorkflowIndexes(db);

  const contentType = request.headers.get('content-type') || '';
  let toEmpId;
  let text = '';
  let jobId = '';
  let fileMeta = null;

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    toEmpId = String(form.get('to_emp_id') || '').trim();
    text = String(form.get('text') || form.get('body') || '').trim();
    jobId = String(form.get('job_id') || '').trim();
    const file = form.get('file');
    if (file && typeof file !== 'string' && file.arrayBuffer) {
      const buf = Buffer.from(await file.arrayBuffer());
      if (buf.length) {
        const uploaded = await uploadWorkflowDocument(buf, file.name || 'chat.bin', {
          jobId: jobId ? `chat_${jobId}` : `chat_${threadKey(senderId(actor), toEmpId)}`,
          contentType: file.type || 'application/octet-stream',
        });
        if (uploaded) fileMeta = { r2_key: uploaded.key, url: uploaded.url, name: file.name };
      }
    }
  } else {
    const body = await request.json().catch(() => ({}));
    toEmpId = String(body.to_emp_id || '').trim();
    text = String(body.text || body.body || '').trim();
    jobId = String(body.job_id || '').trim();
  }

  if (!toEmpId) return json({ error: 'to_emp_id is required' }, 400);
  if (!text && !fileMeta) return json({ error: 'Message or file required' }, 400);

  const from = senderId(actor);
  const doc = {
    thread_key: jobId ? `job::${jobId}` : threadKey(from, toEmpId),
    job_id: jobId || null,
    from_emp_id: from,
    from_name: actor.role === 'MD' ? (actor.name || 'Managing Director') : (actor.name || from),
    to_emp_id: toEmpId,
    text,
    file_r2_key: fileMeta?.r2_key || null,
    file_url: fileMeta?.url || null,
    file_name: fileMeta?.name || null,
    created_at: new Date(),
  };
  const result = await db.collection('staff_chats').insertOne(doc);
  return json({ success: true, message: { ...doc, _id: result.insertedId } }, 201);
}

export async function DELETE(request) {
  const gate = await actorOr401(request);
  if (gate.error) return gate.error;
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return json({ error: 'id required' }, 400);
  const db = await getDb();
  const { ObjectId } = await import('mongodb');
  if (!ObjectId.isValid(id)) return json({ error: 'invalid id' }, 400);
  const doc = await db.collection('staff_chats').findOne({ _id: new ObjectId(id) });
  if (doc?.file_r2_key) await deleteR2Key(doc.file_r2_key);
  await db.collection('staff_chats').deleteOne({ _id: new ObjectId(id) });
  return json({ success: true });
}

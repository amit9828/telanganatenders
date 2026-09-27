import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveClientEmail } from '@/lib/staff-auth';
import {
  acceptAnswers,
  answerFromExtract,
  bidKeyOf,
  buildExtract,
  clientSentence,
  draftFromCorpus,
  loadTender,
  needsDocument,
  openingSession,
  publicMessages,
  readTenderFiles,
  sessionReply,
} from '@/lib/estimator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

async function sessionFor(db, email, bidKey) {
  return db.collection('estimator_sessions').findOne({ client_email: email, bid_key: bidKey });
}

async function saveSession(db, session) {
  const { _id, ...rest } = session;
  rest.updated_at = new Date();
  await db.collection('estimator_sessions').updateOne(
    { client_email: rest.client_email, bid_key: rest.bid_key },
    { $set: rest },
    { upsert: true },
  );
  return rest;
}

async function lockJob(db, email, bidKey) {
  const jobs = db.collection('estimator_jobs');
  try {
    await jobs.createIndex(
      { client_email: 1, bid_key: 1 },
      { unique: true, partialFilterExpression: { status: 'running' }, name: 'estimator_one_flight' },
    );
  } catch { /* index already exists */ }
  const running = await jobs.findOne({ client_email: email, bid_key: bidKey, status: 'running' });
  if (running) return { busy: true, job: running };
  const inserted = await jobs.insertOne({
    client_email: email,
    bid_key: bidKey,
    status: 'running',
    raw: '',
    error: '',
    created_at: new Date(),
  });
  return { busy: false, job: { _id: inserted.insertedId } };
}

export async function GET(request) {
  const email = await resolveClientEmail(request);
  if (!email) return json({ error: 'Please sign in.' }, 401);
  const url = new URL(request.url);
  const jobId = String(url.searchParams.get('job_id') || '').trim();
  const bidNo = String(url.searchParams.get('bid_no') || '').trim();
  const db = await getDb();
  if (jobId) {
    const { ObjectId } = await import('mongodb');
    if (!ObjectId.isValid(jobId)) return json({ error: 'Unknown job.' }, 404);
    const job = await db.collection('estimator_jobs').findOne({ _id: new ObjectId(jobId), client_email: email });
    if (!job) return json({ error: 'Unknown job.' }, 404);
    const session = await sessionFor(db, email, job.bid_key);
    return json({ status: job.status, error: job.error || '', messages: publicMessages(session) });
  }
  if (!bidNo) return json({ error: 'A bid number is required.' }, 400);
  const session = await sessionFor(db, email, bidKeyOf(bidNo));
  if (!session) return json({ messages: [] });
  return json({ messages: publicMessages(session), bid_no: session.bid_no });
}

export async function POST(request) {
  const email = await resolveClientEmail(request);
  if (!email) return json({ error: 'Please sign in.' }, 401);
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'Invalid JSON body' }, 400);
  const db = await getDb();
  const bidNo = String(body.bid_no || '').trim();
  const message = String(body.message || '').trim();

  if (bidNo && !message) {
    const tender = await loadTender(db, bidNo);
    if (!tender) return json({ error: 'That bid number is not in our records.' }, 404);
    const key = bidKeyOf(tender.bid_no || bidNo);
    let session = await sessionFor(db, email, key);
    if (!session) session = await saveSession(db, openingSession(email, bidNo, tender));
    return json({ messages: publicMessages(session), bid_no: session.bid_no });
  }

  if (!message) return json({ error: 'A message is required.' }, 400);
  const key = bidKeyOf(body.bid_no || body.bid_key || '');
  const session = key
    ? await sessionFor(db, email, key)
    : await db.collection('estimator_sessions').findOne({ client_email: email }, { sort: { updated_at: -1 } });
  if (!session) return json({ error: 'Enter a bid number first.' }, 400);

  if (!session.answers_ready) {
    const next = acceptAnswers(session, message);
    await saveSession(db, next);
    return json({ messages: publicMessages(next), bid_no: next.bid_no });
  }

  const current = await sessionFor(db, email, session.bid_key);
  const remembered = sessionReply(current, message);
  if (remembered && !needsDocument(message)) {
    current.messages = [...(current.messages || []), { role: 'user', text: message }, { role: 'assistant', text: remembered }];
    await saveSession(db, current);
    return json({ messages: publicMessages(current), bid_no: current.bid_no });
  }

  if (!needsDocument(message)) {
    const reply = 'Ask me about the scope, the documents, an exemption, or an estimate for this tender.';
    current.messages = [...(current.messages || []), { role: 'user', text: message }, { role: 'assistant', text: reply }];
    await saveSession(db, current);
    return json({ messages: publicMessages(current), bid_no: current.bid_no });
  }

  const gate = await lockJob(db, email, current.bid_key);
  if (gate.busy) {
    return json({ status: 'running', job_id: String(gate.job._id), messages: publicMessages(current) });
  }
  const jobId = gate.job._id;
  const jobs = db.collection('estimator_jobs');

  try {
    const tender = await loadTender(db, current.bid_key);
    if (!tender) throw new Error('That bid number is not in our records.');
    const files = await readTenderFiles(tender);
    const stored = await db.collection('estimator_extracts').findOne({ bid_key: current.bid_key, file_hash: files.fileHash });
    let extract;
    let raw = '';
    if (stored?.scope) {
      const turned = await answerFromExtract(stored, current, message);
      raw = turned.raw;
      extract = turned.extract;
    } else {
      if (!files.corpus) {
        const reply = files.missing.length
          ? `The files on this bid could not be read (${files.missing.join(', ')}).`
          : 'This bid has no stored file I can read.';
        current.messages = [...(current.messages || []), { role: 'user', text: message }, { role: 'assistant', text: reply }];
        await saveSession(db, current);
        await jobs.updateOne({ _id: jobId }, { $set: { status: 'ready', raw: '', updated_at: new Date() } });
        return json({ status: 'ready', job_id: String(jobId), messages: publicMessages(current) });
      }
      const drafted = await draftFromCorpus(files.corpus, current, message);
      raw = drafted.raw;
      await jobs.updateOne({ _id: jobId }, { $set: { raw, updated_at: new Date() } });
      if (!drafted.parsed) throw new Error('The model reply could not be read. Nothing was shown.');
      extract = buildExtract(drafted.parsed, files.corpus, files.missing, files.scanned);
      await db.collection('estimator_extracts').updateOne(
        { bid_key: current.bid_key },
        { $set: { ...extract, bid_key: current.bid_key, bid_no: current.bid_no, file_hash: files.fileHash, updated_at: new Date() } },
        { upsert: true },
      );
    }
    const reply = clientSentence(extract, message);
    current.messages = [...(current.messages || []), { role: 'user', text: message }, { role: 'assistant', text: reply }];
    await saveSession(db, current);
    await jobs.updateOne({ _id: jobId }, { $set: { status: 'ready', raw, updated_at: new Date() } });
    return json({ status: 'ready', job_id: String(jobId), messages: publicMessages(current) });
  } catch (error) {
    const safe = error?.status === 429
      ? 'AI limit reached. Please wait a moment and try again.'
      : (error?.message || 'The read failed. Your earlier notes were kept.');
    await jobs.updateOne({ _id: jobId }, { $set: { status: 'failed', error: safe, updated_at: new Date() } });
    return json({ status: 'failed', job_id: String(jobId), error: safe, messages: publicMessages(current) }, error?.status === 429 ? 429 : 500);
  }
}

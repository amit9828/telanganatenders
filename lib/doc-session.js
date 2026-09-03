// Document Studio session state.
//
// The model proposes, the server decides. Every turn the LLM returns structured JSON
// naming which slots it believes it has filled; the session route refuses to believe it
// until each value has been checked against a real client, a real tender and a real
// letterhead. That separation is the whole safety story — without it a model can talk
// itself into generating a signed undertaking for a company that does not exist.
//
// This module holds the shape of a session and stays free of Node built-ins, because the
// Document Studio components import the phase and slot labels from here.

export const DOC_SESSION_COLLECTION = 'doc_sessions';

export const PHASE = {
  GATHERING: 'gathering',
  OUTLINE_PENDING: 'outline_pending',
  CONFIRMED: 'confirmed',
  RENDERED: 'rendered',
};

/** Slots a document cannot be generated without. */
export const REQUIRED_SLOTS = ['doc_type', 'client_email', 'letterhead_id'];

export const SLOT_LABELS = {
  doc_type: 'Document type',
  client_email: 'Client',
  tender_id: 'Tender',
  letterhead_id: 'Letterhead',
  instructions: 'Special instructions',
};

const MAX_MESSAGES = 120;
const MAX_MESSAGE_CHARS = 6000;

export function newSessionId() {
  return `docs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function emptySession(sessionId, owner) {
  const now = new Date();
  return {
    session_id: sessionId,
    owner,
    phase: PHASE.GATHERING,
    slots: {},
    validated: {},
    outline: null,
    outline_hash: null,
    messages: [],
    files: [],
    created_at: now,
    updated_at: now,
  };
}

async function ensureIndexes(col) {
  await col.createIndex({ session_id: 1 }, { unique: true }).catch(() => {});
  await col.createIndex({ owner: 1, updated_at: -1 }).catch(() => {});
}

export async function loadSession(db, sessionId) {
  if (!sessionId) return null;
  return db.collection(DOC_SESSION_COLLECTION).findOne({ session_id: String(sessionId) });
}

export async function saveSession(db, session) {
  const col = db.collection(DOC_SESSION_COLLECTION);
  await ensureIndexes(col);

  const messages = (session.messages || []).slice(-MAX_MESSAGES).map((m) => ({
    ...m,
    text: String(m.text || '').slice(0, MAX_MESSAGE_CHARS),
  }));

  const payload = { ...session, messages, updated_at: new Date() };
  delete payload._id;

  await col.updateOne(
    { session_id: session.session_id },
    { $set: payload, $setOnInsert: { created_at: session.created_at || new Date() } },
    { upsert: true },
  );
  return payload;
}

/** Recent turns rendered for the prompt. */
export function renderTranscript(session, turns = 14) {
  const messages = (session?.messages || []).filter((m) => m.role === 'user' || m.role === 'assistant');
  if (!messages.length) return '';
  return messages
    .slice(-turns)
    .map((m) => `${m.role === 'assistant' ? 'ASSISTANT' : 'OFFICER'}: ${String(m.text || '').trim()}`)
    .join('\n\n');
}

/** Required slots that are still unfilled or failed validation. */
export function missingSlots(validated) {
  return REQUIRED_SLOTS.filter((slot) => !validated?.[slot]?.ok);
}

/** Trimmed session for the client — never ships raw model JSON or internal fields. */
export function publicSession(session) {
  return {
    session_id: session.session_id,
    phase: session.phase,
    slots: session.slots || {},
    validated: session.validated || {},
    missing: missingSlots(session.validated),
    outline: session.outline || null,
    outline_hash: session.outline_hash || null,
    messages: (session.messages || []).map((m) => ({
      role: m.role,
      text: m.text,
      quick_replies: m.quick_replies || [],
      at: m.at,
    })),
    files: (session.files || []).map((f) => ({
      doc_type: f.doc_type,
      filename: f.filename,
      mime: f.mime,
      html: f.html,
    })),
    updated_at: session.updated_at,
  };
}

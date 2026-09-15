// Persistent Co-Pilot conversation memory.
//
// Every /api/ai/chat request used to be stateless: the model saw one question and no
// history, so "what about its EMD?" after a tender question was unanswerable and the
// thread vanished the moment the panel was closed. Turns are now stored per
// conversation and replayed as prior context on the next request.

export const COPILOT_CHAT_COLLECTION = 'copilot_conversations';

/** How many past turns travel back to the model. Enough for real follow-ups, small
 *  enough that the prompt stays inside the token budget alongside a PDF. */
export const HISTORY_TURNS = 12;

/** Hard cap on what a single conversation document may hold. */
const MAX_STORED_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 8000;

export function newConversationId() {
  return `conv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureIndexes(col) {
  await col.createIndex({ conversation_id: 1 }, { unique: true }).catch(() => {});
  await col.createIndex({ owner: 1, updated_at: -1 }).catch(() => {});
}

export async function loadConversation(db, conversationId) {
  if (!conversationId) return null;
  const col = db.collection(COPILOT_CHAT_COLLECTION);
  return col.findOne({ conversation_id: String(conversationId) });
}

/**
 * Recent turns rendered as plain transcript lines for the prompt.
 * Returns '' when there is no usable history, so callers can skip the section entirely.
 */
export function renderHistory(conversation, turns = HISTORY_TURNS) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  if (!messages.length) return '';
  return messages
    .slice(-turns)
    .map((m) => `${m.role === 'assistant' ? 'CO-PILOT' : 'OFFICER'}: ${String(m.text || '').trim()}`)
    .filter((line) => line.length > 10)
    .join('\n\n');
}

/**
 * Appends one question/answer pair and returns the conversation id used.
 * Failures are swallowed: losing a transcript must never fail the answer itself.
 */
export async function appendTurn(db, {
  conversationId,
  owner = 'staff',
  tenderId = null,
  question,
  answer,
  sources = [],
  mode = null,
  model = null,
}) {
  const id = conversationId || newConversationId();
  try {
    const col = db.collection(COPILOT_CHAT_COLLECTION);
    await ensureIndexes(col);
    const now = new Date();

    await col.updateOne(
      { conversation_id: id },
      {
        $push: {
          messages: {
            $each: [
              { role: 'user', text: String(question || '').slice(0, MAX_MESSAGE_CHARS), at: now },
              { role: 'assistant', text: String(answer || '').slice(0, MAX_MESSAGE_CHARS), at: now, sources, mode, model },
            ],
            // Negative $slice keeps the most recent messages and drops the oldest.
            $slice: -MAX_STORED_MESSAGES,
          },
        },
        $set: { owner, tender_id: tenderId, updated_at: now },
        $setOnInsert: {
          conversation_id: id,
          created_at: now,
          title: String(question || 'New conversation').slice(0, 120),
        },
      },
      { upsert: true },
    );
  } catch (err) {
    console.warn('[copilot-memory] could not persist turn:', err?.message || err);
  }
  return id;
}

export async function listConversations(db, owner, limit = 20) {
  const col = db.collection(COPILOT_CHAT_COLLECTION);
  const docs = await col
    .find(owner ? { owner } : {}, {
      projection: { conversation_id: 1, title: 1, updated_at: 1, tender_id: 1, messages: { $slice: -1 } },
    })
    .sort({ updated_at: -1 })
    .limit(limit)
    .toArray()
    .catch(() => []);

  return docs.map((d) => ({
    conversation_id: d.conversation_id,
    title: d.title || 'Conversation',
    updated_at: d.updated_at,
    tender_id: d.tender_id || null,
    last_message: d.messages?.[0]?.text?.slice(0, 160) || '',
  }));
}

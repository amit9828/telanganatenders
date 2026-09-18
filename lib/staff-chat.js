import { Binary, ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import {
  deleteR2Key,
  fetchR2Buffer,
  isR2Configured,
  uploadWorkflowDocument,
} from '@/lib/cloudflare-r2';

export const MD_OFFICE_ID = 'MD';
export const CHAT_MAX_BYTES = 4 * 1024 * 1024;
export const CHAT_FILES_COLLECTION = 'staff_chat_files';
export const CHAT_READS_COLLECTION = 'staff_chat_reads';
export const CHAT_PRESENCE_COLLECTION = 'staff_chat_presence';
export const CHAT_TYPING_COLLECTION = 'staff_chat_typing';
export const ONLINE_MS = 45 * 1000;
const TYPING_MS = 4000;

export function threadKey(a, b) {
  return [String(a || ''), String(b || '')].sort().join('::');
}

/** Personal emp_id DMs. ADMIN_TOKEN (no emp_id) is the shared MD office line. */
export function chatSenderId(actor) {
  const empId = String(actor?.empId || '').trim();
  if (empId) return empId;
  if (actor?.role === 'MD') return MD_OFFICE_ID;
  return '';
}

export function pairFilter(from, peer) {
  return {
    $or: [
      { from_emp_id: from, to_emp_id: peer },
      { from_emp_id: peer, to_emp_id: from },
    ],
  };
}

export function publicChatMessage(doc) {
  if (!doc) return doc;
  const id = doc._id;
  return {
    _id: id,
    thread_key: doc.thread_key,
    job_id: doc.job_id || null,
    from_emp_id: doc.from_emp_id,
    from_name: doc.from_name,
    to_emp_id: doc.to_emp_id,
    text: doc.text || '',
    file_name: doc.file_name || null,
    file_content_type: doc.file_content_type || null,
    has_file: Boolean(doc.file_r2_key || doc.file_mongo_id || doc.file_base64 || doc.file_name),
    is_image: isImageMime(doc.file_content_type, doc.file_name),
    is_pdf: isPdfMime(doc.file_content_type, doc.file_name),
    forwarded_from: doc.forwarded_from || null,
    created_at: doc.created_at,
    edited_at: doc.edited_at || null,
  };
}

export function mimeFromName(name, fallback = 'application/octet-stream') {
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.gif')) return 'image/gif';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.doc')) return 'application/msword';
  if (n.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return fallback;
}

export function isImageMime(mime, name) {
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test(String(name || ''));
}

export function isPdfMime(mime, name) {
  const m = String(mime || '').toLowerCase();
  if (m === 'application/pdf') return true;
  return /\.pdf$/i.test(String(name || ''));
}

export function isAllowedChatFile(mime, name, size) {
  if (typeof size === 'number' && size > CHAT_MAX_BYTES) return false;
  const resolved = mime || mimeFromName(name);
  return isImageMime(resolved, name) || isPdfMime(resolved, name);
}

export async function assertLivePeer(db, toEmpId) {
  if (toEmpId === MD_OFFICE_ID) return true;
  const emp = await db.collection('employees').findOne({
    emp_id: toEmpId,
    deleted: { $ne: true },
    active: { $ne: false },
  });
  return Boolean(emp);
}

export async function ensureStaffChatIndexes(db) {
  const { ensureAppIndexes } = await import('@/lib/ensure-indexes');
  await ensureAppIndexes(db);
}

export async function storeChatBuffer(buffer, { name, mime, from, toEmpId }) {
  if (!buffer?.length) return null;
  if (buffer.length > CHAT_MAX_BYTES) {
    const err = new Error('File must be 4 MB or smaller.');
    err.status = 413;
    throw err;
  }
  const fileName = name || 'attachment';
  const contentType = mime || mimeFromName(fileName);
  let r2_key = null;
  let data = new Binary(buffer);
  if (isR2Configured()) {
    const uploaded = await uploadWorkflowDocument(buffer, fileName, {
      jobId: `chat_${threadKey(from, toEmpId || 'pending')}`,
      contentType,
    });
    if (uploaded?.key) {
      r2_key = uploaded.key;
      data = null;
    }
  }
  const db = await getDb();
  const result = await db.collection(CHAT_FILES_COLLECTION).insertOne({
    name: fileName,
    mime: contentType,
    uploaded_by: from || null,
    r2_key,
    created_at: new Date(),
    data,
  });
  return { mongo_id: result.insertedId, r2_key, name: fileName, content_type: contentType };
}

export async function cloneChatFile(original, from, toEmpId) {
  if (!original) return null;
  let buf = null;
  if (original.file_base64) buf = Buffer.from(String(original.file_base64), 'base64');
  else if (original.file_mongo_id) {
    const stored = await fetchChatFileBuffer(original);
    buf = stored?.buffer || null;
  } else if (original.file_r2_key) {
    buf = await fetchR2Buffer(original.file_r2_key);
  }
  if (!buf?.length) return null;
  return storeChatBuffer(buf, {
    name: original.file_name || 'attachment',
    mime: original.file_content_type || mimeFromName(original.file_name),
    from,
    toEmpId,
  });
}

export async function fetchChatFileBuffer(doc) {
  if (!doc) return null;
  if (doc.file_base64) {
    const buffer = Buffer.from(String(doc.file_base64), 'base64');
    return { buffer, mime: doc.file_content_type || mimeFromName(doc.file_name) };
  }
  if (doc.file_mongo_id && ObjectId.isValid(String(doc.file_mongo_id))) {
    const db = await getDb();
    const stored = await db.collection(CHAT_FILES_COLLECTION).findOne({ _id: new ObjectId(String(doc.file_mongo_id)) });
    if (stored?.data) {
      const raw = stored.data.buffer || stored.data;
      const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (buffer.length) {
        return { buffer, mime: stored.mime || doc.file_content_type || mimeFromName(doc.file_name) };
      }
    }
    if (stored?.r2_key) {
      const buffer = await fetchR2Buffer(stored.r2_key);
      if (buffer?.length) {
        return { buffer, mime: stored.mime || doc.file_content_type || mimeFromName(doc.file_name) };
      }
    }
  }
  if (doc.file_r2_key) {
    const buffer = await fetchR2Buffer(doc.file_r2_key);
    if (buffer?.length) return { buffer, mime: doc.file_content_type || mimeFromName(doc.file_name) };
  }
  return null;
}

export async function releaseChatFile(db, doc) {
  if (!doc) return;
  if (doc.file_r2_key) {
    const others = await db.collection('staff_chats').countDocuments({
      file_r2_key: doc.file_r2_key,
      _id: { $ne: doc._id },
    });
    if (others === 0) await deleteR2Key(doc.file_r2_key);
  }
  if (doc.file_mongo_id) {
    const others = await db.collection('staff_chats').countDocuments({
      file_mongo_id: doc.file_mongo_id,
      _id: { $ne: doc._id },
    });
    if (others === 0) {
      const stored = await db.collection(CHAT_FILES_COLLECTION).findOne({ _id: doc.file_mongo_id });
      if (stored?.r2_key) {
        const keyOthers = await db.collection('staff_chats').countDocuments({
          file_r2_key: stored.r2_key,
          _id: { $ne: doc._id },
        });
        if (keyOthers === 0) await deleteR2Key(stored.r2_key);
      }
      await db.collection(CHAT_FILES_COLLECTION).deleteOne({ _id: doc.file_mongo_id });
    }
  }
}

export async function loadChatFileMeta(db, fileId, from) {
  if (!fileId || !ObjectId.isValid(String(fileId))) return null;
  const stored = await db.collection(CHAT_FILES_COLLECTION).findOne({ _id: new ObjectId(String(fileId)) });
  if (!stored) return null;
  if (stored.uploaded_by && stored.uploaded_by !== from) return null;
  return {
    mongo_id: stored._id,
    r2_key: stored.r2_key || null,
    name: stored.name,
    content_type: stored.mime,
  };
}

export async function markThreadRead(db, from, peer) {
  if (!from || !peer) return;
  const key = threadKey(from, peer);
  await db.collection(CHAT_READS_COLLECTION).updateOne(
    { thread_key: key, emp_id: from },
    { $set: { thread_key: key, emp_id: from, last_read_at: new Date() } },
    { upsert: true },
  );
}

export async function peerReadAt(db, from, peer) {
  if (!from || !peer) return null;
  const key = threadKey(from, peer);
  const row = await db.collection(CHAT_READS_COLLECTION).findOne({ thread_key: key, emp_id: peer });
  return row?.last_read_at || null;
}

export async function readsForInbox(db, from, messages) {
  const peers = new Set();
  for (const msg of messages || []) {
    const other = msg.from_emp_id === from ? msg.to_emp_id : msg.from_emp_id;
    if (other) peers.add(other);
  }
  if (!peers.size) return {};
  const keys = [...peers].map((peer) => threadKey(from, peer));
  const rows = await db.collection(CHAT_READS_COLLECTION).find({
    thread_key: { $in: keys },
    emp_id: from,
  }).toArray();
  const map = {};
  for (const row of rows) {
    const [a, b] = String(row.thread_key || '').split('::');
    const other = a === from ? b : a;
    if (other) map[other] = row.last_read_at;
  }
  return map;
}

const presenceTouchedAt = new Map();
const PRESENCE_MIN_INTERVAL_MS = 30 * 1000;

export async function touchPresence(db, from) {
  if (!from) return;
  const last = presenceTouchedAt.get(from) || 0;
  if (Date.now() - last < PRESENCE_MIN_INTERVAL_MS) return;
  presenceTouchedAt.set(from, Date.now());
  await db.collection(CHAT_PRESENCE_COLLECTION).updateOne(
    { emp_id: from },
    { $set: { emp_id: from, last_seen_at: new Date() } },
    { upsert: true },
  );
}

export async function presenceMap(db, ids) {
  const list = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!list.length) return {};
  const rows = await db.collection(CHAT_PRESENCE_COLLECTION).find({ emp_id: { $in: list } }).toArray();
  const out = {};
  for (const row of rows) {
    const ts = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
    out[row.emp_id] = {
      last_seen_at: row.last_seen_at,
      online: Boolean(ts && Date.now() - ts < ONLINE_MS),
    };
  }
  return out;
}

export async function setTyping(db, from, peer, typing) {
  if (!from || !peer) return;
  const key = threadKey(from, peer);
  if (!typing) {
    await db.collection(CHAT_TYPING_COLLECTION).deleteOne({ thread_key: key, emp_id: from });
    return;
  }
  await db.collection(CHAT_TYPING_COLLECTION).updateOne(
    { thread_key: key, emp_id: from },
    { $set: { thread_key: key, emp_id: from, until: new Date(Date.now() + TYPING_MS) } },
    { upsert: true },
  );
}

export async function peerTyping(db, from, peer) {
  if (!from || !peer) return false;
  const key = threadKey(from, peer);
  const row = await db.collection(CHAT_TYPING_COLLECTION).findOne({
    thread_key: key,
    emp_id: peer,
    until: { $gt: new Date() },
  });
  return Boolean(row);
}

export function fileMetaOnMessage(fileMeta) {
  if (!fileMeta) {
    return {
      file_r2_key: null,
      file_mongo_id: null,
      file_name: null,
      file_content_type: null,
      file_base64: null,
      file_url: null,
    };
  }
  return {
    file_r2_key: fileMeta.r2_key || null,
    file_mongo_id: fileMeta.mongo_id || null,
    file_name: fileMeta.name || null,
    file_content_type: fileMeta.content_type || null,
    file_base64: null,
    file_url: null,
  };
}

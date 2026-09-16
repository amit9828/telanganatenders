import { ObjectId } from 'mongodb';

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Existing client lookup only. Never upserts. */
export function clientIdentQuery(ident) {
  const raw = String(ident || '').trim();
  if (!raw) return null;
  const or = [
    { email: raw.toLowerCase() },
    { client_id: new RegExp(`^${escapeRegex(raw)}$`, 'i') },
  ];
  if (ObjectId.isValid(raw)) or.push({ _id: new ObjectId(raw) });
  return { $or: or };
}

export async function findExistingClient(db, ident) {
  const query = clientIdentQuery(ident);
  if (!query) return null;
  return db.collection('users').findOne(query);
}

export function clientIdentFromRequest(request) {
  const header = String(request.headers.get('x-client-id') || '').trim();
  const cookie = (() => {
    const raw = String(request.headers.get('cookie') || '');
    const match = raw.split(';').map((p) => p.trim()).find((p) => p.startsWith('tt_client_id='));
    if (!match) return '';
    try {
      return decodeURIComponent(match.slice('tt_client_id='.length).trim());
    } catch {
      return match.slice('tt_client_id='.length).trim();
    }
  })();
  return header || cookie || '';
}

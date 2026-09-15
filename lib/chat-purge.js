import { getDb } from '@/lib/db';
import { listR2Keys, deleteR2Key } from '@/lib/cloudflare-r2';

const CHAT_PREFIX = 'workflow/chat_';
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export async function purgeExpiredChatObjects() {
  const cutoff = Date.now() - MAX_AGE_MS;
  const objects = await listR2Keys(CHAT_PREFIX);
  let deleted = 0;
  for (const obj of objects) {
    const ts = obj.lastModified ? new Date(obj.lastModified).getTime() : 0;
    if (ts && ts < cutoff) {
      const ok = await deleteR2Key(obj.key);
      if (ok) deleted += 1;
    }
  }
  try {
    const db = await getDb();
    await db.collection('staff_chats').createIndex(
      { created_at: 1 },
      { expireAfterSeconds: 7 * 24 * 3600 }
    );
  } catch (err) {
    console.warn('[chat-purge] ttl index:', err?.message || err);
  }
  return { deleted, scanned: objects.length };
}

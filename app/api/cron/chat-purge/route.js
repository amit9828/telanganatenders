import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { listR2Keys, deleteR2Key } from '@/lib/cloudflare-r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function isAuthorised(request) {
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const adminToken = String(process.env.ADMIN_TOKEN || '').trim();
  if (cronSecret && bearer === cronSecret) return true;
  if (adminToken && bearer === adminToken) return true;
  return false;
}

export async function GET(request) {
  return POST(request);
}

export async function POST(request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  const objects = await listR2Keys('workflow/chat/');
  let deleted = 0;
  for (const obj of objects) {
    const ts = obj.lastModified ? new Date(obj.lastModified).getTime() : 0;
    if (ts && ts < cutoff) {
      const ok = await deleteR2Key(obj.key);
      if (ok) deleted += 1;
    }
  }
  const db = await getDb();
  try {
    await db.collection('staff_chats').createIndex({ created_at: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
  } catch (err) {
    console.warn('[chat-purge] ttl index:', err?.message || err);
  }
  return NextResponse.json({ success: true, deleted, scanned: objects.length });
}

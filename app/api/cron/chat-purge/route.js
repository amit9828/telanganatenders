import { NextResponse } from 'next/server';
import { purgeExpiredChatObjects } from '@/lib/chat-purge';

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
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await purgeExpiredChatObjects();
  return NextResponse.json({ success: true, ...result });
}

export const POST = GET;

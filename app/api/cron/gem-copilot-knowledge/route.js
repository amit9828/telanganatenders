import { NextResponse } from 'next/server';
import { syncGemCopilotKnowledge } from '@/lib/gem-copilot-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function isAuthorised(request) {
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const adminToken = String(process.env.ADMIN_TOKEN || '').trim();

  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Admin token allows a manual
  // Sunday-style harvest from the dashboard / local scraper.
  if (cronSecret && bearer === cronSecret) return true;
  if (adminToken && bearer === adminToken) return true;
  return false;
}

/**
 * Sunday weekly GeM Co-Pilot knowledge harvest.
 * GET/POST /api/cron/gem-copilot-knowledge
 *
 * Downloads footer/resource documents from GeM, stores binaries under
 * R2 gem_copilot_knowledge/, and indexes text into Mongo gem_copilot_knowledge.
 */
async function run(request) {
  if (!isAuthorised(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let discovered_links = [];
  try {
    if (request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (Array.isArray(body?.discovered_links)) {
        discovered_links = body.discovered_links;
      }
    }
  } catch {
    // ignore body parse errors — sync still runs on curated sources
  }

  try {
    const result = await syncGemCopilotKnowledge({
      batchSize: 6,
      discoveredLinks: discovered_links,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[cron/gem-copilot-knowledge]', err);
    return NextResponse.json(
      { error: err?.message || 'GeM Co-Pilot knowledge sync failed' },
      { status: 500 },
    );
  }
}

export async function GET(request) {
  return run(request);
}

export async function POST(request) {
  return run(request);
}

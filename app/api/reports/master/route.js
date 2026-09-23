import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveActorRole } from '@/lib/staff-auth';
import { loadMasterReport } from '@/lib/reports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const actor = await resolveActorRole(request);
  if (actor?.role !== 'MD') {
    return NextResponse.json({ error: 'Only MD can open Master Reports.' }, { status: actor?.role ? 403 : 401 });
  }
  const range = new URL(request.url).searchParams.get('range') || 'monthly';
  try {
    const db = await getDb();
    const report = await loadMasterReport(db, range);
    return NextResponse.json(report);
  } catch (err) {
    console.error('[reports/master]', err?.message || err);
    return NextResponse.json({ error: 'Could not load reports.' }, { status: 500 });
  }
}

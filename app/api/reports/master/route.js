import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { resolveActorRole } from '@/lib/staff-auth';
import { istParts, loadMasterReport, parseMonthKey } from '@/lib/reports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const actor = await resolveActorRole(request);
  if (actor?.role !== 'MD') {
    return NextResponse.json({ error: 'Only MD can open Master Reports.' }, { status: actor?.role ? 403 : 401 });
  }
  const params = new URL(request.url).searchParams;
  const range = params.get('range') || 'monthly';
  const compare = params.get('compare') === '1';
  const monthParam = params.get('month');
  let month = null;
  if (monthParam) {
    month = parseMonthKey(monthParam);
    if (!month) {
      return NextResponse.json({ error: 'month must be YYYY-MM.' }, { status: 400 });
    }
    const today = istParts(new Date());
    if (month.year * 12 + month.month > today.y * 12 + today.m) {
      return NextResponse.json({ error: 'That month has not started yet.' }, { status: 400 });
    }
  }
  try {
    const db = await getDb();
    const report = await loadMasterReport(db, { range, month, compare });
    return NextResponse.json(report);
  } catch (err) {
    console.error('[reports/master]', err?.message || err);
    return NextResponse.json({ error: 'Could not load reports.' }, { status: 500 });
  }
}

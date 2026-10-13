import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { verifyCashfreeOrder } from '@/lib/payments';

// Takes precedence over app/api/[[...path]] so a cold start loads only the payment code.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function POST(request) {
  try {
    const db = await getDb();
    const body = await request.json().catch(() => ({}));
    return await verifyCashfreeOrder(db, body);
  } catch (err) {
    console.error('[payment/verify] failed:', err?.message || err);
    return NextResponse.json(
      { success: false, status: 'PROCESSING', message: 'Still confirming with the bank...' },
      { status: 202, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

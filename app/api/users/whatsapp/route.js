import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/staff-auth';

export const dynamic = 'force-dynamic';

// PATCH: staff marks a client's mobile as WhatsApp-verified (or revokes it).
// Automated notifications refuse to send unless this flag is true.
export async function PATCH(request) {
  const auth = await requireStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => null);
    const email = String(body?.email || '').trim().toLowerCase();
    if (!email) return NextResponse.json({ error: 'email is required.' }, { status: 400 });
    if (typeof body?.verified !== 'boolean') {
      return NextResponse.json({ error: '`verified` must be true or false.' }, { status: 400 });
    }

    const db = await getDb();
    const result = await db.collection('users').updateOne(
      { email },
      {
        $set: {
          whatsapp_verified: body.verified,
          whatsapp_verified_at: body.verified ? new Date() : null,
          whatsapp_verified_by: body.verified ? (auth.email || auth.actor) : null,
        },
      }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, email, whatsapp_verified: body.verified });
  } catch (error) {
    console.error('[users/whatsapp] PATCH failed:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

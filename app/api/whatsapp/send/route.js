import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/staff-auth';
import { formatClientBidAlert } from '@/lib/matchmaking';
import { sendWhatsAppAlert } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

const SUGGESTED_MATCHES_COLLECTION = 'suggested_bid_matches';

/**
 * Manual, human-in-the-loop WhatsApp dispatch for a suggested bid match.
 * Matching itself never calls this — staff must click "Send Alert to Client".
 */
export async function POST(request) {
  const auth = await requireStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => null);
    const matchId = body?.match_id ? String(body.match_id).trim() : '';
    const clientEmail = body?.client_email ? String(body.client_email).trim().toLowerCase() : '';
    const phoneOverride = body?.phone ? String(body.phone).trim() : '';
    const customMessage = body?.message ? String(body.message).trim().slice(0, 1500) : '';

    if (!matchId && !clientEmail) {
      return NextResponse.json({ error: 'match_id or client_email is required.' }, { status: 400 });
    }

    const db = await getDb();

    let match = null;
    if (matchId) {
      const filter = ObjectId.isValid(matchId) ? { _id: new ObjectId(matchId) } : { _id: matchId };
      match = await db.collection(SUGGESTED_MATCHES_COLLECTION).findOne(filter);
      if (!match) match = await db.collection('bid_matches').findOne(filter);
    }

    const email = clientEmail || String(match?.client_email || '').toLowerCase();
    if (!email) {
      return NextResponse.json({ error: 'Could not resolve the client for this alert.' }, { status: 400 });
    }

    const client = await db.collection('users').findOne(
      { email },
      {
        projection: {
          email: 1, phone: 1, whatsapp_number: 1, whatsapp_verified: 1,
          company_name: 1, client_name: 1, name: 1,
        },
      },
    );

    if (!client) {
      return NextResponse.json({ error: 'Client profile not found.' }, { status: 404 });
    }

    const phone = phoneOverride || client.phone || client.whatsapp_number || '';
    if (!phone) {
      return NextResponse.json({
        error: 'This client has no phone number on file. Add one before sending a WhatsApp alert.',
      }, { status: 422 });
    }

    if (client.whatsapp_verified !== true) {
      return NextResponse.json({
        error: 'WhatsApp is not verified for this client. Mark the number as WA Verified on their card first.',
        whatsapp_verified: false,
      }, { status: 422 });
    }

    const payload = match
      ? {
        tender: {
          bid_no: match.tender_bid_no,
          title: match.tender_title,
          department: match.tender_department,
          last_date: match.tender_last_date,
        },
        client: {
          company_name: client.company_name || match.client_company,
          name: client.client_name || client.name,
        },
        match_score: match.match_score ?? match.confidence,
        suggested_quote: match.suggested_quote,
      }
      : {
        tender: body?.tender || {},
        client: {
          company_name: client.company_name,
          name: client.client_name || client.name,
        },
        match_score: body?.match_score,
        suggested_quote: body?.suggested_quote,
      };

    const message = customMessage || formatClientBidAlert(payload);
    const result = await sendWhatsAppAlert(phone, message, { whatsapp_verified: true });

    if (!result.sent) {
      return NextResponse.json({
        error: result.error || result.reason || 'WhatsApp send failed.',
        skipped: Boolean(result.skipped),
      }, { status: result.skipped ? 503 : 502 });
    }

    const alertSentAt = new Date();
    if (match?._id) {
      await db.collection(SUGGESTED_MATCHES_COLLECTION).updateOne(
        { _id: match._id },
        {
          $set: {
            alert_sent_at: alertSentAt,
            alert_sent_by: auth.email || auth.actor,
            status: 'alerted',
          },
        },
      ).catch(() => {});
      await db.collection('bid_matches').updateOne(
        { _id: match._id },
        { $set: { alert_sent_at: alertSentAt, status: 'reviewed' } },
      ).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      sent: true,
      alert_sent_at: alertSentAt.toISOString(),
      phone_masked: String(phone).replace(/\d(?=\d{4})/g, '•'),
    });
  } catch (error) {
    console.error('[whatsapp/send] failed:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}

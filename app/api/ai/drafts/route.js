import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { requireStaff } from '@/lib/staff-auth';

export const dynamic = 'force-dynamic';

// The original single-file analyzer wrote drafts as 'Pending Verification'; the bulk
// pipeline writes 'Pending Review'. Match both so drafts created before this change
// stay visible in the employee queue.
const PENDING_STATUSES = ['Pending Review', 'Pending Verification'];

function draftFilter(id) {
  return ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id };
}

// 🚀 GET: డ్రాఫ్ట్స్ ని ఎంప్లాయ్ పేజీకి పంపడానికి
async function staffOr401(request) {
    const auth = await requireStaff(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    return null;
}

export async function GET(request) {
    const denied = await staffOr401(request);
    if (denied) return denied;
    try {
        const db = await getDb();
        const drafts = await db.collection('ai_draft_tenders')
            .find({ status: { $in: PENDING_STATUSES } })
            // pdf_base64 only exists on legacy drafts and is megabytes wide — never ship it.
            .project({ pdf_base64: 0 })
            .sort({ created_at: -1 })
            .toArray();
        return NextResponse.json({ drafts });
    } catch (e) {
        console.error('[ai/drafts] GET failed:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// 🚀 POST: రివ్యూ అయిన డ్రాఫ్ట్ ని లైవ్ టెండర్ గా పబ్లిష్ చేయడం.
// Promotes a reviewed draft into the live `tenders` collection and removes it from the
// queue. The PDF itself never moves — the tender inherits the same R2 pointers.
export async function POST(request) {
    const denied = await staffOr401(request);
    if (denied) return denied;
    try {
        const body = await request.json().catch(() => null);
        if (!body?.id) {
            return NextResponse.json({ error: 'Draft id is required.' }, { status: 400 });
        }

        const db = await getDb();
        const filter = draftFilter(body.id);
        const draft = await db.collection('ai_draft_tenders').findOne(filter);
        if (!draft) {
            return NextResponse.json({ error: 'This draft no longer exists. It may have already been published.' }, { status: 404 });
        }

        // The employee can correct anything the AI got wrong; fall back to the extracted
        // value when a field was left untouched.
        const pick = (key) => String(body[key] ?? draft[key] ?? '').trim();
        const title = pick('title');
        const department = pick('department');
        const last_date = pick('last_date');
        const bid_no = pick('bid_no');

        const missing = Object.entries({ title, department, last_date, bid_no })
            .filter(([, value]) => !value)
            .map(([key]) => key);
        if (missing.length > 0) {
            return NextResponse.json(
                { error: `Please fill in the required fields before publishing: ${missing.join(', ')}.` },
                { status: 400 }
            );
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(last_date)) {
            return NextResponse.json({ error: 'Last date must be in YYYY-MM-DD format.' }, { status: 400 });
        }

        const duplicate = await db.collection('tenders').findOne({ bid_no }, { projection: { _id: 1 } });
        if (duplicate) {
            return NextResponse.json({ error: `A live tender with bid number ${bid_no} already exists.` }, { status: 409 });
        }

        const tender = {
            bid_no,
            title,
            department,
            last_date,
            district: pick('district'),
            category: pick('category') || 'Product',
            emd_amount: pick('emd_amount'),
            supply_details: pick('supply_details'),
            // 🚀 CRITICAL: carry the R2 pointers across. The document body is never
            // copied into MongoDB.
            pdf_url: draft.pdf_url || null,
            pdf_r2_key: draft.pdf_r2_key || null,
            pdf_filename: draft.pdf_filename || 'tender.pdf',
            source: 'ai_bulk_publisher',
            published_by: String(body.publishedBy || 'Employee'),
            created_at: new Date(),
        };

        // Legacy drafts predate R2 and still carry the blob; keep the file readable
        // rather than publishing a tender with no document attached.
        if (!tender.pdf_url && !tender.pdf_r2_key && draft.pdf_base64) {
            tender.pdf_base64 = draft.pdf_base64;
        }

        const result = await db.collection('tenders').insertOne(tender);
        await db.collection('ai_draft_tenders').deleteOne(filter);

        return NextResponse.json({ success: true, id: String(result.insertedId), tender });
    } catch (e) {
        console.error('[ai/drafts] POST failed:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// 🚀 DELETE: పబ్లిష్ అయ్యాక / రిజెక్ట్ చేసినప్పుడు డ్రాఫ్ట్ ని డిలీట్ చేయడానికి
export async function DELETE(request) {
    const denied = await staffOr401(request);
    if (denied) return denied;
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });

        const db = await getDb();
        await db.collection('ai_draft_tenders').deleteOne(draftFilter(id));

        return NextResponse.json({ success: true });
    } catch (e) {
        console.error('[ai/drafts] DELETE failed:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

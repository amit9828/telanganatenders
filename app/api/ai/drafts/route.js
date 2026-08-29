import { NextResponse } from 'next/server';
import { MongoClient, ObjectId } from 'mongodb';

let cachedClient = null;
let cachedDb = null;

async function getDb() {
  if (cachedDb) return cachedDb;
  const client = await MongoClient.connect(process.env.MONGO_URL);
  cachedClient = client;
  cachedDb = client.db(process.env.DB_NAME || 'tender_portal');
  return cachedDb;
}

// 🚀 GET: డ్రాఫ్ట్స్ ని ఎంప్లాయ్ పేజీకి పంపడానికి
export async function GET(request) {
    try {
        const db = await getDb();
        const drafts = await db.collection('ai_draft_tenders').find({ status: 'Pending Verification' }).sort({ created_at: -1 }).toArray();
        return NextResponse.json({ drafts });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

// 🚀 DELETE: పబ్లిష్ అయ్యాక డ్రాఫ్ట్ ని డిలీట్ చేయడానికి
export async function DELETE(request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');
        if (!id) return NextResponse.json({ error: 'Missing ID' }, { status: 400 });
        
        const db = await getDb();
        await db.collection('ai_draft_tenders').deleteOne({ _id: new ObjectId(id) });
        return NextResponse.json({ success: true });
    } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}

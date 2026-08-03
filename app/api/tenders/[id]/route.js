import { NextResponse } from 'next/server';
import { MongoClient, ObjectId } from 'mongodb';

export const dynamic = 'force-dynamic';

export async function DELETE(request, { params }) {
  let client;
  try {
    const id = params.id;
    if (!id) {
      return NextResponse.json({ error: 'Missing Tender ID' }, { status: 400 });
    }

    if (!process.env.MONGO_URL) {
      return NextResponse.json({ error: 'MONGO_URL is missing' }, { status: 500 });
    }

    client = await MongoClient.connect(process.env.MONGO_URL);
    const db = client.db(process.env.DB_NAME || 'tender_portal');
    const collection = db.collection('tenders');

    let result = null;

    // 1. Try deleting as a MongoDB ObjectId
    if (ObjectId.isValid(id)) {
      result = await collection.deleteOne({ _id: new ObjectId(id) });
    }

    // 2. Try deleting as a raw String _id
    if (!result || result.deletedCount === 0) {
      result = await collection.deleteOne({ _id: id });
    }

    // 3. Try deleting using a custom 'id' field
    if (!result || result.deletedCount === 0) {
      result = await collection.deleteOne({ id: id });
    }

    if (result && result.deletedCount > 0) {
      return NextResponse.json({ success: true, message: 'Tender deleted successfully' }, { status: 200 });
    } else {
      return NextResponse.json({ error: 'Tender not found in database' }, { status: 404 });
    }

  } catch (error) {
    console.error('Delete API Error:', error);
    return NextResponse.json({ error: 'Server Error', details: error.message }, { status: 500 });
  } finally {
    if (client) {
      await client.close();
    }
  }
}

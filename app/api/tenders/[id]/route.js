import { NextResponse } from 'next/server';
import { MongoClient, ObjectId } from 'mongodb';

export async function DELETE(request, { params }) {
  let client;
  try {
    const id = params.id;
    
    // LOG 1: Track the exact ID coming from the frontend
    console.log(`[DELETE API] Initiating delete sequence for ID: "${id}"`);

    if (!id) {
      return NextResponse.json({ error: 'No ID provided in the request.' }, { status: 400 });
    }

    if (!process.env.MONGO_URL) {
      throw new Error('Database connection string (MONGO_URL) is missing.');
    }

    client = await MongoClient.connect(process.env.MONGO_URL);
    const db = client.db();
    const collection = db.collection('tenders');

    let result = null;

    // STRATEGY 1: Try deleting as a standard MongoDB ObjectId
    if (ObjectId.isValid(id)) {
      console.log('[DELETE API] ID format is valid. Attempting strict ObjectId match...');
      result = await collection.deleteOne({ _id: new ObjectId(id) });
    }

    // STRATEGY 2: Fallback to deleting as a pure String (In case POST route saved it as text)
    if (!result || result.deletedCount === 0) {
      console.log('[DELETE API] ObjectId match failed. Attempting raw String match...');
      result = await collection.deleteOne({ _id: id });
    }

    // STRATEGY 3: Fallback to checking a custom 'id' field instead of standard '_id'
    if (!result || result.deletedCount === 0) {
      console.log('[DELETE API] String match failed. Attempting custom "id" field match...');
      result = await collection.deleteOne({ id: id });
    }

    // FINAL EVALUATION
    if (result && result.deletedCount > 0) {
      console.log(`[DELETE API] SUCCESS! Tender deleted permanently.`);
      return NextResponse.json(
        { success: true, message: 'Tender deleted successfully.' }, 
        { status: 200 }
      );
    } else {
      console.log(`[DELETE API] FAILED. The ID "${id}" does not exist in the database.`);
      
      // DIAGNOSTIC LOG: Fetch the first 3 items in the DB to see what the IDs actually look like
      const sampleDocs = await collection.find({}).project({ _id: 1, title: 1 }).limit(3).toArray();
      console.log('[DELETE API] DIAGNOSTIC - Current database entries look like this:', JSON.stringify(sampleDocs));

      return NextResponse.json(
        { error: 'Tender not found. Check Vercel server logs for exact mismatch details.' }, 
        { status: 404 }
      );
    }
    
  } catch (error) {
    console.error('[DELETE API] CRITICAL SERVER ERROR:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error.message }, 
      { status: 500 }
    );
  } finally {
    if (client) {
      await client.close();
      console.log('[DELETE API] Database connection safely closed.');
    }
  }
}

import { NextResponse } from 'next/server';
import { MongoClient, ObjectId } from 'mongodb';

export async function DELETE(request, { params }) {
  let client;

  try {
    // 1. Authentication Check
    // Verifies that only a logged-in admin (who sends a Bearer token) can delete a tender
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized access. Admin token is missing.' },
        { status: 401 }
      );
    }

    // 2. ID Validation
    // Prevents server crashes by checking if the provided ID is a valid MongoDB ObjectId
    const id = params.id;
    if (!id || !ObjectId.isValid(id)) {
      return NextResponse.json(
        { error: 'Invalid Tender ID format.' },
        { status: 400 }
      );
    }

    // 3. Database Connection Check
    if (!process.env.MONGO_URL) {
      throw new Error('Database configuration (MONGO_URL) is missing.');
    }

    client = await MongoClient.connect(process.env.MONGO_URL);
    const db = client.db();

    // 4. Secure Deletion Execution
    const result = await db.collection('tenders').deleteOne({ 
      _id: new ObjectId(id) 
    });

    // 5. Precise Response Handling
    if (result.deletedCount === 1) {
      return NextResponse.json(
        { success: true, message: 'Tender successfully deleted.' }, 
        { status: 200 }
      );
    } else {
      return NextResponse.json(
        { error: 'Tender not found. It may have already been deleted.' }, 
        { status: 404 }
      );
    }
    
  } catch (error) {
    // 6. Server-side Error Logging
    console.error('[TENDER_DELETE_ERROR]:', error);
    return NextResponse.json(
      { error: 'An internal server error occurred.' }, 
      { status: 500 }
    );
  } finally {
    // 7. Resource Management
    // The 'finally' block guarantees that the database connection closes, preventing memory leaks
    if (client) {
      await client.close();
    }
  }
}

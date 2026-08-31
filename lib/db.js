import { MongoClient } from 'mongodb';

// 🚀 Shared MongoDB connection cache used by ALL API routes (kept identical to the
// previous implementation that lived inline in app/api/[[...path]]/route.js).
let cachedClient = null;
let cachedDb = null;

export async function getDb() {
  if (cachedDb) return cachedDb;
  if (!process.env.MONGO_URL) throw new Error('MONGO_URL environment variable is missing.');

  const client = await MongoClient.connect(process.env.MONGO_URL, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  cachedClient = client;
  cachedDb = client.db(process.env.DB_NAME || 'tender_portal');
  return cachedDb;
}

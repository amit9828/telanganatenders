import { MongoClient } from 'mongodb';

// 🚀 SERVERLESS FIX: Connection Exhaustion Root Cause
//
// A plain module-level variable (the previous implementation) is NOT safe in
// serverless/Next.js environments for two reasons:
//   1. Next.js Fast Refresh (dev) re-evaluates modules, wiping module-level state.
//   2. Even in a single warm Vercel invocation, `cachedDb` stayed `null` until the
//      first `MongoClient.connect()` call actually resolved. Every concurrent
//      request that arrived *before* that resolve (exactly what the Admin
//      Dashboard does — a dozen+ parallel fetches on mount) saw `cachedDb === null`
//      and kicked off its OWN separate connection, exhausting MongoDB Atlas's
//      connection limit and causing 40-50s queued delays.
//
// The fix: cache the CONNECTION PROMISE itself on `global` (not just the resolved
// value, and not a module-level variable). `global` survives both Fast Refresh and
// warm serverless re-invocation, and caching the in-flight promise means every
// concurrent caller awaits the exact same connection attempt instead of racing to
// start their own.
if (!global.mongoose) {
  global.mongoose = { promise: null };
}

export async function getDb() {
  if (!process.env.MONGO_URL) throw new Error('MONGO_URL environment variable is missing.');

  if (!global.mongoose.promise) {
    console.log('🔍 [lib/db] Opening new MongoDB connection...');
    const __connectStart = Date.now();

    // 🚀 FIX: Default serverSelectionTimeoutMS is 30000ms — if a shard host is
    // unreachable (e.g. a hardcoded/stale IP, or a network blocking the port),
    // EVERY request hangs for 30-50s before failing instead of erroring out fast.
    // Capping these means a broken DB fails in ~5-8s instead of stalling the
    // entire Admin Dashboard. No deprecated options — useNewUrlParser/
    // useUnifiedTopology are no-ops on MongoDB Node driver v4+.
    global.mongoose.promise = MongoClient.connect(process.env.MONGO_URL, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 8000,
      })
      .then((client) => {
        console.log(`🔍 [lib/db] MongoDB connected in ${Date.now() - __connectStart}ms`);
        return client.db(process.env.DB_NAME || 'tender_portal');
      })
      .catch((err) => {
        console.error(`🔍 [lib/db] MongoDB connection FAILED after ${Date.now() - __connectStart}ms:`, err.message);
        // 🚀 Don't cache a permanently broken promise — let the next call retry.
        global.mongoose.promise = null;
        throw err;
      });
  }

  return global.mongoose.promise;
}

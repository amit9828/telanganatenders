import { MongoClient } from 'mongodb';
import dns from 'dns';

// 🚀 FIX: NAT64/IPv6 connection instability. On some networks, resolving a
// hostname to its IPv6 (AAAA/NAT64-synthesized, e.g. `[64:ff9b::...]`) address
// is attempted before/instead of the plain IPv4 address, and that IPv6 path can
// be far less reliable, causing `MongoNetworkTimeoutError` / `ReplicaSetNoPrimary`
// even though the same host is instantly reachable over IPv4. This makes every
// `dns.lookup()` call in the process (including the ones the MongoDB driver
// performs on each shard hostname) prefer IPv4 first.
dns.setDefaultResultOrder('ipv4first');

// 🚀 FIX: SRV DNS resolution flakiness ("querySrv ESERVFAIL"). Some networks'
// default DNS resolvers silently fail on non-A/AAAA record types like SRV/TXT
// (which `mongodb+srv://` URIs depend on to discover the current Atlas replica
// set members). The MongoDB driver's own internal SRV lookup does NOT respect
// `dns.setServers()` on the global module (it appears to use its own resolver
// internals), so instead we pre-resolve the SRV/TXT records ourselves using a
// dedicated `dns.promises.Resolver` pointed at public DNS servers, then hand the
// driver a plain `mongodb://` URI built from the freshly-resolved hosts. This
// keeps us fully resilient to Atlas rotating/replacing shard member IPs (unlike
// permanently hardcoding them) while working around the broken default resolver.
async function resolveSrvUriViaPublicDns(srvUri) {
  const match = srvUri.match(/^mongodb\+srv:\/\/([^:]+):([^@]+)@([^/?]+)\/?(.*)$/);
  if (!match) throw new Error('MONGO_URL is not a valid mongodb+srv:// URI');
  const [, user, pass, host, queryString] = match;

  const resolver = new dns.promises.Resolver();
  resolver.setServers(['8.8.8.8', '1.1.1.1']);

  const [srvRecords, txtRecords] = await Promise.all([
    resolver.resolveSrv(`_mongodb._tcp.${host}`),
    resolver.resolveTxt(host).catch(() => []),
  ]);

  const hostList = srvRecords.map((r) => `${r.name}:${r.port}`).join(',');

  const params = new URLSearchParams(queryString);
  // Atlas publishes authSource/replicaSet via TXT record (e.g. "authSource=admin&replicaSet=...").
  new URLSearchParams(txtRecords.flat().join('&')).forEach((value, key) => {
    if (!params.has(key)) params.set(key, value);
  });
  if (!params.has('ssl')) params.set('ssl', 'true');

  return `mongodb://${user}:${pass}@${hostList}/?${params.toString()}`;
}

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

    global.mongoose.promise = (async () => {
      let uri = process.env.MONGO_URL;

      if (uri.startsWith('mongodb+srv://')) {
        try {
          uri = await resolveSrvUriViaPublicDns(uri);
          console.log('🔍 [lib/db] SRV pre-resolved via public DNS successfully.');
        } catch (err) {
          // 🚀 Fall back to letting the driver attempt its own SRV resolution
          // rather than hard-failing if the public-DNS pre-resolve step itself
          // has a problem (e.g. that network path is down too).
          console.error('🔍 [lib/db] SRV pre-resolve failed, falling back to raw URI:', err.message);
        }
      }

      // 🚀 FIX: Default serverSelectionTimeoutMS is 30000ms — if a shard host is
      // unreachable, EVERY request hangs for 30-50s before failing instead of
      // erroring out fast. Capping these means a broken DB fails in ~5-8s instead
      // of stalling the entire Admin Dashboard. No deprecated options —
      // useNewUrlParser/useUnifiedTopology are no-ops on MongoDB Node driver v4+.
      const client = await MongoClient.connect(uri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 8000,
      });

      console.log(`🔍 [lib/db] MongoDB connected in ${Date.now() - __connectStart}ms`);
      return client.db(process.env.DB_NAME || 'tender_portal');
    })().catch((err) => {
      console.error(`🔍 [lib/db] MongoDB connection FAILED after ${Date.now() - __connectStart}ms:`, err.message);
      // 🚀 Don't cache a permanently broken promise — let the next call retry.
      global.mongoose.promise = null;
      throw err;
    });
  }

  return global.mongoose.promise;
}

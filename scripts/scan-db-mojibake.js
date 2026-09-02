#!/usr/bin/env node
/**
 * Read-only scan for mojibake-corrupted text across MongoDB string fields.
 * Reports collection/field/count only — makes no writes. Run with:
 *   node -r dotenv/config scripts/scan-db-mojibake.js
 */
const { MongoClient } = require('mongodb');

const MOJIBAKE_RE = /[\u0080-\u00ff\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018\u2019\u201a\u201c\u201d\u201e\u2020\u2021\u2022\u2026\u2030\u2039\u203a\u2122]{2,}/gu;

async function main() {
  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error('MONGO_URL not set');
  const client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 8000 });
  const db = client.db(process.env.DB_NAME || 'tender_portal');

  const collections = await db.listCollections().toArray();
  let totalHits = 0;

  for (const { name } of collections) {
    const docs = await db.collection(name).find({}).limit(2000).toArray();
    let hits = 0;
    const samples = [];
    for (const doc of docs) {
      for (const [key, value] of Object.entries(doc)) {
        if (typeof value === 'string' && MOJIBAKE_RE.test(value)) {
          hits++;
          if (samples.length < 3) samples.push(`${key}: ${value.slice(0, 80)}`);
        }
        MOJIBAKE_RE.lastIndex = 0;
      }
    }
    if (hits > 0) {
      totalHits += hits;
      console.log(`\n[${name}] ${hits} field(s) with suspected mojibake (scanned ${docs.length} docs):`);
      samples.forEach((s) => console.log(`   e.g. ${s}`));
    }
  }

  console.log(`\nTotal suspected mojibake fields: ${totalHits}`);
  await client.close();
}

main().catch((err) => {
  console.error('Scan failed:', err.message);
  process.exit(1);
});

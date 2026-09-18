#!/usr/bin/env node
/**
 * Permanently deletes every document in `client_requests`.
 * Does not touch workflow_jobs or tenders.
 *
 *   node scripts/purge-client-requests.js
 */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

function loadLocalEnv() {
  const root = process.cwd();
  for (const name of ['.env.local', '.env']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] == null || process.env[key] === '') process.env[key] = value;
    }
  }
}

async function main() {
  loadLocalEnv();
  const uri = process.env.MONGO_URL;
  if (!uri) throw new Error('MONGO_URL not set');
  const client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 20000 });
  const db = client.db(process.env.DB_NAME || 'tender_portal');
  const result = await db.collection('client_requests').deleteMany({});
  console.log(`Deleted ${result.deletedCount} client_requests document(s).`);
  await client.close();
}

main().catch((err) => {
  console.error('Purge failed:', err.message);
  process.exit(1);
});

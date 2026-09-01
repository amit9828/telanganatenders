import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URL, {
  serverSelectionTimeoutMS: 15000,
});

await client.connect();
const db = client.db(process.env.DB_NAME || 'tender_portal');

const total = await db.collection('tenders').countDocuments();

const docs = await db
  .collection('tenders')
  .find({}, { projection: { title: 1, pdf_url: 1, pdf_r2_key: 1, pdf_filename: 1, file_url: 1, last_date: 1 } })
  .sort({ created_at: -1 })
  .limit(2000)
  .toArray();

// pdf_base64 is huge, so only ask Mongo whether it exists.
const withBase64 = new Set(
  (await db.collection('tenders').find({ pdf_base64: { $exists: true, $ne: null } }, { projection: { _id: 1 } }).toArray())
    .map((d) => String(d._id))
);

let counts = { url: 0, base64: 0, r2KeyOnly: 0, nothing: 0 };
const broken = [];

for (const d of docs) {
  const url = String(d.pdf_url || d.file_url || '').trim();
  const hasB64 = withBase64.has(String(d._id));
  if (url) counts.url++;
  else if (hasB64) counts.base64++;
  else if (d.pdf_r2_key) counts.r2KeyOnly++;
  else {
    counts.nothing++;
    broken.push({ id: String(d._id), title: d.title, pdf_filename: d.pdf_filename || null });
  }
}

console.log('DB name:', db.databaseName);
console.log('Total tenders:', total, '| inspected:', docs.length);
console.log('Breakdown:', counts);

const sampleUrls = docs.filter((d) => d.pdf_url || d.file_url).slice(0, 5)
  .map((d) => ({ id: String(d._id), url: d.pdf_url || d.file_url, key: d.pdf_r2_key || null }));
console.log('\nSample stored URLs:');
console.dir(sampleUrls, { depth: null });

console.log('\nTenders with NO retrievable PDF (first 15):');
console.dir(broken.slice(0, 15), { depth: null });

await client.close();

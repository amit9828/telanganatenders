// Sanity check for the PDF-serving helpers. Run: node scripts/verify-pdf-helpers.mjs
import assert from 'node:assert/strict';
import { isPubliclyServableUrl, isValidPDFBuffer, buildTenderPDFKeys } from '../lib/cloudflare-r2.js';

// --- isPubliclyServableUrl: the private S3 API endpoint must never be handed to a browser.
delete process.env.CLOUDFLARE_R2_PUBLIC_URL;
assert.equal(isPubliclyServableUrl('https://abc123.r2.cloudflarestorage.com/bucket/tenders/x.pdf'), false);
assert.equal(isPubliclyServableUrl('https://pub-abc.r2.dev/tenders/x.pdf'), true);
assert.equal(isPubliclyServableUrl('https://files.tgtenders.in/tenders/x.pdf'), true);
assert.equal(isPubliclyServableUrl(''), false);
assert.equal(isPubliclyServableUrl(null), false);
assert.equal(isPubliclyServableUrl('/tenders/x.pdf'), false);

process.env.CLOUDFLARE_R2_PUBLIC_URL = 'https://abc123.r2.cloudflarestorage.com/bucket';
assert.equal(isPubliclyServableUrl('https://abc123.r2.cloudflarestorage.com/bucket/tenders/x.pdf'), true);
delete process.env.CLOUDFLARE_R2_PUBLIC_URL;

// --- isValidPDFBuffer: catches the garbage that Buffer.from() returns for bad base64.
assert.equal(isValidPDFBuffer(Buffer.from('%PDF-1.7\n...')), true);
assert.equal(isValidPDFBuffer(Buffer.from('not a pdf at all')), false);
assert.equal(isValidPDFBuffer(Buffer.from('this is not base64!!!', 'base64')), false);
assert.equal(isValidPDFBuffer(Buffer.alloc(0)), false);
assert.equal(isValidPDFBuffer(null), false);

// A real PDF round-tripped through a data-URL prefix, the way the app stores it.
const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n');
const dataUrl = `data:application/pdf;base64,${pdfBytes.toString('base64')}`;
const decoded = Buffer.from(dataUrl.replace(/^data:[^;,]*(;base64)?,/, ''), 'base64');
assert.equal(isValidPDFBuffer(decoded), true);
assert.equal(decoded.toString(), pdfBytes.toString());

// The old regex was /^data:(.*,)?/ — greedy, so verify the tightened one is equivalent
// here and doesn't chew into the payload.
assert.equal(Buffer.from(pdfBytes.toString('base64').replace(/^data:[^;,]*(;base64)?,/, ''), 'base64').toString(), pdfBytes.toString());

// --- buildTenderPDFKeys: every place an object could be hiding, most specific first.
assert.deepEqual(
  buildTenderPDFKeys({ pdf_r2_key: 'tenders/1700-a.pdf' }),
  ['tenders/1700-a.pdf']
);
assert.deepEqual(
  buildTenderPDFKeys({ pdf_url: 'https://abc.r2.cloudflarestorage.com/bucket/tenders/1700-a.pdf' }),
  ['tenders/1700-a.pdf']
);
assert.deepEqual(
  buildTenderPDFKeys({ pdf_filename: 'my tender.pdf' }),
  ['tenders/my_tender.pdf']
);
// URL-encoded paths must decode before use.
assert.deepEqual(
  buildTenderPDFKeys({ pdf_url: 'https://pub.r2.dev/tenders/1700-my%20tender.pdf' }),
  ['tenders/1700-my tender.pdf']
);
// Duplicates collapse.
assert.deepEqual(
  buildTenderPDFKeys({ pdf_r2_key: 'tenders/a.pdf', pdf_url: 'https://pub.r2.dev/tenders/a.pdf' }),
  ['tenders/a.pdf']
);
assert.deepEqual(buildTenderPDFKeys({}), []);

console.log('All PDF helper checks passed.');

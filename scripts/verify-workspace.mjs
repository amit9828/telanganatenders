// Security and routing checks for the Gemini Workspace pipelines.
// Run: node scripts/verify-workspace.mjs
import assert from 'node:assert/strict';
import { classifyWorkspacePrompt, INTENT, resolveClient } from '../lib/workspace-intent.js';
import { markdownToPlainText, markdownToSafeHtml } from '../lib/markdown-lite.js';
import { wrapWithStationery } from '../lib/stationery-html.js';
import { parseAIJson } from '../lib/ai-extraction.js';
import { sendWhatsAppAlert } from '../lib/whatsapp.js';
import { computeDiscountPct, normaliseHistoricalRow } from '../lib/historical-l1.js';

// --- Intent routing: SOW/ATC questions must not fall through to general RAG.
const sow = classifyWorkspacePrompt('What is the scope of work for tender GEM/2026/B/12345?');
assert.equal(sow.intent, INTENT.DEEP_DIVE);
assert.equal(sow.tenderHint, 'GEM/2026/B/12345');

const atc = classifyWorkspacePrompt('List the additional terms and ATC for this bid');
assert.equal(atc.intent, INTENT.DEEP_DIVE);

const oem = classifyWorkspacePrompt('Generate an OEM Authorization letter for client CLI-1001 on tender GEM/2026/B/99');
assert.equal(oem.intent, INTENT.GENERATE_DOC);
assert.equal(oem.docType?.id, 'oem_authorization');
assert.equal(oem.clientHint?.kind, 'cli');
assert.equal(oem.clientHint?.value, 'CLI-1001');
assert.equal(oem.tenderHint, 'GEM/2026/B/99');

const general = classifyWorkspacePrompt('How does GeM calculate Make in India local content?');
assert.equal(general.intent, INTENT.GENERAL);

const clients = [
  { email: 'acme@example.com', client_id: 'CLI-ACME1', company_name: 'Acme' },
  { email: 'beta@tgtenders.in', company_name: 'Beta' },
];
assert.equal(resolveClient({ kind: 'cli', value: 'CLI-ACME1' }, clients).email, 'acme@example.com');
assert.equal(resolveClient({ kind: 'cli', value: 'CLI-BETAX' }, clients).email, 'beta@tgtenders.in');
assert.equal(resolveClient({ kind: 'email', value: 'acme@example.com' }, clients).company_name, 'Acme');
assert.equal(resolveClient(null, clients), null);

// --- Markdown renderer must escape HTML so a model cannot XSS the panel.
const xss = markdownToSafeHtml('Hello <script>alert(1)</script>\n\n- item **bold**\n\n## Heading');
assert.ok(xss.includes('&lt;script&gt;'), 'raw HTML must be escaped');
assert.ok(!xss.includes('<script>'), 'script tags must not survive');
assert.ok(xss.includes('<strong>bold</strong>'));
assert.ok(xss.includes('<h2>Heading</h2>'));
assert.ok(xss.includes('<li>'));
assert.equal(markdownToPlainText('## Scope\n- Do the work'), 'Scope\nDo the work');

// --- Stationery wrapper: only https / data-image / our own file route, never javascript:.
const wrapped = wrapWithStationery('<p>Body</p>', {
  letterheadSrc: 'javascript:alert(1)',
  signatureSrc: 'https://cdn.example.com/sign.png',
});
assert.ok(!wrapped.includes('javascript:'), 'javascript: letterhead must be rejected');
assert.ok(wrapped.includes('https://cdn.example.com/sign.png'), 'https signature should render');
assert.ok(wrapped.includes('stationery-sheet'));
assert.ok(wrapped.includes('<p>Body</p>'));

const dataWrap = wrapWithStationery('<p>X</p>', {
  letterheadSrc: 'data:image/png;base64,aaa',
});
assert.ok(dataWrap.includes('data:image/png;base64,aaa'));

const httpWrap = wrapWithStationery('<p>X</p>', { letterheadSrc: 'http://evil.test/lh.png' });
assert.ok(!httpWrap.includes('evil.test'), 'plaintext HTTP letterhead must be rejected');

// --- parseAIJson must accept arrays (historical PDF extraction) as well as objects.
assert.deepEqual(parseAIJson('[{"tender_title":"Road work","l1_price":100}]'), [
  { tender_title: 'Road work', l1_price: 100 },
]);
assert.equal(parseAIJson('```json\n{"a":1}\n```').a, 1);
assert.equal(parseAIJson('not json'), null);

// --- Historical row normalisation.
assert.equal(computeDiscountPct(90, 100), 10);
assert.equal(normaliseHistoricalRow({ tender_title: 'Work', l1_price: '₹1,00,000', estimate_value: 120000 }).discount_pct, 16.67);
assert.equal(normaliseHistoricalRow({ title: 'Nope' }), null);

// --- WhatsApp: a missing/false verification flag skips automated client sends.
const skipped = await sendWhatsAppAlert('9876543210', 'hello', { whatsapp_verified: false });
assert.equal(skipped.skipped, true);
assert.equal(skipped.sent, false);

const missing = await sendWhatsAppAlert('9876543210', 'hello', { whatsapp_verified: undefined });
assert.equal(missing.skipped, true, 'explicit undefined flag must still skip');

// Internal MD alerts omit the flag entirely and only skip on missing config/number.
const mdPath = await sendWhatsAppAlert('', 'hello');
assert.equal(mdPath.skipped, true);
assert.match(mdPath.reason || '', /number|configured/i);

console.log('verify-workspace: all assertions passed');

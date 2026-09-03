// Sanity check for the GeM Co-Pilot retrieval primitives.
// Run: node scripts/verify-gem-rag.mjs
import assert from 'node:assert/strict';
import { chunkText, cosineSimilarity, normaliseWhitespace } from '../lib/gem-embeddings.js';
import { htmlToText, SEED_DOCUMENTS, REMOTE_SOURCES } from '../lib/gem-knowledge.js';
import { bidDocumentId } from '../lib/rag-ingest.js';
import { classifyLink, isSafeRemoteUrl } from '../lib/tender-links.js';
import { containsTelugu, languageContract, resolveAnswerLanguage, LANGUAGES } from '../lib/language.js';
import { missingSlots, PHASE, REQUIRED_SLOTS } from '../lib/doc-session.js';
import { FETCH_FAILURE, shouldRetryViaLocalAgent } from '../lib/remote-document.js';

// --- normaliseWhitespace: PDF/HTML extraction produces whitespace soup that would
// otherwise eat a large share of every chunk's token budget.
assert.equal(normaliseWhitespace('a   \t  b'), 'a b');
assert.equal(normaliseWhitespace('a\r\nb'), 'a\nb');
assert.equal(normaliseWhitespace('a\n\n\n\n\nb'), 'a\n\nb');
assert.equal(normaliseWhitespace('  padded  '), 'padded');
assert.equal(normaliseWhitespace(null), '');

// --- chunkText
assert.deepEqual(chunkText(''), []);
assert.deepEqual(chunkText('short text'), ['short text']);

// Long input must split, and every chunk must respect the size limit.
const long = Array.from({ length: 400 }, (_, i) => `Clause ${i}: the supplier shall comply with the stated requirement.`).join(' ');
const chunks = chunkText(long);
assert.ok(chunks.length > 1, 'long text should split into multiple chunks');
for (const c of chunks) assert.ok(c.length <= 4000, `chunk of ${c.length} chars exceeds the limit`);

// No content may be lost: every clause number must survive somewhere.
const joined = chunks.join(' ');
for (const marker of ['Clause 0:', 'Clause 199:', 'Clause 399:']) {
  assert.ok(joined.includes(marker), `${marker} was dropped during chunking`);
}

// Consecutive chunks must overlap so a rule spanning a boundary stays retrievable.
const overlapFound = chunks.slice(0, -1).some((chunk, i) => {
  const tail = chunk.slice(-200);
  return tail.length > 0 && chunks[i + 1].includes(tail.slice(0, 80));
});
assert.ok(overlapFound, 'expected overlap between consecutive chunks');

// Termination guard: pathological input must not spin forever or drop everything.
const noBreaks = 'x'.repeat(20000);
const noBreakChunks = chunkText(noBreaks);
assert.ok(noBreakChunks.length >= 5, 'text with no sentence breaks should still chunk');
assert.ok(noBreakChunks.every(c => c.length <= 4000));

// A tiny chunk size must still terminate rather than loop on the overlap.
const tiny = chunkText('one two three four five six seven eight nine ten', { chunkChars: 10, overlap: 9 });
assert.ok(tiny.length > 0 && tiny.length < 100, `expected bounded chunk count, got ${tiny.length}`);

// --- cosineSimilarity
assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
assert.ok(Math.abs(cosineSimilarity([1, 0], [-1, 0]) + 1) < 1e-9);
// Degenerate input must score 0, never NaN — NaN would corrupt the ranking sort.
assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
assert.equal(cosineSimilarity(null, [1]), 0);
assert.equal(cosineSimilarity([1, 2, 3], undefined), 0);

// Ranking must be meaningful, not just non-crashing.
const query = [1, 1, 0];
const near = [1, 0.9, 0.1];
const far = [0, 0, 1];
assert.ok(cosineSimilarity(query, near) > cosineSimilarity(query, far));

// --- htmlToText
assert.equal(htmlToText('<p>Hello</p>').trim(), 'Hello');
assert.ok(!htmlToText('<script>evil()</script><p>Safe</p>').includes('evil'));
assert.ok(!htmlToText('<style>.a{color:red}</style><p>Safe</p>').includes('color'));
assert.ok(!htmlToText('<!-- secret --><p>Safe</p>').includes('secret'));
assert.equal(htmlToText('<p>A&amp;B &lt;tag&gt; &quot;q&quot;</p>').trim(), 'A&B <tag> "q"');
// Block elements must become line breaks so chunking can find paragraph boundaries.
assert.ok(htmlToText('<p>One</p><p>Two</p>').includes('\n'));
assert.ok(htmlToText('<li>A</li><li>B</li>').includes('\n'));

// --- Corpus integrity: the seed knowledge base is what makes the Co-Pilot useful on
// day one, so guard its shape.
assert.ok(SEED_DOCUMENTS.length >= 5, 'expected a meaningful seed corpus');
const ids = SEED_DOCUMENTS.map(d => d.id);
assert.equal(new Set(ids).size, ids.length, 'seed document ids must be unique');
for (const doc of SEED_DOCUMENTS) {
  assert.ok(doc.id && doc.title, `seed doc missing id/title: ${doc.id}`);
  assert.ok(doc.content.trim().length > 300, `seed doc "${doc.id}" is too thin to be useful`);
  assert.ok(chunkText(doc.content).length >= 1, `seed doc "${doc.id}" produced no chunks`);
}
const remoteIds = REMOTE_SOURCES.map(s => s.id);
assert.equal(new Set([...ids, ...remoteIds]).size, ids.length + remoteIds.length, 'document ids must not collide across seed and remote');
for (const src of REMOTE_SOURCES) {
  assert.ok(['pdf', 'html'].includes(src.type), `unknown source type: ${src.type}`);
  assert.ok(/^https:\/\//.test(src.url), `source ${src.id} must use https`);
}

// --- Per-bid vector ids: a typo here would mix two tenders' clauses in retrieval.
assert.equal(bidDocumentId('GEM/2026/B/1234567', 'SOW', 0), 'bid::GEM-2026-B-1234567::SOW::0');
assert.equal(bidDocumentId('gem/2026/b/99', 'ATC', 2), 'bid::GEM-2026-B-99::ATC::2');
assert.ok(bidDocumentId('GEM/2026/B/1', 'SOW') !== bidDocumentId('GEM/2026/B/2', 'SOW'));

// --- SSRF guard: a URL that came out of an AI-extracted PDF is attacker-influenced.
assert.equal(isSafeRemoteUrl('https://bidplus.gem.gov.in/docs/sow.pdf'), true);
assert.equal(isSafeRemoteUrl('https://mkp.gem.gov.in/documents/GTC.pdf'), true);
assert.equal(isSafeRemoteUrl('http://127.0.0.1/secret'), false);
assert.equal(isSafeRemoteUrl('http://localhost:3000/admin'), false);
assert.equal(isSafeRemoteUrl('http://169.254.169.254/latest/meta-data/'), false);
assert.equal(isSafeRemoteUrl('http://10.0.0.8/internal'), false);
assert.equal(isSafeRemoteUrl('http://192.168.1.1/x'), false);
assert.equal(isSafeRemoteUrl('ftp://gem.gov.in/file'), false);
assert.equal(isSafeRemoteUrl('not a url'), false);

// --- Link classification from surrounding prose, which is how GeM labels attachments.
assert.equal(classifyLink('https://example.gov.in/x.pdf', 'Buyer Additional Terms'), 'ATC');
assert.equal(classifyLink('https://example.gov.in/x.pdf', 'Scope of Work annexure'), 'SOW');
assert.equal(classifyLink('https://example.gov.in/corrigendum-1.pdf', ''), 'CORRIGENDUM');
assert.equal(classifyLink('https://example.gov.in/boq.xlsx', 'Bill of Quantity'), 'BOQ');

// --- Telugu: detect script, honour the selector, pin the glossary, never-translate list.
assert.equal(containsTelugu('What is the EMD?'), false);
assert.equal(containsTelugu('ఈ బిడ్ యొక్క EMD ఎంత?'), true);
assert.equal(resolveAnswerLanguage('What is the EMD?', LANGUAGES.AUTO), LANGUAGES.ENGLISH);
assert.equal(resolveAnswerLanguage('ఈ బిడ్ యొక్క EMD ఎంత?', LANGUAGES.AUTO), LANGUAGES.TELUGU);
assert.equal(resolveAnswerLanguage('ఈ బిడ్ యొక్క EMD ఎంత?', LANGUAGES.ENGLISH), LANGUAGES.ENGLISH);
assert.equal(resolveAnswerLanguage('What is the EMD?', LANGUAGES.TELUGU), LANGUAGES.TELUGU);

const teContract = languageContract(LANGUAGES.TELUGU);
assert.ok(teContract.includes('Telugu'), 'Telugu contract must name the language');
assert.ok(teContract.includes('GFR 2017'), 'statutory names must stay in English');
assert.ok(teContract.includes('GEM/2026/B/1234567'), 'bid numbers must stay verbatim');
assert.ok(teContract.includes('అండర్‌టేకింగ్'), 'glossary must pin a Telugu form for undertaking');
assert.ok(teContract.includes('IN TELUGU'), 'refusals must stay in Telugu');

const enContract = languageContract(LANGUAGES.ENGLISH);
assert.ok(enContract.includes('English'));
assert.ok(!enContract.includes('IN TELUGU'));

// --- Document Studio gate: generation is forbidden while required slots are empty.
assert.deepEqual(REQUIRED_SLOTS, ['doc_type', 'client_email', 'letterhead_id']);
assert.deepEqual(missingSlots({}), REQUIRED_SLOTS);
assert.deepEqual(
  missingSlots({ doc_type: { ok: true }, client_email: { ok: true }, letterhead_id: { ok: true } }),
  [],
);
assert.deepEqual(
  missingSlots({ doc_type: { ok: true }, client_email: { ok: false }, letterhead_id: { ok: true } }),
  ['client_email'],
);
assert.equal(PHASE.GATHERING, 'gathering');
assert.equal(PHASE.OUTLINE_PENDING, 'outline_pending');
assert.equal(PHASE.CONFIRMED, 'confirmed');
assert.equal(PHASE.RENDERED, 'rendered');

// --- Local agent is only the rescue for a login wall, never for a blocked or oversized URL.
assert.equal(shouldRetryViaLocalAgent(FETCH_FAILURE.LOGIN_WALL), true);
assert.equal(shouldRetryViaLocalAgent(FETCH_FAILURE.BLOCKED), false);
assert.equal(shouldRetryViaLocalAgent(FETCH_FAILURE.TOO_LARGE), false);
assert.equal(shouldRetryViaLocalAgent(FETCH_FAILURE.NOT_PDF), false);

console.log('All GeM RAG checks passed.');

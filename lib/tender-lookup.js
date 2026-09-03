import { ObjectId } from 'mongodb';

/** Official BidPlus bid number as printed at the top of every GeM bid document. */
const GEM_BID_RE = /GEM\s*[\/\-]?\s*(\d{4})\s*[\/\-]?\s*([A-Z])\s*[\/\-]?\s*(\d{4,})/i;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Canonical `GEM/YYYY/B/NNNNNNN` form, or null when the text holds no bid number.
 * Tolerates the spacing and separator noise that comes from copy-pasting out of a PDF.
 */
export function normaliseBidNo(value) {
  const match = String(value || '').toUpperCase().match(GEM_BID_RE);
  if (!match) return null;
  return `GEM/${match[1]}/${match[2]}/${match[3]}`;
}

/** The trailing serial (`7938430`) — the part a human actually reads out loud. */
export function bidSerial(value) {
  const normalised = normaliseBidNo(value);
  if (normalised) return normalised.split('/').pop();
  const digits = String(value || '').match(/\d{5,}/g);
  return digits ? digits[digits.length - 1] : null;
}

/**
 * Tender identifiers arrive from several places — Mongo `_id` strings, the legacy `id`
 * field, and bid numbers typed or pasted by staff — so every lookup has to try all of
 * them.
 *
 * The bid-number filters are deliberately layered from strict to loose. Records created
 * by hand carry inconsistent casing and separators (`gem/2026/b/56486` sits next to
 * `GEM/2026/B/7968410` in this database), and a document's real bid number frequently
 * differs from whatever was typed into the form — the truth is printed at the top of the
 * PDF, which is why `bid_no_aliases` (written by the AI analysis routes) is also matched.
 *
 * @param {string} tenderId
 * @returns {Array<object>} Mongo filters to try in order.
 */
export function tenderFilters(tenderId) {
  const id = String(tenderId || '').trim();
  const filters = [];
  if (!id) return filters;

  if (ObjectId.isValid(id)) {
    try { filters.push({ _id: new ObjectId(id) }); } catch { /* not an ObjectId after all */ }
  }
  filters.push({ _id: id }, { id }, { bid_no: id });

  // Same string, any casing.
  filters.push({ bid_no: { $regex: `^\\s*${escapeRegExp(id)}\\s*$`, $options: 'i' } });

  const canonical = normaliseBidNo(id);
  if (canonical) {
    const [, year, letter, serial] = canonical.split('/');
    // Any separator/spacing variant of the same bid number.
    const loose = `^\\s*GEM\\s*[/\\-]?\\s*${year}\\s*[/\\-]?\\s*${letter}\\s*[/\\-]?\\s*${serial}\\s*$`;
    filters.push({ bid_no: { $regex: loose, $options: 'i' } });
    filters.push({ bid_no_aliases: { $regex: loose, $options: 'i' } });
  }

  // Last resort: the serial alone. Long enough to be unambiguous, and it rescues records
  // whose year or category letter was mistyped during manual entry.
  const serial = bidSerial(id);
  if (serial && serial.length >= 5) {
    const tail = `${escapeRegExp(serial)}\\s*$`;
    filters.push({ bid_no: { $regex: tail, $options: 'i' } });
    filters.push({ bid_no_aliases: { $regex: tail, $options: 'i' } });
  }

  return filters;
}

/**
 * Finds a tender by any of its identifiers.
 *
 * @param {import('mongodb').Db} db
 * @param {string} tenderId
 * @param {object} [options] Passed straight to findOne (projection, etc).
 */
export async function findTenderByAnyId(db, tenderId, options = {}) {
  for (const filter of tenderFilters(tenderId)) {
    const tender = await db.collection('tenders').findOne(filter, options);
    if (tender) return tender;
  }
  return null;
}

/**
 * Records the bid number the AI actually read off the document, so the next lookup by
 * that number succeeds even though the manually typed `bid_no` says something else.
 * Never overwrites `bid_no` — staff own that field.
 */
export async function rememberBidNoAlias(db, tenderId, rawBidNo) {
  const alias = normaliseBidNo(rawBidNo);
  if (!alias || !tenderId) return null;
  await db.collection('tenders').updateOne(
    { _id: tenderId },
    { $addToSet: { bid_no_aliases: alias } },
  ).catch((err) => console.warn('[tender-lookup] could not store bid alias:', err?.message));
  return alias;
}

/**
 * Explains a failed lookup instead of returning a bare "not found".
 * Suggests the closest bid numbers on record so staff can spot a typo immediately.
 */
export async function suggestSimilarTenders(db, tenderId, limit = 5) {
  const serial = bidSerial(tenderId);
  if (!serial) return [];

  // Match progressively shorter prefixes of the serial — a single mistyped digit still
  // surfaces the intended bid.
  const prefixes = [serial.slice(0, 5), serial.slice(0, 4)].filter((p) => p.length >= 4);
  const docs = await db.collection('tenders')
    .find(
      { $or: prefixes.map((p) => ({ bid_no: { $regex: escapeRegExp(p), $options: 'i' } })) },
      { projection: { bid_no: 1, title: 1 }, limit },
    )
    .toArray()
    .catch(() => []);

  return docs.map((d) => ({ id: String(d._id), bid_no: d.bid_no || null, title: d.title || null }));
}

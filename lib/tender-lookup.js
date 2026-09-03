import { ObjectId } from 'mongodb';

/**
 * Tender identifiers arrive from several places — Mongo `_id` strings, the legacy `id`
 * field, and bid numbers typed by staff — so every lookup has to try all of them.
 *
 * @param {string} tenderId
 * @returns {Array<object>} Mongo filters to try in order.
 */
export function tenderFilters(tenderId) {
  const id = String(tenderId || '').trim();
  const filters = [];
  if (ObjectId.isValid(id)) {
    try { filters.push({ _id: new ObjectId(id) }); } catch { /* not an ObjectId after all */ }
  }
  filters.push({ _id: id }, { id }, { bid_no: id });
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

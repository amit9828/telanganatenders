export const PAYLOAD_GRACE_DAYS = 10;

export function startOfToday(now = Date.now()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return today;
}

export function todayIso(now = Date.now()) {
  return startOfToday(now).toISOString().slice(0, 10);
}

/** last_date is mixed Date / ISO string in this collection. */
export function lastDateGteClause(date, iso) {
  return { $or: [{ last_date: { $gte: date } }, { last_date: { $gte: iso } }] };
}

export function lastDateLtClause(date, iso) {
  return { $or: [{ last_date: { $lt: date } }, { last_date: { $lt: iso } }] };
}

export function notExpiredAtClause() {
  return { $or: [{ expired_at: { $exists: false } }, { expired_at: null }] };
}

/** Live lists: not stamped expired AND last_date is today or later. */
export function liveTenderQuery(now = Date.now()) {
  const today = startOfToday(now);
  const iso = today.toISOString().slice(0, 10);
  return {
    $and: [notExpiredAtClause(), lastDateGteClause(today, iso)],
  };
}

/** Archive page: stamped expired OR last_date already past. */
export function archiveTenderQuery(now = Date.now()) {
  const today = startOfToday(now);
  const iso = today.toISOString().slice(0, 10);
  return {
    $or: [
      { expired_at: { $exists: true, $nin: [null, ''] } },
      { last_date: { $lt: today } },
      { last_date: { $lt: iso } },
    ],
  };
}

export function expiredUnstampedQuery(now = Date.now()) {
  const today = startOfToday(now);
  const iso = today.toISOString().slice(0, 10);
  return {
    $and: [notExpiredAtClause(), lastDateLtClause(today, iso)],
  };
}

export function payloadGraceCutoff(now = Date.now(), days = PAYLOAD_GRACE_DAYS) {
  const date = startOfToday(now);
  date.setDate(date.getDate() - days);
  return { date, iso: date.toISOString().slice(0, 10) };
}

export function pastPayloadGraceQuery(now = Date.now(), days = PAYLOAD_GRACE_DAYS) {
  const { date, iso } = payloadGraceCutoff(now, days);
  return lastDateLtClause(date, iso);
}

export async function stampExpiredTenders(db, now = Date.now()) {
  const result = await db.collection('tenders').updateMany(
    expiredUnstampedQuery(now),
    { $set: { expired_at: new Date(now) } },
  );
  return { matched: result.matchedCount, stamped: result.modifiedCount };
}

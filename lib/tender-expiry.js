export const PAYLOAD_GRACE_DAYS = 10;
const IST = 'Asia/Kolkata';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar YYYY-MM-DD in Asia/Kolkata (live lists and expiry, not Vercel UTC). */
export function todayIso(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now));
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

/** Midnight IST as a Date (UTC instant). */
export function startOfToday(now = Date.now()) {
  return new Date(`${todayIso(now)}T00:00:00+05:30`);
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

/** Live lists: not stamped expired AND last_date is today or later (IST). */
export function liveTenderQuery(now = Date.now()) {
  const today = startOfToday(now);
  const iso = todayIso(now);
  return {
    $and: [notExpiredAtClause(), lastDateGteClause(today, iso)],
  };
}

/** Archive page: stamped expired OR last_date already past (IST). */
export function archiveTenderQuery(now = Date.now()) {
  const today = startOfToday(now);
  const iso = todayIso(now);
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
  const iso = todayIso(now);
  return {
    $and: [notExpiredAtClause(), lastDateLtClause(today, iso)],
  };
}

export function payloadGraceCutoff(now = Date.now(), days = PAYLOAD_GRACE_DAYS) {
  const date = new Date(startOfToday(now).getTime() - days * DAY_MS);
  return { date, iso: todayIso(date.getTime()) };
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

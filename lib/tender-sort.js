export function lastDateMs(value) {
  if (!value) return NaN;
  const d = new Date(value);
  return d.getTime();
}

export function isLiveLastDate(value, now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const ms = lastDateMs(value);
  if (Number.isNaN(ms)) return false;
  return ms >= start.getTime();
}

export function sortByLastDateAsc(rows = []) {
  return [...rows].sort((a, b) => {
    const aMs = lastDateMs(a?.last_date);
    const bMs = lastDateMs(b?.last_date);
    const aOk = !Number.isNaN(aMs);
    const bOk = !Number.isNaN(bMs);
    if (aOk && bOk) return aMs - bMs;
    if (aOk) return -1;
    if (bOk) return 1;
    return 0;
  });
}

export function liveTendersOnly(rows = [], now = Date.now()) {
  return sortByLastDateAsc(rows.filter((t) => isLiveLastDate(t?.last_date, now)));
}

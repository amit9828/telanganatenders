export const INTERNAL_BOARD_STATUSES = [
  'MD_CHECKLIST',
  'TL_ASSIGN',
  'MAKER_PREP',
  'TL_QC',
  'GM_QC',
  'MD_SUBMIT',
  'AWAITING_RECEIPT',
];

export const SUBMITTED_BOARD_STATUSES = ['SUBMITTED', 'WON'];

export const LIVE_QUEUE_STATUSES = ['LIVE', 'AWAITING_CLIENT', 'AWAITING_PUBLISH'];

export function jobKey(jobOrId) {
  if (jobOrId && typeof jobOrId === 'object') return String(jobOrId._id || '');
  return String(jobOrId || '');
}

export function upsertJob(list = [], job) {
  if (!job) return list;
  const id = jobKey(job);
  if (!id) return list;
  const idx = list.findIndex((row) => jobKey(row) === id);
  if (idx === -1) return [job, ...list];
  const next = list.slice();
  next[idx] = { ...list[idx], ...job };
  return next;
}

export function dropJob(list = [], id) {
  const key = jobKey(id);
  if (!key) return list;
  return list.filter((row) => jobKey(row) !== key);
}

export function belongsOnInternal(job) {
  return Boolean(job && INTERNAL_BOARD_STATUSES.includes(job.status));
}

export function belongsOnSubmitted(job) {
  return Boolean(job && SUBMITTED_BOARD_STATUSES.includes(job.status));
}

export function belongsOnLiveQueue(job) {
  return Boolean(job && LIVE_QUEUE_STATUSES.includes(job.status));
}

/** Waiting for client approval: parked LIVE or AWAITING_CLIENT. Gone at MD_CHECKLIST+. */
export function belongsOnSuggestions(job) {
  if (!job) return false;
  if (job.status === 'AWAITING_CLIENT') return true;
  return job.status === 'LIVE' && Boolean(job.parked_client_email);
}

export function applyJobToBoard(list, job, predicate) {
  const without = dropJob(list, job);
  if (!job || !predicate(job)) return without;
  return upsertJob(without, job);
}

export function stampOf(row) {
  if (!row) return '';
  return [
    row._id || row.id || '',
    row.updated_at || '',
    row.status || '',
    row.tracking_status || '',
    row.parked_client_email || '',
    row.last_date || '',
  ].join(':');
}

export function sameStamps(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (stampOf(a[i]) !== stampOf(b[i])) return false;
  }
  return true;
}

export function setListIfChanged(setter, next) {
  setter((prev) => (sameStamps(prev, next) ? prev : next));
}

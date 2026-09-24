function parseLocalDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value || '').trim();
  if (!text) return null;
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.\d+)?Z)?$/);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Local end-of-day deadline. Urgent while that day is still ahead and at most 3 calendar days out. */
export function deadlineUrgency(value, now = new Date()) {
  const parsed = parseLocalDate(value);
  if (!parsed) return null;
  const end = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 23, 59, 59, 999);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDeadline = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  const calendarDays = Math.round((startDeadline.getTime() - startToday.getTime()) / 86400000);
  if (now.getTime() > end.getTime()) return { text: 'Ended', urgent: false };
  if (calendarDays <= 0) {
    const hours = Math.max(1, Math.ceil((end.getTime() - now.getTime()) / 3600000));
    return { text: `Last ${hours} ${hours === 1 ? 'hour' : 'hours'}`, urgent: true };
  }
  if (calendarDays === 1) return { text: 'Last 1 day', urgent: true };
  if (calendarDays === 2) return { text: 'Last 2 days', urgent: true };
  if (calendarDays === 3) return { text: 'Last 3 days', urgent: true };
  return { text: `Ends: ${parsed.toLocaleDateString()}`, urgent: false };
}

const CLOSED_STATUSES = new Set(['SUBMITTED', 'WON']);

const CLOSED_TRACKING = new Set([
  'Submitted',
  'Technical evaluation',
  'Financial evaluation',
  'Bid Awarded',
  'Won',
  'Lost',
]);

function deadlineClosed(job) {
  if (!job) return false;
  if (job.archived_at || job.archive_reason) return true;
  if (CLOSED_STATUSES.has(String(job.status || ''))) return true;
  return CLOSED_TRACKING.has(String(job.tracking_status || '').trim());
}

/** Same clock as deadlineUrgency, but submitted and later jobs stay on the normal date line. */
export function jobDeadline(job, now = new Date()) {
  const value = job?.last_date || job?.tender_date;
  const result = deadlineUrgency(value, now);
  if (!result || !deadlineClosed(job)) return result;
  const parsed = parseLocalDate(value);
  return { text: `Ends: ${parsed.toLocaleDateString()}`, urgent: false };
}

export function currentHandler(job) {
  const status = String(job?.status || '');
  const client = job?.client_name || job?.company_name || job?.parked_client_name || '';
  const maker = job?.assigned_emp_name || '';
  if (status === 'AWAITING_CLIENT') return client || 'Pending with Client';
  if (status === 'LIVE') return 'GM';
  if (status === 'MD_CHECKLIST' || status === 'MD_SUBMIT' || status === 'AWAITING_RECEIPT') return 'MD';
  if (status === 'TL_ASSIGN' || status === 'TL_QC') return 'TL';
  if (status === 'MAKER_PREP' || status === 'SUBMITTED') return maker || 'Maker';
  if (status === 'GM_QC') return 'GM';
  if (status === 'WON') return maker || client || '—';
  return maker || job?.suggested_by?.name || '—';
}

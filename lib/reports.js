import { matchDesignation, DESIGNATIONS } from '@/lib/designations';
import { currentTrackingStage, TRACKING_LABELS } from '@/lib/tracking-status';
import { SUBMITTED_BOARD_STATUSES } from '@/lib/job-board-state';

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const SHIFT_SECONDS = 8 * 60 * 60;

export const BEACON_MIN_GAP_MS = 110 * 1000;
export const BEACON_CAP_SEC = 120;
export const IDLE_GAP_SEC = 5 * 60;
export const IDLE_MS = IDLE_GAP_SEC * 1000;
export const BEACON_INTERVAL_MS = 2 * 60 * 1000;

export const FUNNEL_ACTIONS = ['suggest_sow', 'client_approve', 'confirm_receipt', 'won'];
export const REVOLT_ACTIONS = ['bounce', 'gm_bounce'];
export const REPORT_ACTIONS = [...FUNNEL_ACTIONS, ...REVOLT_ACTIONS];

const MD_TAB_LABELS = {
  reports: 'Master Reports',
  finance: 'Finance Hub',
  clients: 'Client CRM',
  matchmaker: 'AI Matchmaker',
  'live-scraped': 'Live Scraped',
  'copilot-desk': 'Co-Pilot Chat Desk',
  'team-activity': 'Team Activity',
  internal: 'Internal Board',
  submitted: 'Submitted Board',
  archive: 'Archive',
  publisher: 'Live Tenders',
  team: 'Team Directory',
  alerts: 'Alerts',
  'client-queries': 'Client Queries',
  chat: 'Staff Chat',
  tickets: 'Helpdesk',
  settings: 'Setup',
};

const GM_TAB_LABELS = {
  live: 'Live Tenders',
  'suggestion-bar': 'Suggestion Bar',
  internal: 'Internal Board',
  submitted: 'Submitted',
  'bid-support': 'Bid Support',
  archive: 'Archive',
  matchmaker: 'AI Matchmaker / Live Hunting',
  scraped: 'Live Scraped',
  copilot: 'Co-Pilot',
  clients: 'Clients DB',
  officers: 'Officers',
  team: 'Team Directory',
  alerts: 'Alerts',
  chat: 'Chat',
};

const MEMBER_TAB_LABELS = {
  publisher: 'Publish',
  internal: 'Team Board',
  submitted: 'Submitted',
  copilot: 'Co-Pilot',
  'copilot-desk': 'Co-Pilot Chat Desk',
  clients: 'Clients DB',
  team: 'Team',
  alerts: 'Alerts',
  chat: 'Chat',
  'ops-alerts': 'Work Alerts',
  sla: 'Helpdesk',
};

export function istParts(date) {
  const shifted = new Date(date.getTime() + IST_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    d: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
  };
}

export function istDayKey(date) {
  const p = istParts(date);
  return `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

function istStartOfDay(y, m, d) {
  return new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);
}

export function rangeWindow(range, now = new Date()) {
  const kind = range === 'daily' || range === 'weekly' ? range : 'monthly';
  const p = istParts(now);
  let start;
  if (kind === 'daily') start = istStartOfDay(p.y, p.m, p.d);
  else if (kind === 'weekly') {
    const delta = p.weekday === 0 ? 6 : p.weekday - 1;
    start = new Date(istStartOfDay(p.y, p.m, p.d).getTime() - delta * 86400000);
  } else {
    start = istStartOfDay(p.y, p.m, 1);
  }
  return { range: kind, start, end: now, year: p.y, month: p.m };
}

export function monthKeyOf(year, monthIndex) {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

/** `YYYY-MM` to `{ year, month }` (0-based month), or null. */
export function parseMonthKey(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (month < 0 || month > 11 || year < 2000) return null;
  return { year, month };
}

export function shiftMonth(year, monthIndex, delta) {
  const total = year * 12 + monthIndex + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/** One IST calendar month. The current month ends at `now`. */
export function monthWindow(year, monthIndex, now = new Date()) {
  const start = istStartOfDay(year, monthIndex, 1);
  const next = shiftMonth(year, monthIndex, 1);
  const monthEnd = new Date(istStartOfDay(next.year, next.month, 1).getTime() - 1);
  const end = monthEnd < now ? monthEnd : now;
  return { range: 'monthly', start, end, year, month: monthIndex };
}

export function weekdaysInMonth(year, monthIndex) {
  const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= days; day += 1) {
    const dow = new Date(Date.UTC(year, monthIndex, day)).getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

export function shiftSeconds(range, now = new Date(), window = null) {
  if (range === 'daily') return SHIFT_SECONDS;
  if (range === 'weekly') return 5 * SHIFT_SECONDS;
  if (window && Number.isInteger(window.year) && Number.isInteger(window.month)) {
    return weekdaysInMonth(window.year, window.month) * SHIFT_SECONDS;
  }
  const p = istParts(now);
  return weekdaysInMonth(p.y, p.m) * SHIFT_SECONDS;
}

export function efficiencyPercent(seconds, shift) {
  const active = Number(seconds) || 0;
  const denom = Number(shift) || 0;
  if (active <= 0 || denom <= 0) return 0;
  return Math.min(100, Math.round((active / denom) * 100));
}

/** Seconds to add for a beacon. `ignore` means it arrived inside the 110s quiet window. */
export function beaconIncrement(previousAt, now) {
  if (!previousAt) return { seconds: 0 };
  const elapsedMs = now.getTime() - new Date(previousAt).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < BEACON_MIN_GAP_MS) return { ignore: true, seconds: 0 };
  const elapsed = Math.floor(elapsedMs / 1000);
  if (elapsed > IDLE_GAP_SEC) return { seconds: 0 };
  return { seconds: Math.min(BEACON_CAP_SEC, elapsed) };
}

export function presenceStatus({ seconds, lastBeaconAt, now }) {
  if (lastBeaconAt) {
    const age = now.getTime() - new Date(lastBeaconAt).getTime();
    if (Number.isFinite(age) && age >= 0 && age < IDLE_MS) return 'Working';
  }
  if ((Number(seconds) || 0) > 0) return 'Idle';
  return 'Away';
}

export function tabLabel(tab, role) {
  const id = String(tab || '').trim();
  const raw = String(role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  let map = MEMBER_TAB_LABELS;
  if (raw === 'MD' || raw === 'ADMIN' || raw === 'MANAGING_DIRECTOR') map = MD_TAB_LABELS;
  else if (matchDesignation(role) === DESIGNATIONS.GM || raw === 'GM' || raw === 'GENERAL_MANAGER') map = GM_TAB_LABELS;
  if (map[id]) return map[id];
  if (!id) return 'Unknown';
  return id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** One row per employee. Newest record wins when emp_id repeats. */
export function dedupeStaffRoster(team = []) {
  const byKey = new Map();
  for (const emp of team) {
    if (!emp || emp.deleted === true || emp.active === false) continue;
    const key = String(emp.emp_id || emp.email || '').trim().toLowerCase();
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, emp);
      continue;
    }
    const prevAt = new Date(prev.created_at || 0).getTime();
    const nextAt = new Date(emp.created_at || 0).getTime();
    if (nextAt >= prevAt) byKey.set(key, emp);
  }
  return [...byKey.values()].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }),
  );
}

export function assembleWorkforce(team, presenceDocs, revoltCounts, range, now = new Date(), window = rangeWindow(range, now)) {
  const startKey = istDayKey(window.start);
  const endKey = istDayKey(window.end);
  const shift = shiftSeconds(window.range, now, window);
  const byEmp = new Map();
  for (const doc of presenceDocs || []) {
    const key = String(doc.emp_id || '').trim().toLowerCase();
    if (!key) continue;
    if (!byEmp.has(key)) byEmp.set(key, []);
    byEmp.get(key).push(doc);
  }
  return dedupeStaffRoster(team).map((emp) => {
    const id = String(emp.emp_id || emp.email || '').trim();
    const docs = byEmp.get(id.toLowerCase()) || [];
    let seconds = 0;
    let last = null;
    const tabs = new Map();
    for (const doc of docs) {
      const at = doc.last_beacon_at ? new Date(doc.last_beacon_at) : null;
      if (at && !Number.isNaN(at.getTime()) && (!last || at > last)) last = at;
      const day = String(doc.day || '');
      if (day >= startKey && day <= endKey) {
        const sec = Number(doc.seconds) || 0;
        seconds += sec;
        const tab = String(doc.tab || 'unknown');
        tabs.set(tab, (tabs.get(tab) || 0) + sec);
      }
    }
    const role = emp.designation || emp.role || '';
    return {
      id,
      name: emp.name || 'Unknown',
      role,
      login: presenceStatus({ seconds, lastBeaconAt: last, now }),
      efficiency: efficiencyPercent(seconds, shift),
      seconds,
      revolts: revoltCounts.get(id.toLowerCase()) || 0,
      tabs: [...tabs.entries()]
        .map(([tab, sec]) => ({ tab, label: tabLabel(tab, role), seconds: sec }))
        .sort((a, b) => b.seconds - a.seconds),
    };
  });
}

function inWindow(at, start, end) {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return false;
  return when >= start && when <= end;
}

export function countRevolts(jobs, revoltRows, start, end) {
  const counts = new Map();
  const seen = new Set();
  const add = (empId, jobId, action, at) => {
    const id = String(empId || '').trim();
    if (!id || !inWindow(at, start, end)) return;
    const when = new Date(at).getTime();
    const key = `${String(jobId || '')}|${action}|${Math.floor(when / 60000)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const bucket = id.toLowerCase();
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  };
  for (const row of revoltRows || []) add(row.emp_id, row.job_id, row.action, row.at);
  for (const job of jobs || []) {
    for (const entry of job.history || []) {
      if (entry.action !== 'bounce' && entry.action !== 'gm_bounce') continue;
      const nearRow = (revoltRows || []).some((row) => (
        String(row.job_id || '') === String(job._id || '')
        && row.action === entry.action
        && Math.abs(new Date(row.at).getTime() - new Date(entry.at).getTime()) < 120000
      ));
      if (nearRow) continue;
      const emp = entry.action === 'bounce'
        ? job.assigned_emp_id
        : (job.routed_tl_emp_id || job.team_id);
      add(emp, job._id, entry.action, entry.at);
    }
  }
  return counts;
}

function jobClientEmails(job) {
  const emails = new Set();
  const add = (value) => {
    const email = String(value || '').trim().toLowerCase();
    if (email.includes('@')) emails.add(email);
  };
  add(job.client_email);
  add(job.parked_client_email);
  for (const entry of job.history || []) {
    if (entry.action === 'suggest_sow' || entry.action === 'park_client') add(entry.note);
  }
  return emails;
}

export function funnelForClients(clients, jobs, start, end) {
  const prepared = (jobs || []).map((job) => ({
    emails: jobClientEmails(job),
    stages: new Set(
      (job.history || [])
        .filter((entry) => FUNNEL_ACTIONS.includes(entry.action) && inWindow(entry.at, start, end))
        .map((entry) => entry.action),
    ),
  }));
  const unique = new Map();
  for (const client of clients || []) {
    const key = String(client?.email || '').trim().toLowerCase();
    if (!key || unique.has(key)) continue;
    unique.set(key, client);
  }
  return [...unique.values()]
    .map((client) => {
      const email = String(client.email || '').trim().toLowerCase();
      const counts = { suggested: 0, accepted: 0, submitted: 0, won: 0 };
      if (email) {
        for (const job of prepared) {
          if (!job.emails.has(email)) continue;
          if (job.stages.has('suggest_sow')) counts.suggested += 1;
          if (job.stages.has('client_approve')) counts.accepted += 1;
          if (job.stages.has('confirm_receipt')) counts.submitted += 1;
          if (job.stages.has('won')) counts.won += 1;
        }
      }
      return {
        id: email || String(client._id || client.name || ''),
        name: client.company_name || client.client_name || client.name || email || 'Unknown',
        ...counts,
      };
    })
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }));
}

function monthSpan(year, monthIndex) {
  const days = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => istStartOfDay(year, monthIndex, i + 1));
}

function weekSpan(now) {
  const window = rangeWindow('weekly', now);
  const start = window.start;
  return Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86400000));
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function submissionSeries(range, jobs, now = new Date(), window = null) {
  const kind = range === 'daily' || range === 'weekly' ? range : 'monthly';
  if (!window) window = rangeWindow(kind, now);
  const stamps = [];
  for (const job of jobs || []) {
    for (const entry of job.history || []) {
      if (entry.action !== 'confirm_receipt') continue;
      const at = new Date(entry.at);
      if (!Number.isNaN(at.getTime()) && at >= window.start && at <= window.end) stamps.push(at);
    }
  }
  if (kind === 'daily') {
    const buckets = Array.from({ length: 24 }, (_, hour) => ({
      label: `${String(hour).padStart(2, '0')}:00`,
      count: 0,
    }));
    for (const at of stamps) buckets[istParts(at).hour].count += 1;
    return buckets;
  }
  const days = kind === 'weekly'
    ? weekSpan(now)
    : monthSpan(window.year ?? istParts(now).y, window.month ?? istParts(now).m);
  return days.map((day) => {
    const key = istDayKey(day);
    const p = istParts(day);
    const label = kind === 'weekly' ? `${WEEKDAY[p.weekday]} ${p.d}` : String(p.d);
    const count = stamps.filter((at) => istDayKey(at) === key).length;
    return { label, count };
  });
}

/** Live Submitted Board count: each job once, by its current stage. Bid Awarded is not counted. */
export function submittedBoardSnapshot(jobs) {
  const counts = { submitted: 0, technical: 0, financial: 0 };
  for (const job of jobs || []) {
    const stage = currentTrackingStage(job) || TRACKING_LABELS.SUBMITTED;
    if (stage === TRACKING_LABELS.SUBMITTED) counts.submitted += 1;
    else if (stage === TRACKING_LABELS.TECHNICAL_EVALUATION) counts.technical += 1;
    else if (stage === TRACKING_LABELS.FINANCIAL_EVALUATION) counts.financial += 1;
  }
  return { ...counts, total: counts.submitted + counts.technical + counts.financial };
}

export async function recordStaffRevolt(db, { emp_id, job_id, action, at = new Date() }) {
  const id = String(emp_id || '').trim();
  if (!id || (action !== 'bounce' && action !== 'gm_bounce')) return;
  await db.collection('staff_revolts').insertOne({
    emp_id: id,
    at,
    job_id: job_id ? String(job_id) : null,
    action,
  });
}

const JOB_PROJECT = {
  history: 1,
  client_email: 1,
  parked_client_email: 1,
  assigned_emp_id: 1,
  routed_tl_emp_id: 1,
  team_id: 1,
};

/** Client CRM rows: the same filter as /api/users/approved. */
export const CRM_CLIENT_FILTER = { onboarding_complete: true, account_kind: { $ne: 'visitor' } };

/**
 * `options` is `{ range, month, compare }`. `month` is `{ year, month }` and only
 * applies to the monthly range; it defaults to the current IST month.
 */
export async function loadMasterReport(db, options = {}, now = new Date()) {
  const opts = typeof options === 'string' ? { range: options } : (options || {});
  const base = rangeWindow(opts.range, now);
  const window = base.range === 'monthly'
    ? monthWindow(opts.month?.year ?? base.year, opts.month?.month ?? base.month, now)
    : base;
  const startKey = istDayKey(window.start);
  const endKey = istDayKey(window.end);
  const idleSince = new Date(now.getTime() - IDLE_MS);
  const historyFilter = { 'history.action': { $in: REPORT_ACTIONS } };

  const [team, presence, revolts, jobs, archived, clients, suggestions, boardJobs] = await Promise.all([
    db.collection('employees').find({}).project({
      emp_id: 1, email: 1, name: 1, designation: 1, role: 1, deleted: 1, active: 1, created_at: 1,
    }).toArray(),
    db.collection('staff_presence').find({
      $or: [
        { day: { $gte: startKey, $lte: endKey } },
        { last_beacon_at: { $gte: idleSince } },
      ],
    }).toArray(),
    db.collection('staff_revolts').find({ at: { $gte: window.start, $lte: window.end } }).toArray(),
    db.collection('workflow_jobs').find(historyFilter).project(JOB_PROJECT).toArray(),
    db.collection('workflow_archive').find(historyFilter).project(JOB_PROJECT).toArray(),
    db.collection('users').find(CRM_CLIENT_FILTER).project({
      email: 1, company_name: 1, client_name: 1, name: 1,
    }).toArray(),
    db.collection('workflow_jobs').countDocuments({
      $or: [
        { status: 'AWAITING_CLIENT' },
        { status: 'LIVE', parked_client_email: { $exists: true, $nin: [null, ''] } },
      ],
    }),
    db.collection('workflow_jobs').find({ status: { $in: SUBMITTED_BOARD_STATUSES } }).project({
      status: 1, tracking_status: 1, display_status: 1,
    }).toArray(),
  ]);

  const allJobs = [...jobs, ...archived];
  const revoltCounts = countRevolts(allJobs, revolts, window.start, window.end);
  const report = {
    range: window.range,
    month: window.range === 'monthly' ? monthKeyOf(window.year, window.month) : null,
    shift_seconds: shiftSeconds(window.range, now, window),
    suggestions,
    workforce: assembleWorkforce(team, presence, revoltCounts, window.range, now, window),
    funnel: funnelForClients(clients, allJobs, window.start, window.end),
    submissions: submissionSeries(window.range, allJobs, now, window),
    breakdown: submittedBoardSnapshot(boardJobs),
  };
  if (opts.compare && window.range === 'monthly') {
    const prev = shiftMonth(window.year, window.month, -1);
    const prevWindow = monthWindow(prev.year, prev.month, now);
    report.comparison = {
      month: monthKeyOf(prev.year, prev.month),
      submissions: submissionSeries('monthly', allJobs, now, prevWindow),
    };
  }
  return report;
}

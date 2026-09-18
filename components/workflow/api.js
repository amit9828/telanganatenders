import { isAdminDeskPath, isClientDeskPath, isStaffDeskPath, consumeStaffBypass, staffSessionIdent, clientHeaders } from '@/lib/tab-handoff';

export function staffHeaders(extra = {}) {
  const headers = { ...extra };
  if (typeof window === 'undefined') return headers;
  const path = window.location.pathname || '';
  if (isAdminDeskPath(path)) {
    const token = localStorage.getItem('tt_admin');
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }
  if (isStaffDeskPath(path)) {
    const email = consumeStaffBypass() || staffSessionIdent();
    if (email) headers['x-employee-email'] = email;
  }
  return headers;
}

export async function workflowFetch(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: staffHeaders(options.headers || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const QUEUE_PAGE_SIZE = 100;
const QUEUE_MAX_PAGES = 25;

export async function fetchWorkflowQueue(board = 'all', { limit = QUEUE_PAGE_SIZE } = {}) {
  const qs = (page) => {
    const params = new URLSearchParams();
    if (board && board !== 'all') params.set('board', board);
    params.set('page', String(page));
    params.set('limit', String(limit));
    return `/api/workflow/queue?${params.toString()}`;
  };
  const first = await workflowFetch(qs(1));
  const jobs = [...(first.jobs || [])];
  const reportedPages = Math.max(1, Number(first.totalPages) || 1);
  const totalPages = Math.min(QUEUE_MAX_PAGES, reportedPages);
  if (totalPages > 1) {
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, i) => workflowFetch(qs(i + 2)))
    );
    for (const page of rest) jobs.push(...(page.jobs || []));
  }
  return {
    jobs,
    page: 1,
    limit,
    total: first.total ?? jobs.length,
    totalPages: reportedPages,
    hasMore: reportedPages > QUEUE_MAX_PAGES,
  };
}

export function staffPdfHref(tenderId, { email, role = 'employee' } = {}) {
  let resolved = email;
  if (!resolved && typeof window !== 'undefined') {
    resolved = staffSessionIdent() || process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'admin';
  }
  resolved = resolved || process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'admin';
  return `/api/tenders/${tenderId}/pdf?email=${encodeURIComponent(resolved)}&role=${role}`;
}

export async function openClientWorkflowFile(jobId, slot = 'sow') {
  if (typeof window === 'undefined' || !jobId) return;
  const res = await fetch(`/api/workflow/jobs/${jobId}/file?slot=${encodeURIComponent(slot)}`, {
    credentials: 'include',
    headers: clientHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Could not open file');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  }
}

export async function openWorkflowFile(jobId, slot = 'sow') {
  if (typeof window === 'undefined' || !jobId) return;
  if (isClientDeskPath(window.location.pathname || '')) {
    return openClientWorkflowFile(jobId, slot);
  }
  const res = await fetch(`/api/workflow/jobs/${jobId}/file?slot=${encodeURIComponent(slot)}`, {
    credentials: 'include',
    headers: staffHeaders(),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data.error || 'Could not open file');
    console.error(err);
    throw err;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  }
}

export async function restoreBypassSession() {
  const res = await fetch('/api/staff-bypass/restore', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || 'Could not restore the original session.');
  }
  if (typeof window !== 'undefined') {
    window.location.assign(data.path || '/admin');
  }
  return data;
}

export function openStaffChatFile(id, { download = false, fileName = 'attachment' } = {}) {
  if (typeof window === 'undefined' || !id) return Promise.resolve();
  const qs = new URLSearchParams({ id: String(id) });
  if (download) qs.set('download', '1');
  return fetch(`/api/staff-chat/file?${qs.toString()}`, {
    credentials: 'include',
    headers: staffHeaders(),
  }).then(async (res) => {
    if (!res.ok) throw new Error('Could not open file');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    if (download) {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'attachment';
      a.rel = 'noopener noreferrer';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      return url;
    }
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.click();
    }
    return url;
  }).catch((err) => {
    console.error(err);
    throw err;
  });
}

export function numberedPageList(current, total) {
  const t = Math.max(1, Number(total) || 1);
  const c = Math.min(Math.max(1, Number(current) || 1), t);
  if (t <= 10) return Array.from({ length: t }, (_, i) => i + 1);
  const pages = new Set([1, 2, t - 1, t, c - 1, c, c + 1]);
  return [...pages].filter((p) => p >= 1 && p <= t).sort((a, b) => a - b);
}

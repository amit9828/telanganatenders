import { isAdminDeskPath, isClientDeskPath, isStaffDeskPath, staffSessionIdent, clientHeaders } from '@/lib/tab-handoff';

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
    const email = staffSessionIdent();
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

export function openWorkflowFile(jobId, slot = 'sow') {
  if (typeof window === 'undefined' || !jobId) return;
  if (isClientDeskPath(window.location.pathname || '')) {
    openClientWorkflowFile(jobId, slot).catch((err) => {
      console.error(err);
    });
    return;
  }
  window.location.assign(`/api/workflow/jobs/${jobId}/file?slot=${slot}`);
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

export function openStaffChatFile(id) {
  if (typeof window === 'undefined' || !id) return;
  fetch(`/api/staff-chat/file?id=${encodeURIComponent(id)}`, {
    credentials: 'include',
    headers: staffHeaders(),
  }).then(async (res) => {
    if (!res.ok) throw new Error('Could not open file');
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
  }).catch((err) => {
    console.error(err);
  });
}

export function numberedPageList(current, total) {
  const t = Math.max(1, Number(total) || 1);
  const c = Math.min(Math.max(1, Number(current) || 1), t);
  if (t <= 10) return Array.from({ length: t }, (_, i) => i + 1);
  const pages = new Set([1, 2, t - 1, t, c - 1, c, c + 1]);
  return [...pages].filter((p) => p >= 1 && p <= t).sort((a, b) => a - b);
}

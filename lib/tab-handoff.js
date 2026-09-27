'use client';

const TEMP_BYPASS = 'temp_bypass';
const TEMP_BYPASS_PATH = 'temp_bypass_path';
const LEGACY_TEMP_STAFF = 'temp_bypass_emp';
const LEGACY_TEMP_CLIENT = 'temp_bypass_client';
const SS_STAFF = 'tt_emp_email';
const SS_CLIENT = 'tt_email';

function canUseDom() {
  return typeof window !== 'undefined' && typeof localStorage !== 'undefined' && typeof sessionStorage !== 'undefined';
}

export function isStaffDeskPath(path) {
  const p = String(path || '');
  return p === '/gm' || p.startsWith('/gm/') || p === '/tl' || p.startsWith('/tl/') || p === '/employee' || p.startsWith('/employee/');
}

export function isAdminDeskPath(path) {
  const p = String(path || '');
  return p === '/admin' || p.startsWith('/admin/');
}

export function isClientDeskPath(path) {
  const p = String(path || '');
  return p === '/client' || p.startsWith('/client/');
}

function readTempBypass() {
  if (!canUseDom()) return '';
  return String(
    localStorage.getItem(TEMP_BYPASS)
    || localStorage.getItem(LEGACY_TEMP_STAFF)
    || localStorage.getItem(LEGACY_TEMP_CLIENT)
    || ''
  ).trim();
}

function clearTempBypass() {
  if (!canUseDom()) return;
  localStorage.removeItem(TEMP_BYPASS);
  localStorage.removeItem(TEMP_BYPASS_PATH);
  localStorage.removeItem(LEGACY_TEMP_STAFF);
  localStorage.removeItem(LEGACY_TEMP_CLIENT);
}

function claimTempBypass() {
  const temp = readTempBypass();
  if (temp) clearTempBypass();
  return temp;
}

function destMatchesCurrent(dest) {
  if (!canUseDom()) return false;
  const current = String(window.location.pathname || '').replace(/\/+$/, '') || '/';
  const target = String(dest || '').trim().replace(/\/+$/, '');
  if (!target) return false;
  return current === target || current.startsWith(`${target}/`);
}

function shouldClaimStaffBypass(dest) {
  if (!canUseDom()) return false;
  if (dest) return destMatchesCurrent(dest);
  const path = window.location.pathname || '';
  return path === '/tl' || path.startsWith('/tl/') || path === '/employee' || path.startsWith('/employee/');
}

/** Parent tab: one-shot key, then open a clean staff URL. Never writes tt_emp_email. */
export function openStaffBypass(path, ident) {
  if (!canUseDom()) return false;
  const id = String(ident || '').trim();
  if (!id || !path) return false;
  localStorage.setItem(TEMP_BYPASS, id);
  localStorage.setItem(TEMP_BYPASS_PATH, path);
  window.open(path, '_blank');
  return true;
}

/** Parent tab: one-shot key, then open a clean /client URL. Never writes tt_email. */
export function openClientBypass(ident) {
  if (!canUseDom()) return false;
  const id = String(ident || '').trim();
  if (!id) return false;
  localStorage.setItem(TEMP_BYPASS, id);
  localStorage.setItem(TEMP_BYPASS_PATH, '/client');
  window.open('/client', '_blank');
  return true;
}

export function consumeStaffBypass() {
  if (!canUseDom()) return '';
  const dest = String(localStorage.getItem(TEMP_BYPASS_PATH) || '').trim();
  const temp = readTempBypass();
  if (temp && shouldClaimStaffBypass(dest)) {
    claimTempBypass();
    sessionStorage.setItem(SS_STAFF, temp);
    return temp;
  }
  return String(sessionStorage.getItem(SS_STAFF) || '').trim();
}

const CLIENT_COOKIE = 'tt_client_id';

function writeClientCookie(ident) {
  if (!canUseDom()) return;
  const id = String(ident || '').trim();
  if (!id) return;
  document.cookie = `${CLIENT_COOKIE}=${encodeURIComponent(id)}; Path=/; SameSite=Lax`;
}

export function consumeClientBypass() {
  if (!canUseDom()) return '';
  const dest = String(localStorage.getItem(TEMP_BYPASS_PATH) || '').trim();
  const onClientDesk = isClientDeskPath(window.location.pathname || '');
  const temp = readTempBypass();
  const destIsClient = !dest || isClientDeskPath(dest);
  if (temp && onClientDesk && destIsClient) {
    claimTempBypass();
    sessionStorage.setItem(SS_CLIENT, temp);
    writeClientCookie(temp);
    return temp;
  }
  const existing = String(sessionStorage.getItem(SS_CLIENT) || '').trim();
  if (existing) {
    writeClientCookie(existing);
    return existing;
  }
  return '';
}

export function clearDeskBypass() {
  if (!canUseDom()) return;
  localStorage.removeItem('tt_admin');
  for (const key of [SS_STAFF, SS_CLIENT, TEMP_BYPASS, TEMP_BYPASS_PATH, LEGACY_TEMP_STAFF, LEGACY_TEMP_CLIENT]) {
    sessionStorage.removeItem(key);
  }
}

/** Read-only. Never touches temp_bypass. */
export function staffSessionIdent() {
  if (!canUseDom()) return '';
  return String(sessionStorage.getItem(SS_STAFF) || '').trim();
}

/** Read-only. Never touches temp_bypass. */
export function clientSessionIdent() {
  if (!canUseDom()) return '';
  return String(sessionStorage.getItem(SS_CLIENT) || '').trim();
}

export function rememberRealClientIdent(ident) {
  if (!canUseDom()) return;
  const id = String(ident || '').trim();
  if (!id) return;
  sessionStorage.setItem(SS_CLIENT, id);
  writeClientCookie(id);
}

export function rememberRealStaffIdent(ident) {
  if (!canUseDom()) return;
  const id = String(ident || '').trim();
  if (!id) return;
  sessionStorage.setItem(SS_STAFF, id);
}

export function clientHeaders(extra = {}) {
  const headers = { ...extra };
  const ident = clientSessionIdent();
  if (ident) headers['x-client-id'] = ident;
  return headers;
}

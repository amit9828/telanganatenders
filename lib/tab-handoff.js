'use client';

const TEMP_BYPASS = 'temp_bypass';
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
  localStorage.removeItem(LEGACY_TEMP_STAFF);
  localStorage.removeItem(LEGACY_TEMP_CLIENT);
}

function claimTempBypass() {
  const temp = readTempBypass();
  if (temp) clearTempBypass();
  return temp;
}

/** Parent tab: one-shot key, then open a clean staff URL. Never writes tt_emp_email. */
export function openStaffBypass(path, ident) {
  if (!canUseDom()) return false;
  const id = String(ident || '').trim();
  if (!id || !path) return false;
  localStorage.setItem(TEMP_BYPASS, id);
  window.open(path, '_blank');
  return true;
}

/** Parent tab: one-shot key, then open a clean /client URL. Never writes tt_email. */
export function openClientBypass(ident) {
  if (!canUseDom()) return false;
  const id = String(ident || '').trim();
  if (!id) return false;
  localStorage.setItem(TEMP_BYPASS, id);
  window.open('/client', '_blank');
  return true;
}

export function consumeStaffBypass() {
  if (!canUseDom()) return '';
  const existing = String(sessionStorage.getItem(SS_STAFF) || '').trim();
  if (existing) return existing;
  const temp = claimTempBypass();
  if (temp) sessionStorage.setItem(SS_STAFF, temp);
  return temp;
}

export function consumeClientBypass() {
  if (!canUseDom()) return '';
  const existing = String(sessionStorage.getItem(SS_CLIENT) || '').trim();
  if (existing) return existing;
  const temp = claimTempBypass();
  if (temp) sessionStorage.setItem(SS_CLIENT, temp);
  return temp;
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

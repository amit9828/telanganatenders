// Shared authorisation for staff-only API routes (Admin / MD / Employee).
//
// The older catch-all routes accept an email in the request body with no verification.
// New routes must not: they read and write client KYC data, stationery and signatures.
// Two credentials are accepted — the ADMIN_TOKEN the dashboard stores after
// /api/system/verify, and a NextAuth session belonging to a staff role.

import { getToken } from 'next-auth/jwt';
import { DESIGNATIONS, DESIGNATION_LABELS, matchDesignation, normalizeDesignation, deskPathForDesignation, resolveStaffDesignation, isGmActor } from '@/lib/designations';
import { isMdSessionCookie } from '@/lib/desk-cookie';

const STAFF_ROLE_PATTERN = /admin|md|employee|officer|manager|staff|gm|doc_team/i;

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { DESIGNATIONS, DESIGNATION_LABELS, matchDesignation, normalizeDesignation, deskPathForDesignation, resolveStaffDesignation, isGmActor };

export function isStaffRole(role) {
  return STAFF_ROLE_PATTERN.test(String(role || ''));
}

export function isMdEmployee(emp) {
  if (!emp) return false;
  const role = String(emp.role || '').trim();
  const designation = String(emp.designation || '').trim();
  const roleKey = role.toUpperCase().replace(/[\s-]+/g, '_');
  const desKey = designation.toUpperCase().replace(/[\s-]+/g, '_');
  if (roleKey === 'MD' || roleKey === 'ADMIN') return true;
  if (desKey === 'MD' || desKey === 'ADMIN') return true;
  if (/\(md\)/i.test(role) || /^md$/i.test(role)) return true;
  const mdEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  if (mdEmail && String(emp.email || '').toLowerCase() === mdEmail) return true;
  return false;
}

async function readToken(req, secret, secureCookie) {
  const options = { req, secret };
  if (secureCookie === false) options.secureCookie = false;
  return getToken(options);
}

export async function getStaffToken(req) {
  if (!req) return null;
  const secret = process.env.NEXTAUTH_SECRET;
  try {
    const token = await readToken(req, secret);
    if (token) return token;
  } catch (err) {
    console.warn('[staff-auth] session decode failed:', err?.message || err);
  }
  try {
    const insecure = await readToken(req, secret, false);
    if (insecure) return insecure;
  } catch (err) {
    console.warn('[staff-auth] insecure session decode failed:', err?.message || err);
  }
  try {
    const { cookies } = await import('next/headers');
    const jar = cookies();
    const fromJar = { cookies: jar, headers: req.headers || {} };
    const token = await readToken(fromJar, secret);
    if (token) return token;
    return await readToken({ cookies: jar, headers: {} }, secret, false);
  } catch (err) {
    console.warn('[staff-auth] cookie-jar session decode failed:', err?.message || err);
    return null;
  }
}

/**
 * @returns {Promise<{ok: true, actor: string, email: string|null} | {ok: false, status: number, error: string}>}
 */
export async function requireStaff(request) {
  const adminToken = String(process.env.ADMIN_TOKEN || '').trim();
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();

  if ((adminToken && bearer && bearer === adminToken) || bearer === 'admin_success') {
    return { ok: true, actor: 'admin_token', email: null };
  }

  let token = null;
  try {
    token = await getStaffToken(request);
  } catch (err) {
    console.warn('[staff-auth] session decode failed:', err?.message || err);
  }

  if (isStaffSessionToken(token)) {
    try {
      const emp = await findActiveEmployee(token);
      if (!emp) return { ok: false, status: 401, error: 'This login has been revoked.' };
      const actor = actorFromEmployeeDoc(emp, token.email || token.emp_id || '');
      return {
        ok: true,
        actor: actor?.role || 'EMPLOYEE',
        email: actor?.email || null,
      };
    } catch (err) {
      console.warn('[staff-auth] revoked-login check failed:', err?.message || err);
      return { ok: false, status: 401, error: 'This login has been revoked.' };
    }
  }

  if (await hasMdSessionCookie(request)) {
    return { ok: true, actor: 'MD', email: null };
  }

  if (token?.email) {
    return { ok: false, status: 403, error: 'This action is restricted to staff accounts.' };
  }

  return { ok: false, status: 401, error: 'Please sign in with a staff account.' };
}

/** Staff desk actions require the signed session. A request header is not a login. */
export async function requireDashboardStaff(request) {
  return requireStaff(request);
}

function isAdminBearer(request) {
  const adminToken = String(process.env.ADMIN_TOKEN || '').trim();
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return Boolean((adminToken && bearer && bearer === adminToken) || bearer === 'admin_success');
}

function isStaffSessionToken(token) {
  if (!token) return false;
  if (String(token.emp_id || '').trim()) return true;
  if (String(token.designation || '').trim()) return true;
  const role = String(token.role || '').trim();
  if (!role) return false;
  if (role === 'MD' || role === 'EMPLOYEE') return true;
  return isStaffRole(role);
}

const EMPTY_ACTOR = { role: null, empId: null, email: null, name: null, designation: null, teamId: null };

async function findActiveEmployee(token) {
  const empId = String(token?.emp_id || '').trim();
  const email = String(token?.email || '').trim().toLowerCase();
  const or = [];
  if (empId) or.push({ emp_id: new RegExp(`^${escapeRegex(empId)}$`, 'i') });
  if (email) or.push({ email: new RegExp(`^${escapeRegex(email)}$`, 'i') });
  if (!or.length) return null;
  const { getDb } = await import('./db.js');
  const db = await getDb();
  return db.collection('employees').findOne({
    $or: or,
    deleted: { $ne: true },
    active: { $ne: false },
  }, { projection: { emp_id: 1, email: 1, name: 1, designation: 1, role: 1, team_id: 1 } });
}

async function actorFromStaffToken(token) {
  try {
    const emp = await findActiveEmployee(token);
    if (!emp) return { ...EMPTY_ACTOR };
    return actorFromEmployeeDoc(emp, token.email || token.emp_id || '');
  } catch (err) {
    console.warn('[staff-auth] employee lookup failed:', err?.message || err);
    if (token?.role === 'MD') {
      return {
        role: 'MD',
        empId: token.emp_id || null,
        email: token.email || null,
        name: token.name || null,
        designation: null,
        teamId: null,
      };
    }
    return {
      role: 'EMPLOYEE',
      empId: token?.emp_id || null,
      email: token?.email || null,
      name: token?.name || null,
      designation: token?.designation ? normalizeDesignation(token.designation) : null,
      teamId: token?.team_id || null,
    };
  }
}

async function hasMdSessionCookie(request) {
  const fromJar = request?.cookies?.get?.('tt_md_session')?.value;
  const raw = fromJar || cookieValue(request, 'tt_md_session');
  return Boolean(raw && await isMdSessionCookie(raw));
}

/**
 * Resolves WHO is calling for the purpose of task-ownership data isolation
 * (Bids / Suggestions), as opposed to requireStaff()'s plain "are they staff at
 * all" gate. Three outcomes:
 *   - MD (the ADMIN_TOKEN bearer, or a NextAuth session whose role is 'MD') sees
 *     everything — no filter is ever applied for this actor.
 *   - EMPLOYEE (a NextAuth session with an emp_id) is scoped to records carrying
 *     their own `employee_id`.
 *   - Unresolved (no bearer match, no session) — callers must fall back to
 *     today's unfiltered behavior; this intentionally does NOT throw/401 so it
 *     can drop into existing routes that have no auth gate today without
 *     locking anyone out.
 *
 * Employee JWTs win over a leftover admin bearer so GM/TL/Member desks never
 * collapse onto the MD identity.
 *
 * @returns {Promise<{role: 'MD'|'EMPLOYEE'|null, empId: string|null, email: string|null, name: string|null, designation: string|null, teamId: string|null}>}
 */
async function actorFromEmployeeDoc(emp, fallbackIdent = '') {
  if (!emp) return null;
  if (isMdEmployee(emp)) {
    return {
      role: 'MD',
      empId: emp.emp_id || null,
      email: emp.email ? String(emp.email).toLowerCase() : null,
      name: emp.name || null,
      designation: null,
      teamId: null,
    };
  }
  return {
    role: 'EMPLOYEE',
    empId: emp.emp_id || null,
    email: emp.email ? String(emp.email).toLowerCase() : String(fallbackIdent || '').toLowerCase() || null,
    name: emp.name || null,
    designation: matchDesignation(emp.designation) || matchDesignation(emp.role) || null,
    teamId: emp.team_id || null,
  };
}

function callerMayOpenEmployee(sessionActor, emp) {
  if (!sessionActor?.role || !emp) return false;
  if (sessionActor.role === 'MD' || isMdEmployee(sessionActor)) return true;
  const dest = resolveStaffDesignation(emp);
  if (isGmActor(sessionActor)) {
    return dest === DESIGNATIONS.DOC_TEAM_TL || dest === DESIGNATIONS.DOC_TEAM_MEMBER;
  }
  if (matchDesignation(sessionActor.designation) === DESIGNATIONS.DOC_TEAM_TL) {
    return dest === DESIGNATIONS.DOC_TEAM_MEMBER;
  }
  return false;
}

async function findEmployeeByIdent(ident) {
  const header = String(ident || '').trim();
  if (!header) return null;
  const { getDb } = await import('./db.js');
  const db = await getDb();
  const headerKey = header.toLowerCase();
  const escaped = escapeRegex(header);
  return db.collection('employees').findOne({
    $or: [
      { email: headerKey },
      { emp_id: new RegExp(`^${escaped}$`, 'i') },
    ],
    deleted: { $ne: true },
    active: { $ne: false },
  }, { projection: { emp_id: 1, email: 1, name: 1, designation: 1, role: 1, team_id: 1 } });
}

export async function resolveActorRole(request) {
  let token = null;
  try {
    token = await getStaffToken(request);
  } catch (err) {
    console.warn('[staff-auth] resolveActorRole session decode failed:', err?.message || err);
  }

  let sessionActor = null;
  if (isStaffSessionToken(token)) {
    sessionActor = await actorFromStaffToken(token);
  } else if (isAdminBearer(request) || await hasMdSessionCookie(request)) {
    sessionActor = { role: 'MD', empId: null, email: null, name: 'Managing Director', designation: null, teamId: null };
  }

  const header = String(request.headers.get('x-employee-email') || '').trim();
  const sessionEmail = String(sessionActor?.email || '').toLowerCase();
  const sessionEmp = String(sessionActor?.empId || '').toLowerCase();
  const headerKey = header.toLowerCase();
  const headerMatchesSession = Boolean(
    sessionActor?.role
    && header
    && (headerKey === sessionEmail || headerKey === sessionEmp),
  );
  if (sessionActor?.role && header) {
    try {
      const emp = await findEmployeeByIdent(header);
      const fromHeader = await actorFromEmployeeDoc(emp, header);
      if (fromHeader && (headerMatchesSession || callerMayOpenEmployee(sessionActor, emp))) {
        return fromHeader;
      }
    } catch (err) {
      console.warn('[staff-auth] x-employee-email lookup failed:', err?.message || err);
    }
  }

  return sessionActor || { role: null, empId: null, email: null, name: null, designation: null, teamId: null };
}

function cookieValue(request, name) {
  const raw = String(request.headers.get('cookie') || '');
  const parts = raw.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    const key = eq === -1 ? trimmed : trimmed.slice(0, eq);
    if (key !== name) continue;
    try {
      return decodeURIComponent((eq === -1 ? '' : trimmed.slice(eq + 1)).trim());
    } catch {
      return (eq === -1 ? '' : trimmed.slice(eq + 1)).trim();
    }
  }
  return '';
}

export async function resolveClientEmail(request) {
  let token = null;
  try {
    token = await getStaffToken(request);
  } catch (err) {
    console.warn('[staff-auth] resolveClientEmail session decode failed:', err?.message || err);
  }
  const staffJwt = Boolean(
    token?.emp_id
    || token?.role === 'MD'
    || token?.role === 'EMPLOYEE'
    || isStaffRole(token?.role)
    || isGmActor(token),
  );

  const actor = await resolveActorRole(request);
  const leadership = actor.role === 'MD' || isGmActor(actor);
  if (leadership) {
    const header = String(request.headers.get('x-client-id') || '').trim();
    const fromCookie = cookieValue(request, 'tt_client_id');
    const ident = header || fromCookie;
    if (!ident) return null;
    try {
      const { getDb } = await import('./db.js');
      const { findExistingClient } = await import('./clients.js');
      const db = await getDb();
      const user = await findExistingClient(db, ident);
      if (user?.email) return String(user.email).toLowerCase();
    } catch (err) {
      console.warn('[staff-auth] x-client-id lookup failed:', err?.message || err);
    }
    return null;
  }

  if (staffJwt) return null;
  if (token?.email) return String(token.email).toLowerCase();
  return null;
}

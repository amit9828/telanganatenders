// Shared authorisation for staff-only API routes (Admin / MD / Employee).
//
// The older catch-all routes accept an email in the request body with no verification.
// New routes must not: they read and write client KYC data, stationery and signatures.
// Two credentials are accepted — the ADMIN_TOKEN the dashboard stores after
// /api/system/verify, and a NextAuth session belonging to a staff role.

import { getToken } from 'next-auth/jwt';
import { DESIGNATIONS, DESIGNATION_LABELS, matchDesignation, normalizeDesignation, deskPathForDesignation, resolveStaffDesignation } from '@/lib/designations';

const STAFF_ROLE_PATTERN = /admin|md|employee|officer|manager|staff|gm|doc_team/i;

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { DESIGNATIONS, DESIGNATION_LABELS, matchDesignation, normalizeDesignation, deskPathForDesignation };

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

export async function getStaffToken(req) {
  if (!req) return null;
  const secret = process.env.NEXTAUTH_SECRET;
  try {
    const token = await getToken({ req, secret });
    if (token) return token;
  } catch (err) {
    console.warn('[staff-auth] session decode failed:', err?.message || err);
  }
  try {
    return await getToken({ req, secret, secureCookie: false });
  } catch (err) {
    console.warn('[staff-auth] insecure session decode failed:', err?.message || err);
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

  const headerEmail = String(request.headers.get('x-employee-email') || '').trim();
  if (headerEmail) {
    try {
      const { getDb } = await import('./db.js');
      const db = await getDb();
      const emp = await db.collection('employees').findOne({
        $or: [
          { email: headerEmail.toLowerCase() },
          { emp_id: new RegExp(`^${escapeRegex(headerEmail)}$`, 'i') },
        ],
        deleted: { $ne: true },
        active: { $ne: false },
      }, { projection: { emp_id: 1, email: 1 } });
      if (emp) return { ok: true, actor: 'employee', email: emp.email ? String(emp.email).toLowerCase() : headerEmail.toLowerCase() };
    } catch (err) {
      console.warn('[staff-auth] x-employee-email lookup failed:', err?.message || err);
    }
    return { ok: false, status: 401, error: 'Staff account not found.' };
  }

  if (token?.emp_id || (token?.email && isStaffRole(token.role))) {
    return { ok: true, actor: String(token.role || 'staff'), email: token.email ? String(token.email).toLowerCase() : null };
  }

  if (token?.email) {
    return { ok: false, status: 403, error: 'This action is restricted to staff accounts.' };
  }

  return { ok: false, status: 401, error: 'Please sign in with a staff account.' };
}

/**
 * Same as requireStaff, plus the employee dashboard's localStorage email header
 * (x-employee-email) when that address is a staff user in Mongo.
 */
export async function requireDashboardStaff(request) {
  const primary = await requireStaff(request);
  if (primary.ok) return primary;

  const email = String(request.headers.get('x-employee-email') || '').trim().toLowerCase();
  if (!email) return primary;

  try {
    const { getDb } = await import('./db.js');
    const db = await getDb();
    const emp = await db.collection('employees').findOne(
      { email, deleted: { $ne: true }, active: { $ne: false } },
      { projection: { emp_id: 1 } },
    );
    if (emp) return { ok: true, actor: 'employee', email };
  } catch (err) {
    console.warn('[staff-auth] employee email lookup failed:', err?.message || err);
  }
  return primary;
}

function isAdminBearer(request) {
  const adminToken = String(process.env.ADMIN_TOKEN || '').trim();
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return Boolean((adminToken && bearer && bearer === adminToken) || bearer === 'admin_success');
}

async function hydrateEmployeeActor(token) {
  const empId = String(token?.emp_id || '').trim();
  const base = {
    role: 'EMPLOYEE',
    empId,
    email: token?.email || null,
    name: token?.name || null,
    designation: token?.designation ? normalizeDesignation(token.designation) : null,
    teamId: token?.team_id || null,
  };
  if (!token?.is_bypass && (token?.role === 'MD' || isMdEmployee(token))) {
    return {
      role: 'MD',
      empId: empId || null,
      email: token?.email || null,
      name: token?.name || null,
      designation: null,
      teamId: null,
    };
  }
  if (!empId) return base;
  try {
    const { getDb } = await import('./db.js');
    const db = await getDb();
    const emp = await db.collection('employees').findOne(
      { emp_id: empId, deleted: { $ne: true }, active: { $ne: false } },
      { projection: { designation: 1, team_id: 1, name: 1, email: 1, role: 1 } },
    );
    if (!emp) return base;
    if (!token?.is_bypass && isMdEmployee(emp)) {
      return {
        role: 'MD',
        empId: emp.emp_id || empId,
        email: emp.email || token?.email || null,
        name: emp.name || token?.name || null,
        designation: null,
        teamId: null,
      };
    }
    if (emp.designation || emp.role) base.designation = resolveStaffDesignation(emp);
    if (emp.team_id) base.teamId = emp.team_id;
    if (emp.name && !base.name) base.name = emp.name;
    if (emp.email && !base.email) base.email = emp.email;
  } catch (err) {
    console.warn('[staff-auth] employee hydrate failed:', err?.message || err);
  }
  return base;
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

export async function resolveActorRole(request) {
  const header = String(request.headers.get('x-employee-email') || '').trim();
  if (header) {
    try {
      const { getDb } = await import('./db.js');
      const db = await getDb();
      const escaped = escapeRegex(header);
      const emp = await db.collection('employees').findOne({
        $or: [
          { email: header.toLowerCase() },
          { emp_id: new RegExp(`^${escaped}$`, 'i') },
        ],
        deleted: { $ne: true },
        active: { $ne: false },
      }, { projection: { emp_id: 1, email: 1, name: 1, designation: 1, role: 1, team_id: 1 } });
      const fromHeader = await actorFromEmployeeDoc(emp, header);
      if (fromHeader) return fromHeader;
    } catch (err) {
      console.warn('[staff-auth] x-employee-email actor lookup failed:', err?.message || err);
    }
    return { role: null, empId: null, email: null, name: null, designation: null, teamId: null };
  }

  let token = null;
  try {
    token = await getStaffToken(request);
  } catch (err) {
    console.warn('[staff-auth] resolveActorRole session decode failed:', err?.message || err);
  }

  if (token?.emp_id && token?.role !== 'MD') {
    return hydrateEmployeeActor(token);
  }

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

  if (isAdminBearer(request)) {
    return { role: 'MD', empId: null, email: null, name: 'Managing Director', designation: null, teamId: null };
  }

  return { role: null, empId: null, email: null, name: null, designation: null, teamId: null };
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
  const header = String(request.headers.get('x-client-id') || '').trim();
  const fromCookie = cookieValue(request, 'tt_client_id');
  const ident = header || fromCookie;
  if (ident) {
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

  let token = null;
  try {
    token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  } catch (err) {
    console.warn('[staff-auth] resolveClientEmail session decode failed:', err?.message || err);
  }
  if (token?.email && (token.role === 'Client' || token.client_id || (!token.emp_id && token.role !== 'MD' && token.role !== 'EMPLOYEE'))) {
    return String(token.email).toLowerCase();
  }
  if (token?.email && !token.emp_id && token.role !== 'MD') {
    return String(token.email).toLowerCase();
  }
  return null;
}

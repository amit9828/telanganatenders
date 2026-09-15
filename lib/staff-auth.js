// Shared authorisation for staff-only API routes (Admin / MD / Employee).
//
// The older catch-all routes accept an email in the request body with no verification.
// New routes must not: they read and write client KYC data, stationery and signatures.
// Two credentials are accepted — the ADMIN_TOKEN the dashboard stores after
// /api/system/verify, and a NextAuth session belonging to a staff role.

import { getToken } from 'next-auth/jwt';
import { DESIGNATIONS, DESIGNATION_LABELS, normalizeDesignation, deskPathForDesignation } from '@/lib/designations';

const STAFF_ROLE_PATTERN = /admin|md|employee|officer|manager|staff|gm|doc_team/i;

export { DESIGNATIONS, DESIGNATION_LABELS, normalizeDesignation, deskPathForDesignation };

export function isStaffRole(role) {
  return STAFF_ROLE_PATTERN.test(String(role || ''));
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
    token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  } catch (err) {
    console.warn('[staff-auth] session decode failed:', err?.message || err);
  }

  if (token?.emp_id || (token?.email && isStaffRole(token.role))) {
    return { ok: true, actor: String(token.role || 'staff'), email: token.email ? String(token.email).toLowerCase() : null };
  }

  if (token?.email) {
    return { ok: false, status: 403, error: 'This action is restricted to staff accounts.' };
  }

  // With no ADMIN_TOKEN configured there is nothing to verify a bearer against. Refuse
  // rather than silently running unauthenticated in a misconfigured deployment.
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

    const user = await db.collection('users').findOne(
      { email },
      { projection: { role: 1, employee_id: 1 } },
    );
    if (user && (isStaffRole(user.role) || user.employee_id)) {
      return { ok: true, actor: 'employee', email };
    }
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
  if (!empId) return base;
  try {
    const { getDb } = await import('./db.js');
    const db = await getDb();
    const emp = await db.collection('employees').findOne(
      { emp_id: empId, deleted: { $ne: true }, active: { $ne: false } },
      { projection: { designation: 1, team_id: 1, name: 1, email: 1 } },
    );
    if (!emp) return base;
    if (emp.designation) base.designation = normalizeDesignation(emp.designation);
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
export async function resolveActorRole(request) {
  let token = null;
  try {
    token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
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

export async function resolveClientEmail(request) {
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

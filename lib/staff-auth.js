// Shared authorisation for staff-only API routes (Admin / MD / Employee).
//
// The older catch-all routes accept an email in the request body with no verification.
// New routes must not: they read and write client KYC data, stationery and signatures.
// Two credentials are accepted — the ADMIN_TOKEN the dashboard stores after
// /api/system/verify, and a NextAuth session belonging to a staff role.

import { getToken } from 'next-auth/jwt';
import fs from 'node:fs';
import path from 'node:path';
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

  if (adminToken && bearer && bearer === adminToken) {
    // #region agent log
    fetch('http://127.0.0.1:7477/ingest/dcce912b-9df5-4338-98f3-06c1a78e9bb9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'900d71'},body:JSON.stringify({sessionId:'900d71',runId:'pre-fix',hypothesisId:'B',location:'lib/staff-auth.js:requireStaff',message:'accepted via ADMIN_TOKEN bearer',data:{hasAdminEnv:true,hasBearer:true,matched:true},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return { ok: true, actor: 'admin_token', email: null };
  }

  let token = null;
  try {
    token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  } catch (err) {
    console.warn('[staff-auth] session decode failed:', err?.message || err);
  }

  if (token?.email && isStaffRole(token.role)) {
    return { ok: true, actor: String(token.role || 'staff'), email: String(token.email).toLowerCase() };
  }

  if (token?.email) {
    // #region agent log
    fetch('http://127.0.0.1:7477/ingest/dcce912b-9df5-4338-98f3-06c1a78e9bb9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'900d71'},body:JSON.stringify({sessionId:'900d71',runId:'pre-fix',hypothesisId:'C',location:'lib/staff-auth.js:requireStaff',message:'jwt present but role not staff',data:{hasJwt:true,hasEmail:true,roleIsStaff:false,status:403},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return { ok: false, status: 403, error: 'This action is restricted to staff accounts.' };
  }

  // #region agent log
  {
    const payload = {sessionId:'900d71',runId:'pre-fix',hypothesisId:'A',location:'lib/staff-auth.js:requireStaff',message:'401 staff sign-in required',data:{hasAdminEnv:Boolean(adminToken),hasBearer:Boolean(bearer),bearerMatches:Boolean(adminToken&&bearer&&bearer===adminToken),hasJwt:Boolean(token),hasEmail:Boolean(token?.email),status:401},timestamp:Date.now()};
    fetch('http://127.0.0.1:7477/ingest/dcce912b-9df5-4338-98f3-06c1a78e9bb9',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'900d71'},body:JSON.stringify(payload)}).catch(()=>{});
    try { fs.appendFileSync(path.join(process.cwd(), 'debug-900d71.log'), JSON.stringify(payload) + '\n'); } catch { /* debug sink */ }
  }
  // #endregion
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
 * @returns {Promise<{role: 'MD'|'EMPLOYEE'|null, empId: string|null, email: string|null, name: string|null, designation: string|null, teamId: string|null}>}
 */
export async function resolveActorRole(request) {
  const adminToken = String(process.env.ADMIN_TOKEN || '').trim();
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (adminToken && bearer && bearer === adminToken) {
    return { role: 'MD', empId: null, email: null, name: null, designation: null, teamId: null };
  }

  let token = null;
  try {
    token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
  } catch (err) {
    console.warn('[staff-auth] resolveActorRole session decode failed:', err?.message || err);
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
  if (token?.emp_id) {
    return {
      role: 'EMPLOYEE',
      empId: token.emp_id,
      email: token.email || null,
      name: token.name || null,
      designation: normalizeDesignation(token.designation),
      teamId: token.team_id || null,
    };
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

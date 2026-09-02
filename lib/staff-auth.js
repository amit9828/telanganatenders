// Shared authorisation for staff-only API routes (Admin / MD / Employee).
//
// The older catch-all routes accept an email in the request body with no verification.
// New routes must not: they read and write client KYC data, stationery and signatures.
// Two credentials are accepted — the ADMIN_TOKEN the dashboard stores after
// /api/system/verify, and a NextAuth session belonging to a staff role.

import { getToken } from 'next-auth/jwt';

const STAFF_ROLE_PATTERN = /admin|md|employee|officer|manager|staff/i;

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
    return { ok: false, status: 403, error: 'This action is restricted to staff accounts.' };
  }

  // With no ADMIN_TOKEN configured there is nothing to verify a bearer against. Refuse
  // rather than silently running unauthenticated in a misconfigured deployment.
  return { ok: false, status: 401, error: 'Please sign in with a staff account.' };
}

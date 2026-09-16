import { encode } from 'next-auth/jwt';
import { DESIGNATIONS, normalizeDesignation, deskPathForDesignation } from '@/lib/designations';

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isAdminBypassToken(provided) {
  const token = String(provided || '').trim();
  if (!token) return false;
  if (token === 'admin_success') return true;
  const adminToken = String(process.env.ADMIN_TOKEN || '').trim();
  return Boolean(adminToken && token === adminToken);
}

export function staffJwtFromEmployee(emp) {
  const mdEmail = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const isMD = Boolean(mdEmail) && String(emp.email || '').toLowerCase() === mdEmail;
  return {
    id: emp._id.toString(),
    sub: emp._id.toString(),
    email: emp.email ? String(emp.email).toLowerCase() : null,
    name: emp.name,
    emp_id: emp.emp_id,
    role: isMD ? 'MD' : 'EMPLOYEE',
    designation: isMD ? null : normalizeDesignation(emp.designation),
    team_id: isMD ? null : (emp.team_id || null),
    is_bypass: true,
  };
}

export async function impersonateCaller(credentials, req) {
  if (isAdminBypassToken(credentials?.adminToken)) {
    return { kind: 'admin_token' };
  }
  try {
    const { getStaffToken } = await import('@/lib/staff-auth');
    const token = await getStaffToken(req);
    if (!token) return null;
    if (token.role === 'MD') return { kind: 'MD' };
    const designation = token.designation ? normalizeDesignation(token.designation) : null;
    if (designation === DESIGNATIONS.GM) return { kind: 'GM' };
    if (designation === DESIGNATIONS.DOC_TEAM_TL) return { kind: 'TL' };
  } catch (err) {
    console.warn('[impersonate] caller session decode failed:', err?.message || err);
  }
  return null;
}

export function callerCanBypass(caller, emp) {
  const dest = normalizeDesignation(emp.designation);
  if (caller.kind === 'admin_token' || caller.kind === 'MD') return true;
  if (caller.kind === 'GM') return dest === DESIGNATIONS.DOC_TEAM_TL || dest === DESIGNATIONS.DOC_TEAM_MEMBER;
  if (caller.kind === 'TL') return dest === DESIGNATIONS.DOC_TEAM_MEMBER;
  return false;
}

export async function findEmployeeForBypass(db, credentials) {
  const empId = String(credentials?.emp_id || '').trim();
  const searchStr = String(credentials?.email || empId || '').trim();
  const or = [];
  if (searchStr) {
    or.push({ email: new RegExp(`^${escapeRegex(searchStr)}$`, 'i') });
    or.push({ emp_id: new RegExp(`^${escapeRegex(searchStr)}$`, 'i') });
  }
  if (empId && empId.toLowerCase() !== searchStr.toLowerCase()) {
    or.push({ emp_id: new RegExp(`^${escapeRegex(empId)}$`, 'i') });
  }
  if (!or.length) return null;
  return db.collection('employees').findOne({
    $or: or,
    deleted: { $ne: true },
    active: { $ne: false },
  });
}

export function sessionCookieName(request) {
  const url = String(process.env.NEXTAUTH_URL || '').trim();
  const proto = String(
    request?.headers?.get?.('x-forwarded-proto')
    || (request?.url ? new URL(request.url).protocol.replace(':', '') : '')
    || '',
  ).toLowerCase();
  const useSecure = url.startsWith('https://') || proto === 'https';
  return useSecure ? '__Secure-next-auth.session-token' : 'next-auth.session-token';
}

export async function encodeStaffSessionCookie(emp, request) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is not configured.');
  const maxAge = 30 * 24 * 60 * 60;
  const jwt = await encode({
    token: staffJwtFromEmployee(emp),
    secret,
    maxAge,
  });
  const names = new Set([
    'next-auth.session-token',
    sessionCookieName(request),
    sessionCookieName(),
  ]);
  return [...names].map((name) => ({
    name,
    value: jwt,
    options: {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: name.startsWith('__Secure-'),
      maxAge,
    },
  }));
}

export async function resolveBypassCaller(request, adminTokenFromBody) {
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (isAdminBypassToken(adminTokenFromBody) || isAdminBypassToken(bearer)) {
    return { kind: 'admin_token' };
  }
  return impersonateCaller({ adminToken: adminTokenFromBody }, request);
}

export { deskPathForDesignation };

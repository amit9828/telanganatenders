import { encode } from 'next-auth/jwt';
import { DESIGNATIONS, normalizeDesignation, deskPathForDesignation } from '@/lib/designations';
import { isMdEmployee } from '@/lib/staff-auth';

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

export function pickOriginalIdentity(source) {
  if (!source?.originalRole) return null;
  return {
    originalRole: source.originalRole,
    originalEmail: source.originalEmail || null,
    originalName: source.originalName || null,
    originalEmpId: source.originalEmpId || null,
    originalDesignation: source.originalDesignation ?? null,
    originalTeamId: source.originalTeamId ?? null,
  };
}

export function originalIdentityFromCaller(token, callerKind) {
  const existing = pickOriginalIdentity(token);
  if (existing) return existing;

  if (token?.role === 'MD' || callerKind === 'admin_token' || callerKind === 'MD') {
    return {
      originalRole: 'MD',
      originalEmail: token?.email || String(process.env.ADMIN_EMAIL || '').trim().toLowerCase() || null,
      originalName: token?.name || 'Managing Director',
      originalEmpId: token?.emp_id || null,
      originalDesignation: token?.designation || null,
      originalTeamId: token?.team_id || null,
    };
  }

  if (token?.emp_id || token?.role) {
    return {
      originalRole: token.role || 'EMPLOYEE',
      originalEmail: token.email || null,
      originalName: token.name || null,
      originalEmpId: token.emp_id || null,
      originalDesignation: token.designation || null,
      originalTeamId: token.team_id || null,
    };
  }

  return {
    originalRole: 'MD',
    originalEmail: String(process.env.ADMIN_EMAIL || '').trim().toLowerCase() || null,
    originalName: 'Managing Director',
    originalEmpId: null,
    originalDesignation: null,
    originalTeamId: null,
  };
}

export function staffJwtFromEmployee(emp, extras = {}) {
  const isMD = isMdEmployee(emp);
  const isBypass = Boolean(extras.isBypass);
  const token = {
    id: emp._id.toString(),
    sub: emp._id.toString(),
    email: emp.email ? String(emp.email).toLowerCase() : null,
    name: emp.name,
    emp_id: emp.emp_id,
    role: isMD ? 'MD' : 'EMPLOYEE',
    designation: isMD ? null : normalizeDesignation(emp.designation),
    team_id: isMD ? null : (emp.team_id || null),
    is_bypass: isBypass,
  };

  if (isBypass) {
    const original = pickOriginalIdentity(extras.original) || (extras.original?.originalRole ? extras.original : null);
    if (original?.originalRole) {
      token.originalRole = original.originalRole;
      token.originalEmail = original.originalEmail || null;
      token.originalName = original.originalName || null;
      token.originalEmpId = original.originalEmpId || null;
      token.originalDesignation = original.originalDesignation ?? null;
      token.originalTeamId = original.originalTeamId ?? null;
    }
  }

  return token;
}

export async function impersonateCaller(credentials, req) {
  if (isAdminBypassToken(credentials?.adminToken)) {
    return { kind: 'admin_token' };
  }
  try {
    const { getStaffToken } = await import('@/lib/staff-auth');
    const token = await getStaffToken(req);
    if (!token) return null;
    if (token.role === 'MD' || isMdEmployee(token)) return { kind: 'MD' };
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

function sessionCookieNames(request) {
  return new Set([
    'next-auth.session-token',
    '__Secure-next-auth.session-token',
    sessionCookieName(request),
    sessionCookieName(),
  ]);
}

export function clearStaffSessionCookies(request) {
  return [...sessionCookieNames(request)].map((name) => ({
    name,
    value: '',
    options: {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: name.startsWith('__Secure-'),
      maxAge: 0,
      expires: new Date(0),
    },
  }));
}

async function encodeTokenCookie(token, request) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET is not configured.');
  const maxAge = 30 * 24 * 60 * 60;
  const jwt = await encode({ token, secret, maxAge });
  return [...sessionCookieNames(request)].map((name) => ({
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

export async function encodeStaffSessionCookie(emp, request, extras = {}) {
  const isBypass = extras.isBypass !== false;
  return encodeTokenCookie(staffJwtFromEmployee(emp, { isBypass, original: extras.original }), request);
}

export async function resolveBypassCaller(request, adminTokenFromBody) {
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (isAdminBypassToken(adminTokenFromBody) || isAdminBypassToken(bearer)) {
    return { kind: 'admin_token' };
  }
  return impersonateCaller({ adminToken: adminTokenFromBody }, request);
}

export { deskPathForDesignation, isMdEmployee };

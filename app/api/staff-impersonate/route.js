import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getStaffToken } from '@/lib/staff-auth';
import {
  callerCanBypass,
  callerKindForEmployee,
  deskPathForDesignation,
  findEmployeeForBypass,
  isAdminBypassToken,
} from '@/lib/impersonate';
import { IMPERSONATION_COOKIE, IMPERSONATION_MAX_AGE, isMdSessionCookie, signImpersonation } from '@/lib/desk-cookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cookieOptions(request, maxAge) {
  const proto = String(request.headers.get('x-forwarded-proto') || new URL(request.url).protocol.replace(':', '')).toLowerCase();
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: proto === 'https' || String(process.env.NEXTAUTH_URL || '').startsWith('https://'),
    maxAge,
  };
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const ident = String(body.ident || body.email || body.emp_id || '').trim();
    if (!ident) return NextResponse.json({ error: 'Pick a staff member to open.' }, { status: 400 });

    const token = await getStaffToken(request);
    const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    const mdCookie = isAdminBypassToken(bearer)
      || await isMdSessionCookie(request.cookies.get('tt_md_session')?.value);
    if (!token?.emp_id && !token?.email && !mdCookie) {
      return NextResponse.json({ error: 'Please sign in with a staff account.' }, { status: 401 });
    }

    const db = await getDb();
    const callerEmp = token?.emp_id || token?.email
      ? await findEmployeeForBypass(db, { email: token.email || '', emp_id: token.emp_id || '' })
      : null;
    const kind = mdCookie || token?.role === 'MD' ? 'MD' : callerKindForEmployee(callerEmp);
    if (!kind) return NextResponse.json({ error: 'Not allowed to open other desks.' }, { status: 403 });

    const target = await findEmployeeForBypass(db, { email: ident, emp_id: ident });
    if (!target) return NextResponse.json({ error: 'Staff account not found.' }, { status: 404 });
    if (!callerCanBypass({ kind, empId: callerEmp?.emp_id || null }, target)) {
      return NextResponse.json({ error: 'Not allowed to open this desk.' }, { status: 403 });
    }

    const path = deskPathForDesignation(target.designation || target.role);
    const res = NextResponse.json({ ok: true, path, ident: target.email || target.emp_id });
    const desk = path === '/tl' ? 'tl' : path === '/employee' ? 'employee' : '';
    if (desk && kind !== 'MD' && callerEmp?.emp_id) {
      const value = await signImpersonation({
        by: callerEmp.emp_id,
        target: target.emp_id,
        desk,
        exp: Date.now() + IMPERSONATION_MAX_AGE * 1000,
      });
      if (value) res.cookies.set(IMPERSONATION_COOKIE, value, cookieOptions(request, IMPERSONATION_MAX_AGE));
    }
    return res;
  } catch (err) {
    console.error('[staff-impersonate]', err?.message || err);
    return NextResponse.json({ error: 'Could not open this desk.' }, { status: 500 });
  }
}

export async function DELETE(request) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(IMPERSONATION_COOKIE, '', cookieOptions(request, 0));
  return res;
}

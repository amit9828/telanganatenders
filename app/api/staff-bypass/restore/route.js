import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getStaffToken, isMdEmployee } from '@/lib/staff-auth';
import {
  clearStaffSessionCookies,
  deskPathForDesignation,
  encodeStaffSessionCookie,
  findEmployeeForBypass,
} from '@/lib/impersonate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function applyCookies(res, cookies) {
  for (const cookie of cookies) {
    res.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  return res;
}

export async function POST(request) {
  try {
    const token = await getStaffToken(request);
    if (!token?.is_bypass || !token.originalRole) {
      return NextResponse.json(
        { error: 'No bypass session to restore.' },
        { status: 400 },
      );
    }

    const originalRole = String(token.originalRole);
    const lookup = {
      email: token.originalEmail || '',
      emp_id: token.originalEmpId || '',
    };

    if (originalRole === 'MD') {
      let emp = null;
      if (lookup.email || lookup.emp_id) {
        const db = await getDb();
        emp = await findEmployeeForBypass(db, lookup);
      }
      if (emp && isMdEmployee(emp)) {
        const cookies = await encodeStaffSessionCookie(emp, request, { isBypass: false });
        const res = NextResponse.json({ ok: true, path: '/admin' });
        return applyCookies(res, cookies);
      }
      const res = NextResponse.json({ ok: true, path: '/admin' });
      return applyCookies(res, clearStaffSessionCookies(request));
    }

    const db = await getDb();
    const emp = await findEmployeeForBypass(db, lookup);
    if (!emp) {
      return NextResponse.json({ error: 'Original staff account not found.' }, { status: 404 });
    }
    const cookies = await encodeStaffSessionCookie(emp, request, { isBypass: false });
    const res = NextResponse.json({
      ok: true,
      path: deskPathForDesignation(emp.designation),
    });
    return applyCookies(res, cookies);
  } catch (err) {
    console.error('[staff-bypass/restore]', err?.message || err);
    return NextResponse.json(
      { error: err.message || 'Could not restore the original session.' },
      { status: 500 },
    );
  }
}

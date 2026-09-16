import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import {
  callerCanBypass,
  deskPathForDesignation,
  encodeStaffSessionCookie,
  findEmployeeForBypass,
  resolveBypassCaller,
} from '@/lib/impersonate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const caller = await resolveBypassCaller(request, body.adminToken);
    if (!caller) {
      return NextResponse.json(
        { error: 'Please sign in with a staff account.' },
        { status: 401 },
      );
    }

    const db = await getDb();
    const emp = await findEmployeeForBypass(db, body);
    if (!emp) {
      return NextResponse.json({ error: 'Staff account not found.' }, { status: 404 });
    }
    if (!callerCanBypass(caller, emp)) {
      return NextResponse.json({ error: 'Not allowed to bypass this desk.' }, { status: 403 });
    }

    const cookies = await encodeStaffSessionCookie(emp, request);
    const path = deskPathForDesignation(emp.designation);
    const res = NextResponse.json({
      ok: true,
      path,
      emp_id: emp.emp_id,
      email: emp.email || null,
      designation: emp.designation || null,
    });
    for (const cookie of cookies) {
      res.cookies.set(cookie.name, cookie.value, cookie.options);
    }
    return res;
  } catch (err) {
    console.error('[staff-bypass]', err?.message || err);
    return NextResponse.json(
      { error: err.message || 'Bypass failed.' },
      { status: 500 },
    );
  }
}

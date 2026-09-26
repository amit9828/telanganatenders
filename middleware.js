import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { isMdSessionCookie } from '@/lib/desk-cookie';

function deskOf(token) {
  const role = String(token?.role || '').toUpperCase().replace(/[\s-]+/g, '_');
  const designation = String(token?.designation || '').toUpperCase().replace(/[\s-]+/g, '_');
  if (role === 'MD' || role === 'ADMIN') return 'md';
  if (designation === 'GM' || role === 'GM' || role === 'GENERAL_MANAGER') return 'gm';
  if (designation === 'DOC_TEAM_TL' || designation === 'TL' || role === 'TL') return 'tl';
  if (designation === 'DOC_TEAM_MEMBER' || role === 'EMPLOYEE' || token?.emp_id) return 'employee';
  if (token?.email) return 'client';
  return '';
}

function home(req) {
  return NextResponse.redirect(new URL('/', req.url));
}

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  const secret = process.env.NEXTAUTH_SECRET;
  let token = await getToken({ req, secret });
  if (!token) token = await getToken({ req, secret, secureCookie: false });
  const mdCookie = await isMdSessionCookie(req.cookies.get('tt_md_session')?.value);
  const desk = mdCookie ? 'md' : deskOf(token);
  const authed = Boolean(token?.email || token?.emp_id || mdCookie);

  if (pathname === '/md' || pathname.startsWith('/md/')) {
    if (desk !== 'md') return home(req);
    const url = req.nextUrl.clone();
    url.pathname = `/admin${pathname.slice(3)}` || '/admin';
    return NextResponse.rewrite(url);
  }

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    if (desk !== 'md') return home(req);
    return NextResponse.next();
  }

  if (pathname === '/gm' || pathname.startsWith('/gm/')) {
    if (desk !== 'gm' && desk !== 'md') return home(req);
    return NextResponse.next();
  }

  if (pathname === '/tl' || pathname.startsWith('/tl/')) {
    if (desk !== 'tl' && desk !== 'md') return home(req);
    return NextResponse.next();
  }

  if (pathname === '/employee' || pathname.startsWith('/employee/')) {
    if (!authed || desk === 'client') return home(req);
    return NextResponse.next();
  }

  if (pathname === '/client' || pathname.startsWith('/client/')) {
    if (!authed) return home(req);
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/client',
    '/client/:path*',
    '/gm',
    '/gm/:path*',
    '/admin',
    '/admin/:path*',
    '/md',
    '/md/:path*',
    '/tl',
    '/tl/:path*',
    '/employee',
    '/employee/:path*',
  ],
};

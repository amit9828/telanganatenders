import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
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

export async function readDeskSession() {
  const jar = cookies();
  const secret = process.env.NEXTAUTH_SECRET;
  const req = { cookies: jar, headers: {} };
  let token = await getToken({ req, secret });
  if (!token) token = await getToken({ req, secret, secureCookie: false });
  const mdCookie = await isMdSessionCookie(jar.get('tt_md_session')?.value);
  const desk = mdCookie ? 'md' : deskOf(token);
  const authed = Boolean(token?.email || token?.emp_id || mdCookie);
  return { token, desk, authed };
}

export async function assertDesk(kind) {
  const { token, desk, authed } = await readDeskSession();
  let ok = false;
  if (kind === 'md') ok = desk === 'md';
  else if (kind === 'gm') ok = desk === 'gm' || desk === 'md';
  else if (kind === 'tl') ok = desk === 'tl' || desk === 'md';
  else if (kind === 'employee') ok = authed && desk !== 'client';
  else if (kind === 'client') ok = Boolean(token?.email || authed);
  if (!ok) redirect('/');
}

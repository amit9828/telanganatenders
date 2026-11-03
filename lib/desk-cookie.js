const encoder = new TextEncoder();
const MESSAGE = 'tt-md-desk-v2';

function signingSecret() {
  return String(process.env.NEXTAUTH_SECRET || process.env.ADMIN_TOKEN || '');
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function mdSessionValue() {
  const secret = signingSecret();
  if (!secret) return '';
  return hmacHex(secret, MESSAGE);
}

function sameString(expected, got) {
  if (!expected || expected.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

export async function isMdSessionCookie(value) {
  const expected = await mdSessionValue();
  return sameString(expected, String(value || ''));
}

export const IMPERSONATION_COOKIE = 'tt_impersonate';
export const IMPERSONATION_MAX_AGE = 8 * 60 * 60;
const IMPERSONATION_PREFIX = 'tt-impersonate-v1.';

// Runs in middleware too, so stick to Web APIs (no Buffer).
function toBase64Url(text) {
  let binary = '';
  for (const byte of encoder.encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)));
}

export async function signImpersonation({ by, target, desk, exp }) {
  const secret = signingSecret();
  if (!secret) return '';
  const body = toBase64Url(JSON.stringify({
    by: String(by || ''),
    target: String(target || ''),
    desk: String(desk || ''),
    exp: Number(exp) || Date.now() + IMPERSONATION_MAX_AGE * 1000,
  }));
  return `${body}.${await hmacHex(secret, IMPERSONATION_PREFIX + body)}`;
}

export async function readImpersonation(value, now = Date.now()) {
  const raw = String(value || '');
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  const secret = signingSecret();
  if (!secret) return null;
  const body = raw.slice(0, dot);
  const expected = await hmacHex(secret, IMPERSONATION_PREFIX + body);
  if (!sameString(expected, raw.slice(dot + 1))) return null;
  try {
    const payload = JSON.parse(fromBase64Url(body));
    if (!payload?.by || !payload?.target || !payload?.desk) return null;
    if (!(Number(payload.exp) > now)) return null;
    return payload;
  } catch {
    return null;
  }
}

const IMPERSONATION_RANK = { md: 3, gm: 2, tl: 1, employee: 0 };

/** Whether a signed impersonation payload lets this caller onto `desk`. */
export function impersonationAllows(token, payload, desk, callerDesk) {
  if (!payload || payload.desk !== desk) return false;
  const self = String(token?.emp_id || '').trim().toLowerCase();
  if (!self || String(payload.by).trim().toLowerCase() !== self) return false;
  if (desk !== 'tl' && desk !== 'employee') return false;
  const callerRank = IMPERSONATION_RANK[callerDesk];
  return callerRank != null && callerRank > IMPERSONATION_RANK[desk];
}

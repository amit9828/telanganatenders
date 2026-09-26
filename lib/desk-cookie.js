const encoder = new TextEncoder();
const MESSAGE = 'tt-md-desk';

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

export async function isMdSessionCookie(value) {
  const expected = await mdSessionValue();
  const got = String(value || '');
  if (!expected || expected.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

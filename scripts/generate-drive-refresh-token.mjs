// One-time local consent for the consumer Gmail that owns client Drive folders.
// Run: node scripts/generate-drive-refresh-token.mjs
// Paste the printed GOOGLE_DRIVE_REFRESH_TOKEN into .env. Do not commit it.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { google } from 'googleapis';

function loadLocalEnv() {
  const root = process.cwd();
  for (const name of ['.env.local', '.env']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] == null || process.env[key] === '') process.env[key] = value;
    }
  }
}

loadLocalEnv();

const clientId = String(process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '').trim();
const clientSecret = String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '').trim();
if (!clientId || !clientSecret) {
  console.error('Set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET in .env, then run this script again.');
  process.exit(1);
}

const PORT = 53682;
const redirect = `http://127.0.0.1:${PORT}/oauth2callback`;
const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirect);
const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/drive'],
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', redirect);
    if (url.pathname !== '/oauth2callback') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const oauthError = url.searchParams.get('error');
    if (oauthError) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(`Google returned: ${oauthError}. You can close this tab.`);
      console.error('Consent failed:', oauthError);
      server.close();
      process.exit(1);
    }
    const code = url.searchParams.get('code');
    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing authorization code.');
      return;
    }
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<p>Refresh token captured. You can close this tab and return to the terminal.</p>');
    if (!tokens.refresh_token) {
      console.error('Google did not return a refresh token. Revoke this app at https://myaccount.google.com/permissions and run the script again.');
      server.close();
      process.exit(1);
    }
    console.log('\nAdd this line to .env (do not commit it):\n');
    console.log(`GOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('Token exchange failed:', err?.message || err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Token exchange failed. See the terminal.');
    }
    server.close();
    process.exit(1);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\nSign in as the Gmail account that owns the client Drive folders:\n');
  console.log(authUrl);
  console.log(`\nWaiting for Google to redirect to ${redirect}\n`);
});

// Local bridge the MD/Employee dashboards ping to launch the visible GeM hunter.
// Listens on http://localhost:4001 — never deployed to Vercel.

import express from 'express';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadLocalEnv } from './load-local-env.js';
import { isSafeRemoteUrl } from '../lib/tender-links.js';

loadLocalEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.GEM_AGENT_PORT || 4001);
const ALLOWED_ORIGINS = new Set([
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://www.tgtenders.in',
  'https://tgtenders.in',
  String(process.env.NEXTAUTH_URL || '').replace(/\/+$/, ''),
  String(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, ''),
].filter(Boolean));

let hunter = null;

function isHunterAlive() {
  return Boolean(hunter && hunter.exitCode == null && !hunter.killed);
}

function launchHunter() {
  if (isHunterAlive()) {
    return { already_running: true, pid: hunter.pid };
  }

  const script = path.join(__dirname, 'gem-local-agent.js');
  hunter = spawn(process.execPath, [script], {
    cwd: path.join(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
    detached: false,
    windowsHide: false,
  });

  hunter.on('exit', (code) => {
    console.log(`[gem-agent] hunter exited with code ${code}`);
    hunter = null;
  });
  hunter.on('error', (err) => {
    console.error('[gem-agent] failed to spawn hunter:', err.message);
    hunter = null;
  });

  return { already_running: false, pid: hunter.pid };
}

// --- Authenticated document fetcher ----------------------------------------
//
// Many SOW and buyer-ATC attachments are served only to a logged-in GeM session, so a
// plain server-side fetch gets an HTML login page with a 200 status. This browser keeps a
// persistent profile on disk: the operator signs in to GeM once in the window that opens,
// and every later download reuses that session.

const FETCH_PROFILE_DIR = process.env.GEM_FETCH_PROFILE_DIR
  || path.join(os.homedir(), '.tgtenders', 'gem-fetch-profile');
const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
const NAVIGATION_TIMEOUT_MS = 45000;
// Keeping the browser warm matters: cold-starting Chromium per document would add ~4s to
// every one of the three to five documents in a dossier.
const IDLE_CLOSE_MS = 5 * 60 * 1000;

let fetchContext = null;
let idleTimer = null;

function scheduleIdleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const ctx = fetchContext;
    fetchContext = null;
    await ctx?.close().catch(() => {});
    console.log('[gem-agent] fetch browser closed after idle timeout');
  }, IDLE_CLOSE_MS);
}

async function getFetchContext() {
  if (fetchContext) {
    scheduleIdleClose();
    return fetchContext;
  }

  fetchContext = await chromium.launchPersistentContext(FETCH_PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 860 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    acceptDownloads: true,
    ignoreHTTPSErrors: true,
  });

  fetchContext.on('close', () => {
    fetchContext = null;
    clearTimeout(idleTimer);
  });

  scheduleIdleClose();
  return fetchContext;
}

function isPdfBuffer(buffer) {
  return Boolean(buffer) && buffer.length > 4 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

/**
 * Downloads one document inside the authenticated browser.
 *
 * Tries the page's own fetch first, since a same-origin XHR carries the session cookies
 * and returns bytes directly. Falls back to a navigation, which is what works when the
 * portal answers with a Content-Disposition download instead of an inline response.
 */
async function fetchDocumentInBrowser(url) {
  const context = await getFetchContext();
  const page = await context.newPage();

  try {
    const target = new URL(url);
    // Land on the portal first so the request is same-origin and the session cookie is
    // attached; a cross-origin fetch from about:blank is sent without credentials.
    await page.goto(`${target.protocol}//${target.host}/`, {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS,
    }).catch(() => {});

    const viaXhr = await page.evaluate(async (href) => {
      try {
        const res = await fetch(href, { credentials: 'include', redirect: 'follow' });
        if (!res.ok) return { ok: false, status: res.status };
        const bytes = new Uint8Array(await res.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        }
        return { ok: true, base64: btoa(binary), contentType: res.headers.get('content-type') || '' };
      } catch (err) {
        return { ok: false, error: String(err?.message || err) };
      }
    }, url).catch(() => null);

    if (viaXhr?.ok && viaXhr.base64) {
      const buffer = Buffer.from(viaXhr.base64, 'base64');
      if (isPdfBuffer(buffer) && buffer.length <= MAX_DOCUMENT_BYTES) {
        return { ok: true, buffer };
      }
    }

    // Second attempt: navigate and capture either the response body or a download.
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    const response = await page.goto(url, { waitUntil: 'commit', timeout: NAVIGATION_TIMEOUT_MS }).catch(() => null);

    const download = await downloadPromise;
    if (download) {
      const stream = await download.createReadStream();
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      if (isPdfBuffer(buffer)) return { ok: true, buffer };
    }

    if (response) {
      const buffer = await response.body().catch(() => null);
      if (isPdfBuffer(buffer)) return { ok: true, buffer };
    }

    // Reaching here almost always means GeM bounced us to its login page.
    const title = await page.title().catch(() => '');
    return {
      ok: false,
      error: /login|sign\s*in/i.test(title)
        ? 'GeM asked for a login. Sign in to GeM in the browser window that just opened, then run the ingest again.'
        : 'The portal did not return a PDF for this link.',
      needs_login: /login|sign\s*in/i.test(title),
    };
  } finally {
    await page.close().catch(() => {});
    scheduleIdleClose();
  }
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

app.use((req, res, next) => {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.has(origin) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.get(['/health', '/api/health'], (_req, res) => {
  res.json({ ok: true, hunter_running: isHunterAlive(), pid: hunter?.pid || null });
});

function launchHtml(result) {
  const title = result.already_running ? 'Hunter already running' : 'Chrome launched';
  const body = result.already_running
    ? 'The visible Chrome window is already hunting. You can close this tab.'
    : 'Chrome is opening and the search starts on its own. You can close this tab.';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${title}</title></head>
<body style="font-family:Segoe UI,sans-serif;max-width:36rem;margin:3rem auto;padding:0 1.25rem;color:#0A2647">
  <h1 style="font-size:1.25rem">${title}</h1>
  <p>${body}</p>
</body></html>`;
}

// GET /launch is the HTTPS-dashboard fallback: browsers block fetch() from
// https://www.tgtenders.in to http://localhost:4001 (mixed content), but a
// top-level navigation / window.open to localhost is allowed.
app.get('/launch', (_req, res) => {
  try {
    const result = launchHunter();
    res.status(200).type('html').send(launchHtml(result));
  } catch (err) {
    res.status(500).type('html').send(`<p>${err?.message || 'Could not launch the hunter.'}</p>`);
  }
});

app.post('/api/launch-gem', (_req, res) => {
  try {
    const result = launchHunter();
    res.json({
      success: true,
      message: result.already_running
        ? 'Hunter is already running in the visible Chrome window.'
        : 'Chrome is opening and the search starts on its own.',
      ...result,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Could not launch the hunter.' });
  }
});

// Called by lib/remote-document.js when a plain HTTPS fetch hits a login wall.
app.post('/api/fetch-document', async (req, res) => {
  const url = String(req.body?.url || '').trim();

  if (!url || !isSafeRemoteUrl(url)) {
    return res.status(400).json({ error: 'A public http(s) document URL is required.' });
  }

  try {
    const result = await fetchDocumentInBrowser(url);
    if (!result.ok) {
      return res.status(502).json({ error: result.error, needs_login: Boolean(result.needs_login) });
    }
    res.json({
      success: true,
      bytes: result.buffer.length,
      pdf_base64: result.buffer.toString('base64'),
    });
  } catch (err) {
    console.error('[gem-agent] fetch-document failed:', err?.message || err);
    res.status(500).json({ error: err?.message || 'Could not fetch the document.' });
  }
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[gem-agent] listening on http://localhost:${PORT}`);
  console.log('[gem-agent] POST /api/launch-gem from the Admin or Employee dashboard to open Chrome.');
  console.log('[gem-agent] POST /api/fetch-document downloads login-protected PDFs for the Co-Pilot.');
});

server.on('error', (err) => {
  if (err?.code === 'EADDRINUSE') {
    console.error(`[gem-agent] Port ${PORT} is already in use — the agent is probably already running.`);
    console.error('[gem-agent] Do not start a second copy. Use Launch GeM Live Hunter in the dashboard.');
    console.error(`[gem-agent] To restart: stop the other terminal (Ctrl+C), or run: Stop-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess -Force`);
    process.exit(0);
  }
  console.error('[gem-agent] failed to listen:', err?.message || err);
  process.exit(1);
});

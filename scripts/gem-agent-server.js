// Local bridge the MD/Employee dashboards ping to launch the visible GeM hunter.
// Listens on http://localhost:4001 — never deployed to Vercel.

import express from 'express';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from './load-local-env.js';

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
    : 'Chrome opened on your screen. Solve CAPTCHA if prompted, then close this tab.';
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
        : 'Chrome launched. Solve CAPTCHA on screen if prompted.',
      ...result,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Could not launch the hunter.' });
  }
});

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`[gem-agent] listening on http://localhost:${PORT}`);
  console.log('[gem-agent] POST /api/launch-gem from the Admin or Employee dashboard to open Chrome.');
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

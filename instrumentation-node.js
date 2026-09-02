// Node.js-runtime-only half of instrumentation.js — see that file for why this is
// split out and dynamically imported instead of statically imported at the top.
//
// Guarded to never run on Vercel: the bridge exists only to open a visible Chrome
// browser on someone's own laptop when triggered from the dashboard — meaningless
// (and impossible) inside a serverless function.
//
// scripts/gem-agent-server.js already exits gracefully (process.exit(0)) if port 4001
// is already bound, so this is harmless even if this module is ever evaluated more
// than once, or someone is still manually running `npm run gem:agent` in a separate
// terminal.
import { spawn } from 'child_process';
import path from 'path';

if (!process.env.VERCEL) {
  const script = path.join(process.cwd(), 'scripts', 'gem-agent-server.js');

  const child = spawn(process.execPath, [script], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    detached: false,
    windowsHide: false,
  });

  child.on('error', (err) => {
    console.error('[instrumentation] Could not auto-start the GeM agent bridge:', err?.message || err);
  });
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.warn(`[instrumentation] GeM agent bridge exited with code ${code}.`);
    }
  });
}

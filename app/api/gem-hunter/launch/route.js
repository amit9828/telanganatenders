// Launches the visible GeM Live Hunter from the Next server itself.
//
// The hunter previously required a second terminal running `npm run gem:agent`, and the
// dashboard button failed with "Local agent not running" whenever that had been
// forgotten or the bridge had crashed. When the dashboard is served from the operator's
// own machine — which is the only situation in which opening a Chrome window means
// anything — the Next process can spawn the hunter directly, so no bridge is involved.
//
// On Vercel there is no desktop to open a browser on, so this returns 501 and the client
// falls back to the localhost bridge.

import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { requireDashboardStaff } from '@/lib/staff-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Survives dev-server hot reloads, which would otherwise reset a module-level variable
// and let a second Chrome window be spawned on the next click.
const state = globalThis.__gemHunterProcess || (globalThis.__gemHunterProcess = { child: null });

function isAlive() {
  return Boolean(state.child && state.child.exitCode === null && !state.child.killed);
}

export async function GET(request) {
  const auth = await requireDashboardStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  return NextResponse.json({
    supported: !process.env.VERCEL,
    running: isAlive(),
    pid: state.child?.pid || null,
  });
}

export async function POST(request) {
  const auth = await requireDashboardStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (process.env.VERCEL) {
    return NextResponse.json(
      { error: 'The hunter opens a real Chrome window, so it can only be launched from the app running on your own computer.' },
      { status: 501 },
    );
  }

  if (isAlive()) {
    return NextResponse.json({
      success: true,
      already_running: true,
      pid: state.child.pid,
      message: 'The hunter is already running in the visible Chrome window.',
    });
  }

  try {
    const script = path.join(process.cwd(), 'scripts', 'gem-local-agent.js');
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      windowsHide: false,
    });

    child.on('exit', (code) => {
      console.log(`[gem-hunter] exited with code ${code}`);
      if (state.child === child) state.child = null;
    });
    child.on('error', (err) => {
      console.error('[gem-hunter] failed to spawn:', err?.message || err);
      if (state.child === child) state.child = null;
    });

    state.child = child;
    return NextResponse.json({
      success: true,
      already_running: false,
      pid: child.pid,
      message: 'Chrome is opening. Leave the window on screen while it works.',
    });
  } catch (err) {
    console.error('[gem-hunter] launch failed:', err);
    return NextResponse.json({ error: err?.message || 'Could not launch the hunter.' }, { status: 500 });
  }
}

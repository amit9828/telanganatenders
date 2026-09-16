// Browser helper for launching the GeM Live Hunter.
//
// Three routes to the same outcome, tried in order:
//   1. Same-origin /api/gem-hunter/launch — works whenever the app is running on the
//      operator's own machine, with no second terminal and no separate bridge process.
//   2. The localhost:4001 bridge (scripts/gem-agent-server.js) — for an HTTP dashboard
//      whose Next server is somewhere else.
//   3. A popup to the bridge — an HTTPS page cannot fetch() http://localhost (mixed
//      content), but a top-level navigation to it is allowed.
//
// Vercel can never open Chrome on someone's laptop, so step 1 returns 501 there and the
// fallbacks take over.

import { staffHeaders } from '@/components/workflow/api';

export const GEM_AGENT_ORIGIN = 'http://localhost:4001';

function isHttpsPage() {
  return typeof window !== 'undefined' && window.location.protocol === 'https:';
}

function launchViaLocalTab() {
  const popup = window.open(
    `${GEM_AGENT_ORIGIN}/launch`,
    'gem-live-hunter',
    'noopener,noreferrer,width=560,height=360',
  );
  return Boolean(popup);
}

async function launchViaSameOrigin() {
  const res = await fetch('/api/gem-hunter/launch', {
    method: 'POST',
    credentials: 'include',
    headers: staffHeaders({ 'Content-Type': 'application/json' }),
  });
  const data = await res.json().catch(() => null);
  if (res.ok) {
    return {
      ok: true,
      already_running: Boolean(data?.already_running),
      pid: data?.pid || null,
      message: data?.message,
    };
  }
  // 501 means "this server has no desktop" — a real failure to report, not a reason to
  // stop, so the caller's bridge fallback still gets a turn.
  return { ok: false, status: res.status, error: data?.error };
}

export async function launchGemHunter() {
  let sameOrigin = null;
  try {
    sameOrigin = await launchViaSameOrigin();
    if (sameOrigin.ok) return sameOrigin;
    // An auth failure will not be fixed by trying the bridge.
    if (sameOrigin.status === 401 || sameOrigin.status === 403) {
      return { ok: false, offline: false, error: sameOrigin.error || 'You are not signed in as staff.' };
    }
  } catch {
    /* dev server unreachable — fall through to the bridge */
  }

  try {
    const res = await fetch(`${GEM_AGENT_ORIGIN}/api/launch-gem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      return { ok: false, offline: false, error: data?.error || `Agent responded ${res.status}` };
    }
    return { ok: true, already_running: Boolean(data?.already_running), pid: data?.pid || null };
  } catch {
    if (isHttpsPage()) {
      if (launchViaLocalTab()) {
        return { ok: true, via_popup: true, already_running: false };
      }
      return {
        ok: false,
        offline: false,
        error: 'Popup blocked. Allow popups, or open http://localhost:3000 on this computer to launch the hunter.',
      };
    }
    return {
      ok: false,
      offline: true,
      error: sameOrigin?.error
        || "Could not start the hunter. Start the app with npm run dev (it launches everything), or run 'npm run gem:agent'.",
    };
  }
}

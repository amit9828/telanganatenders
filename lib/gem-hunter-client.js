// Browser helper for the local GeM Live Hunter bridge (scripts/gem-agent-server.js).
// Must be called from the user's machine — Vercel cannot open Chrome on their laptop.

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

export async function launchGemHunter() {
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
    // HTTPS dashboards cannot fetch() http://localhost (mixed content). A new
    // tab to the agent is allowed and is what actually starts Chrome.
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
      error: "Local agent not running. Start the app with npm run dev (it auto-starts the agent), or run 'npm run gem:agent'.",
    };
  }
}

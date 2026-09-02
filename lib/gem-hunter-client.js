// Browser helper for the local GeM Live Hunter bridge (scripts/gem-agent-server.js).
// Must be called from the user's machine — Vercel cannot open Chrome on their laptop.

export const GEM_AGENT_ORIGIN = 'http://localhost:4001';

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
    return {
      ok: false,
      offline: true,
      error: "Local agent not running. Run 'npm run gem:agent' in a terminal on this computer.",
    };
  }
}

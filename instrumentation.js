// Auto-starts the local GeM agent bridge (scripts/gem-agent-server.js) whenever a
// Next.js server instance boots, so the MD/employee no longer has to remember to run
// `npm run gem:agent` in a second terminal before "Launch GeM Live Hunter" works from
// the dashboard.
//
// Requires experimental.instrumentationHook = true in next.config.js on Next 14.x
// (stable/default from Next 15 onward).
//
// register() is bundled and invoked for BOTH the Node.js and Edge runtimes, so the
// actual child_process/path logic must live in a separate file and only ever be
// dynamically imported inside the NEXT_RUNTIME === 'nodejs' branch below — a static
// top-level import of a Node builtin here breaks the Edge bundle at build time.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node.js');
  }
}

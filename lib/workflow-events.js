const listeners = new Set();

export function publishWorkflowEvent(event) {
  for (const listener of listeners) {
    try { listener(event); } catch { /* one subscriber must not break the rest */ }
  }
}

export function subscribeWorkflowEvents(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

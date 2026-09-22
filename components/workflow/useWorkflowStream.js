'use client';

import { useEffect, useRef } from 'react';
import { clientHeaders } from '@/lib/tab-handoff';
import { staffHeaders } from '@/components/workflow/api';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Live tracking events. Falls back to the dashboard poll if the stream drops. */
export function useWorkflowStream(onEvent, { audience = 'staff', enabled = true } = {}) {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!enabled) return undefined;
    const ctrl = new AbortController();
    let stopped = false;

    const run = async () => {
      while (!stopped) {
        try {
          const headers = audience === 'client' ? clientHeaders() : staffHeaders();
          const res = await fetch('/api/workflow/stream', {
            credentials: 'include',
            headers,
            signal: ctrl.signal,
          });
          if (!res.ok || !res.body) {
            await sleep(5000);
            continue;
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          while (!stopped) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const chunks = buf.split('\n\n');
            buf = chunks.pop() || '';
            for (const chunk of chunks) {
              const line = chunk.split('\n').find((row) => row.startsWith('data:'));
              if (!line) continue;
              try {
                handler.current(JSON.parse(line.slice(5).trim()));
              } catch { /* ignore a partial frame */ }
            }
          }
        } catch (err) {
          if (ctrl.signal.aborted || stopped) return;
        }
        if (!stopped) await sleep(5000);
      }
    };

    run();
    return () => {
      stopped = true;
      ctrl.abort();
    };
  }, [audience, enabled]);
}

export function mergeTrackingEvent(job, event) {
  if (!job || String(job._id) !== String(event?.jobId)) return null;
  return {
    ...job,
    status: event.status || job.status,
    tracking_status: event.tracking_status || job.tracking_status,
    display_status: event.display_status || job.display_status,
    updated_at: event.updated_at || job.updated_at,
  };
}

'use client';

import { useEffect, useRef } from 'react';
import { staffHeaders } from '@/components/workflow/api';
import { BEACON_INTERVAL_MS, IDLE_MS } from '@/lib/reports';

const CLICKABLE = 'button, a, [role="button"], [role="tab"], input, select, textarea, label, summary';

/**
 * Sends one presence beacon after a click, a tab change, or a successful workflow write.
 * Beacons are at most every 2 minutes. They stop 5 minutes after the last interaction.
 */
export function useStaffPresence(tab, { enabled = true } = {}) {
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const lastSent = useRef(0);
  const lastInteraction = useRef(0);
  const timer = useRef(null);
  const tabSeen = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;

    const clearTimer = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };

    const schedule = (delay) => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        send();
      }, delay);
    };

    const send = () => {
      const now = Date.now();
      if (now - lastInteraction.current > IDLE_MS) return;
      const sinceSend = now - lastSent.current;
      if (lastSent.current && sinceSend < BEACON_INTERVAL_MS) {
        schedule(BEACON_INTERVAL_MS - sinceSend);
        return;
      }
      lastSent.current = now;
      const headers = staffHeaders({ 'Content-Type': 'application/json' });
      fetch('/api/staff-presence', {
        method: 'POST',
        credentials: 'include',
        keepalive: true,
        headers,
        body: JSON.stringify({ tab: tabRef.current || 'unknown' }),
      }).catch(() => {});
      schedule(BEACON_INTERVAL_MS);
    };

    const noteInteraction = () => {
      lastInteraction.current = Date.now();
      const sinceSend = Date.now() - lastSent.current;
      if (!lastSent.current || sinceSend >= BEACON_INTERVAL_MS) send();
      else schedule(BEACON_INTERVAL_MS - sinceSend);
    };

    const onClick = (event) => {
      const el = event.target?.closest?.(CLICKABLE);
      if (!el) return;
      noteInteraction();
    };

    document.addEventListener('click', onClick, true);
    window.addEventListener('tt-staff-activity', noteInteraction);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('tt-staff-activity', noteInteraction);
      clearTimer();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    if (!tabSeen.current) {
      tabSeen.current = true;
      return;
    }
    window.dispatchEvent(new Event('tt-staff-activity'));
  }, [tab, enabled]);
}

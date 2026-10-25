'use client';

import { useCallback, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

export function useDeskTab(name, fallback, allowed) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams.get(name) || '';
  const fromUrl = allowed.includes(raw) ? raw : fallback;
  const [value, setValueState] = useState(fromUrl);

  const setValue = useCallback((next) => {
    const resolved = allowed.includes(next) ? next : fallback;
    setValueState(resolved);
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!resolved || resolved === fallback) params.delete(name);
    else params.set(name, resolved);
    const query = params.toString();
    const path = pathname || window.location.pathname;
    const url = query ? `${path}?${query}` : path;
    window.history.replaceState(window.history.state, '', url);
  }, [allowed, fallback, name, pathname]);

  return [value, setValue];
}

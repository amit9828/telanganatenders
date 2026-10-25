'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function useDeskTab(name, fallback, allowed) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams.get(name) || '';
  const value = allowed.includes(raw) ? raw : fallback;

  const setValue = useCallback((next) => {
    const params = new URLSearchParams(searchParams.toString());
    if (!next || next === fallback) params.delete(name);
    else params.set(name, next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [fallback, name, pathname, router, searchParams]);

  return [value, setValue];
}

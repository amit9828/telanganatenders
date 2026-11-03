'use client';

import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { numberedPageList } from '@/components/workflow/api';

export const TENDERS_PER_PAGE = 10;

export function pageSlice(list, page, size = TENDERS_PER_PAGE) {
  const items = Array.isArray(list) ? list : [];
  const totalPages = Math.max(1, Math.ceil(items.length / size));
  const safePage = Math.min(Math.max(1, Number(page) || 1), totalPages);
  return { slice: items.slice((safePage - 1) * size, safePage * size), safePage, totalPages };
}

export default function TenderPager({ page, totalPages, onChange, scrollRef }) {
  if (totalPages <= 1) return null;
  const pages = numberedPageList(page, totalPages);
  const go = (next) => {
    onChange(Math.min(Math.max(1, next), totalPages));
    scrollRef?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <nav aria-label="Tender pages" className="flex items-center justify-center flex-wrap gap-1.5 pt-3">
      <Button variant="outline" size="sm" className="h-8 text-xs font-bold" disabled={page === 1} onClick={() => go(page - 1)}>
        <ChevronLeft className="w-4 h-4 mr-1" /> Previous
      </Button>
      {pages.map((p, i) => (
        <span key={p} className="inline-flex items-center gap-1.5">
          {i > 0 && p - pages[i - 1] > 1 && <span className="text-xs text-slate-400 px-0.5">…</span>}
          <Button
            size="sm"
            variant={p === page ? 'default' : 'outline'}
            className={`h-8 w-8 p-0 text-xs ${p === page ? 'bg-[#0A2647] hover:bg-[#144272]' : ''}`}
            aria-current={p === page ? 'page' : undefined}
            onClick={() => go(p)}
          >
            {p}
          </Button>
        </span>
      ))}
      <Button variant="outline" size="sm" className="h-8 text-xs font-bold" disabled={page === totalPages} onClick={() => go(page + 1)}>
        Next <ChevronRight className="w-4 h-4 ml-1" />
      </Button>
    </nav>
  );
}

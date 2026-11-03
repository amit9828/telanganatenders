'use client';

import { memo, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Clock, Search, FileText } from 'lucide-react';
import { staffPdfHref } from '@/components/workflow/api';
import TenderPager, { TENDERS_PER_PAGE, pageSlice } from '@/components/workflow/TenderPager';
import { liveTendersOnly } from '@/lib/tender-sort';

function fmtDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
}

function LiveTendersPaged({
  tenders = [],
  pageSize = TENDERS_PER_PAGE,
  renderActions,
  onViewPdf,
  pdfEmail,
  pdfRole = 'employee',
}) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const live = liveTendersOnly(tenders);
    const needle = q.trim().toLowerCase();
    if (!needle) return live;
    return live.filter((t) =>
      [t.bid_no, t.title, t.department, t.district].some((v) => String(v || '').toLowerCase().includes(needle))
    );
  }, [tenders, q]);
  const listRef = useRef(null);
  const { slice, safePage, totalPages } = pageSlice(filtered, page, pageSize);

  const openPdf = (t) => {
    if (onViewPdf) return onViewPdf(t._id || t.id);
    window.location.assign(staffPdfHref(t._id || t.id, { email: pdfEmail, role: pdfRole }));
  };

  return (
    <Card ref={listRef} className="tender-shadow w-full scroll-mt-20">
      <CardHeader className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
        <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg">
          Live Tenders <Badge variant="outline">{filtered.length}</Badge>
        </CardTitle>
        <div className="relative w-full sm:w-[240px]">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input
            placeholder="Search bid or title..."
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            className="pl-9 h-9 text-xs"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {slice.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No tenders on this page.</p>}
        {slice.map((t) => (
          <div key={t._id || t.id} className="border border-slate-200 rounded-lg p-3 bg-white flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap gap-1.5 mb-1">
                  {t.bid_no && <Badge variant="outline" className="text-[10px] font-mono bg-amber-50 text-amber-800 border-amber-200">Bid: {t.bid_no}</Badge>}
                  {t.district && <Badge className="bg-[#0A2647] text-[10px]">{t.district}</Badge>}
                  {t.last_date && (
                    <span className="text-[10px] text-red-600 font-bold flex items-center bg-red-50 px-1.5 py-0.5 rounded">
                      <Clock className="w-3 h-3 mr-1" /> Ends: {fmtDate(t.last_date)}
                    </span>
                  )}
                </div>
                <p className="font-bold text-sm text-[#0A2647] line-clamp-2 min-w-0">{t.title}</p>
                <p className="text-[11px] text-slate-500">{t.department}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => openPdf(t)}>
                <FileText className="w-3 h-3 mr-1" /> View PDF
              </Button>
              {renderActions?.(t)}
            </div>
          </div>
        ))}
        <TenderPager page={safePage} totalPages={totalPages} onChange={setPage} scrollRef={listRef} />
      </CardContent>
    </Card>
  );
}

export default memo(LiveTendersPaged);

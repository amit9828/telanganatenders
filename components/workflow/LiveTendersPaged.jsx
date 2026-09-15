'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Search, FileText } from 'lucide-react';

export default function LiveTendersPaged({ tenders = [], pageSize = 10, renderActions, onViewPdf }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tenders;
    return tenders.filter((t) =>
      [t.bid_no, t.title, t.department, t.district].some((v) => String(v || '').toLowerCase().includes(needle))
    );
  }, [tenders, q]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const slice = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <Card className="tender-shadow">
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
                  {t.bid_no && <Badge variant="outline" className="text-[10px] font-mono">{t.bid_no}</Badge>}
                  {t.district && <Badge className="bg-[#0A2647] text-[10px]">{t.district}</Badge>}
                </div>
                <p className="font-bold text-sm text-[#0A2647] line-clamp-2">{t.title}</p>
                <p className="text-[11px] text-slate-500">{t.department}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {onViewPdf && (
                <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => onViewPdf(t._id)}>
                  <FileText className="w-3 h-3 mr-1" /> View PDF
                </Button>
              )}
              {renderActions?.(t)}
            </div>
          </div>
        ))}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button variant="outline" size="sm" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>
              <ChevronLeft className="w-4 h-4 mr-1" /> Previous
            </Button>
            <span className="text-xs font-bold">Page {safePage} of {totalPages}</span>
            <Button variant="outline" size="sm" disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

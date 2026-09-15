'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Clock, Search, FileText } from 'lucide-react';
import { numberedPageList, staffPdfHref, viewTenderOnHome } from '@/components/workflow/api';

function fmtDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
}

export default function LiveTendersPaged({
  tenders = [],
  pageSize = 10,
  renderActions,
  onViewPdf,
  pdfEmail,
  pdfRole = 'employee',
}) {
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
  const pages = numberedPageList(safePage, totalPages);

  const openPdf = (t) => {
    if (onViewPdf) return onViewPdf(t._id || t.id);
    window.location.assign(staffPdfHref(t._id || t.id, { email: pdfEmail, role: pdfRole }));
  };

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
              {t.bid_no && (
                <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => viewTenderOnHome(t.bid_no)}>
                  View Tender
                </Button>
              )}
              {renderActions?.(t)}
            </div>
          </div>
        ))}
        {totalPages > 1 && (
          <div className="flex items-center justify-center flex-wrap gap-1.5 pt-2">
            <Button variant="outline" size="sm" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            {pages.map((p, i) => (
              <span key={p} className="inline-flex items-center gap-1.5">
                {i > 0 && p - pages[i - 1] > 1 && <span className="text-xs text-slate-400 px-0.5">…</span>}
                <Button
                  size="sm"
                  variant={p === safePage ? 'default' : 'outline'}
                  className={`h-8 w-8 p-0 text-xs ${p === safePage ? 'bg-[#0A2647]' : ''}`}
                  onClick={() => setPage(p)}
                >
                  {p}
                </Button>
              </span>
            ))}
            <Button variant="outline" size="sm" disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

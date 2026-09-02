'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Activity, Loader2, RefreshCw } from 'lucide-react';

function staffHeaders() {
  const headers = {};
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('tt_admin');
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export default function LiveScrapedTendersPanel() {
  const [rows, setRows] = useState([]);
  const [today, setToday] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async ({ silent = false } = {}) => {
    setLoading(true);
    try {
      const email = typeof window !== 'undefined'
        ? (localStorage.getItem('tt_emp_email') || '')
        : '';
      const qs = email ? `&email=${encodeURIComponent(email)}` : '';
      const res = await fetch(`/api/tenders/live-feed?t=${Date.now()}${qs}`, {
        headers: staffHeaders(),
        credentials: 'include',
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (!silent) toast.error(data?.error || `Live feed failed (${res.status})`);
        return;
      }
      setRows(data?.tenders || []);
      setToday(data?.today || '');
    } catch {
      if (!silent) toast.error('Network error while loading live scraped tenders.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load({ silent: true }); }, []);

  return (
    <Card className="tender-shadow border border-slate-300 border-t-4 border-t-teal-600 w-full overflow-hidden">
      <CardHeader className="bg-teal-50/50 border-b border-slate-200 py-3 px-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-[#0A2647] text-base">
              <Activity className="w-5 h-5 text-teal-700" /> Today&apos;s Live Scraped Tenders
            </CardTitle>
            <CardDescription className="mt-0.5 text-xs">
              Text-only GeM hunter feed for {today || 'today'} (IST). No PDF binaries.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-semibold text-slate-500 tabular-nums">
              {rows.length} row{rows.length === 1 ? '' : 's'}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => load()}
              disabled={loading}
              className="h-8 border-teal-300 text-teal-800 hover:bg-teal-50"
            >
              {loading
                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Refreshing…</>
                : <><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh Feed</>}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead>
              <tr className="bg-slate-100 border-b border-slate-300">
                <th className="border-r border-slate-300 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-600 w-[140px]">Match Keyword</th>
                <th className="border-r border-slate-300 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-600 w-[170px]">GeM Bid Number</th>
                <th className="border-r border-slate-300 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-600">Work Title &amp; Department</th>
                <th className="border-r border-slate-300 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-600 w-[130px]">District</th>
                <th className="border-r border-slate-300 px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-600 w-[110px]">Start Date</th>
                <th className="px-2 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-600 w-[110px]">Last Date</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin inline-block mr-2 align-middle" />
                    Loading today&apos;s feed…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                    <p className="font-semibold text-slate-700">No live scraped bids for today yet</p>
                    <p className="text-xs mt-1">Launch GeM Live Hunter from the Matchmaker tab — matches appear here as text rows.</p>
                  </td>
                </tr>
              ) : (
                rows.map((row, idx) => (
                  <tr
                    key={row._id || row.bid_no || idx}
                    className={`border-b border-slate-200 hover:bg-teal-50/40 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/80'}`}
                  >
                    <td className="border-r border-slate-200 px-2 py-1.5 align-top">
                      <span className="text-xs font-semibold text-teal-800 break-words">
                        {row.matched_keyword
                          || (Array.isArray(row.matched_keywords) ? row.matched_keywords.join(', ') : '—')}
                      </span>
                    </td>
                    <td className="border-r border-slate-200 px-2 py-1.5 align-top font-mono text-xs text-[#0A2647] whitespace-nowrap">
                      {row.bid_no || '—'}
                    </td>
                    <td className="border-r border-slate-200 px-2 py-1.5 align-top">
                      <div className="font-semibold text-slate-800 text-xs leading-snug">{row.title || '—'}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{row.department || '—'}</div>
                    </td>
                    <td className="border-r border-slate-200 px-2 py-1.5 align-top text-xs text-slate-700">
                      {row.district || '—'}
                    </td>
                    <td className="border-r border-slate-200 px-2 py-1.5 align-top text-xs tabular-nums text-slate-700 whitespace-nowrap">
                      {row.start_date || '—'}
                    </td>
                    <td className="px-2 py-1.5 align-top text-xs tabular-nums text-slate-700 whitespace-nowrap">
                      {row.last_date || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

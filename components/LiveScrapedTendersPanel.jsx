'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { Activity, Loader2, RefreshCw, Trash2 } from 'lucide-react';

function staffHeaders() {
  const headers = {};
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('tt_admin');
    if (token) headers.Authorization = `Bearer ${token}`;
    const email = localStorage.getItem('tt_emp_email');
    if (email) headers['x-employee-email'] = email;
  }
  return headers;
}

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'mapped', label: 'Mapped' },
  { id: 'unmapped', label: 'Unmapped' },
];

function isMapped(row) {
  return Array.isArray(row.matched_keywords) && row.matched_keywords.length > 0;
}

export default function LiveScrapedTendersPanel() {
  const [rows, setRows] = useState([]);
  const [today, setToday] = useState('');
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [filter, setFilter] = useState('all');

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

  const unmappedCount = useMemo(() => rows.filter((r) => !isMapped(r)).length, [rows]);
  const visibleRows = useMemo(() => {
    if (filter === 'mapped') return rows.filter(isMapped);
    if (filter === 'unmapped') return rows.filter((r) => !isMapped(r));
    return rows;
  }, [rows, filter]);

  const deleteOne = async (row) => {
    const id = String(row._id || '');
    if (!id) return;
    setDeletingId(id);
    try {
      const res = await fetch('/api/tenders/live-feed', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...staffHeaders() },
        credentials: 'include',
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || `Delete failed (${res.status})`);
        return;
      }
      setRows((prev) => prev.filter((r) => String(r._id || '') !== id));
      toast.success(`Removed ${row.bid_no || 'row'}.`);
    } catch {
      toast.error('Network error while deleting.');
    } finally {
      setDeletingId(null);
    }
  };

  const deleteAllUnmapped = async () => {
    setBulkDeleting(true);
    try {
      const res = await fetch('/api/tenders/live-feed', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...staffHeaders() },
        credentials: 'include',
        body: JSON.stringify({ scope: 'unmapped' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || `Bulk delete failed (${res.status})`);
        return;
      }
      toast.success(`Deleted ${data?.deletedCount || 0} unmapped row(s).`);
      load({ silent: true });
    } catch {
      toast.error('Network error while deleting unmapped rows.');
    } finally {
      setBulkDeleting(false);
    }
  };

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
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={unmappedCount === 0 || bulkDeleting}
                  className="h-8 border-red-300 text-red-700 hover:bg-red-50"
                >
                  {bulkDeleting
                    ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Deleting…</>
                    : <><Trash2 className="w-3.5 h-3.5 mr-1.5" /> Delete Unmapped ({unmappedCount})</>}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {unmappedCount} unmapped row{unmappedCount === 1 ? '' : 's'}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    These are GeM bids that never matched any approved client&apos;s keyword profile.
                    This permanently removes them from <code>live_scraped_bids</code> and cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={deleteAllUnmapped}
                    className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                  >
                    Delete Permanently
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
        <div className="flex items-center gap-1.5 mt-3">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors ${
                filter === f.id
                  ? 'bg-teal-700 text-white border-teal-700'
                  : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {f.label}
              {f.id === 'unmapped' && unmappedCount > 0 ? ` (${unmappedCount})` : ''}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="premium-table min-w-[1080px] text-sm">
            <thead>
              <tr>
                <th className="w-[90px]">Status</th>
                <th className="w-[140px]">Match Keyword</th>
                <th className="w-[170px]">GeM Bid Number</th>
                <th>Work Title &amp; Department</th>
                <th className="w-[130px]">District</th>
                <th className="w-[110px]">Start Date</th>
                <th className="w-[110px]">Last Date</th>
                <th className="w-[60px]">Delete</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin inline-block mr-2 align-middle" />
                    Loading today&apos;s feed…
                  </td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                    <p className="font-semibold text-slate-700">
                      {rows.length === 0 ? 'No live scraped bids for today yet' : `No ${filter} rows to show`}
                    </p>
                    <p className="text-xs mt-1">Launch GeM Live Hunter from the Matchmaker tab — matches appear here as text rows.</p>
                  </td>
                </tr>
              ) : (
                visibleRows.map((row, idx) => {
                  const mapped = isMapped(row);
                  const rowId = String(row._id || row.bid_no || idx);
                  return (
                    <tr key={rowId}>
                      <td className="align-top">
                        <Badge
                          className={mapped
                            ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'}
                        >
                          {mapped ? 'Mapped' : 'Unmapped'}
                        </Badge>
                      </td>
                      <td className="align-top">
                        <span className="text-xs font-semibold text-teal-800 break-words">
                          {row.matched_keyword
                            || (Array.isArray(row.matched_keywords) ? row.matched_keywords.join(', ') : '—')
                            || '—'}
                        </span>
                      </td>
                      <td className="align-top font-mono text-xs text-[#0A2647] whitespace-nowrap">
                        {row.bid_no || '—'}
                      </td>
                      <td className="align-top">
                        <div className="font-semibold text-slate-800 text-xs leading-snug">{row.title || '—'}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{row.department || '—'}</div>
                      </td>
                      <td className="align-top text-xs text-slate-700">
                        {row.district || '—'}
                      </td>
                      <td className="align-top text-xs tabular-nums text-slate-700 whitespace-nowrap">
                        {row.start_date || '—'}
                      </td>
                      <td className="align-top text-xs tabular-nums text-slate-700 whitespace-nowrap">
                        {row.last_date || '—'}
                      </td>
                      <td className="align-top">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => deleteOne(row)}
                          disabled={deletingId === String(row._id || '')}
                          className="h-7 w-7 p-0 text-slate-400 hover:text-red-600 hover:bg-red-50"
                          title="Delete this row"
                        >
                          {deletingId === String(row._id || '')
                            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            : <Trash2 className="w-3.5 h-3.5" />}
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

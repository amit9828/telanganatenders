'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { BarChart3, Loader2, UploadCloud } from 'lucide-react';
import { formatINR } from '@/lib/format';

function staffHeaders() {
  const headers = {};
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('tt_admin');
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

/**
 * L1 Benchmark Repository — upload past award PDFs/CSVs and review the stored baseline.
 */
export default function L1BenchmarkDropzone() {
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [records, setRecords] = useState([]);
  const [baseline, setBaseline] = useState(null);
  const [total, setTotal] = useState(0);

  const load = async () => {
    try {
      const res = await fetch('/api/tenders/historical?limit=25', { headers: staffHeaders() });
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setRecords(data.records || []);
        setBaseline(data.baseline || null);
        setTotal(data.total || 0);
      }
    } catch {
      /* listing is best-effort */
    }
  };

  useEffect(() => { load(); }, []);

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setUploading(true);
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    try {
      const res = await fetch('/api/tenders/historical', { method: 'POST', headers: staffHeaders(), body: form });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || 'Ingestion failed.');
        return;
      }
      const inserted = data.summary?.inserted ?? data.inserted ?? 0;
      const duplicates = data.summary?.duplicates ?? 0;
      toast.success(`${inserted} result(s) saved${duplicates ? `, ${duplicates} duplicate(s) skipped` : ''}.`);
      load();
    } catch {
      toast.error('Network error while uploading benchmarks.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="tender-shadow border-t-4 border-t-amber-500">
      <CardHeader className="bg-amber-50/40 border-b pb-4">
        <CardTitle className="text-[#0A2647] flex items-center gap-2 text-lg">
          <BarChart3 className="w-5 h-5 text-amber-600" /> L1 Benchmark Repository
        </CardTitle>
        <CardDescription>
          Upload past award letters, comparative statements or CSV exports. These baselines feed L1 price predictions.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-5 space-y-4">
        <label
          onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragActive(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragActive(false); }}
          onDrop={(e) => { e.preventDefault(); setDragActive(false); if (!uploading) uploadFiles(e.dataTransfer?.files); }}
          className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center text-center transition ${
            uploading ? 'bg-amber-100 cursor-wait' : dragActive ? 'border-amber-600 bg-amber-100' : 'border-amber-200 bg-amber-50/50 hover:bg-amber-50 cursor-pointer'
          }`}
        >
          <input
            type="file"
            multiple
            accept=".pdf,.csv,.tsv,.txt,image/png,image/jpeg"
            className="hidden"
            disabled={uploading}
            onChange={(e) => { uploadFiles(e.target.files); e.target.value = ''; }}
          />
          {uploading ? (
            <Loader2 className="w-8 h-8 text-amber-600 animate-spin mb-2" />
          ) : (
            <UploadCloud className="w-8 h-8 text-amber-500 mb-2" />
          )}
          <span className="text-sm font-bold text-amber-900">
            {uploading ? 'Extracting historical results…' : 'Drop past-result PDFs or CSV files'}
          </span>
          <span className="text-xs text-amber-700 mt-1">Excel must be re-saved as CSV. Images of result sheets are accepted.</span>
        </label>

        {baseline && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-slate-50 border rounded-lg p-2">
              <div className="text-lg font-extrabold text-[#0A2647]">{total}</div>
              <div className="text-[10px] uppercase text-slate-400 font-bold">Records</div>
            </div>
            <div className="bg-slate-50 border rounded-lg p-2">
              <div className="text-lg font-extrabold text-amber-700">{baseline.median_discount_pct != null ? `${baseline.median_discount_pct}%` : '—'}</div>
              <div className="text-[10px] uppercase text-slate-400 font-bold">Median discount</div>
            </div>
            <div className="bg-slate-50 border rounded-lg p-2">
              <div className="text-lg font-extrabold text-amber-700">{baseline.average_discount_pct != null ? `${baseline.average_discount_pct}%` : '—'}</div>
              <div className="text-[10px] uppercase text-slate-400 font-bold">Average discount</div>
            </div>
          </div>
        )}

        {records.length > 0 && (
          <div className="max-h-56 overflow-y-auto border rounded-lg divide-y text-sm">
            {records.slice(0, 12).map((r) => (
              <div key={r._id} className="px-3 py-2 flex justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 truncate">{r.tender_title}</p>
                  <p className="text-[11px] text-slate-500 truncate">{r.department || r.category} {r.winner_name ? `· ${r.winner_name}` : ''}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-emerald-700">{formatINR(r.l1_price)}</p>
                  <p className="text-[10px] text-slate-400">{r.discount_pct != null ? `${r.discount_pct}% below est.` : ''}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

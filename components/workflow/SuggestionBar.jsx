'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, FileText, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { staffHeaders, staffPdfHref } from '@/components/workflow/api';

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
}

function clientLabel(job) {
  return job.parked_client_name || job.parked_client_email || 'Unassigned client';
}

export default function SuggestionBar({ jobs = [], pdfEmail, onRefresh }) {
  const [busyId, setBusyId] = useState('');

  const groups = useMemo(() => {
    const map = new Map();
    for (const job of jobs) {
      if (!job?.parked_client_email) continue;
      const key = String(job.parked_client_email).toLowerCase();
      if (!map.has(key)) map.set(key, { label: clientLabel(job), email: key, jobs: [] });
      map.get(key).jobs.push(job);
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [jobs]);

  const openPdf = (job) => {
    const tenderId = job.tender_id;
    if (!tenderId) return toast.error('No tender PDF is attached to this card.');
    window.location.assign(staffPdfHref(tenderId, { email: pdfEmail, role: 'employee' }));
  };

  const attachSow = async (job, file) => {
    if (!file) {
      toast.error('Choose a SOW PDF.');
      return;
    }
    if (file.type && file.type !== 'application/pdf' && !String(file.name || '').toLowerCase().endsWith('.pdf')) {
      toast.error('SOW must be a PDF.');
      return;
    }
    setBusyId(job._id);
    try {
      const form = new FormData();
      form.append('client_email', job.parked_client_email);
      form.append('sow', file);
      const res = await fetch(`/api/workflow/jobs/${job._id}/suggest`, {
        method: 'POST',
        credentials: 'include',
        headers: staffHeaders(),
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      toast.success('SOW attached. Client will see Pending Approval.');
      onRefresh?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusyId('');
    }
  };

  return (
    <Card className="tender-shadow">
      <CardHeader>
        <CardTitle className="text-[#0A2647] text-lg">Suggestion Bar</CardTitle>
        <CardDescription>
          Parked tenders grouped by client. Attach a SOW with + to forward. The client is not notified until the SOW is uploaded.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {groups.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-10">No parked suggestions yet. Select a client on Live Tenders and click Suggest.</p>
        )}
        {groups.map((group) => (
          <div key={group.email} className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-black text-[#0A2647] uppercase tracking-wide">{group.label}</h3>
              <Badge variant="outline" className="text-[10px]">{group.jobs.length}</Badge>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
              {group.jobs.map((job) => {
                const inputId = `sow-${job._id}`;
                return (
                  <div
                    key={job._id}
                    className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm flex flex-col justify-between min-h-[148px] max-w-[220px]"
                  >
                    <div>
                      <p className="text-[10px] font-mono font-bold text-amber-800 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5 inline-block">
                        {job.bid_no || 'No tender no'}
                      </p>
                      <p className="mt-2 text-xs font-bold text-[#0A2647] line-clamp-2 leading-snug">
                        {job.title || 'Untitled tender'}
                      </p>
                      <p className="mt-2 text-[10px] text-red-600 font-bold flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {fmtDate(job.last_date)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 pt-2 border-t border-slate-100 mt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] flex-1"
                        onClick={() => openPdf(job)}
                      >
                        <FileText className="w-3 h-3 mr-1" /> PDF
                      </Button>
                      <input
                        id={inputId}
                        type="file"
                        accept=".pdf,application/pdf"
                        className="sr-only"
                        disabled={busyId === job._id}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          attachSow(job, file);
                        }}
                      />
                      <label
                        htmlFor={inputId}
                        title="Attach SOW"
                        className={`h-7 w-7 inline-flex items-center justify-center rounded-md bg-emerald-600 hover:bg-emerald-700 text-white shrink-0 cursor-pointer ${busyId === job._id ? 'opacity-50 pointer-events-none' : ''}`}
                      >
                        <Plus className="w-4 h-4" />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

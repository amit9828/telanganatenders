'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchWorkflowQueue } from '@/components/workflow/api';
import { belongsOnSuggestions } from '@/lib/job-board-state';
import { currentHandler, jobDeadline } from '@/lib/tender-deadline';

export default function GlobalSuggestionsBoard() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [parked, waiting] = await Promise.all([
        fetchWorkflowQueue('parked').catch(() => ({ jobs: [] })),
        fetchWorkflowQueue('suggestions').catch(() => ({ jobs: [] })),
      ]);
      const merged = [...(parked.jobs || []), ...(waiting.jobs || [])].filter(belongsOnSuggestions);
      const seen = new Set();
      setJobs(merged.filter((job) => {
        const id = String(job._id || job.id || '');
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      }));
    } catch (err) {
      toast.error(err.message || 'Could not load suggestions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card className="shadow-sm border-t-4 border-t-blue-600">
      <CardHeader className="bg-blue-50/50 border-b pb-4 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-[#0A2647] text-lg flex items-center gap-2">
            <Send className="w-5 h-5 text-blue-600" /> Global Suggestions
          </CardTitle>
          <CardDescription>Waiting for client approval only — parked LIVE tenders and AWAITING_CLIENT.</CardDescription>
        </div>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </CardHeader>
      <CardContent className="pt-4 max-h-[450px] overflow-y-auto pr-2">
        {loading ? (
          <div className="text-center py-12 text-slate-400">
            <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
            <p className="text-sm">Loading suggestions...</p>
          </div>
        ) : jobs.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <Send className="w-10 h-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No tenders waiting for client approval.</p>
          </div>
        ) : (
          <table className="premium-table text-sm text-left">
            <thead>
              <tr>
                <th>Client</th>
                <th>Bid</th>
                <th>Status</th>
                <th>Last date</th>
                <th>Current handler</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const deadline = jobDeadline(job);
                return (
                  <tr key={job._id || job.id} className={deadline?.urgent ? 'bg-red-50' : undefined}>
                    <td className="align-top">
                      <p className="font-semibold text-slate-800 text-xs">{job.parked_client_name || job.client_name || job.parked_client_email || job.client_email || '—'}</p>
                      <p className="text-[9px] text-slate-400 font-mono">{job.parked_client_email || job.client_email || ''}</p>
                    </td>
                    <td className="align-top">
                      <p className="font-semibold text-xs">{job.bid_no || 'PENDING'}</p>
                      <p className="text-[10px] text-slate-500 line-clamp-1">{job.title}</p>
                    </td>
                    <td className="align-top">
                      <Badge className="text-[10px] border bg-amber-100 text-amber-800 border-amber-200">
                        {job.status === 'AWAITING_CLIENT' ? 'AWAITING_CLIENT' : 'LIVE (parked)'}
                      </Badge>
                    </td>
                    <td className={`align-top text-xs whitespace-nowrap ${deadline?.urgent ? 'font-bold text-red-600' : 'text-slate-600'}`}>{deadline?.text || '—'}</td>
                    <td className="align-top text-xs font-semibold text-slate-700 whitespace-nowrap">{currentHandler(job)}</td>
                    <td className="align-top text-[10px] text-slate-500 whitespace-nowrap">{job.updated_at || job.created_at ? new Date(job.updated_at || job.created_at).toLocaleDateString() : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

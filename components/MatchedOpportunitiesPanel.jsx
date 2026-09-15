'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Clock, Handshake, Loader2, MapPin, RefreshCw, Rocket, Sparkles, Target } from 'lucide-react';
import { launchGemHunter } from '@/lib/gem-hunter-client';
import { staffHeaders } from '@/components/workflow/api';
import { formatINR } from '@/lib/format';

export default function MatchedOpportunitiesPanel() {
  const [matches, setMatches] = useState([]);
  const [summary, setSummary] = useState({ total: 0, new: 0, jv: 0 });
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [predictingId, setPredictingId] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/bid-matches', { credentials: 'include', headers: staffHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load matches');
      setMatches(data.matches || []);
      setSummary(data.summary || { total: 0, new: 0, jv: 0 });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    if (filter === 'all') return matches;
    return matches.filter((m) => m.match_type === filter);
  }, [matches, filter]);

  const launchHunter = async () => {
    setLaunching(true);
    try {
      const result = await launchGemHunter();
      if (!result.ok) {
        toast.error(result.error || 'Could not launch the hunter.');
        return;
      }
      toast.success(result.already_running ? 'Hunter already running.' : 'GeM Live Hunter started.');
    } finally {
      setLaunching(false);
    }
  };

  const refreshCron = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/cron/matchmaker', {
        method: 'POST',
        credentials: 'include',
        headers: staffHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Refresh failed (${res.status})`);
      const s = data.stats || {};
      toast.success(s.matches_found
        ? `${s.matches_found} match(es) found.`
        : (data.explanation || 'Scan complete — no new matches.'));
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRefreshing(false);
    }
  };

  const runL1 = async (match) => {
    const id = match._id || match.tender_id;
    setPredictingId(id);
    try {
      const res = await fetch('/api/ai/predict-l1', {
        method: 'POST',
        credentials: 'include',
        headers: staffHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ tender_id: match.tender_id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'L1 prediction failed');
      toast.success(data.prediction?.summary || 'L1 prediction ready.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPredictingId('');
    }
  };

  return (
    <Card className="tender-shadow border-t-4 border-t-indigo-600 w-full mb-6">
      <CardHeader className="bg-indigo-50/40 border-b pb-4">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg">
              <Target className="w-5 h-5 text-indigo-600" /> Matched Opportunities
            </CardTitle>
            <CardDescription className="mt-1">
              Live hunting feed: cron matches plus on-demand L1. Same module as MD.
            </CardDescription>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
            <Button onClick={launchHunter} disabled={launching} variant="outline" className="border-emerald-300 text-emerald-800">
              {launching ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Launching…</> : <><Rocket className="w-4 h-4 mr-2" /> Launch GeM Live Hunter</>}
            </Button>
            <Button onClick={refreshCron} disabled={refreshing} className="bg-indigo-700 hover:bg-indigo-800 text-white">
              {refreshing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Scanning…</> : <><RefreshCw className="w-4 h-4 mr-2" /> Refresh Cron Matches</>}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-5 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="bg-slate-50 border rounded-lg p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Live Matches</div>
            <div className="text-2xl font-extrabold text-[#0A2647]">{summary.total || matches.length}</div>
          </div>
          <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Awaiting Review</div>
            <div className="text-2xl font-extrabold text-indigo-700">{summary.new || 0}</div>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-500">JV Opportunities</div>
            <div className="text-2xl font-extrabold text-amber-700">{summary.jv || 0}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { id: 'all', label: `All (${matches.length})` },
            { id: 'DIRECT', label: `Direct (${matches.filter((m) => m.match_type === 'DIRECT').length})` },
            { id: 'JV', label: `Joint Venture (${matches.filter((m) => m.match_type === 'JV').length})` },
          ].map((opt) => (
            <Button
              key={opt.id}
              size="sm"
              variant={filter === opt.id ? 'default' : 'outline'}
              onClick={() => setFilter(opt.id)}
              className={`h-7 text-xs ${filter === opt.id ? 'bg-[#0A2647] hover:bg-[#0A2647]/90' : 'text-slate-600'}`}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        {loading ? (
          <p className="text-sm text-slate-400 text-center py-8">Loading matches…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">No matches yet. Launch the hunter, then refresh cron matches.</p>
        ) : (
          <div className="space-y-3">
            {visible.map((m) => {
              const id = m._id || m.tender_id;
              return (
                <div key={id} className="border rounded-lg p-3 bg-white">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-sm text-[#0A2647]">{m.client_company || m.client_email}</p>
                      <p className="text-xs font-semibold text-slate-800 mt-1">{m.tender_title || 'Untitled tender'}</p>
                      <p className="text-[11px] text-slate-500 mt-1 flex flex-wrap gap-2">
                        {m.tender_bid_no && <span className="font-mono">{m.tender_bid_no}</span>}
                        {m.tender_district && <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{m.tender_district}</span>}
                        {m.tender_last_date && <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{m.tender_last_date}</span>}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <span className="text-lg font-extrabold text-indigo-700">{m.confidence != null ? `${m.confidence}%` : '—'}</span>
                      <Badge variant="outline" className={m.match_type === 'JV' ? 'border-amber-300 text-amber-700 bg-amber-50 text-[10px]' : 'text-[10px]'}>
                        {m.match_type === 'JV' ? <><Handshake className="w-3 h-3 mr-1" />JV</> : 'DIRECT'}
                      </Badge>
                      <p className="text-xs font-bold text-emerald-700">{formatINR(m.estimated_value)}</p>
                      <Button size="sm" className="h-7 text-[10px] bg-indigo-700" disabled={predictingId === id} onClick={() => runL1(m)}>
                        {predictingId === id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Sparkles className="w-3 h-3 mr-1" /> L1</>}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

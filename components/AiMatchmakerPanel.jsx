'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Clock, FileText, Loader2, MapPin, MessageCircle, Radar, RefreshCw, Rocket, Sparkles, Target, Zap,
} from 'lucide-react';
import { staffPdfHref, staffHeaders } from '@/components/workflow/api';
import { formatINR } from '@/lib/format';

function countdownLabel(lastDate) {
  if (!lastDate) return { text: 'No closing date', tone: 'slate' };
  const end = new Date(`${String(lastDate).slice(0, 10)}T23:59:59`);
  if (Number.isNaN(end.getTime())) return { text: String(lastDate), tone: 'slate' };
  const ms = end.getTime() - Date.now();
  if (ms < 0) return { text: 'Expired', tone: 'red' };
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days === 0) return { text: `${hours}h left`, tone: 'red' };
  if (days <= 3) return { text: `${days}d ${hours}h left`, tone: 'amber' };
  return { text: `${days} days left`, tone: 'emerald' };
}

function toneClass(tone) {
  if (tone === 'red') return 'bg-red-50 text-red-700 border-red-200';
  if (tone === 'amber') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (tone === 'emerald') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

/**
 * Shared AI Matchmaker & Suggested Bids panel for Admin + Employee dashboards.
 * Matching never auto-sends WhatsApp — every client alert is a staff click.
 */
export default function AiMatchmakerPanel({ compact = false } = {}) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [matching, setMatching] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [stats, setStats] = useState(null);
  const [explanation, setExplanation] = useState(null);

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch('/api/ai/match-tenders', { headers: staffHeaders() });
      const data = await res.json().catch(() => null);
      if (res.ok) setMatches(data.matches || []);
    } catch {
      /* listing is best-effort on mount */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSaved(); }, [loadSaved]);

  const runMatching = async () => {
    setMatching(true);
    const toastId = toast.loading('Scoring open tenders against approved clients…');
    try {
      const res = await fetch('/api/ai/match-tenders', {
        method: 'POST',
        headers: staffHeaders({ 'Content-Type': 'application/json' }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || `Matching failed (${res.status})`, { id: toastId, duration: 9000 });
        return;
      }
      setMatches(data.matches || []);
      setStats(data.stats || null);
      setExplanation(data.explanation || null);
      const count = data.matches?.length || 0;
      if (count === 0) {
        toast.info(data.explanation || 'No matches this run.', { id: toastId, duration: 10000 });
      } else {
        toast.success(`${count} suggested bid(s) ready for review. WhatsApp is manual — click Send Alert on each card.`, {
          id: toastId,
          duration: 8000,
        });
      }
    } catch {
      toast.error('Network error while running AI matching.', { id: toastId });
    } finally {
      setMatching(false);
    }
  };

  const sendAlert = async (match) => {
    if (!match?.client?.phone) {
      toast.error('This client has no phone number on file.');
      return;
    }
    if (!match.client.whatsapp_verified) {
      toast.error('Mark the client WhatsApp number as verified before sending.');
      return;
    }

    const ok = window.confirm(
      `Send a WhatsApp alert to ${match.client.company_name || match.client.email} (${match.client.phone}) about ${match.tender.bid_no || 'this tender'}?`,
    );
    if (!ok) return;

    setSendingId(match.match_id);
    const toastId = toast.loading('Sending WhatsApp alert…');
    try {
      const res = await fetch('/api/whatsapp/send', {
        method: 'POST',
        headers: staffHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          match_id: match.match_id,
          client_email: match.client.email,
          tender: match.tender,
          match_score: match.match_score,
          suggested_quote: match.suggested_quote,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || `Send failed (${res.status})`, { id: toastId, duration: 9000 });
        return;
      }
      const stamp = data.alert_sent_at || new Date().toISOString();
      setMatches((prev) => prev.map((m) => (
        m.match_id === match.match_id ? { ...m, alert_sent_at: stamp, status: 'alerted' } : m
      )));
      toast.success(`Alert sent to ${match.client.company_name || 'client'}.`, { id: toastId });
    } catch {
      toast.error('Network error while sending WhatsApp.', { id: toastId });
    } finally {
      setSendingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="tender-shadow border-t-4 border-t-indigo-600">
        <CardHeader className="bg-indigo-50/40 border-b pb-4">
          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
            <div className="flex-1">
              <CardTitle className="flex items-center gap-2 text-[#0A2647] text-lg">
                <Target className="w-5 h-5 text-indigo-600" /> AI Matchmaker &amp; Suggested Bids
              </CardTitle>
              <CardDescription className="mt-1">
                Launch the local GeM hunter to ingest live TS/AP bids, then score them against approved client
                profiles. WhatsApp alerts are always manual — nothing is sent until you click Send Alert.
              </CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 shrink-0">
              <Button
                onClick={runMatching}
                disabled={matching}
                className="bg-indigo-700 hover:bg-indigo-800 text-white"
              >
                {matching
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Matching…</>
                  : <><Zap className="w-4 h-4 mr-2" /> Run AI Matching Now</>}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Suggested Bids</div>
              <div className="text-2xl font-extrabold text-[#0A2647] mt-0.5">{matches.length}</div>
            </div>
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">TS/AP Open</div>
              <div className="text-2xl font-extrabold text-indigo-700 mt-0.5">{stats?.tenders_in_ts_ap ?? '—'}</div>
            </div>
            <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">Alerts Sent</div>
              <div className="text-2xl font-extrabold text-emerald-700 mt-0.5">
                {matches.filter((m) => m.alert_sent_at).length}
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-amber-500">Clients Scored</div>
              <div className="text-2xl font-extrabold text-amber-700 mt-0.5">{stats?.approved_clients ?? '—'}</div>
            </div>
          </div>
          {explanation && (
            <p className="mt-3 text-sm text-slate-600 bg-slate-50 border rounded-lg px-3 py-2">{explanation}</p>
          )}
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-slate-500">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading saved matches…
        </div>
      ) : matches.length === 0 ? (
        <Card className="tender-shadow">
          <CardContent className="py-12 text-center">
            <Radar className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="font-bold text-slate-700">No suggested bids yet</p>
            <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
              Run the GeM Live Hunter to pull fresh tenders, then click Run AI Matching Now.
              Matches need a client service-category overlap to qualify.
            </p>
            <Button onClick={runMatching} disabled={matching} className="mt-4 bg-[#0A2647] hover:bg-[#144272]">
              <RefreshCw className="w-4 h-4 mr-2" /> Run AI Matching Now
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className={`grid gap-4 ${compact ? 'xl:grid-cols-1' : 'xl:grid-cols-2'}`}>
          {matches.map((m) => {
            const cd = countdownLabel(m.tender?.last_date);
            const sending = sendingId === m.match_id;
            return (
              <Card key={m.match_id} className="tender-shadow border border-slate-200 overflow-hidden">
                <CardHeader className="pb-3 border-b bg-white">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-black text-[#0A2647] text-base truncate">
                        {m.client.company_name}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">
                        {m.client.name ? `${m.client.name} · ` : ''}{m.client.email}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {m.client.service_category && (
                          <Badge variant="outline" className="text-[10px] max-w-[220px] truncate">
                            {m.client.service_category}
                          </Badge>
                        )}
                        <Badge className="bg-indigo-600 text-white text-[10px]">
                          {m.match_score}% Match
                        </Badge>
                        <Badge variant="outline" className={
                          m.match_type === 'JV'
                            ? 'border-amber-300 text-amber-700 bg-amber-50 text-[10px]'
                            : 'border-emerald-300 text-emerald-700 bg-emerald-50 text-[10px]'
                        }>
                          {m.match_type === 'JV' ? 'JV' : 'DIRECT'}
                        </Badge>
                        {m.alert_sent_at && (
                          <Badge className="bg-emerald-600 text-white text-[10px]">
                            Alert Sent {new Date(m.alert_sent_at).toLocaleString('en-IN', {
                              day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                            })}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-4 space-y-3">
                  <div>
                    <div className="font-semibold text-sm text-slate-800 leading-snug">{m.tender.title}</div>
                    <div className="text-[11px] text-slate-500 mt-1 space-y-0.5">
                      {m.tender.bid_no && <div className="font-mono">{m.tender.bid_no}</div>}
                      {m.tender.department && <div>{m.tender.department}</div>}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {m.tender.district && (
                          <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{m.tender.district}</span>
                        )}
                        {m.tender.category && <span>{m.tender.category}</span>}
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border ${toneClass(cd.tone)}`}>
                          <Clock className="w-3 h-3" /> {cd.text}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-indigo-50/70 border border-indigo-100 rounded-lg p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500 flex items-center gap-1 mb-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> AI Bidding Strategy
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase">Suggested Quote</div>
                        <div className="font-extrabold text-emerald-700">{formatINR(m.suggested_quote)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase">L1 Discount</div>
                        <div className="font-extrabold text-indigo-700">
                          {m.l1_discount_pct != null ? `${m.l1_discount_pct}%` : '—'}
                        </div>
                      </div>
                    </div>
                    {(m.strategy_notes || m.match_reasons || []).length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {(m.strategy_notes || m.match_reasons).slice(0, 3).map((note) => (
                          <li key={note} className="text-[11px] text-slate-600 leading-snug">• {note}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      disabled={!m.tender.id}
                      onClick={() => {
                        if (!m.tender.id) return;
                        window.location.assign(staffPdfHref(m.tender.id, { role: 'admin' }));
                      }}
                    >
                      <FileText className="w-4 h-4 mr-2" /> View PDF
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => sendAlert(m)}
                      disabled={sending || Boolean(m.alert_sent_at)}
                      className="flex-1 bg-[#25D366] hover:bg-[#1ebe57] text-white"
                    >
                      {sending
                        ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
                        : m.alert_sent_at
                          ? <>Alert Sent</>
                          : <><MessageCircle className="w-4 h-4 mr-2" /> Send Alert to Client</>}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

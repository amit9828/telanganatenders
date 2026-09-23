'use client';

import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Activity, Clock, Globe, Target, UserPlus, Users, Wallet } from 'lucide-react';
import { staffHeaders } from '@/components/workflow/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

function StatCard({ icon, label, value, accent }) {
  return (
    <Card className={`border-0 ring-1 premium-hover ${accent ? 'ring-emerald-500/40 bg-emerald-50/60' : 'ring-slate-200/80 bg-white'}`}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center gap-2 text-muted-foreground text-[11px] sm:text-xs font-bold uppercase tracking-wider mb-2">{icon} {label}</div>
        <div className={`text-2xl sm:text-3xl font-black ${accent ? 'text-emerald-700' : 'text-[#0A2647]'}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function statusClass(login) {
  if (login === 'Working') return 'text-emerald-700';
  if (login === 'Idle') return 'text-amber-700';
  return 'text-slate-500';
}

export default function MasterReports({
  active,
  onOpenTab,
  liveTenders = 0,
  clients = 0,
  pending = 0,
  balance = 0,
}) {
  const [range, setRange] = useState('monthly');
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!active) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/reports/master?range=${encodeURIComponent(range)}`, {
          credentials: 'include',
          headers: staffHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not load reports.');
        if (!cancelled) {
          setReport(data);
          setError('');
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load reports.');
      }
    };
    load();
    const interval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') load();
    }, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [active, range]);

  const workforce = report?.workforce || [];
  const funnel = report?.funnel || [];
  const submissions = report?.submissions || [];
  const chartConfig = { count: { label: 'Submitted', color: '#0A2647' } };
  const tabConfig = { minutes: { label: 'Minutes', color: '#0A2647' } };
  const tabRows = (selected?.tabs || [])
    .filter((row) => row.seconds > 0)
    .map((row) => ({ label: row.label, minutes: Math.round(row.seconds / 60) }));

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-white p-3 rounded-xl shadow-sm border border-slate-200">
        <h2 className="font-bold text-[#0A2647] flex items-center gap-2"><Activity className="w-5 h-5 text-blue-600" /> Consultancy Performance</h2>
        <div className="bg-slate-100 p-1 rounded-lg flex gap-1">
          {['daily', 'weekly', 'monthly'].map((value) => (
            <Button
              key={value}
              size="sm"
              variant={range === value ? 'default' : 'ghost'}
              onClick={() => setRange(value)}
              className={`h-7 text-xs capitalize ${range === value ? 'bg-[#0A2647] text-white' : ''}`}
            >
              {value}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <div onClick={() => onOpenTab?.('team-activity')} className="cursor-pointer transition hover:scale-[1.01]">
          <StatCard icon={<Users className="w-4 h-4 text-blue-500" />} label="Team Activity" value={report ? report.suggestions : '—'} accent />
        </div>
        <div onClick={() => onOpenTab?.('publisher')} className="cursor-pointer transition hover:scale-[1.01]">
          <StatCard icon={<Globe className="w-4 h-4 text-blue-500" />} label="Live Tenders" value={liveTenders} />
        </div>
        <div onClick={() => onOpenTab?.('clients')} className="cursor-pointer transition hover:scale-[1.01]">
          <StatCard icon={<Users className="w-4 h-4 text-purple-500" />} label="Total Clients" value={clients} />
        </div>
        <div onClick={() => onOpenTab?.('clients')} className="cursor-pointer transition hover:scale-[1.01]">
          <StatCard icon={<UserPlus className="w-4 h-4 text-orange-500" />} label="Pending Appr." value={pending} accent={pending > 0} />
        </div>
        <div onClick={() => onOpenTab?.('finance')} className="cursor-pointer transition hover:scale-[1.01]">
          <StatCard icon={<Wallet className="w-4 h-4 text-emerald-600" />} label="Net Balance" value={`₹${Number(balance || 0).toLocaleString()}`} />
        </div>
      </div>

      <Card className="border-0 ring-1 ring-slate-200/80">
        <CardHeader className="bg-slate-50/80 border-b border-slate-200/80 pb-3 rounded-t-xl">
          <CardTitle className="text-sm text-[#0A2647]">Bids submitted</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {submissions.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-6">No submission data for this range.</p>
          ) : (
            <ChartContainer config={chartConfig} className="h-[220px] w-full aspect-auto">
              <BarChart data={submissions} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={range === 'monthly' ? 1 : 0} />
                <YAxis allowDecimals={false} width={28} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={4} />
              </BarChart>
            </ChartContainer>
          )}
        </CardContent>
      </Card>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="border-0 ring-1 ring-slate-200/80">
          <CardHeader className="bg-slate-50/80 border-b border-slate-200/80 pb-3 rounded-t-xl">
            <CardTitle className="text-sm text-[#0A2647] flex items-center gap-2"><Clock className="w-4 h-4 text-slate-500" /> Workforce Efficiency & Logs</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-4 max-h-[360px] overflow-y-auto">
            {workforce.length === 0 ? <p className="text-center text-sm text-slate-400 py-6">{report ? 'No employees on the roster.' : 'Loading roster...'}</p> : (
              <table className="premium-table text-sm text-left">
                <thead>
                  <tr><th>Employee</th><th>Status</th><th>Efficiency</th><th>Revolts</th></tr>
                </thead>
                <tbody>
                  {workforce.map((emp) => (
                    <tr key={emp.id}>
                      <td>
                        <button type="button" onClick={() => setSelected(emp)} className="text-left">
                          <p className="font-bold text-[#0A2647] underline-offset-2 hover:underline">{emp.name}</p>
                          <p className="text-[9px] text-slate-400">{emp.id} • {emp.role}</p>
                        </button>
                      </td>
                      <td className={`font-semibold ${statusClass(emp.login)}`}>{emp.login}</td>
                      <td>
                        <div className="w-16 h-2 bg-slate-200 rounded-full overflow-hidden">
                          <div className={`h-full ${emp.efficiency >= 90 ? 'bg-emerald-500' : emp.efficiency > 0 ? 'bg-amber-500' : 'bg-slate-300'}`} style={{ width: `${emp.efficiency}%` }} />
                        </div>
                        <span className="font-bold text-xs">{emp.efficiency}%</span>
                      </td>
                      <td className="font-bold text-slate-700">{emp.revolts || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card className="border-0 ring-1 ring-slate-200/80">
          <CardHeader className="bg-slate-50/80 border-b border-slate-200/80 pb-3 rounded-t-xl">
            <CardTitle className="text-sm text-[#0A2647] flex items-center gap-2"><Target className="w-4 h-4 text-slate-500" /> Consultancy Funnel</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-4 max-h-[360px] overflow-y-auto">
            {funnel.length === 0 ? <p className="text-center text-sm text-slate-400 py-6">{report ? 'No verified clients yet.' : 'Loading funnel...'}</p> : (
              <table className="premium-table text-sm text-left">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Suggested</th>
                    <th>Accepted</th>
                    <th>Submitted</th>
                    <th className="text-emerald-600">Won</th>
                  </tr>
                </thead>
                <tbody>
                  {funnel.map((row) => (
                    <tr key={row.id}>
                      <td><p className="font-bold text-[#0A2647]">{row.name}</p><p className="text-[9px] text-slate-400">{row.id}</p></td>
                      <td className="font-bold text-slate-700">{row.suggested}</td>
                      <td className="font-bold text-slate-700">{row.accepted}</td>
                      <td className="font-bold text-slate-700">{row.submitted}</td>
                      <td className="font-black text-emerald-600">{row.won}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{selected?.name}</DialogTitle>
            <DialogDescription>{selected?.id} • {selected?.role}. Time on each tab in this range.</DialogDescription>
          </DialogHeader>
          {tabRows.length === 0 ? (
            <p className="text-sm text-slate-500">No time recorded in this range.</p>
          ) : (
            <ChartContainer config={tabConfig} className="h-[240px] w-full aspect-auto">
              <BarChart data={tabRows} margin={{ left: 0, right: 8, top: 8, bottom: 24 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={50} />
                <YAxis allowDecimals={false} width={28} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="minutes" fill="var(--color-minutes)" radius={4} />
              </BarChart>
            </ChartContainer>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

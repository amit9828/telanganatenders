'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Upload, Download, Eye, Trash2, CheckCircle2 } from 'lucide-react';
import { TRACKING_LABELS, TRACKING_ORDER, currentTrackingStage } from '@/lib/tracking-status';

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

function relativeUpdateLabel(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const start = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const days = Math.round((start(new Date()) - start(d)) / 86400000);
  if (days <= 0) return 'Updated: Today';
  if (days === 1) return 'Updated: 1 Day Ago';
  return `Updated: ${days} Days Ago`;
}

function activeIndexFor(job, stages) {
  const stage = currentTrackingStage(job);
  if (stage === TRACKING_LABELS.WON) return stages.length - 1;
  return stages.indexOf(stage);
}

export function TrackingProgressBar({ job, stages = TRACKING_ORDER, activeLabel }) {
  const stagesList = Array.isArray(stages) && stages.length ? stages : TRACKING_ORDER;
  const activeIndex = activeLabel ? stagesList.indexOf(activeLabel) : activeIndexFor(job, stagesList);
  if (activeIndex < 0) return null;
  const n = stagesList.length;
  const inset = 100 / (2 * n);
  const fillPct = activeIndex > 0 ? activeIndex * (100 / n) : 0;
  const gridClass = n === 6 ? 'grid-cols-6' : 'grid-cols-4';

  return (
    <div className="relative mt-1 px-1 pb-1">
      <div
        className="absolute top-3 h-1 bg-slate-200 rounded-full z-0"
        style={{ left: `${inset}%`, right: `${inset}%` }}
      />
      {fillPct > 0 && (
        <div
          className="absolute top-3 h-1 bg-blue-600 rounded-full z-0"
          style={{ left: `${inset}%`, width: `${fillPct}%` }}
        />
      )}
      <div className={`relative z-10 grid ${gridClass}`}>
        {stagesList.map((label, index) => {
          const complete = activeIndex >= 0 && index < activeIndex;
          const active = index === activeIndex;
          const circle = complete
            ? 'bg-blue-600 text-white'
            : active
              ? 'bg-amber-500 text-white'
              : 'bg-slate-100 text-slate-300';
          return (
            <div key={label} className="flex flex-col items-center gap-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shadow ring-4 ring-white ${circle}`}>
                {complete || active ? <CheckCircle2 className="w-3 h-3" /> : <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />}
              </div>
              <span className="text-[8px] font-bold text-slate-600 text-center leading-tight px-0.5">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CompactTenderCard({ job, actions = [], progress = null, showClientName = false, showWinBadge = false }) {
  const clientName = job.client_name || job.company_name || '';
  const updatedLabel = relativeUpdateLabel(job.updated_at || job.archived_at);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm flex flex-col gap-2 min-h-[132px]">
      {updatedLabel ? (
        <p className="text-[10px] font-semibold text-slate-500">{updatedLabel}</p>
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {showClientName && clientName ? (
            <p className="text-[11px] font-semibold text-slate-700 truncate">{clientName}</p>
          ) : null}
          <p className="text-[10px] font-mono font-bold text-slate-500 tracking-wide">{job.bid_no || 'No bid no'}</p>
          <h4 className="text-sm font-bold text-[#0A2647] leading-tight line-clamp-2">{job.title || 'Untitled tender'}</h4>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {showWinBadge || job.status === 'WON' ? (
            <Badge className="bg-emerald-100 text-emerald-800 border-0 text-[10px]">Win</Badge>
          ) : (
            <Badge className="bg-slate-100 text-slate-800 border-0 text-[10px]">{job.display_status || job.status}</Badge>
          )}
        </div>
      </div>
      <p className="text-[11px] text-slate-500">Tender date: {fmtDate(job.tender_date || job.last_date)}</p>
      {progress}
      {actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-100">
          {actions.map((a) => (
            <Button key={a.label} size="sm" variant={a.variant || 'outline'} className="h-7 text-[10px]" onClick={a.onClick} disabled={a.disabled}>
              {a.icon === 'upload' ? <Upload className="w-3 h-3 mr-1" /> : a.icon === 'download' ? <Download className="w-3 h-3 mr-1" /> : a.icon === 'eye' ? <Eye className="w-3 h-3 mr-1" /> : a.icon === 'trash' ? <Trash2 className="w-3 h-3 mr-1" /> : <FileText className="w-3 h-3 mr-1" />}
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

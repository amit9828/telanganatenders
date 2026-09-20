'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Upload, Download, Eye, Trash2, CheckCircle2, Clock, Trophy } from 'lucide-react';
import { INTERNAL_BOARD_STATUSES } from '@/lib/job-board-state';

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

export function TrackingProgressBar({ job }) {
  const status = String(job?.status || '');
  const display = String(job?.display_status || job?.tracking_status || '');
  const lower = display.toLowerCase();
  let stage = 'prep';
  if (status === 'WON' || lower === 'won') stage = 'won';
  else if (lower === 'lost' || lower === 'loss') stage = 'lost';
  else if (
    status === 'SUBMITTED'
    || lower.includes('submitted')
    || lower.includes('technical')
    || lower.includes('financial')
    || lower.includes('evaluat')
  ) stage = 'evaluating';
  else if (INTERNAL_BOARD_STATUSES.includes(status) || lower === 'in progress') stage = 'prep';

  const barW = stage === 'prep' ? 'w-[30%]' : stage === 'evaluating' ? 'w-[70%]' : 'w-[100%]';
  const s1 = 'bg-blue-500 text-white';
  const s2 = stage === 'prep' ? 'bg-amber-500 text-white animate-pulse' : 'bg-blue-500 text-white';
  const s3 = stage === 'prep'
    ? 'bg-slate-100 text-slate-300'
    : (stage === 'evaluating' ? 'bg-amber-500 text-white animate-pulse' : 'bg-blue-500 text-white');
  const s4 = stage === 'won'
    ? 'bg-emerald-500 text-white'
    : stage === 'lost' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-300';
  const s2Icon = stage === 'prep' ? <Clock className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />;
  const s3Icon = stage === 'prep' || stage === 'evaluating'
    ? <Clock className="w-3.5 h-3.5" />
    : <CheckCircle2 className="w-3.5 h-3.5" />;

  return (
    <div className="relative mt-1 px-1 sm:px-2 pb-1">
      <div className="absolute top-3 left-6 right-6 h-1.5 bg-slate-100 rounded-full z-0" />
      <div className={`absolute top-3 left-6 h-1.5 bg-blue-500 rounded-full z-0 transition-all duration-1000 ${barW}`} />
      <div className="relative z-10 flex justify-between">
        <div className="flex flex-col items-center gap-1">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center shadow ring-4 ring-white ${s1}`}>
            <CheckCircle2 className="w-3.5 h-3.5" />
          </div>
          <span className="text-[9px] font-bold text-slate-600 uppercase">Doc Prep</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center shadow ring-4 ring-white ${s2}`}>{s2Icon}</div>
          <span className="text-[9px] font-bold text-slate-600 uppercase">Submitted</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center shadow ring-4 ring-white ${s3}`}>{s3Icon}</div>
          <span className="text-[9px] font-bold text-slate-600 uppercase">Evaluating</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <div className={`w-7 h-7 rounded-full flex items-center justify-center shadow ring-4 ring-white ${s4}`}>
            <Trophy className="w-3.5 h-3.5" />
          </div>
          <span className="text-[9px] font-bold text-slate-600 uppercase">Result</span>
        </div>
      </div>
    </div>
  );
}

export default function CompactTenderCard({ job, actions = [], progress = null }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm flex flex-col gap-2 min-h-[132px]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-mono font-bold text-slate-500 tracking-wide">{job.bid_no || 'No bid no'}</p>
          <h4 className="text-sm font-bold text-[#0A2647] leading-tight line-clamp-2">{job.title || 'Untitled tender'}</h4>
        </div>
        <Badge className="shrink-0 bg-slate-100 text-slate-800 border-0 text-[10px]">{job.display_status || job.status}</Badge>
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

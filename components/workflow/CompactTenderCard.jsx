'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Upload, Download, Eye, Trash2 } from 'lucide-react';

function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

export default function CompactTenderCard({ job, actions = [] }) {
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

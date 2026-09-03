'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertTriangle, Check, ClipboardCheck, Loader2, Paperclip, RefreshCw, ScanSearch,
} from 'lucide-react';
import { SLOT_LABELS } from '@/lib/doc-session';

const CONFIDENCE_STYLES = {
  high: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  medium: 'bg-amber-100 text-amber-800 border-amber-200',
  low: 'bg-slate-100 text-slate-700 border-slate-200',
};

/**
 * The gathering-phase canvas.
 *
 * Two jobs: show what the interview still needs, and — once a tender is known — show what
 * the bid document itself demands. The requirement checklist lives here rather than in the
 * chat so the AI opens the conversation already knowing what the bid asks for, and the
 * officer can see the source of that list while typing.
 */
export default function EmptyCanvas({ session, requirements, analysing, analysisError, onReanalyse }) {
  const missing = session?.missing || [];
  const validated = session?.validated || {};
  const undertakings = (requirements?.items || []).filter((i) => i.kind === 'undertaking');
  const supporting = (requirements?.items || []).filter((i) => i.kind === 'document');

  return (
    <div className="h-full overflow-y-auto p-5 space-y-5">
      <div>
        <h3 className="text-sm font-bold text-[#0A2647] uppercase tracking-wider">Before I can draft</h3>
        <ul className="mt-2 space-y-1.5">
          {['doc_type', 'client_email', 'letterhead_id', 'tender_id'].map((slot) => {
            const state = validated[slot];
            const ok = Boolean(state?.ok);
            const optional = slot === 'tender_id';
            return (
              <li key={slot} className="flex items-start gap-2 text-sm">
                <span
                  className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${
                    ok ? 'bg-emerald-100' : 'bg-slate-100'
                  }`}
                >
                  {ok ? <Check className="w-2.5 h-2.5 text-emerald-700" /> : <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />}
                </span>
                <span className={ok ? 'text-slate-700' : 'text-slate-500'}>
                  <span className="font-semibold">{SLOT_LABELS[slot]}</span>
                  {optional && !ok && <span className="text-slate-400"> (optional)</span>}
                  {ok
                    ? <span className="text-slate-600"> — {state.label}</span>
                    : state?.reason && missing.includes(slot)
                      ? <span className="text-amber-700"> — {state.reason}</span>
                      : null}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {validated.tender_id?.ok && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-indigo-100/60 border-b border-indigo-200">
            <div className="flex items-center gap-2 min-w-0">
              <ClipboardCheck className="w-4 h-4 text-indigo-700 shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider">What this tender requires</p>
                <p className="text-[10px] text-indigo-700 truncate">Read from the bid document, not the tender form.</p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={analysing}
              onClick={onReanalyse}
              className="shrink-0 h-7 text-[10px] bg-white border-indigo-300 text-indigo-800 hover:bg-indigo-100"
            >
              {analysing
                ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Reading…</>
                : <><RefreshCw className="w-3 h-3 mr-1" /> Re-read</>}
            </Button>
          </div>

          <div className="p-4 space-y-3">
            {analysing && !requirements && (
              <p className="flex items-center gap-2 text-sm text-indigo-800">
                <ScanSearch className="w-4 h-4 animate-pulse" />
                Reading the full bid document and its ATC clauses. Up to a minute the first time.
              </p>
            )}

            {analysisError && !analysing && (
              <p className="flex items-start gap-2 text-[13px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{analysisError}</span>
              </p>
            )}

            {requirements?.summary && (
              <p className="text-[13px] text-slate-700 leading-relaxed">{requirements.summary}</p>
            )}

            <div className="flex flex-wrap gap-1.5 text-[10px]">
              {requirements?.bid_end_date && <Badge variant="outline" className="bg-white">Closes: {requirements.bid_end_date}</Badge>}
              {requirements?.emd_amount && (
                <Badge variant="outline" className="bg-white">
                  EMD: ₹{Number(requirements.emd_amount).toLocaleString('en-IN')}
                </Badge>
              )}
              {requirements?.mse_exemption_allowed && (
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">MSE exemption allowed</Badge>
              )}
            </div>

            {undertakings.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                  Undertakings to submit ({undertakings.length})
                </p>
                <ul className="space-y-1.5">
                  {undertakings.map((item, i) => (
                    <li key={`${item.title}-${i}`} className="rounded-lg border border-slate-200 bg-white p-2.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] font-semibold text-slate-800">{item.title}</span>
                        {item.mandatory
                          ? <Badge className="bg-red-100 text-red-800 border-red-200 text-[9px] px-1.5 py-0">Mandatory</Badge>
                          : <Badge variant="outline" className="text-[9px] px-1.5 py-0">Optional</Badge>}
                        <Badge className={`${CONFIDENCE_STYLES[item.confidence]} text-[9px] px-1.5 py-0 border`}>
                          {item.confidence}
                        </Badge>
                        {item.doc_type && (
                          <Badge className="bg-indigo-100 text-indigo-800 border-indigo-200 text-[9px] px-1.5 py-0">
                            Ask for: {item.doc_type.label}
                          </Badge>
                        )}
                      </span>
                      {item.why && <span className="block text-[11px] text-slate-600 mt-0.5">{item.why}</span>}
                      {item.clause && <span className="block text-[10px] font-mono text-slate-400 mt-0.5">Ref: {item.clause}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {supporting.length > 0 && (
              <div>
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                  <Paperclip className="w-3 h-3" /> Documents to attach ({supporting.length})
                </p>
                <ul className="space-y-1">
                  {supporting.map((item, i) => (
                    <li key={`${item.title}-${i}`} className="text-[12px] text-slate-700 flex items-start gap-2">
                      <span className="text-slate-400 mt-0.5">•</span>
                      <span>
                        <strong className="font-semibold">{item.title}</strong>
                        {item.mandatory ? '' : ' (optional)'}
                        {item.why ? ` — ${item.why}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {requirements?.watch_outs?.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                <p className="text-[10px] font-bold text-amber-900 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3" /> Watch out
                </p>
                <ul className="space-y-1">
                  {requirements.watch_outs.map((line, i) => (
                    <li key={i} className="text-[12px] text-amber-900 flex items-start gap-2">
                      <span className="mt-0.5">•</span><span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

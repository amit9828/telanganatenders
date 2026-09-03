'use client';

import { Button } from '@/components/ui/button';
import { AlertTriangle, FileCheck2, Loader2 } from 'lucide-react';

/**
 * The confirmation gate.
 *
 * Everything the draft will use is on screen — the sections, the real facts, and every
 * blank it cannot fill — so approval is informed rather than reflexive. The Generate
 * button carries the outline hash, and the server refuses any confirmation whose hash no
 * longer matches what is displayed here.
 */
export default function OutlinePreview({ session, busy, onConfirm }) {
  const outline = session?.outline;
  if (!outline) return null;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5">
        <div>
          <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Ready to draft</p>
          <h3 className="text-lg font-bold text-[#0A2647] mt-0.5">{outline.title}</h3>
        </div>

        {outline.sections?.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2">
              Sections ({outline.sections.length})
            </p>
            <ol className="space-y-2">
              {outline.sections.map((section, i) => (
                <li key={`${section.heading}-${i}`} className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="text-[13px] font-semibold text-slate-800">
                    <span className="text-slate-400 mr-1.5">{i + 1}.</span>{section.heading}
                  </p>
                  {section.content && <p className="text-[12px] text-slate-600 mt-0.5">{section.content}</p>}
                </li>
              ))}
            </ol>
          </div>
        )}

        {outline.facts_used?.length > 0 && (
          <div>
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-wider mb-2">Facts it will use</p>
            <dl className="rounded-lg border border-slate-200 bg-white divide-y divide-slate-100">
              {outline.facts_used.map((fact, i) => (
                <div key={`${fact.label}-${i}`} className="flex gap-3 px-3 py-1.5">
                  <dt className="text-[11px] font-semibold text-slate-500 w-40 shrink-0">{fact.label}</dt>
                  <dd className="text-[12px] text-slate-800 break-words">{fact.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {outline.placeholders?.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-[10px] font-bold text-amber-900 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3" /> Left blank for you to fill ({outline.placeholders.length})
            </p>
            <ul className="space-y-1">
              {outline.placeholders.map((item, i) => (
                <li key={i} className="text-[12px] text-amber-900 flex items-start gap-2">
                  <span className="mt-0.5">•</span><span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="border-t bg-white p-4 flex items-center gap-3">
        <Button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="bg-emerald-700 hover:bg-emerald-800"
        >
          {busy
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Drafting…</>
            : <><FileCheck2 className="w-4 h-4 mr-2" /> Generate this document</>}
        </Button>
        <p className="text-[11px] text-slate-500">
          Or tell me what to change in the chat and I will revise the outline.
        </p>
      </div>
    </div>
  );
}

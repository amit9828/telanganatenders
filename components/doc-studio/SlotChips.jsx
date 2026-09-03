'use client';

import { Check, CircleDashed, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const ORDER = [
  ['doc_type', 'Document'],
  ['client_email', 'Client'],
  ['tender_id', 'Tender'],
  ['letterhead_id', 'Letterhead'],
];

/**
 * Live strip showing which slots the SERVER has verified.
 *
 * Deliberately driven by the validation result rather than by what the model claimed, so
 * a chip turning green means a real record was found — not that the AI said so.
 */
export default function SlotChips({ validated = {} }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ORDER.map(([key, label]) => {
        const state = validated[key];
        const ok = Boolean(state?.ok);
        const optional = Boolean(state?.optional);
        const Icon = ok ? Check : optional ? CircleDashed : X;

        return (
          <span
            key={key}
            title={ok ? state.label : state?.reason || `${label} not set`}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold max-w-[190px]',
              ok
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : optional
                  ? 'border-slate-200 bg-slate-50 text-slate-500'
                  : 'border-amber-200 bg-amber-50 text-amber-800',
            )}
          >
            <Icon className="w-3 h-3 shrink-0" />
            <span className="shrink-0">{label}</span>
            {ok && <span className="truncate font-normal opacity-80">{state.label}</span>}
          </span>
        );
      })}
    </div>
  );
}

'use client';

import { Bot, Info } from 'lucide-react';

export default function ChatMessage({ role, text }) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] bg-[#0A2647] text-white rounded-2xl rounded-br-md px-3.5 py-2 text-sm leading-relaxed">
          {text}
        </div>
      </div>
    );
  }

  // A system line is the server correcting the record mid-interview — a client that was
  // deleted, an outline that no longer matches. It reads as neither party's speech.
  if (role === 'system') {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>{text}</span>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
        <Bot className="w-3.5 h-3.5 text-emerald-700" />
      </div>
      <div className="max-w-[85%] bg-white border border-slate-200 rounded-2xl rounded-bl-md px-3.5 py-2 text-sm leading-relaxed text-slate-700 shadow-sm">
        {text}
      </div>
    </div>
  );
}

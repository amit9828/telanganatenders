'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, RotateCcw, Send, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LANGUAGE_OPTIONS } from '@/lib/language';
import ChatMessage from './ChatMessage';
import QuickReplies from './QuickReplies';
import SlotChips from './SlotChips';

export default function DocStudioChat({ session, busy, optimistic, error, language, onLanguage, onSend, onReset }) {
  const [input, setInput] = useState('');
  const threadRef = useRef(null);

  const messages = session?.messages || [];
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const quickReplies = busy ? [] : (lastAssistant?.quick_replies || []);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages.length, busy, optimistic]);

  const submit = (text) => {
    const value = String(text ?? input).trim();
    if (!value || busy) return;
    setInput('');
    onSend(value);
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-slate-50">
      <header className="px-4 py-3 border-b bg-[#0A2647] text-white">
        <div className="flex items-center justify-between gap-3">
          <p className="font-bold text-sm flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-300" /> Document Studio
          </p>
          <div className="flex items-center gap-1">
            <div className="flex rounded-md bg-white/10 p-0.5" role="group" aria-label="Answer language">
              {LANGUAGE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  title={option.hint}
                  onClick={() => {
                    onLanguage?.(option.id);
                    try { localStorage.setItem('tt_copilot_language', option.id); } catch { /* private mode */ }
                  }}
                  className={cn(
                    'px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide transition-colors',
                    language === option.id ? 'bg-white text-[#0A2647]' : 'text-white/70 hover:text-white',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onReset}
              disabled={busy}
              title="Start a new document"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/10
                         text-[10px] font-bold uppercase tracking-wider disabled:opacity-50"
            >
              <RotateCcw className="w-3 h-3" /> New
            </button>
          </div>
        </div>
        <p className="text-[11px] text-white/70 mt-0.5">
          Tell me what you need. I will check every detail against your records before drafting.
        </p>
      </header>

      <div className="px-4 py-2 border-b bg-white">
        <SlotChips validated={session?.validated} />
      </div>

      <div ref={threadRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map((msg, i) => (
          <ChatMessage key={`${msg.role}-${i}`} role={msg.role} text={msg.text} />
        ))}

        {optimistic && <ChatMessage role="user" text={optimistic} />}

        {!busy && quickReplies.length > 0 && (
          <QuickReplies options={quickReplies} disabled={busy} onPick={submit} />
        )}

        {busy && (
          <div className="flex items-center gap-2 text-sm text-slate-500 pl-8">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-600" /> Checking your records…
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
            {error}
          </div>
        )}
      </div>

      <footer className="border-t bg-white p-3">
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="e.g. Bid undertaking for CLI-0042 on GEM/2026/B/7938430"
            className="resize-none min-h-[40px] text-sm"
          />
          <Button type="submit" disabled={busy || !input.trim()} className="h-10 bg-emerald-700 hover:bg-emerald-800 shrink-0">
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </footer>
    </div>
  );
}

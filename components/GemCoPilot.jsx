'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Bot, Send, X, Minus, Loader2, Sparkles, FileText, AlertCircle, BookOpen,
} from 'lucide-react';

const SUGGESTED_PROMPTS = [
  'What is the vendor assessment fee?',
  'Who is exempt from paying EMD?',
  'What counts as a Class-I local supplier?',
  'When must payment be released after CRAC?',
];

const TENDER_PROMPTS = [
  'Summarise the eligibility criteria for this tender.',
  'What documents must we submit with this bid?',
  'What is the EMD and how do we claim exemption?',
  'List the key dates and deadlines.',
];

/**
 * Floating GeM AI Co-Pilot.
 *
 * Deliberately not a Sheet: Radix's Sheet renders a modal overlay that blocks the page
 * behind it, and the whole point of a co-pilot is asking questions *while* reading a
 * tender. This is a non-blocking fixed panel instead.
 *
 * @param {string|null} tenderId    When set, questions are answered strictly against this
 *                                  tender instead of the general GeM knowledge base.
 * @param {string|null} tenderLabel Human-readable name shown on the context chip.
 */
export default function GemCoPilot({ tenderId = null, tenderLabel = null }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  // Server-side transcript id, so a follow-up question keeps the earlier context.
  const [conversationId, setConversationId] = useState(null);

  const threadRef = useRef(null);
  const inputRef = useRef(null);

  const contextActive = Boolean(tenderId);

  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, sending, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Let Escape close the panel, matching every other overlay in the app.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const sendMessage = async (rawText) => {
    const question = String(rawText ?? input).trim();
    if (!question || sending) return;

    // Capture the context at send time so a later navigation can't retag this answer.
    const askedWithTender = tenderId;
    setMessages(prev => [...prev, { role: 'user', text: question, tenderId: askedWithTender }]);
    setInput('');
    setSending(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: question,
          tender_id: askedWithTender || undefined,
          conversation_id: conversationId || undefined,
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setMessages(prev => [...prev, {
          role: 'error',
          text: data?.error || `The Co-Pilot could not answer (${res.status}).`,
        }]);
        return;
      }

      if (data?.conversation_id) setConversationId(data.conversation_id);
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: data?.answer || 'No answer was returned.',
        sources: data?.sources || [],
        mode: data?.mode,
      }]);
    } catch (err) {
      console.error('Co-Pilot error:', err);
      setMessages(prev => [...prev, {
        role: 'error',
        text: 'Network error — the Co-Pilot could not be reached. Please try again.',
      }]);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const prompts = contextActive ? TENDER_PROMPTS : SUGGESTED_PROMPTS;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open GeM AI Co-Pilot"
        className="fixed bottom-6 right-6 z-40 group flex items-center gap-2 rounded-full bg-[#0A2647] pl-4 pr-5 py-3.5 text-white shadow-xl shadow-slate-900/25 ring-1 ring-white/10 transition hover:bg-[#0d3159] hover:shadow-2xl active:scale-95"
      >
        <span className="relative flex items-center justify-center">
          <Bot className="w-5 h-5" />
          <span className="absolute -top-1.5 -right-1.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-[#0A2647]" />
        </span>
        <span className="text-sm font-bold hidden sm:inline">GeM Co-Pilot</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-0 right-0 sm:bottom-6 sm:right-6 z-40 w-full sm:w-[420px] h-[100dvh] sm:h-[640px] sm:max-h-[calc(100vh-3rem)] flex flex-col overflow-hidden bg-white sm:rounded-2xl shadow-2xl shadow-slate-900/25 ring-1 ring-slate-900/10 animate-in slide-in-from-bottom-4 fade-in duration-200">

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[#0A2647] text-white shrink-0">
        <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-blue-200" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-tight">GeM AI Co-Pilot</p>
          <p className="text-[11px] text-blue-200/80 leading-tight">Senior GeM bidding expert</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Minimise Co-Pilot"
          className="p-1.5 rounded-md hover:bg-white/10 transition"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setMessages([]); setConversationId(null); }}
          aria-label="Close and clear conversation"
          className="p-1.5 rounded-md hover:bg-white/10 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Context chip */}
      <div className={cn(
        'flex items-center gap-2 px-4 py-2 text-[11px] border-b shrink-0',
        contextActive ? 'bg-blue-50 border-blue-100 text-blue-800' : 'bg-slate-50 border-slate-100 text-slate-600'
      )}>
        {contextActive ? <FileText className="w-3.5 h-3.5 shrink-0" /> : <BookOpen className="w-3.5 h-3.5 shrink-0" />}
        <span className="truncate">
          {contextActive
            ? <>Answering about: <span className="font-bold">{tenderLabel || 'the selected tender'}</span></>
            : 'Answering from the GeM rules knowledge base'}
        </span>
      </div>

      {/* Thread */}
      <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-slate-50/60">
        {messages.length === 0 && (
          <div className="pt-2">
            <div className="w-11 h-11 rounded-xl bg-[#0A2647] flex items-center justify-center mb-3">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <p className="text-sm font-bold text-[#0A2647]">How can I help with this bid?</p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              {contextActive
                ? 'I will answer strictly from this tender document — no guesswork.'
                : 'I answer strictly from synced GeM rules and circulars — no guesswork.'}
            </p>
            <div className="mt-4 space-y-2">
              {prompts.map(prompt => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => sendMessage(prompt)}
                  className="w-full text-left text-xs bg-white border border-slate-200 rounded-lg px-3 py-2.5 text-slate-700 hover:border-[#0A2647] hover:text-[#0A2647] hover:shadow-sm transition"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.role === 'user') {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] bg-[#0A2647] text-white rounded-2xl rounded-br-sm px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap shadow-sm">
                  {msg.text}
                </div>
              </div>
            );
          }

          if (msg.role === 'error') {
            return (
              <div key={i} className="flex gap-2 items-start bg-red-50 border border-red-100 rounded-xl px-3.5 py-2.5">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700 leading-relaxed">{msg.text}</p>
              </div>
            );
          }

          return (
            <div key={i} className="flex gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-[#0A2647] flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm text-slate-800 leading-relaxed whitespace-pre-wrap shadow-sm">
                  {msg.text}
                </div>
                {msg.sources?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 self-center">Sources</span>
                    {msg.sources.map((source, si) => (
                      <Badge
                        key={si}
                        variant="outline"
                        className="text-[10px] font-normal bg-white border-slate-200 text-slate-600 max-w-full truncate"
                        title={source.title}
                      >
                        {source.title}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {sending && (
          <div className="flex gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#0A2647] flex items-center justify-center shrink-0">
              <Bot className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" />
            </div>
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-slate-200 bg-white px-3 py-3 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={contextActive ? 'Ask about this tender...' : 'Ask about GeM rules...'}
            disabled={sending}
            className="flex-1 resize-none max-h-28 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 outline-none transition focus:border-[#0A2647] focus:bg-white focus:ring-1 focus:ring-[#0A2647] disabled:opacity-60"
          />
          <Button
            type="button"
            onClick={() => sendMessage()}
            disabled={sending || !input.trim()}
            className="h-11 w-11 p-0 shrink-0 rounded-xl bg-[#0A2647] hover:bg-[#0d3159] disabled:opacity-40"
            aria-label="Send message"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-[10px] text-slate-400 mt-2 px-1">
          AI can make mistakes. Verify against the official bid document before acting.
        </p>
      </div>
    </div>
  );
}

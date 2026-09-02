'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { classifyWorkspacePrompt, INTENT, resolveClient } from '@/lib/workspace-intent';
import { markdownToPlainText, markdownToSafeHtml } from '@/lib/markdown-lite';
import { launchGemHunter } from '@/lib/gem-hunter-client';
import {
  Bot, Copy, FileText, Loader2, Mic, MicOff, Printer, Send, Sparkles, Volume2, VolumeX, X,
} from 'lucide-react';

function staffHeaders(extra = {}) {
  const headers = { ...extra };
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('tt_admin');
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function printDocumentHtml(html) {
  if (typeof document === 'undefined') return;
  let host = document.getElementById('a4-print-sheet');
  if (!host) {
    host = document.createElement('div');
    host.id = 'a4-print-sheet';
    host.className = 'workspace-print-host';
    document.body.appendChild(host);
  }
  host.className = 'workspace-print-host';
  host.innerHTML = html;
  document.body.classList.add('printing-document');

  const cleanup = () => {
    document.body.classList.remove('printing-document');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  setTimeout(cleanup, 1500);
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch { /* clipboard may be blocked */ }
      }}
      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-indigo-600"
    >
      <Copy className="w-3 h-3" /> {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function SpeakButton({ text, speakingId, id, onToggle }) {
  const active = speakingId === id;
  return (
    <button
      type="button"
      onClick={() => onToggle(id, text)}
      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-indigo-600"
    >
      {active ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
      {active ? '⏹️ Stop' : '🔊 Listen'}
    </button>
  );
}

/**
 * Wide Gemini-style workspace for staff dashboards only.
 *
 * @param {string|null} tenderId
 * @param {string|null} tenderLabel
 * @param {object[]} clients  Approved clients, used to resolve CLI-xxxx / emails in prompts.
 * @param {object[]} tenders  Live tenders, used to resolve GEM bid numbers.
 */
export default function GeminiWorkspace({
  tenderId = null,
  tenderLabel = null,
  clients = [],
  tenders = [],
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakingId, setSpeakingId] = useState(null);
  const [micSupported, setMicSupported] = useState(false);

  const threadRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);

  const contextActive = Boolean(tenderId);
  const contextBadge = contextActive
    ? (tenderLabel || `Tender: ${tenderId}`)
    : 'General GeM Co-Pilot';

  useEffect(() => {
    setMicSupported(Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));
  }, []);

  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, sending, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => () => {
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    try { recognitionRef.current?.stop(); } catch { /* ignore */ }
  }, []);

  const toggleSpeak = useCallback((id, text) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    if (speakingId === id) {
      window.speechSynthesis.cancel();
      setSpeakingId(null);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(markdownToPlainText(text));
    utterance.rate = 1;
    utterance.onend = () => setSpeakingId(null);
    utterance.onerror = () => setSpeakingId(null);
    setSpeakingId(id);
    window.speechSynthesis.speak(utterance);
  }, [speakingId]);

  const toggleMic = () => {
    const SpeechRecognition = typeof window !== 'undefined'
      && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SpeechRecognition) return;

    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-IN';
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((r) => r[0].transcript).join(' ').trim();
      if (transcript) setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };

  const resolveTenderId = (hint) => {
    if (hint) {
      const match = tenders.find((t) => String(t.bid_no || '').toUpperCase() === hint.toUpperCase());
      if (match) return String(match._id || match.id || match.bid_no);
      return hint;
    }
    return tenderId || null;
  };

  const sendMessage = async (rawText) => {
    const question = String(rawText ?? input).trim();
    if (!question || sending) return;

    const classified = classifyWorkspacePrompt(question);
    const askedTender = resolveTenderId(classified.tenderHint);
    const resolvedClient = resolveClient(classified.clientHint, clients);

    setMessages((prev) => [...prev, { role: 'user', text: question }]);
    setInput('');
    setSending(true);

    try {
      if (classified.intent === INTENT.LIVE_HUNTER) {
        const result = await launchGemHunter();
        if (result.offline) {
          setMessages((prev) => [...prev, {
            role: 'assistant',
            kind: 'text',
            text: "Local GeM agent is offline. On this computer run `npm run gem:agent` in a terminal, then ask me again to launch the hunter.",
          }]);
          return;
        }
        if (!result.ok) {
          setMessages((prev) => [...prev, {
            role: 'error',
            text: result.error || 'Could not launch the GeM Live Hunter.',
          }]);
          return;
        }
        setMessages((prev) => [...prev, {
          role: 'assistant',
          kind: 'text',
          text: result.already_running
            ? 'Chrome is already open on your screen. Solve any CAPTCHA there — the hunter will resume automatically.'
            : 'Chrome opened on your screen for GeM BidPlus. Solve CAPTCHA if prompted; the hunter will scrape Telangana & Andhra Pradesh bids and upsert them into MongoDB.',
          meta: result.pid ? `pid ${result.pid}` : undefined,
        }]);
        return;
      }

      if (classified.intent === INTENT.DEEP_DIVE) {
        if (!askedTender) {
          setMessages((prev) => [...prev, {
            role: 'assistant',
            kind: 'text',
            text: 'I need a tender to read. Open one in the dashboard, or include its GEM bid number (e.g. GEM/2026/B/12345).',
          }]);
          return;
        }
        const res = await fetch('/api/ai/tender-deep-dive', {
          method: 'POST',
          headers: staffHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ tender_id: askedTender }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setMessages((prev) => [...prev, { role: 'error', text: data?.error || `Deep dive failed (${res.status}).` }]);
          return;
        }
        setMessages((prev) => [...prev, {
          role: 'assistant',
          kind: 'markdown',
          text: data.markdown,
          meta: data.cached ? 'Cached analysis' : `Read ${data.documents_read?.length || 0} document(s)`,
        }]);
        return;
      }

      if (classified.intent === INTENT.GENERATE_DOC) {
        if (!resolvedClient?.email) {
          setMessages((prev) => [...prev, {
            role: 'assistant',
            kind: 'text',
            text: 'Name the client (CLI-xxxx or their email) so I can pull their letterhead, signature and KYC into the draft.',
          }]);
          return;
        }
        const res = await fetch('/api/ai/generate-doc', {
          method: 'POST',
          headers: staffHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            client_email: resolvedClient.email,
            doc_type: classified.docType?.id,
            tender_id: askedTender || undefined,
            instructions: question,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          setMessages((prev) => [...prev, { role: 'error', text: data?.error || `Document generation failed (${res.status}).` }]);
          return;
        }
        setMessages((prev) => [...prev, {
          role: 'assistant',
          kind: 'document',
          text: `${data.doc_type?.label || 'Document'} drafted for ${data.client?.company_name || resolvedClient.email}.`,
          html: data.html,
          docLabel: data.doc_type?.label,
          stationery: data.stationery,
        }]);
        return;
      }

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: staffHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ query: question, tender_id: askedTender || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMessages((prev) => [...prev, { role: 'error', text: data?.error || `The Co-Pilot failed (${res.status}).` }]);
        return;
      }
      setMessages((prev) => [...prev, {
        role: 'assistant',
        kind: 'markdown',
        text: data.answer || data.text || 'No answer was returned.',
      }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'error', text: 'Network error. Please try again.' }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Gemini Workspace"
          className="fixed bottom-6 right-6 z-40 no-print h-14 px-4 rounded-full bg-[#0A2647] text-white shadow-xl hover:bg-[#144272] flex items-center gap-2 font-semibold"
        >
                  <Sparkles className="w-5 h-5 text-amber-300" />
          <span className="hidden sm:inline">Gemini Enterprise Co-Pilot</span>
          <Bot className="w-5 h-5 sm:hidden" />
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-50 no-print">
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <aside
            className="absolute top-0 right-0 h-full w-full md:w-[48vw] bg-white shadow-2xl border-l border-slate-200 flex flex-col"
            role="dialog"
            aria-label="Gemini Workspace"
          >
            <header className="px-4 py-3 border-b bg-[#0A2647] text-white flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
                  <p className="font-bold text-sm">Gemini Workspace</p>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <Badge className="bg-white/15 text-white border-0 text-[10px] font-medium">Gemini 1.5 Flash — Enterprise</Badge>
                  <Badge className="bg-indigo-400/30 text-indigo-50 border-0 text-[10px] font-medium truncate max-w-[220px]">
                    {contextBadge}
                  </Badge>
                </div>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="p-1.5 rounded-md hover:bg-white/10">
                <X className="w-4 h-4" />
              </button>
            </header>

            <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-slate-50">
              {messages.length === 0 && (
                <div className="text-sm text-slate-500 bg-white border rounded-xl p-4">
                  <p className="font-semibold text-[#0A2647] mb-2">Ask anything about GeM bidding.</p>
                  <ul className="space-y-1 text-[13px]">
                    <li>• “What is the scope of work for GEM/2026/B/123?” — reads SOW/ATC PDFs.</li>
                    <li>• “Generate an OEM Authorization for CLI-XXXX on that tender.” — prints on their letterhead.</li>
                    <li>• “Search tenders on GeM” / “run live hunter” — opens Chrome via the local agent.</li>
                    <li>• Anything else hits the GeM knowledge base.</li>
                  </ul>
                </div>
              )}

              {messages.map((msg, i) => {
                const id = `msg-${i}`;
                if (msg.role === 'user') {
                  return (
                    <div key={id} className="flex justify-end">
                      <div className="max-w-[85%] bg-[#0A2647] text-white rounded-2xl rounded-br-md px-3.5 py-2 text-sm leading-relaxed">
                        {msg.text}
                      </div>
                    </div>
                  );
                }
                if (msg.role === 'error') {
                  return (
                    <div key={id} className="bg-red-50 border border-red-100 text-red-800 rounded-xl px-3 py-2 text-sm">
                      {msg.text}
                    </div>
                  );
                }
                if (msg.kind === 'document') {
                  return (
                    <div key={id} className="bg-white border rounded-xl overflow-hidden shadow-sm">
                      <div className="px-3 py-2 border-b flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-[#0A2647] flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-indigo-600" /> {msg.docLabel || 'Document'}
                        </span>
                        <Button size="sm" className="h-7 text-[10px] bg-[#0A2647] hover:bg-[#144272]" onClick={() => printDocumentHtml(msg.html)}>
                          <Printer className="w-3 h-3 mr-1" /> Print Document
                        </Button>
                      </div>
                      <div className="max-h-[420px] overflow-auto bg-slate-200/70 p-3">
                        <div
                          className="origin-top mx-auto"
                          style={{ width: '210mm', transform: 'scale(0.55)', transformOrigin: 'top center' }}
                          dangerouslySetInnerHTML={{ __html: msg.html }}
                        />
                      </div>
                      {(msg.stationery && !msg.stationery.letterhead) && (
                        <p className="text-[10px] text-amber-700 px-3 py-1.5 bg-amber-50">No letterhead on file for this client — upload stationery from their card.</p>
                      )}
                    </div>
                  );
                }
                const html = msg.kind === 'markdown' ? markdownToSafeHtml(msg.text) : null;
                return (
                  <div key={id} className="bg-white border rounded-xl px-3.5 py-2.5 shadow-sm">
                    {html
                      ? <div className="prose prose-sm max-w-none text-slate-700 workspace-md" dangerouslySetInnerHTML={{ __html: html }} />
                      : <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{msg.text}</p>}
                    <div className="flex items-center gap-3 mt-2 pt-2 border-t border-slate-100">
                      <CopyButton text={markdownToPlainText(msg.text)} />
                      <SpeakButton id={id} text={msg.text} speakingId={speakingId} onToggle={toggleSpeak} />
                      {msg.meta && <span className="text-[10px] text-slate-400 ml-auto">{msg.meta}</span>}
                    </div>
                  </div>
                );
              })}

              {sending && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-600" /> Drafting…
                </div>
              )}
            </div>

            <footer className="border-t bg-white p-3">
              <form
                onSubmit={(e) => { e.preventDefault(); sendMessage(); }}
                className="flex items-end gap-2"
              >
                {micSupported && (
                  <Button type="button" variant="outline" size="icon" title="Mic" aria-label="Mic" className={cn('h-10 w-10 shrink-0', listening && 'bg-red-50 border-red-200 text-red-600')} onClick={toggleMic}>
                    {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                  </Button>
                )}
                <Textarea
                  ref={inputRef}
                  rows={2}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Ask about SOW/ATC, generate a letter, or query GeM rules…"
                  className="resize-none min-h-[40px] text-sm"
                />
                <Button type="submit" disabled={sending || !input.trim()} className="h-10 bg-indigo-700 hover:bg-indigo-800 shrink-0">
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </footer>
          </aside>
        </div>
      )}
    </>
  );
}

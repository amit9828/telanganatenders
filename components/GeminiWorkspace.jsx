'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { classifyWorkspacePrompt, INTENT, resolveClient } from '@/lib/workspace-intent';
import { markdownToPlainText, markdownToSafeHtml } from '@/lib/markdown-lite';
import { LANGUAGE_OPTIONS, LANGUAGES } from '@/lib/language';
import { staffHeaders } from '@/components/workflow/api';
import {
  Bot, Copy, FileText, Library, Loader2, Mic, MicOff, Printer, Send, Sparkles, Volume2, VolumeX, X,
} from 'lucide-react';

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
 * State of the open bid's document dossier, plus the control that builds it.
 *
 * This is the honest answer to "does the Co-Pilot actually know this bid?" — until the
 * SOW and buyer ATC are ingested it is answering from the cover page, and the officer
 * needs to see that rather than infer it from a vague reply.
 */
function DossierStrip({ dossier, ingest, onBuild }) {
  const ingested = dossier?.ingested || 0;
  const chunks = dossier?.chunks || 0;
  const needsAgent = dossier?.needs_local_agent || 0;
  const referenceOnly = dossier?.reference_only || 0;
  const built = ingested > 0;

  return (
    <div className="px-4 py-2 border-b bg-white flex items-center gap-3 flex-wrap">
      <Library className={cn('w-4 h-4 shrink-0', built ? 'text-emerald-600' : 'text-slate-400')} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-[#0A2647]">
          {built
            ? `Bid dossier ready — ${ingested} document(s), ${chunks} passage(s) indexed`
            : 'Bid dossier not built — answers come from the bid PDF only'}
        </p>
        {ingest.message ? (
          <p className="text-[10px] text-slate-500 truncate">
            {ingest.running && ingest.total > 0 ? `${ingest.done}/${ingest.total} · ` : ''}{ingest.message}
          </p>
        ) : (
          <p className="text-[10px] text-slate-500">
            {needsAgent > 0
              ? `${needsAgent} document(s) sit behind a GeM login — run this from the office computer with the local agent started.`
              : referenceOnly > 0
                ? `${referenceOnly} document(s) are named in the bid but published without a download link.`
                : 'Reads the linked Scope of Work and buyer ATC so clause questions can be answered.'}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {needsAgent > 0 && !ingest.running && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px]"
            onClick={() => onBuild({ retry: true })}
          >
            Retry blocked
          </Button>
        )}
        <Button
          size="sm"
          className="h-7 text-[10px] bg-emerald-700 hover:bg-emerald-800"
          disabled={ingest.running}
          onClick={() => onBuild({ refresh: built })}
        >
          {ingest.running
            ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Reading…</>
            : built ? 'Re-read documents' : 'Read bid documents'}
        </Button>
      </div>
    </div>
  );
}

/** Citation footer: which extract each bracketed reference in the answer came from. */
function SourceList({ sources }) {
  const cited = (sources || []).filter((s) => s.label && s.label !== 'S0');
  if (!cited.length) return null;

  return (
    <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap gap-1.5">
      {cited.map((source) => {
        const body = (
          <>
            <span className="font-bold">{source.label}</span>
            <span className="truncate max-w-[190px]">{source.title}</span>
            {source.doc_type && <span className="text-slate-400">{source.doc_type}</span>}
          </>
        );
        const className = 'inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 '
          + 'px-2 py-0.5 text-[10px] text-slate-600';
        return source.url
          ? (
            <a key={source.label} href={source.url} target="_blank" rel="noreferrer" className={cn(className, 'hover:border-indigo-300 hover:text-indigo-700')}>
              {body}
            </a>
          )
          : <span key={source.label} className={className}>{body}</span>;
      })}
    </div>
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
  embedded = false,
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakingId, setSpeakingId] = useState(null);
  const [micSupported, setMicSupported] = useState(false);
  // Server-side transcript id. Kept in localStorage so closing the panel, switching
  // tabs or reloading the dashboard resumes the same conversation instead of wiping it.
  const [conversationId, setConversationId] = useState(null);
  const [language, setLanguage] = useState(LANGUAGES.AUTO);
  const [dossier, setDossier] = useState(null);
  const [ingest, setIngest] = useState({ running: false, message: '', done: 0, total: 0 });

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
    const stored = localStorage.getItem('tt_copilot_conversation');
    if (!stored) return;
    setConversationId(stored);

    let cancelled = false;
    fetch(`/api/ai/chat?conversation_id=${encodeURIComponent(stored)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.messages?.length) return;
        setMessages(data.messages.map((m) => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          kind: m.role === 'user' ? undefined : 'markdown',
          text: m.text,
          sources: m.sources || [],
        })));
      })
      .catch(() => {
        // A missing or purged transcript just means starting fresh.
      });
    return () => { cancelled = true; };
  }, []);

  const rememberConversation = useCallback((id) => {
    if (!id) return;
    setConversationId(id);
    try { localStorage.setItem('tt_copilot_conversation', id); } catch { /* private mode */ }
  }, []);

  const startNewConversation = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    try { localStorage.removeItem('tt_copilot_conversation'); } catch { /* private mode */ }
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('tt_copilot_language');
      if (stored && Object.values(LANGUAGES).includes(stored)) setLanguage(stored);
    } catch { /* private mode */ }
  }, []);

  const chooseLanguage = useCallback((next) => {
    setLanguage(next);
    try { localStorage.setItem('tt_copilot_language', next); } catch { /* private mode */ }
  }, []);

  // What the Co-Pilot already knows about the open bid's own documents.
  useEffect(() => {
    if (!tenderId) {
      setDossier(null);
      return undefined;
    }
    let cancelled = false;
    fetch(`/api/tenders/dossier?tender_id=${encodeURIComponent(tenderId)}`, {
      credentials: 'include',
      headers: staffHeaders(),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled && data) setDossier(data); })
      .catch(() => { /* a missing dossier just means it has not been built */ });
    return () => { cancelled = true; };
  }, [tenderId]);

  /**
   * Reads the bid's linked SOW/ATC documents into per-bid vector context.
   *
   * The server ingests exactly one document per call — a full PDF through Gemini takes
   * 15-40s and several of them in one request would exceed the function timeout — so the
   * loop lives here, driving a progress line.
   */
  const buildDossier = useCallback(async ({ refresh = false, retry = false } = {}) => {
    if (!tenderId || ingest.running) return;
    setIngest({ running: true, message: 'Finding the documents this bid links to…', done: 0, total: 0 });

    let processed = 0;
    try {
      // Hard stop so a server that never reports `done` cannot spin forever.
      for (let step = 0; step < 12; step += 1) {
        const res = await fetch('/api/tenders/dossier', {
          method: 'POST',
          credentials: 'include',
          headers: staffHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            tender_id: tenderId,
            refresh: refresh && step === 0,
            retry: retry && step === 0,
          }),
        });
        const data = await res.json().catch(() => null);

        if (!res.ok) {
          setIngest({ running: false, message: data?.error || `Ingestion failed (${res.status}).`, done: processed, total: 0 });
          return;
        }

        setDossier(data);
        if (data.current) processed += 1;
        const total = processed + (data.remaining || 0);
        setIngest({
          running: !data.done,
          message: data.current
            ? `Read ${data.current.name || data.current.type} (${data.current.status})`
            : 'Preparing…',
          done: processed,
          total,
        });

        if (data.done) {
          setIngest({
            running: false,
            message: `${data.ingested} document(s) ingested · ${data.chunks} passage(s) indexed`
              + (data.needs_local_agent ? ` · ${data.needs_local_agent} need the local browser agent` : ''),
            done: processed,
            total,
          });
          return;
        }
      }
      setIngest((prev) => ({ ...prev, running: false, message: 'Paused — run it again to continue.' }));
    } catch {
      setIngest({ running: false, message: 'Network error while ingesting. Try again.', done: processed, total: 0 });
    }
  }, [tenderId, ingest.running]);

  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, sending, open, embedded]);

  useEffect(() => {
    if (open || embedded) inputRef.current?.focus();
  }, [open, embedded]);

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
        setMessages((prev) => [...prev, {
          role: 'assistant',
          kind: 'text',
          text: 'Live hunting has been removed. Tenders are added from the master upload, and a client chat reads a bid only when someone names it.',
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
        credentials: 'include',
        headers: staffHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          query: question,
          tender_id: askedTender || undefined,
          conversation_id: conversationId || undefined,
          language,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMessages((prev) => [...prev, { role: 'error', text: data?.error || `The Co-Pilot failed (${res.status}).` }]);
        return;
      }
      rememberConversation(data.conversation_id);
      if (data.dossier) setDossier((prev) => ({ ...(prev || {}), ...data.dossier }));
      setMessages((prev) => [...prev, {
        role: 'assistant',
        kind: 'markdown',
        text: data.answer || data.text || 'No answer was returned.',
        meta: data.dossier?.chunks_matched
          ? `${data.dossier.chunks_matched} passage(s) from this bid's own documents`
          : data.retrieval === 'gem_copilot_knowledge'
            ? 'Answered from Co-Pilot knowledge memory'
            : data.retrieval
              ? `Retrieval: ${data.retrieval}`
              : undefined,
        sources: data.sources || [],
      }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'error', text: 'Network error. Please try again.' }]);
    } finally {
      setSending(false);
    }
  };

  const chatColumn = (
            <>
            <header className="px-4 py-3 border-b bg-[#0A2647] text-white flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
                  <p className="font-bold text-sm">{embedded ? 'Co-Pilot Chat Desk' : 'Gemini Workspace'}</p>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  <Badge className="bg-white/15 text-white border-0 text-[10px] font-medium">Gemini Enterprise</Badge>
                  <Badge className="bg-indigo-400/30 text-indigo-50 border-0 text-[10px] font-medium truncate max-w-[220px]">
                    {contextBadge}
                  </Badge>
                  <Badge className="bg-emerald-400/25 text-emerald-50 border-0 text-[10px] font-medium">
                    Memory: gem_copilot_knowledge first
                  </Badge>
                  {conversationId && (
                    <Badge className="bg-amber-400/25 text-amber-50 border-0 text-[10px] font-medium">
                      Chat history saved
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <div className="flex rounded-md bg-white/10 p-0.5" role="group" aria-label="Answer language">
                  {LANGUAGE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      title={option.hint}
                      onClick={() => chooseLanguage(option.id)}
                      className={cn(
                        'px-2 py-1 rounded text-[10px] font-bold tracking-wide transition-colors',
                        language === option.id ? 'bg-white text-[#0A2647]' : 'text-white/70 hover:text-white',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={startNewConversation}
                  title="Start a new conversation"
                  className="px-2 py-1 rounded-md hover:bg-white/10 text-[10px] font-bold uppercase tracking-wider"
                >
                  New chat
                </button>
                {!embedded && (
                  <button type="button" onClick={() => setOpen(false)} className="p-1.5 rounded-md hover:bg-white/10">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </header>

            {contextActive && <DossierStrip dossier={dossier} ingest={ingest} onBuild={buildDossier} />}

            <div ref={threadRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-slate-50">
              {messages.length === 0 && (
                <div className="text-sm text-slate-500 bg-white border rounded-xl p-4">
                  <p className="font-semibold text-[#0A2647] mb-2">Ask anything about GeM bidding.</p>
                  <ul className="space-y-1 text-[13px]">
                    <li>• “What is the scope of work for GEM/2026/B/123?” — reads SOW/ATC PDFs.</li>
                    <li>• “ఈ బిడ్‌కి EMD ఎంత?” — ask in Telugu and the answer comes back in Telugu.</li>
                    <li>• “Generate an OEM Authorization for CLI-XXXX on that tender.” — prints on their letterhead.</li>
                    <li>• “Search tenders on GeM” / “run live hunter” — opens Chrome via the local agent.</li>
                    <li>• Anything else hits Co-Pilot memory (`gem_copilot_knowledge`) first, then the vector KB.</li>
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
                    <SourceList sources={msg.sources} />
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
            </>
  );

  if (embedded) {
    return (
      <div className="h-[min(78vh,820px)] w-full bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
        {chatColumn}
      </div>
    );
  }

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
            {chatColumn}
          </aside>
        </div>
      )}
    </>
  );
}

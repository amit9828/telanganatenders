'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { staffLetterheadHeaders } from '@/components/LetterheadThumb';
import DocStudioChat from './DocStudioChat';
import DocStudioCanvas from './DocStudioCanvas';
import { useDocSession } from './useDocSession';

const TABS = [
  { id: 'chat', label: 'Conversation' },
  { id: 'canvas', label: 'Document' },
];

/**
 * Chat-to-canvas document workspace.
 *
 * Split pane rather than pure chat, because the confirmation gate only works if the
 * outline stays visible while the officer types their objection to it. Below `lg` the two
 * panes become tabs — a 40/60 split on a phone would leave neither usable.
 */
export default function DocStudio({ defaultTenderId = '', className }) {
  const { session, files, busy, error, optimistic, language, setLanguage, sendMessage, confirm, reset } = useDocSession({
    defaultSlots: defaultTenderId ? { tender_id: defaultTenderId } : {},
  });

  const [tab, setTab] = useState('chat');
  const [requirements, setRequirements] = useState(null);
  const [analysing, setAnalysing] = useState(false);
  const [analysisError, setAnalysisError] = useState('');

  const tenderId = session?.validated?.tender_id?.ok ? session.validated.tender_id.value : null;
  const analysedFor = useRef(null);

  const analyseRequirements = useCallback(async (id, { refresh = false } = {}) => {
    if (!id) return;
    setAnalysing(true);
    setAnalysisError('');
    try {
      const res = await fetch('/api/tenders/requirements', {
        method: 'POST',
        credentials: 'include',
        headers: staffLetterheadHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ tender_id: id, refresh }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setRequirements(null);
        setAnalysisError(data?.error || `Requirement check failed (${res.status}).`);
        return;
      }
      setRequirements(data);
    } catch {
      setRequirements(null);
      setAnalysisError('Network error while reading the bid document.');
    } finally {
      setAnalysing(false);
    }
  }, []);

  // Read the bid as soon as the server confirms which tender this is. Guarded by the last
  // analysed id so re-validation on every turn does not re-trigger a Pro-tier PDF read.
  useEffect(() => {
    if (!tenderId) {
      setRequirements(null);
      analysedFor.current = null;
      return;
    }
    if (analysedFor.current === tenderId) return;
    analysedFor.current = tenderId;
    analyseRequirements(tenderId);
  }, [tenderId, analyseRequirements]);

  // Follow the work: when the server produces an outline or a document, the canvas is
  // where the officer needs to be looking on a small screen.
  useEffect(() => {
    if (session?.phase === 'outline_pending' || session?.phase === 'rendered') setTab('canvas');
  }, [session?.phase]);

  const canvas = (
    <DocStudioCanvas
      session={session}
      files={files}
      busy={busy}
      requirements={requirements}
      analysing={analysing}
      analysisError={analysisError}
      onReanalyse={() => analyseRequirements(tenderId, { refresh: true })}
      onConfirm={confirm}
    />
  );

  const chat = (
    <DocStudioChat
      session={session}
      busy={busy}
      optimistic={optimistic}
      error={error}
      language={language}
      onLanguage={setLanguage}
      onSend={sendMessage}
      onReset={reset}
    />
  );

  return (
    <Card className={cn('tender-shadow border-t-4 border-t-[#0A2647] w-full overflow-hidden p-0', className)}>
      <div className="lg:hidden flex border-b bg-white">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              'flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-wider',
              tab === t.id ? 'text-[#0A2647] border-b-2 border-[#0A2647]' : 'text-slate-400',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] h-[min(80vh,860px)]">
        <div className={cn('min-h-0 border-r border-slate-200', tab === 'chat' ? 'block' : 'hidden lg:block')}>
          {chat}
        </div>
        <div className={cn('min-h-0 bg-slate-50', tab === 'canvas' ? 'block' : 'hidden lg:block')}>
          {canvas}
        </div>
      </div>
    </Card>
  );
}

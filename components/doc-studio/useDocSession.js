'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { staffLetterheadHeaders } from '@/components/LetterheadThumb';
import { LANGUAGES } from '@/lib/language';

const STORAGE_KEY = 'tt_doc_studio_session';

/**
 * Owns the Document Studio session.
 *
 * The server holds the state machine; this hook only mirrors it. The one piece of local
 * state that matters is `optimistic` — the officer's message shown immediately so the UI
 * does not feel dead during a 10-20 second Pro-tier turn.
 */
export function useDocSession({ defaultSlots } = {}) {
  const [session, setSession] = useState(null);
  const [letterheads, setLetterheads] = useState([]);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [optimistic, setOptimistic] = useState(null);
  const [language, setLanguage] = useState(LANGUAGES.AUTO);

  const startedRef = useRef(false);

  const post = useCallback(async (payload) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/documents/session', {
        method: 'POST',
        credentials: 'include',
        headers: staffLetterheadHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ ...payload, language }),
      });
      const data = await res.json().catch(() => null);

      // A 409 is the confirmation gate doing its job, and it carries the corrected
      // session — surface the reason but keep the server's state.
      if (data?.session) setSession(data.session);
      if (data?.letterheads) setLetterheads(data.letterheads);
      if (data?.files?.length) setFiles(data.files);

      if (!res.ok) {
        setError(data?.error || `The document desk failed (${res.status}).`);
        return null;
      }

      if (data?.session?.session_id) {
        try { localStorage.setItem(STORAGE_KEY, data.session.session_id); } catch { /* private mode */ }
      }
      return data;
    } catch {
      setError('Network error. Please try again.');
      return null;
    } finally {
      setBusy(false);
      setOptimistic(null);
    }
  }, [language]);

  // Resume the interview after a refresh rather than restarting it.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let stored = null;
    try { stored = localStorage.getItem(STORAGE_KEY); } catch { /* private mode */ }
    try {
      const storedLang = localStorage.getItem('tt_copilot_language');
      if (storedLang && Object.values(LANGUAGES).includes(storedLang)) setLanguage(storedLang);
    } catch { /* private mode */ }

    (async () => {
      if (stored) {
        try {
          const res = await fetch(`/api/documents/session?session_id=${encodeURIComponent(stored)}`, {
            credentials: 'include',
            headers: staffLetterheadHeaders(),
          });
          if (res.ok) {
            const data = await res.json();
            if (data?.session) {
              setSession(data.session);
              return;
            }
          }
        } catch { /* fall through to a fresh session */ }
      }
      await post({ slots: defaultSlots || {} });
    })();
    // defaultSlots is only an opening hint; changing it later must not restart the interview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post]);

  const sendMessage = useCallback((text) => {
    const message = String(text || '').trim();
    if (!message || busy) return Promise.resolve(null);
    setOptimistic(message);
    return post({ session_id: session?.session_id, message });
  }, [busy, post, session?.session_id]);

  const setSlots = useCallback((slots) => post({ session_id: session?.session_id, slots }), [post, session?.session_id]);

  const confirm = useCallback(() => post({
    session_id: session?.session_id,
    action: 'confirm',
    outline_hash: session?.outline_hash,
  }), [post, session?.session_id, session?.outline_hash]);

  const reset = useCallback(async () => {
    setFiles([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* private mode */ }
    await post({ session_id: session?.session_id, action: 'reset' });
  }, [post, session?.session_id]);

  return { session, letterheads, files, busy, error, optimistic, language, setLanguage, sendMessage, setSlots, confirm, reset };
}

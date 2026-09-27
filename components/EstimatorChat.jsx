'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2 } from 'lucide-react';

export default function EstimatorChat() {
  const [bidNo, setBidNo] = useState('');
  const [activeBid, setActiveBid] = useState('');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function send(body) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/estimator/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && !data.messages) throw new Error(data.error || 'The chat could not continue.');
      if (data.messages) setMessages(data.messages);
      if (data.bid_no) setActiveBid(data.bid_no);
      if (data.error) setError(data.error);
      if (data.job_id && data.status === 'running') {
        const polled = await fetch(`/api/estimator/chat?job_id=${encodeURIComponent(data.job_id)}`, { credentials: 'include' });
        const job = await polled.json().catch(() => ({}));
        if (job.messages) setMessages(job.messages);
        if (job.error) setError(job.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
      <div>
        <h2 className="font-bold text-[#0A2647]">Tender assistant</h2>
        <p className="text-sm text-slate-500">Name a bid we already hold. The assistant asks about you first, then answers only what you ask.</p>
      </div>
      <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (bidNo.trim()) send({ bid_no: bidNo.trim() }); }}>
        <Input value={bidNo} onChange={(event) => setBidNo(event.target.value)} placeholder="Bid number" />
        <Button type="submit" disabled={busy}>Open</Button>
      </form>
      <div className="space-y-3 max-h-[480px] overflow-y-auto">
        {messages.map((item, index) => (
          <div key={`${item.role}-${index}`} className={item.role === 'user' ? 'text-right' : 'text-left'}>
            <div className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${item.role === 'user' ? 'bg-[#0A2647] text-white' : 'bg-slate-100 text-slate-800'}`}>
              {item.text}
            </div>
          </div>
        ))}
        {busy ? <div className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Reading</div> : null}
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {activeBid ? (
        <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); const text = draft.trim(); if (!text) return; setDraft(''); send({ bid_no: activeBid, message: text }); }}>
          <Input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Ask about this tender" />
          <Button type="submit" disabled={busy}>Send</Button>
        </form>
      ) : null}
    </div>
  );
}

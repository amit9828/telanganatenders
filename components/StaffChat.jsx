'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { workflowFetch, staffHeaders } from '@/components/workflow/api';
import { Send } from 'lucide-react';

const MD_PEER = { emp_id: 'MD', name: 'Managing Director', designation: 'MD' };

function formatWhen(value) {
  if (!value) return '';
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function StaffChat({ selfId, roster = [], teammates, jobId = null }) {
  const people = teammates || roster;
  const [peer, setPeer] = useState('');
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const list = useMemo(() => {
    const seen = new Set();
    const out = [];
    const add = (row) => {
      const id = String(row?.emp_id || row?.email || '').trim();
      if (!id || id === selfId || seen.has(id)) return;
      seen.add(id);
      out.push(row);
    };
    add(MD_PEER);
    (people || []).forEach(add);
    return out;
  }, [people, selfId]);

  const load = useCallback(async (p) => {
    const target = p || peer;
    if (!jobId && !target) return;
    try {
      const qs = new URLSearchParams();
      if (target) qs.set('peer', target);
      if (jobId) qs.set('job_id', jobId);
      const data = await workflowFetch(`/api/staff-chat?${qs.toString()}`);
      setMessages(data.messages || []);
    } catch (e) {
      toast.error(e.message);
    }
  }, [peer, jobId]);

  useEffect(() => { load(peer); }, [load, peer, jobId]);

  useEffect(() => {
    if (!jobId && !peer) return undefined;
    const id = setInterval(() => load(peer), 8000);
    return () => clearInterval(id);
  }, [load, peer, jobId]);

  const send = async () => {
    if (!peer) return toast.error('Pick a teammate.');
    if (!text && !file) return;
    setBusy(true);
    try {
      if (file) {
        const form = new FormData();
        form.append('to_emp_id', peer);
        form.append('text', text);
        if (jobId) form.append('job_id', jobId);
        form.append('file', file);
        const res = await fetch('/api/staff-chat', {
          method: 'POST',
          credentials: 'include',
          headers: staffHeaders(),
          body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Send failed (${res.status})`);
      } else {
        await workflowFetch('/api/staff-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to_emp_id: peer, text, ...(jobId ? { job_id: jobId } : {}) }),
        });
      }
      setText('');
      setFile(null);
      await load(peer);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{jobId ? 'Tender thread (7-day history)' : 'Staff chat (7-day history)'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <select className="w-full border rounded-md h-9 text-sm px-2" value={peer} onChange={(e) => setPeer(e.target.value)}>
          <option value="">Select teammate</option>
          {list.map((r) => (
            <option key={r.emp_id || r.email} value={r.emp_id || r.email}>{r.name} ({r.emp_id || r.designation || 'staff'})</option>
          ))}
        </select>
        <ScrollArea className="h-56 border rounded-md p-2 bg-slate-50">
          {messages.map((m) => (
            <div key={m._id} className={`mb-2 text-sm ${m.from_emp_id === selfId ? 'text-right' : ''}`}>
              <span className="inline-block max-w-[80%] rounded-lg px-2 py-1 bg-white border text-left">
                <span className="block text-[9px] text-slate-400 font-mono">{m.from_name || m.from_emp_id} · {formatWhen(m.created_at)}</span>
                {m.text || m.file_name}
                {m.file_url && (
                  <a href={m.file_url} className="block text-[10px] text-blue-600 underline mt-0.5" target="_self" rel="noreferrer">Attachment</a>
                )}
              </span>
            </div>
          ))}
        </ScrollArea>
        <div className="flex gap-2">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Message"
            className="h-9"
          />
          <input type="file" className="w-28 text-[10px]" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <Button size="sm" className="h-9" onClick={send} disabled={busy}><Send className="w-4 h-4" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}

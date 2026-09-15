'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { workflowFetch, staffHeaders } from '@/components/workflow/api';
import { Send } from 'lucide-react';

export default function StaffChat({ selfId, roster = [] }) {
  const [peer, setPeer] = useState('');
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);

  const load = async (p) => {
    if (!p) return;
    try {
      const data = await workflowFetch(`/api/staff-chat?peer=${encodeURIComponent(p)}`);
      setMessages(data.messages || []);
    } catch (e) {
      toast.error(e.message);
    }
  };

  useEffect(() => { if (peer) load(peer); }, [peer]);

  const send = async () => {
    if (!peer) return toast.error('Pick a teammate.');
    if (!text && !file) return;
    try {
      if (file) {
        const form = new FormData();
        form.append('to_emp_id', peer);
        form.append('text', text);
        form.append('file', file);
        await fetch('/api/staff-chat', { method: 'POST', credentials: 'include', headers: staffHeaders(), body: form });
      } else {
        await workflowFetch('/api/staff-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to_emp_id: peer, text }),
        });
      }
      setText('');
      setFile(null);
      load(peer);
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Staff chat (7-day history)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <select className="w-full border rounded-md h-9 text-sm px-2" value={peer} onChange={(e) => setPeer(e.target.value)}>
          <option value="">Select teammate</option>
          {roster.filter((r) => (r.emp_id || r.email) !== selfId).map((r) => (
            <option key={r.emp_id || r.email} value={r.emp_id || r.email}>{r.name} ({r.emp_id || r.designation || 'staff'})</option>
          ))}
        </select>
        <ScrollArea className="h-56 border rounded-md p-2 bg-slate-50">
          {messages.map((m) => (
            <div key={m._id} className={`mb-2 text-sm ${m.from_emp_id === selfId ? 'text-right' : ''}`}>
              <span className="inline-block max-w-[80%] rounded-lg px-2 py-1 bg-white border">{m.text || m.file_name}</span>
            </div>
          ))}
        </ScrollArea>
        <div className="flex gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message" className="h-9" />
          <input type="file" className="w-28 text-[10px]" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <Button size="sm" className="h-9" onClick={send}><Send className="w-4 h-4" /></Button>
        </div>
      </CardContent>
    </Card>
  );
}

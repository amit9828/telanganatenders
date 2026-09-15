'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { workflowFetch } from '@/components/workflow/api';
import { BellRing, Send } from 'lucide-react';

export default function OpsAlerts({ roster = [] }) {
  const [alerts, setAlerts] = useState([]);
  const [toEmpId, setToEmpId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = async () => {
    try {
      const data = await workflowFetch('/api/ops-alerts');
      setAlerts(data.alerts || []);
    } catch (e) {
      toast.error(e.message);
    }
  };

  useEffect(() => { load(); }, []);

  const ok = async (id) => {
    try {
      await workflowFetch('/api/ops-alerts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setSelected(null);
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const send = async () => {
    if (!toEmpId || !message.trim()) return toast.error('Select an employee and type a message.');
    setBusy(true);
    try {
      await workflowFetch('/api/ops-alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to_emp_id: toEmpId, message: message.trim() }),
      });
      toast.success('Alert sent.');
      setMessage('');
      setToEmpId('');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const people = [
    { emp_id: 'MD', name: 'Managing Director' },
    ...roster.filter((r) => r.emp_id && r.deleted !== true && r.active !== false),
  ];
  const incoming = alerts.filter((a) => a.status !== 'OK');

  return (
    <div className="flex flex-wrap gap-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-10">
            <BellRing className="w-4 h-4 mr-2" /> Incoming Alerts
            {incoming.length > 0 && (
              <Badge className="ml-2 bg-red-600 hover:bg-red-600 text-white border-0">{incoming.length}</Badge>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[340px] p-3 space-y-2">
          {incoming.length === 0 && <p className="text-xs text-slate-400 py-4 text-center">No incoming alerts.</p>}
          {incoming.map((a) => (
            <button
              key={a._id}
              type="button"
              onClick={() => setSelected(a)}
              className="w-full text-left border rounded-lg p-2 hover:bg-slate-50"
            >
              <p className="text-[10px] font-bold text-slate-500">{a.from_name || a.from_emp_id || a.type}</p>
              <p className="text-xs text-slate-800 line-clamp-2">{a.message}</p>
            </button>
          ))}
          {selected && (
            <div className="border-t pt-2">
              <p className="text-sm text-slate-800 mb-2">{selected.message}</p>
              <Button size="sm" className="h-8 w-full bg-[#0A2647]" onClick={() => ok(selected._id)}>OK</Button>
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="h-10 bg-[#0A2647] hover:bg-[#144272]">
            <Send className="w-4 h-4 mr-2" /> Send Alert
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[340px] p-3 space-y-3">
          <Select value={toEmpId} onValueChange={setToEmpId}>
            <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select employee" /></SelectTrigger>
            <SelectContent>
              {people.map((p) => (
                <SelectItem key={p.emp_id} value={p.emp_id}>{p.name || p.emp_id} ({p.emp_id})</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Type alert message" className="text-sm" />
          <Button className="w-full h-9 bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={send}>
            {busy ? 'Sending…' : 'Send / Forward'}
          </Button>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

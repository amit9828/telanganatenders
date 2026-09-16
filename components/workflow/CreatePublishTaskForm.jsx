'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { workflowFetch } from '@/components/workflow/api';

export default function CreatePublishTaskForm({
  members = [],
  tls = [],
  actorEmpId = '',
  actorDesk = 'tl',
  onCreated,
}) {
  const [assignedEmpId, setAssignedEmpId] = useState('');
  const [tlId, setTlId] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const teamLeadId = actorDesk === 'md' ? tlId : actorEmpId;
  const makers = members.filter((m) => String(m.team_id || '') === String(teamLeadId || '') && Boolean(teamLeadId));

  const submit = async (e) => {
    e.preventDefault();
    if (actorDesk === 'md' && !tlId) return toast.error('Select a Team Lead first.');
    if (!assignedEmpId) return toast.error('Select a team member to publish.');
    setBusy(true);
    try {
      await workflowFetch('/api/workflow/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigned_emp_id: assignedEmpId,
          title: title.trim() || 'Check Drive / Publish tender',
          notes: notes.trim(),
          ...(actorDesk === 'md' ? { team_id: tlId, routed_tl_emp_id: tlId } : {}),
        }),
      });
      toast.success('Publish job assigned. The member will see it on their Publish tab.');
      setAssignedEmpId('');
      setTitle('');
      setNotes('');
      onCreated?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-0 shadow-md">
      <CardHeader className="pb-3 border-b">
        <CardTitle className="text-[#0A2647] text-lg">Assign a publish job</CardTitle>
        <CardDescription>Creates an AWAITING_PUBLISH task. The member attaches the live tender from their Publish desk.</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <form onSubmit={submit} className="space-y-3">
          {actorDesk === 'md' && (
            <div>
              <Label className="text-xs font-bold">Team Lead *</Label>
              <Select value={tlId} onValueChange={(v) => { setTlId(v); setAssignedEmpId(''); }}>
                <SelectTrigger className="mt-1 h-9"><SelectValue placeholder="Select TL" /></SelectTrigger>
                <SelectContent>
                  {tls.map((t) => <SelectItem key={t.emp_id} value={t.emp_id}>{t.name} ({t.emp_id})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-xs font-bold">Team employee *</Label>
            <Select value={assignedEmpId} onValueChange={setAssignedEmpId}>
              <SelectTrigger className="mt-1 h-9"><SelectValue placeholder={makers.length ? 'Select employee' : 'No employees on this team'} /></SelectTrigger>
              <SelectContent>
                {makers.map((m) => <SelectItem key={m.emp_id} value={m.emp_id}>{m.name} ({m.emp_id})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs font-bold">Task title</Label>
            <Input className="mt-1 h-9" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Check Drive / Publish tender" />
          </div>
          <div>
            <Label className="text-xs font-bold">Notes</Label>
            <Input className="mt-1 h-9" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
          <Button type="submit" disabled={busy} className="w-full h-9 bg-[#0A2647] hover:bg-[#144272]">Create publish job</Button>
        </form>
      </CardContent>
    </Card>
  );
}

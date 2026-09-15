'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { signIn } from 'next-auth/react';
import { Key, LogIn, UserPlus } from 'lucide-react';
import { DESIGNATION_LABELS, deskPathForDesignation } from '@/lib/designations';
import { workflowFetch } from '@/components/workflow/api';

export default function TeamDirectoryPanel({ actorDesk, team = [], onRefresh, impersonate }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', designation: actorDesk === 'md' ? 'GM' : 'DOC_TEAM_TL', team_id: '' });
  const tls = team.filter((t) => t.designation === 'DOC_TEAM_TL');
  const allowed = useMemo(() => {
    if (actorDesk === 'md') return ['GM', 'DOC_TEAM_TL', 'DOC_TEAM_MEMBER'];
    if (actorDesk === 'gm') return ['DOC_TEAM_TL', 'DOC_TEAM_MEMBER'];
    return [];
  }, [actorDesk]);

  const create = async (e) => {
    e.preventDefault();
    if (!allowed.length) return toast.error('You cannot create staff logins.');
    try {
      await workflowFetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      toast.success('Staff login created. Drive folder attempted automatically.');
      setForm({ name: '', email: '', password: '', designation: allowed[0], team_id: '' });
      onRefresh?.();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const canBypass = (member) => {
    if (actorDesk === 'md') return true;
    if (actorDesk === 'gm') return member.designation === 'DOC_TEAM_TL' || member.designation === 'DOC_TEAM_MEMBER';
    if (actorDesk === 'tl') return member.designation === 'DOC_TEAM_MEMBER';
    return false;
  };

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      {allowed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg"><Key className="w-4 h-4" /> Create login</CardTitle>
            <CardDescription>Designation drives desk routing. Members must belong to one TL.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label>Designation</Label>
                <Select value={form.designation} onValueChange={(v) => setForm({ ...form, designation: v })}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {allowed.map((d) => <SelectItem key={d} value={d}>{DESIGNATION_LABELS[d] || d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              {form.designation === 'DOC_TEAM_MEMBER' && (
                <div>
                  <Label>Team Lead</Label>
                  <Select value={form.team_id} onValueChange={(v) => setForm({ ...form, team_id: v })}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select TL" /></SelectTrigger>
                    <SelectContent>
                      {tls.map((t) => <SelectItem key={t.emp_id} value={t.emp_id}>{t.name} ({t.emp_id})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <Label>Email</Label>
                <Input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label>Password</Label>
                <Input required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="mt-1" />
              </div>
              <Button type="submit" className="w-full"><UserPlus className="w-4 h-4 mr-2" /> Save</Button>
            </form>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle className="text-lg">Team</CardTitle></CardHeader>
        <CardContent className="space-y-3 max-h-[520px] overflow-y-auto">
          {team.map((off) => (
            <div key={off._id} className="border rounded-xl p-3">
              <div className="flex justify-between gap-2">
                <div>
                  <p className="font-bold text-sm">{off.name}</p>
                  <p className="text-[10px] font-mono text-slate-500">{off.emp_id} · {off.email}</p>
                </div>
                <Badge variant="outline">{DESIGNATION_LABELS[off.designation] || off.designation || off.role}</Badge>
              </div>
              {canBypass(off) && impersonate && (
                <Button size="sm" className="mt-2 h-8 text-xs w-full" onClick={() => impersonate(off)}>
                  <LogIn className="w-3 h-3 mr-1" /> Login as {off.designation || off.role}
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export async function openStaffDesk(member) {
  const path = deskPathForDesignation(member.designation);
  if (typeof window === 'undefined') return;
  localStorage.setItem('tt_emp_email', member.email);
  const adminToken = localStorage.getItem('tt_admin');
  if (adminToken) {
    await signIn('impersonate', { redirect: false, email: member.email, adminToken });
  }
  window.open(path, '_blank');
}

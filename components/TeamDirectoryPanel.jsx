'use client';

import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Eye, EyeOff, Key, LogIn, Pencil, Trash2, UserPlus } from 'lucide-react';
import { DESIGNATION_LABELS, DESIGNATIONS, deskPathForStaff, loginAsLabel, resolveStaffDesignation } from '@/lib/designations';
import { workflowFetch } from '@/components/workflow/api';
import { openStaffBypass } from '@/lib/tab-handoff';

function StaffCard({ off, canManage, canDelete, canBypass, impersonate, onRefresh, tls }) {
  const [showPw, setShowPw] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    name: off.name || '',
    email: off.email || '',
    password: '',
    designation: off.designation || '',
    team_id: off.team_id || '',
  });

  const save = async () => {
    try {
      await workflowFetch(`/api/employees?id=${encodeURIComponent(off._id || off.emp_id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emp_id: off.emp_id,
          name: form.name,
          email: form.email,
          designation: form.designation,
          team_id: form.team_id,
          ...(form.password ? { password: form.password } : {}),
        }),
      });
      toast.success('Staff updated.');
      setEditing(false);
      onRefresh?.();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async () => {
    if (!confirm(`Revoke login for ${off.name} (${off.emp_id})? They will not be able to sign in.`)) return;
    try {
      await workflowFetch(`/api/employees?id=${encodeURIComponent(off._id || off.emp_id)}`, { method: 'DELETE' });
      toast.success('Login revoked. They can no longer sign in.');
      onRefresh?.();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="border rounded-xl p-3 min-w-0 overflow-hidden">
      <div className="flex justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold text-sm">{off.name}</p>
          <p className="text-[10px] font-mono text-slate-500">{off.emp_id} · {off.email}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant="outline">{DESIGNATION_LABELS[resolveStaffDesignation(off)] || off.designation || off.role}</Badge>
          {(off.deleted || off.active === false) && (
            <Badge className="bg-red-100 text-red-800 border-0">{off.deleted ? 'Revoked' : 'Inactive'}</Badge>
          )}
        </div>
      </div>
      {canManage && showPw && (
        <p className="mt-2 text-[11px] font-mono bg-slate-50 border rounded px-2 py-1 break-all">
          Password: {off.password || '—'}
        </p>
      )}
      {editing && (
        <div className="mt-2 space-y-2">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="h-8 text-xs" />
          <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="h-8 text-xs" />
          <Input placeholder="New password (optional)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="h-8 text-xs" />
          {form.designation === 'DOC_TEAM_MEMBER' && (
            <Select value={form.team_id} onValueChange={(v) => setForm({ ...form, team_id: v })}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Team Lead" /></SelectTrigger>
              <SelectContent>
                {tls.map((t) => <SelectItem key={t.emp_id} value={t.emp_id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" className="h-7 text-[10px] w-full" onClick={save}>Save changes</Button>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 mt-2">
        {canBypass && impersonate && !off.deleted && off.active !== false && (
          <Button size="sm" className="h-7 text-[10px]" onClick={() => impersonate(off)}>
            <LogIn className="w-3 h-3 mr-1" /> {loginAsLabel(off)}
          </Button>
        )}
        {canManage && (
          <>
            <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setEditing((v) => !v)}>
              <Pencil className="w-3 h-3 mr-1" /> Edit
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setShowPw((v) => !v)}>
              {showPw ? <EyeOff className="w-3 h-3 mr-1" /> : <Eye className="w-3 h-3 mr-1" />} Password
            </Button>
            {canDelete && !off.deleted && (
            <Button size="sm" variant="outline" className="h-7 text-[10px] text-red-600 border-red-200" onClick={remove}>
              <Trash2 className="w-3 h-3 mr-1" /> Delete
            </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function TeamDirectoryPanel({ actorDesk, team = [], onRefresh, impersonate, actorEmpId = '' }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', designation: actorDesk === 'md' ? 'GM' : 'DOC_TEAM_TL', team_id: '' });
  const tls = team.filter((t) => resolveStaffDesignation(t) === DESIGNATIONS.DOC_TEAM_TL);
  const gms = team.filter((t) => resolveStaffDesignation(t) === DESIGNATIONS.GM);
  const members = team.filter((t) => resolveStaffDesignation(t) === DESIGNATIONS.DOC_TEAM_MEMBER);
  const allowed = useMemo(() => {
    if (actorDesk === 'md') return ['GM', 'DOC_TEAM_TL', 'DOC_TEAM_MEMBER'];
    if (actorDesk === 'gm') return ['DOC_TEAM_TL', 'DOC_TEAM_MEMBER'];
    return [];
  }, [actorDesk]);
  const canManage = actorDesk === 'md' || actorDesk === 'gm';
  const canDelete = actorDesk === 'md';

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
    const role = resolveStaffDesignation(member);
    if (actorDesk === 'md') return true;
    if (actorDesk === 'gm') {
      return role === DESIGNATIONS.DOC_TEAM_TL || role === DESIGNATIONS.DOC_TEAM_MEMBER;
    }
    if (actorDesk === 'tl') {
      return role === DESIGNATIONS.DOC_TEAM_MEMBER
        && String(member?.team_id || '') === String(actorEmpId || '')
        && Boolean(actorEmpId);
    }
    return false;
  };

  const cardProps = (off) => ({
    off,
    canManage,
    canDelete,
    canBypass: canBypass(off),
    impersonate,
    onRefresh,
    tls,
  });

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
        <CardContent className="space-y-4 max-h-[620px] overflow-y-auto">
          {gms.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">General Managers</p>
              {gms.map((off) => <StaffCard key={off._id || off.emp_id} {...cardProps(off)} />)}
            </div>
          )}
          {tls.map((tl) => (
            <div key={tl.emp_id} className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Team · {tl.name}</p>
              <StaffCard {...cardProps(tl)} />
              {members.filter((m) => m.team_id === tl.emp_id).map((off) => (
                <div key={off._id || off.emp_id} className="pl-3 border-l-2 border-slate-200">
                  <StaffCard {...cardProps(off)} />
                </div>
              ))}
            </div>
          ))}
          {members.filter((m) => !tls.some((tl) => tl.emp_id === m.team_id)).length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Unassigned members</p>
              {members.filter((m) => !tls.some((tl) => tl.emp_id === m.team_id)).map((off) => (
                <StaffCard key={off._id || off.emp_id} {...cardProps(off)} />
              ))}
            </div>
          )}
          {team.length === 0 && <p className="text-sm text-slate-400 text-center py-8">No staff yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

export function openStaffDesk(member) {
  if (typeof window === 'undefined') return;
  const email = String(member?.email || '').trim();
  const empId = String(member?.emp_id || '').trim();
  if (!email && !empId) {
    toast.error('This staff record has no email or employee ID.');
    return;
  }

  const path = deskPathForStaff(member);
  toast.success('Opening live dashboard…');
  openStaffBypass(path, email || empId);
}

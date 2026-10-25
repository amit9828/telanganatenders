'use client';

import { useCallback, useEffect, useState } from 'react';
import { useDeskTab } from '@/lib/use-desk-tab';
import { toast } from 'sonner';
import { staffHeaders } from '@/components/workflow/api';
import DocTaskOverview from '@/components/doc-team/DocTaskOverview';
import DocTaskWorkflow from '@/components/doc-team/DocTaskWorkflow';
import DocTaskCompleted from '@/components/doc-team/DocTaskCompleted';

const TABS = [
  { id: 'overview', label: 'Overview', active: '#7c3aed', idle: '#ede9fe', activeText: '#fff', idleText: '#4c1d95' },
  { id: 'workflow', label: 'Workflow', active: '#ea580c', idle: '#ffedd5', activeText: '#fff', idleText: '#9a3412' },
  { id: 'completed', label: 'Completed', active: '#2563eb', idle: '#dbeafe', activeText: '#fff', idleText: '#1e3a8a' },
];

const METRICS = [
  { key: 'waitingForQuotation', label: 'Waiting for Quotation', color: '#6b21a8', background: '#f3e8ff' },
  { key: 'waitingForDocuments', label: 'Waiting for Documents', color: '#9a3412', background: '#ffedd5' },
  { key: 'underPreparation', label: 'Under Preparation', color: '#1e40af', background: '#dbeafe' },
  { key: 'completed', label: 'Completed', color: '#334155', background: '#f1f5f9' },
  { key: 'totalOngoing', label: 'Total Ongoing', color: '#0A2647', background: '#e0e7ff' },
];

async function docFetch(url, options = {}) {
  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: staffHeaders({
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const SHEET_TABS = ['overview', 'workflow', 'completed'];

export default function DocTeamWorkspace({ role = 'maker', actorEmpId = '' }) {
  const [tab, setTab] = useDeskTab('sheet', 'overview', SHEET_TABS);
  const [tasks, setTasks] = useState([]);
  const [overview, setOverview] = useState([]);
  const [summary, setSummary] = useState(null);
  const [assignees, setAssignees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const canLead = role === 'gm' || role === 'tl';

  const load = useCallback(async ({ soft = false } = {}) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await docFetch('/api/doc-tasks');
      const loaded = data.tasks || [];
      setTasks(loaded);
      setOverview(data.overview || loaded);
      setSummary(data.summary || null);
      if (canLead) {
        const staff = await docFetch('/api/doc-tasks?view=assignees');
        setAssignees(staff.assignees || []);
      }
    } catch (err) {
      toast.error(err.message || 'Could not load the doc team sheet.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [canLead]);

  useEffect(() => { load(); }, [load]);

  const replaceTask = (task) => {
    const swap = (current) => (
      current.some((row) => row.id === task.id)
        ? current.map((row) => (row.id === task.id ? task : row))
        : current
    );
    setTasks(swap);
    setOverview(swap);
  };

  const reloadSummary = async () => {
    const data = await docFetch('/api/doc-tasks?view=summary');
    setSummary(data);
  };

  const onPatch = async (row, patch) => {
    try {
      const data = await docFetch(`/api/doc-tasks/${row.id}`, { method: 'PUT', body: JSON.stringify(patch) });
      const swap = (current) => (
        data.deleted
          ? current.filter((item) => item.id !== row.id)
          : current.map((item) => (item.id === row.id ? data.task : item))
      );
      setTasks(swap);
      setOverview(swap);
      try { await reloadSummary(); } catch (err) { toast.error(err.message || 'Could not refresh the counts.'); }
    } catch (err) {
      toast.error(err.message || 'Save failed.');
    }
  };

  const onAssign = async (row, assignedEmployeeId) => {
    try {
      const data = await docFetch(`/api/doc-tasks/${row.id}`, {
        method: 'PUT',
        body: JSON.stringify({ assignedEmployeeId }),
      });
      replaceTask(data.task);
    } catch (err) {
      toast.error(err.message || 'Could not assign the employee.');
    }
  };

  const onDelete = async (row) => {
    if (!window.confirm(`Delete bid ${row.bidNumber || 'this row'} from the doc team sheet?`)) return;
    try {
      await docFetch(`/api/doc-tasks/${row.id}`, { method: 'DELETE' });
      const drop = (current) => current.filter((item) => item.id !== row.id);
      setTasks(drop);
      setOverview(drop);
      try { await reloadSummary(); } catch (err) { toast.error(err.message || 'Could not refresh the counts.'); }
    } catch (err) {
      toast.error(err.message || 'Delete failed.');
    }
  };

  const completed = tasks.filter((row) => row.status === 'Completed');
  const active = tasks.filter((row) => row.status !== 'Completed');

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch', marginBottom: 8 }}>
        {summary ? METRICS.map((metric) => (
          <div key={metric.key} style={{ flex: 1, background: metric.background, color: metric.color, padding: '8px 10px', borderLeft: `6px solid ${metric.color}` }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>{metric.label}</div>
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1 }}>{summary[metric.key] ?? 0}</div>
          </div>
        )) : <div style={{ flex: 1 }} />}
        <button
          type="button"
          disabled={refreshing}
          onClick={() => load({ soft: true })}
          style={{ border: '1px solid #64748b', background: '#fff', padding: '2px 8px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <span
            aria-hidden="true"
            className={refreshing ? 'animate-spin' : ''}
            style={{
              width: 12,
              height: 12,
              border: '2px solid #64748b',
              borderTopColor: 'transparent',
              borderRadius: '50%',
              display: 'inline-block',
            }}
          />
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <div className="flex w-full" style={{ display: 'flex', width: '100%', gap: 8, marginBottom: 12 }}>
        {TABS.map((item) => {
          const selected = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className="flex-1"
              onClick={() => setTab(item.id)}
              style={{
                flex: 1,
                border: 'none',
                background: selected ? item.active : item.idle,
                color: selected ? item.activeText : item.idleText,
                fontWeight: 800,
                fontSize: 18,
                padding: '16px 12px',
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {loading ? <p style={{ fontSize: 13, color: '#334155' }}>Loading sheet…</p> : null}
      {!loading && tab === 'overview' ? (
        <DocTaskOverview rows={overview} />
      ) : null}
      {!loading && tab === 'workflow' ? (
        <DocTaskWorkflow
          rows={active}
          editable={role === 'maker'}
          editorEmpId={actorEmpId}
          canAssign={canLead}
          canDelete={false}
          canDeleteQuotation={false}
          advanceMode={role === 'maker' ? 'maker' : (canLead ? 'lead' : 'none')}
          canEditNextUpdate={role === 'maker' || canLead}
          assignees={assignees}
          onPatch={onPatch}
          onAssign={onAssign}
          onDelete={onDelete}
        />
      ) : null}
      {!loading && tab === 'completed' ? (
        <DocTaskCompleted
          rows={completed}
          advanceMode={role === 'maker' ? 'maker' : (canLead ? 'lead' : 'none')}
          onPatch={onPatch}
        />
      ) : null}
    </div>
  );
}

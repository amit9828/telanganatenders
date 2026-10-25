'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { staffHeaders } from '@/components/workflow/api';
import DocTaskOverview from '@/components/doc-team/DocTaskOverview';
import DocTaskWorkflow from '@/components/doc-team/DocTaskWorkflow';
import DocTaskCompleted from '@/components/doc-team/DocTaskCompleted';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'completed', label: 'Completed' },
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

export default function DocTeamWorkspace({ role = 'maker', actorEmpId = '' }) {
  const [tab, setTab] = useState('overview');
  const [tasks, setTasks] = useState([]);
  const [summary, setSummary] = useState(null);
  const [assignees, setAssignees] = useState([]);
  const [loading, setLoading] = useState(true);
  const canLead = role === 'gm' || role === 'tl';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await docFetch('/api/doc-tasks');
      setTasks(data.tasks || []);
      setSummary(data.summary || null);
      if (canLead) {
        const staff = await docFetch('/api/doc-tasks?view=assignees');
        setAssignees(staff.assignees || []);
      }
    } catch (err) {
      toast.error(err.message || 'Could not load the doc team sheet.');
    } finally {
      setLoading(false);
    }
  }, [canLead]);

  useEffect(() => { load(); }, [load]);

  const replaceTask = (task) => {
    setTasks((current) => {
      const next = current.some((row) => row.id === task.id)
        ? current.map((row) => (row.id === task.id ? task : row))
        : current;
      return next;
    });
  };

  const reloadSummary = async () => {
    const data = await docFetch('/api/doc-tasks?view=summary');
    setSummary(data);
  };

  const onPatch = async (row, patch) => {
    try {
      const data = await docFetch(`/api/doc-tasks/${row.id}`, { method: 'PUT', body: JSON.stringify(patch) });
      setTasks((current) => (
        data.deleted
          ? current.filter((item) => item.id !== row.id)
          : current.map((item) => (item.id === row.id ? data.task : item))
      ));
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
      setTasks((current) => current.filter((item) => item.id !== row.id));
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
        <button type="button" onClick={load} style={{ border: '1px solid #64748b', background: '#fff', padding: '2px 8px', fontWeight: 700 }}>
          Refresh
        </button>
      </div>
      <div style={{ display: 'flex', gap: 0, marginBottom: 8 }}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            style={{
              border: '1px solid #64748b',
              borderBottom: tab === item.id ? '1px solid #fff' : '1px solid #64748b',
              background: tab === item.id ? '#fff' : '#e2e8f0',
              fontWeight: 700,
              padding: '6px 14px',
              marginBottom: -1,
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {loading ? <p style={{ fontSize: 13, color: '#334155' }}>Loading sheet…</p> : null}
      {!loading && tab === 'overview' ? (
        <DocTaskOverview rows={tasks} />
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
          assignees={assignees}
          onPatch={onPatch}
          onAssign={onAssign}
          onDelete={onDelete}
          onDateError={(message) => toast.error(message)}
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

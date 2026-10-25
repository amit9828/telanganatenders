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

export default function DocTeamWorkspace({ role = 'maker' }) {
  const [tab, setTab] = useState('overview');
  const [tasks, setTasks] = useState([]);
  const [summary, setSummary] = useState({ pending: 0, active: 0, completed: 0 });
  const [assignees, setAssignees] = useState([]);
  const [loading, setLoading] = useState(true);
  const canLead = role === 'gm' || role === 'tl';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await docFetch('/api/doc-tasks');
      setTasks(data.tasks || []);
      setSummary(data.summary || { pending: 0, active: 0, completed: 0 });
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

  const refreshSummary = (rows) => {
    const counts = { pending: 0, active: 0, completed: 0 };
    for (const row of rows) {
      if (row.status === 'Completed') counts.completed += 1;
      else if (row.status === 'Under Preparation') counts.active += 1;
      else counts.pending += 1;
    }
    setSummary(counts);
  };

  const onPatch = async (row, patch) => {
    try {
      const data = await docFetch(`/api/doc-tasks/${row.id}`, { method: 'PUT', body: JSON.stringify(patch) });
      setTasks((current) => {
        const next = current.map((item) => (item.id === row.id ? data.task : item));
        refreshSummary(next);
        return next;
      });
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
      setTasks((current) => {
        const next = current.filter((item) => item.id !== row.id);
        refreshSummary(next);
        return next;
      });
    } catch (err) {
      toast.error(err.message || 'Delete failed.');
    }
  };

  const completed = tasks.filter((row) => row.status === 'Completed');
  const active = tasks.filter((row) => row.status !== 'Completed');

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 8, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
        <span>Pending {summary.pending}</span>
        <span>Active {summary.active}</span>
        <span>Completed {summary.completed}</span>
        <button type="button" onClick={load} style={{ marginLeft: 'auto', border: '1px solid #64748b', background: '#fff', padding: '2px 8px', fontWeight: 700 }}>
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
        <DocTaskOverview rows={tasks} canDelete={canLead} onDelete={onDelete} />
      ) : null}
      {!loading && tab === 'workflow' ? (
        <DocTaskWorkflow
          rows={active}
          editable={role === 'maker'}
          canAssign={canLead}
          canDelete={canLead}
          assignees={assignees}
          onPatch={onPatch}
          onAssign={onAssign}
          onDelete={onDelete}
          onDateError={(message) => toast.error(message)}
        />
      ) : null}
      {!loading && tab === 'completed' ? (
        <DocTaskCompleted rows={completed} canDelete={canLead} onDelete={onDelete} />
      ) : null}
    </div>
  );
}

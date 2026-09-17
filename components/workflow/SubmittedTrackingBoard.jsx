'use client';

import CompactTenderCard from '@/components/workflow/CompactTenderCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { workflowFetch, openWorkflowFile } from '@/components/workflow/api';
import { workflowDocActions, mdDeleteCardAction } from '@/components/workflow/jobDocActions';
import { TRACKING_LABELS, normalizeTrackingStatus } from '@/lib/tracking-status';

const DROPDOWN_STAGES = [
  TRACKING_LABELS.TECHNICAL_EVALUATION,
  TRACKING_LABELS.FINANCIAL_EVALUATION,
  TRACKING_LABELS.WON,
  TRACKING_LABELS.LOST,
];

export default function SubmittedTrackingBoard({
  jobs = [],
  actorEmpId = '',
  onRefresh,
  canDelete = false,
}) {
  const update = async (job, tracking_status) => {
    try {
      await workflowFetch(`/api/workflow/jobs/${job._id}/tracking`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracking_status }),
      });
      toast.success(tracking_status === 'Lost' ? 'Moved to archive.' : `Updated to ${tracking_status}`);
      onRefresh?.();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const deleteCard = async (job) => {
    const name = job.bid_no || job.title || 'this card';
    if (!window.confirm(`Delete ${name}? It is removed from every board. This cannot be undone.`)) return;
    try {
      await workflowFetch(`/api/workflow/jobs/${job._id}`, { method: 'DELETE' });
      toast.success('Card deleted.');
      onRefresh?.();
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="font-bold text-[#0A2647]">Submitted tracking</h3>
      {jobs.length === 0 && <p className="text-sm text-slate-400">No submitted tenders.</p>}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {jobs.map((job) => {
          const stage = normalizeTrackingStatus(job.tracking_status);
          const canEdit = Boolean(actorEmpId) && String(job.assigned_emp_id || '') === String(actorEmpId);
          return (
            <div key={job._id} className="space-y-2">
              <CompactTenderCard
                job={{ ...job, display_status: stage || job.display_status || 'Submitted' }}
                actions={[
                  ...workflowDocActions(job, (docJob, slot) => openWorkflowFile(docJob._id, slot).catch((err) => toast.error(err.message || 'Could not open file'))),
                  canDelete && mdDeleteCardAction(job, deleteCard),
                ].filter(Boolean)}
              />
              {canEdit ? (
                <Select value={stage || undefined} onValueChange={(v) => update(job, v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Set tracking status" /></SelectTrigger>
                  <SelectContent>
                    {DROPDOWN_STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-[11px] text-slate-500 px-1">
                  {stage || job.display_status || 'Submitted'} · read-only
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

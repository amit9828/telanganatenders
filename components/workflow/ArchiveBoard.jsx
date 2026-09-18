'use client';

import CompactTenderCard from '@/components/workflow/CompactTenderCard';
import { toast } from 'sonner';
import { workflowFetch, openWorkflowFile } from '@/components/workflow/api';
import { workflowDocActions, mdDeleteCardAction } from '@/components/workflow/jobDocActions';

export default function ArchiveBoard({ jobs = [], canDelete = false, onRefresh, onRemoveJob }) {
  const deleteCard = async (job) => {
    const name = job.bid_no || job.title || 'this card';
    if (!window.confirm(`Delete ${name}? It is removed from every board. This cannot be undone.`)) return;
    const snapshot = job;
    onRemoveJob?.(job._id);
    try {
      await workflowFetch(`/api/workflow/jobs/${job._id}`, { method: 'DELETE' });
      toast.success('Card deleted.');
    } catch (e) {
      onRefresh?.();
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-3">
      <h3 className="font-bold text-[#0A2647]">Archive</h3>
      <p className="text-xs text-slate-500">Lost jobs copied into the archive desk after they leave the live board.</p>
      {jobs.length === 0 && <p className="text-sm text-slate-400">No archived jobs.</p>}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {jobs.map((job) => (
          <CompactTenderCard
            key={job._id}
            job={{ ...job, display_status: job.archive_reason || 'Lost' }}
            actions={[
              ...workflowDocActions(job, (docJob, slot) => openWorkflowFile(docJob._id, slot).catch((err) => toast.error(err.message || 'Could not open file'))),
              canDelete && mdDeleteCardAction(job, deleteCard),
            ].filter(Boolean)}
          />
        ))}
      </div>
    </div>
  );
}

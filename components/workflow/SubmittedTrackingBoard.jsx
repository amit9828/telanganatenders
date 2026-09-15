'use client';

import { useState } from 'react';
import CompactTenderCard from '@/components/workflow/CompactTenderCard';
import StaffChat from '@/components/StaffChat';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { workflowFetch, openWorkflowFile } from '@/components/workflow/api';

const STAGES = ['Submitted', 'Technical Evaluation', 'Financial Evaluation', 'Won', 'Lost'];

export default function SubmittedTrackingBoard({ jobs = [], canEdit, onRefresh, chatSelfId, chatRoster = [] }) {
  const [chatJobId, setChatJobId] = useState(null);
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

  return (
    <div className="space-y-3">
      <h3 className="font-bold text-[#0A2647]">Submitted tracking</h3>
      {jobs.length === 0 && <p className="text-sm text-slate-400">No submitted tenders.</p>}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {jobs.map((job) => (
          <div key={job._id} className="space-y-2">
            <CompactTenderCard
              job={{ ...job, display_status: job.tracking_status || job.display_status || 'Submitted' }}
              actions={[
                { label: 'View SOW', icon: 'eye', onClick: () => openWorkflowFile(job._id, 'sow') },
                job.receipt && { label: 'Receipt', icon: 'download', onClick: () => openWorkflowFile(job._id, 'receipt') },
                chatSelfId && { label: 'Chat', onClick: () => setChatJobId((id) => id === job._id ? null : job._id) },
              ].filter(Boolean)}
            />
            {chatJobId === job._id && chatSelfId && (
              <StaffChat selfId={chatSelfId} roster={chatRoster} jobId={job._id} />
            )}
            {canEdit ? (
              <Select value={job.tracking_status || 'Submitted'} onValueChange={(v) => update(job, v)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-[11px] text-slate-500 px-1">Read-only for MD / Client</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

'use client';

import CompactTenderCard from '@/components/workflow/CompactTenderCard';
import { openWorkflowFile } from '@/components/workflow/api';

export default function ArchiveBoard({ jobs = [] }) {
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
              job.sow && { label: 'View SOW', icon: 'eye', onClick: () => openWorkflowFile(job._id, 'sow') },
              job.receipt && { label: 'Receipt', icon: 'download', onClick: () => openWorkflowFile(job._id, 'receipt') },
            ].filter(Boolean)}
          />
        ))}
      </div>
    </div>
  );
}

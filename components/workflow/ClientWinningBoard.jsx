'use client';

import CompactTenderCard from '@/components/workflow/CompactTenderCard';

export default function ClientWinningBoard({ jobs = [] }) {
  const won = jobs.filter((j) => j.status === 'WON' || j.display_status === 'Won');
  return (
    <div className="space-y-3">
      <h3 className="font-bold text-[#0A2647]">Winning board</h3>
      {won.length === 0 && <p className="text-sm text-slate-400">No won tenders yet.</p>}
      <div className="grid sm:grid-cols-2 gap-3">
        {won.map((job) => (
          <CompactTenderCard
            key={job._id}
            job={job}
            actions={[
              { label: 'View SOW', icon: 'eye', onClick: () => window.open(`/api/workflow/jobs/${job._id}/file?slot=sow`, '_blank') },
              job.receipt && { label: 'Receipt', icon: 'download', onClick: () => window.open(`/api/workflow/jobs/${job._id}/file?slot=receipt`, '_blank') },
            ].filter(Boolean)}
          />
        ))}
      </div>
    </div>
  );
}

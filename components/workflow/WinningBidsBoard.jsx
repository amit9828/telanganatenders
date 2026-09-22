'use client';

import CompactTenderCard, { TrackingProgressBar } from '@/components/workflow/CompactTenderCard';

function clientGroupName(job) {
  return job.client_name || job.company_name || job.client_email || 'Unknown client';
}

export default function WinningBidsBoard({
  jobs = [],
  showClientName = true,
  barStages,
  activeLabelFor,
  actionsFor,
}) {
  const won = (jobs || []).filter((job) => job.status === 'WON' || job.display_status === 'Won');

  const renderCard = (job, { showName, showDrive }) => {
    const driveLink = showDrive ? (job.drive_bid_folder_link || '') : '';
    const activeLabel = activeLabelFor ? activeLabelFor(job) : undefined;
    const docActions = !showClientName && actionsFor ? actionsFor(job) : [];
    const driveAction = driveLink ? [{
      label: 'Open Drive folder',
      icon: 'file',
      onClick: () => window.open(driveLink, '_blank', 'noopener,noreferrer'),
    }] : [];
    return (
      <CompactTenderCard
        key={job._id}
        job={job}
        showClientName={showName}
        showWinBadge
        progress={(
          <TrackingProgressBar
            job={job}
            stages={barStages}
            activeLabel={activeLabel}
          />
        )}
        actions={[...docActions, ...driveAction]}
      />
    );
  };

  let body = null;
  if (won.length === 0) {
    body = <p className="text-sm text-slate-400">No won tenders yet.</p>;
  } else if (showClientName) {
    const groups = new Map();
    won.forEach((job) => {
      const name = clientGroupName(job);
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(job);
    });
    const names = [...groups.keys()].sort((a, b) => a.localeCompare(b));
    body = (
      <div className="space-y-5">
        {names.map((name) => (
          <section key={name} className="space-y-2">
            <h4 className="text-sm font-bold text-[#0A2647] border-b border-slate-200 pb-1">{name}</h4>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {groups.get(name).map((job) => renderCard(job, { showName: false, showDrive: true }))}
            </div>
          </section>
        ))}
      </div>
    );
  } else {
    body = (
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {won.map((job) => renderCard(job, { showName: false, showDrive: false }))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="font-bold text-[#0A2647]">Winning bids</h3>
      {body}
    </div>
  );
}

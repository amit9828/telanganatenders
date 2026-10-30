'use client';

import { memo, useState } from 'react';
import CompactTenderCard, { TrackingProgressBar } from '@/components/workflow/CompactTenderCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { workflowFetch } from '@/components/workflow/api';
import { mdDeleteCardAction } from '@/components/workflow/jobDocActions';
import { TRACKING_LABELS, currentTrackingStage, laterTrackingStages } from '@/lib/tracking-status';

function clientGroupName(job) {
  return job.client_name || job.company_name || job.client_email || 'Unknown client';
}

function clientSections(jobs) {
  const groups = new Map();
  jobs.forEach((job) => {
    const name = clientGroupName(job);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(job);
  });
  return [...groups.keys()].sort((a, b) => a.localeCompare(b)).map((name) => [name, groups.get(name)]);
}

function SubmittedTrackingBoard({
  jobs = [],
  actorEmpId = '',
  onPatchJob,
  onRemoveJob,
  onArchiveJob,
  canDelete = false,
}) {
  const [busyId, setBusyId] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [outcomeJob, setOutcomeJob] = useState(null);
  const [l1Price, setL1Price] = useState('');

  const commit = async (job, tracking_status, extra = {}) => {
    setBusyId(job._id);
    try {
      const data = await workflowFetch(`/api/workflow/jobs/${job._id}/tracking`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracking_status, ...extra }),
      });
      if (data?.archived) {
        onRemoveJob?.(job._id);
        onArchiveJob?.({ ...job, archive_reason: 'Lost' });
        toast.success('Moved to archive.');
      } else if (data?.job) {
        onPatchJob?.(data.job);
        toast.success(tracking_status === TRACKING_LABELS.WON ? 'Moved to winning bids.' : `Updated to ${tracking_status}`);
      }
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusyId('');
    }
  };

  const deleteCard = async (job) => {
    const name = job.bid_no || job.title || 'this card';
    if (!window.confirm(`Delete ${name}? It is removed from every board. This cannot be undone.`)) return;
    setBusyId(job._id);
    try {
      await workflowFetch(`/api/workflow/jobs/${job._id}`, { method: 'DELETE' });
      onRemoveJob?.(job._id);
      toast.success('Card deleted.');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusyId('');
    }
  };

  const acceptConfirm = () => {
    const pending = confirm;
    setConfirm(null);
    if (!pending) return;
    if (pending.target === 'result') {
      setOutcomeJob(pending.job);
      return;
    }
    commit(pending.job, pending.target);
  };

  return (
    <div className="space-y-3">
      <h3 className="font-bold text-[#0A2647]">Submitted tracking</h3>
      {jobs.length === 0 && <p className="text-sm text-slate-400">No submitted tenders.</p>}
      {jobs.length > 0 && (
        <div className="space-y-5">
          {clientSections(jobs).map(([name, clientJobs]) => (
            <section key={name} className="space-y-2">
              <h4 className="text-sm font-bold text-[#0A2647] border-b border-slate-200 pb-1">{name}</h4>
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {clientJobs.map((job) => {
                  const stage = currentTrackingStage(job) || TRACKING_LABELS.SUBMITTED;
                  const me = String(actorEmpId || '');
                  const canEdit = Boolean(me) && (
                    String(job.assigned_emp_id || '') === me
                    || (job.tracking_editors || []).map(String).includes(me)
                  );
                  const awarded = stage === TRACKING_LABELS.BID_AWARDED;
                  const later = awarded ? [] : laterTrackingStages(stage);
                  const cardBusy = busyId === job._id;
                  const driveLink = job.drive_bid_folder_link || '';
                  return (
                    <div key={job._id} className={`space-y-2 ${cardBusy ? 'opacity-70' : ''}`}>
                      <CompactTenderCard
                        job={{ ...job, display_status: stage }}
                        progress={<TrackingProgressBar job={{ ...job, tracking_status: stage }} />}
                        actions={[
                          driveLink && { label: 'Open Drive folder', icon: 'file', onClick: () => window.open(driveLink, '_blank', 'noopener,noreferrer') },
                          canDelete && mdDeleteCardAction(job, deleteCard),
                        ].filter(Boolean)}
                      />
                      {canEdit && awarded ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 w-full text-xs"
                          disabled={cardBusy}
                          onClick={() => setConfirm({ job, target: 'result' })}
                        >
                          Record result
                        </Button>
                      ) : canEdit && later.length > 0 ? (
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">Update stage</p>
                          <div className="flex flex-wrap gap-1.5">
                            {later.map((target) => (
                              <Button
                                key={target}
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-8 flex-1 min-w-[7rem] text-xs"
                                disabled={cardBusy}
                                onClick={() => setConfirm({ job, target })}
                              >
                                {target}
                              </Button>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500 px-1">{stage} · read-only</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <AlertDialog open={Boolean(confirm)} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update status?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.target === 'result'
                ? 'Are you sure you want to record the result for this bid?'
                : `Are you sure you want to update the status to ${confirm?.target || ''}?`}
              {confirm?.job ? ` (${confirm.job.bid_no || confirm.job.title || 'this bid'})` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={acceptConfirm}>Yes, confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={Boolean(outcomeJob)} onOpenChange={(open) => { if (!open) { setOutcomeJob(null); setL1Price(''); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bid Awarded</AlertDialogTitle>
            <AlertDialogDescription>
              Select Win or Loss. Win moves the bid to Winning Bids and needs the L1 price. Loss moves it to the archive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            type="number"
            min="1"
            inputMode="decimal"
            placeholder="L1 Price (winning bid amount)"
            value={l1Price}
            onChange={(e) => setL1Price(e.target.value)}
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                const job = outcomeJob;
                setOutcomeJob(null);
                setL1Price('');
                if (job) commit(job, TRACKING_LABELS.LOST);
              }}
            >
              Loss
            </AlertDialogAction>
            <AlertDialogAction
              className="bg-emerald-600 hover:bg-emerald-700"
              disabled={!(Number(l1Price) > 0)}
              onClick={() => {
                const price = Number(l1Price);
                if (!(price > 0)) return;
                const job = outcomeJob;
                setOutcomeJob(null);
                setL1Price('');
                if (job) commit(job, TRACKING_LABELS.WON, { l1_price: price });
              }}
            >
              Win
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default memo(SubmittedTrackingBoard);

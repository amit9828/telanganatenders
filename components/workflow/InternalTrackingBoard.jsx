'use client';

import { memo, useMemo, useState } from 'react';
import CompactTenderCard from '@/components/workflow/CompactTenderCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Lock } from 'lucide-react';
import { workflowFetch, openWorkflowFile } from '@/components/workflow/api';
import { workflowDocActions, mdDeleteCardAction } from '@/components/workflow/jobDocActions';
import { canViewPrepFiles, prepLockLabel, viewerFromDesk } from '@/lib/prep-access';

const STATUS_LABEL = {
  MD_CHECKLIST: 'MD Checklist',
  TL_ASSIGN: 'TL Assign',
  MAKER_PREP: 'Employee Prep',
  TL_QC: 'TL QC',
  GM_QC: 'GM QC',
  MD_SUBMIT: 'Ready to Submit',
  AWAITING_RECEIPT: 'Awaiting Receipt',
};

const MD_TEAM_STATUSES = ['TL_ASSIGN', 'MAKER_PREP', 'TL_QC', 'GM_QC'];

function jobId(job) {
  return String(job?._id || job?.id || '');
}

function partitionInternalJobs(jobs = [], desk, actorEmpId = '') {
  const list = Array.isArray(jobs) ? jobs : [];
  const unused = (used) => {
    const seen = new Set(used.map(jobId).filter(Boolean));
    return list.filter((job) => {
      const id = jobId(job);
      return !id || !seen.has(id);
    });
  };

  if (desk === 'md') {
    const checklist = list.filter((job) => job.status === 'MD_CHECKLIST');
    const ready = list.filter((job) => job.status === 'MD_SUBMIT' || job.status === 'AWAITING_RECEIPT');
    const team = list.filter((job) => MD_TEAM_STATUSES.includes(job.status));
    return [
      { title: 'Waiting for MD Checklist', items: checklist },
      { title: 'Ready to Submit', items: ready },
      { title: 'Pending at Team Members', items: [...team, ...unused([...checklist, ...ready, ...team])] },
    ];
  }

  if (desk === 'gm') {
    const qc = list.filter((job) => job.status === 'GM_QC');
    return [
      { title: 'Waiting for GM QC', items: qc },
      { title: 'Pending in Team', items: unused(qc) },
    ];
  }

  if (desk === 'tl') {
    const mine = list.filter((job) => job.status === 'TL_ASSIGN' || job.status === 'TL_QC');
    return [
      { title: 'Waiting for TL QC / Work Assigning', items: mine },
      { title: 'Pending at Team Members', items: unused(mine) },
    ];
  }

  if (desk === 'employee') {
    const mine = list.filter((job) => (
      job.status === 'MAKER_PREP' && String(job.assigned_emp_id || '') === String(actorEmpId || '')
    ));
    return [
      { title: 'My Pending Tasks / Incomplete Document Prep', items: mine },
      { title: 'Pending at Other Team Members', items: unused(mine) },
    ];
  }

  return [{ title: 'All jobs', items: list }];
}

function InternalTrackingBoard({
  desk,
  tls = [],
  members = [],
  team = [],
  onRefresh,
  onPatchJob,
  onRemoveJob,
  jobs = [],
  actorEmpId = '',
}) {
  const [checklistJob, setChecklistJob] = useState(null);
  const [checklistFile, setChecklistFile] = useState(null);
  const [tlId, setTlId] = useState('');
  const [makerJob, setMakerJob] = useState(null);
  const [makerId, setMakerId] = useState('');
  const [receiptJob, setReceiptJob] = useState(null);
  const [receiptFile, setReceiptFile] = useState(null);
  const [bounceJob, setBounceJob] = useState(null);
  const [bounceMode, setBounceMode] = useState('');
  const [bounceSlots, setBounceSlots] = useState([]);
  const [bounceNote, setBounceNote] = useState('');
  const [busyId, setBusyId] = useState('');

  const applyResult = (job, data) => {
    if (data?.job) onPatchJob?.(data.job);
    else if (data?.archived) onRemoveJob?.(job._id);
  };

  const run = async (job, fn, { optimistic, remove } = {}) => {
    const snapshot = job;
    setBusyId(job._id);
    if (remove) onRemoveJob?.(job._id);
    else if (optimistic) onPatchJob?.({ ...job, ...optimistic });
    try {
      const data = await fn();
      applyResult(job, data);
      return data;
    } catch (e) {
      if (remove || optimistic) onPatchJob?.(snapshot);
      toast.error(e.message);
      return null;
    } finally {
      setBusyId('');
    }
  };

  const openFile = (job, slot) => openWorkflowFile(job._id, slot).catch((err) => toast.error(err.message || 'Could not open file'));
  const makerTeamKeys = [makerJob?.team_id, makerJob?.routed_tl_emp_id, desk === 'tl' ? actorEmpId : '']
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const makerOptions = members.filter((m) => makerTeamKeys.includes(String(m.team_id || '').trim()));

  const submitChecklist = async () => {
    if (!checklistFile) return toast.error('Upload the checklist PDF. Typed items are not allowed.');
    if (!tlId) return toast.error('Select a Team Lead.');
    const job = checklistJob;
    const form = new FormData();
    form.append('checklist', checklistFile);
    form.append('routed_tl_emp_id', tlId);
    const data = await run(job, () => workflowFetch(`/api/workflow/jobs/${job._id}/checklist`, { method: 'PUT', body: form }), {
      optimistic: { status: 'TL_ASSIGN', routed_tl_emp_id: tlId },
    });
    if (!data) return;
    toast.success('Checklist uploaded and routed to TL.');
    setChecklistJob(null);
    setChecklistFile(null);
    setTlId('');
  };

  const deleteCard = (job) => {
    const name = job.bid_no || job.title || 'this card';
    if (!window.confirm(`Delete ${name}? It is removed from every board. This cannot be undone.`)) return;
    return run(job, async () => {
      await workflowFetch(`/api/workflow/jobs/${job._id}`, { method: 'DELETE' });
      toast.success('Card deleted.');
      return { archived: true };
    }, { remove: true });
  };

  const assignMaker = async () => {
    if (!makerId) return toast.error('Select an employee in your team.');
    const job = makerJob;
    const member = makerOptions.find((m) => m.emp_id === makerId);
    const data = await run(job, () => workflowFetch(`/api/workflow/jobs/${job._id}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'assign_maker', assigned_emp_id: makerId }),
    }), {
      optimistic: {
        status: 'MAKER_PREP',
        assigned_emp_id: makerId,
        assigned_emp_name: member?.name || makerId,
      },
    });
    if (!data) return;
    toast.success('Employee assigned.');
    setMakerJob(null);
  };

  const confirmReceipt = async () => {
    if (!receiptFile) return toast.error('Submission Receipt PDF is required.');
    const job = receiptJob;
    const form = new FormData();
    form.append('action', 'confirm_receipt');
    form.append('receipt', receiptFile);
    form.append('kind', 'receipt');
    const data = await run(job, () => workflowFetch(`/api/workflow/jobs/${job._id}/advance`, { method: 'POST', body: form }));
    if (!data) return;
    toast.success('Drive pack uploaded. Status is Submitted.');
    setReceiptJob(null);
    setReceiptFile(null);
  };

  const openTlBounce = (job) => {
    setBounceMode('tl');
    setBounceJob(job);
    setBounceSlots([]);
    setBounceNote('');
  };

  const openGmBounce = (job) => {
    setBounceMode('gm');
    setBounceJob(job);
    setBounceSlots([]);
    setBounceNote('');
  };

  const toggleBounceSlot = (slot) => {
    setBounceSlots((prev) => (prev.includes(slot) ? prev.filter((s) => s !== slot) : [...prev, slot]));
  };

  const submitBounce = async () => {
    const note = bounceNote.trim();
    if (!note) return toast.error('A bounce note is required.');
    const job = bounceJob;
    if (bounceMode === 'tl') {
      if ((job.prep_files || []).length && bounceSlots.length === 0) {
        return toast.error('Select at least one file to bounce.');
      }
      const data = await run(job, () => workflowFetch(`/api/workflow/jobs/${job._id}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bounce', slots: bounceSlots, note }),
      }), { optimistic: { status: 'MAKER_PREP', bounce_note: note, bounced_slots: bounceSlots } });
      if (!data) return;
      toast.success('Bounced to employee.');
    } else {
      const data = await run(job, () => workflowFetch(`/api/workflow/jobs/${job._id}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'gm_bounce', note }),
      }), { optimistic: { status: 'TL_QC', bounce_note: note } });
      if (!data) return;
      toast.success('Bounced to TL.');
    }
    setBounceJob(null);
    setBounceNote('');
    setBounceSlots([]);
  };

  const sections = useMemo(() => partitionInternalJobs(jobs, desk, actorEmpId), [jobs, desk, actorEmpId]);

  const uploadPrepFile = async (job, file, slot) => {
    const form = new FormData();
    form.append('file', file);
    form.append('slot', slot);
    form.append('kind', 'final');
    return workflowFetch(`/api/workflow/jobs/${job._id}/files`, { method: 'POST', body: form });
  };

  const renderJobCard = (job) => {
    const cardBusy = busyId === job._id;
    const viewer = viewerFromDesk(desk, actorEmpId);
    const prepOpen = canViewPrepFiles(viewer, job);
    const prepLock = prepLockLabel(job.status);
    const actions = [
      ...workflowDocActions(job, openFile, viewer),
    ];
    if (desk === 'md' && job.status === 'MD_CHECKLIST') {
      actions.push({ label: 'Upload checklist + TL', variant: 'default', icon: 'upload', disabled: cardBusy, onClick: () => setChecklistJob(job) });
    }
    if ((desk === 'tl' || desk === 'md') && job.status === 'TL_ASSIGN') {
      actions.push({ label: 'Assign employee', variant: 'default', disabled: cardBusy, onClick: () => { setMakerId(''); setMakerJob(job); } });
    }
    if (desk === 'employee' && job.status === 'MAKER_PREP') {
      actions.push({
        label: cardBusy ? 'Sending…' : 'Send to TL',
        variant: 'default',
        disabled: cardBusy || (job.prep_files || []).length < 2,
        onClick: () => {
          if ((job.prep_files || []).length < 2) return toast.error('Upload at least 2 files before sending to TL.');
          return run(job, () => workflowFetch(`/api/workflow/jobs/${job._id}/advance`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'send_tl' }),
          }), { optimistic: { status: 'TL_QC' } });
        },
      });
    }
    if (desk === 'tl' && job.status === 'TL_QC') {
      actions.push({
        label: cardBusy ? 'Sending…' : 'Pass to GM',
        variant: 'default',
        disabled: cardBusy,
        onClick: () => run(job, () => workflowFetch(`/api/workflow/jobs/${job._id}/advance`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'send_gm' }),
        }), { optimistic: { status: 'GM_QC' } }),
      });
      actions.push({
        label: 'Bounce',
        disabled: cardBusy,
        onClick: () => openTlBounce(job),
      });
    }
    if (desk === 'gm' && job.status === 'GM_QC') {
      actions.push({
        label: cardBusy ? 'Sending…' : 'Send to MD',
        variant: 'default',
        disabled: cardBusy,
        onClick: () => run(job, () => workflowFetch(`/api/workflow/jobs/${job._id}/advance`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'send_md' }),
        }), { optimistic: { status: 'MD_SUBMIT' } }),
      });
      actions.push({
        label: 'Bounce',
        disabled: cardBusy,
        onClick: () => openGmBounce(job),
      });
    }
    if (desk === 'md' && job.status === 'MD_SUBMIT') {
      actions.push({
        label: cardBusy ? 'Submitting…' : 'Submit Tender',
        variant: 'default',
        disabled: cardBusy,
        onClick: () => run(job, async () => {
          const data = await workflowFetch(`/api/workflow/jobs/${job._id}/advance`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'submit_tender' }),
          });
          setReceiptJob(data?.job || { ...job, status: 'AWAITING_RECEIPT' });
          return data;
        }, { optimistic: { status: 'AWAITING_RECEIPT' } }),
      });
    }
    if (desk === 'md' && job.status === 'AWAITING_RECEIPT') {
      actions.push({
        label: cardBusy ? 'Uploading pack…' : 'Receipt + Drive',
        icon: 'upload',
        variant: 'default',
        disabled: cardBusy,
        onClick: () => setReceiptJob(job),
      });
    }
    if (desk === 'md') {
      const del = mdDeleteCardAction(job, deleteCard);
      if (del) actions.push({ ...del, disabled: cardBusy || del.disabled });
    }
    return (
      <div key={job._id} className={cardBusy ? 'opacity-70 pointer-events-none' : ''}>
        <CompactTenderCard
          job={{ ...job, display_status: STATUS_LABEL[job.status] || job.status }}
          showClientName
          actions={actions}
        />
        {job.bounce_note && (job.status === 'MAKER_PREP' || job.status === 'TL_QC') && (
          <p className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5">
            Bounce note: {job.bounce_note}
          </p>
        )}
        {desk === 'employee' && job.status === 'MAKER_PREP' && (
          <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3 space-y-2">
            <p className="text-[11px] font-black text-[#0A2647] uppercase tracking-wide">Additional Documentations</p>
            <p className="text-[10px] text-slate-500">
              Upload at least 2 files before Send to TL. {(job.prep_files || []).length} stored.
            </p>
            {(job.prep_files || []).length > 0 && (
              <ul className="space-y-1">
                {(job.prep_files || []).map((f, i) => {
                  const bounced = (job.bounced_slots || []).includes(f.slot);
                  return (
                  <li key={f.slot || i} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className={`truncate min-w-0 ${bounced ? 'text-red-700 font-semibold' : ''}`}>
                      {f.name || f.slot || `File ${i + 1}`}{bounced ? ' (bounced)' : ''}
                    </span>
                    <span className="flex items-center shrink-0">
                      {bounced && (
                        <label className={`h-6 px-2 inline-flex items-center text-[10px] font-semibold text-red-700 cursor-pointer ${cardBusy ? 'opacity-50 pointer-events-none' : ''}`}>
                          Replace
                          <input
                            type="file"
                            accept="application/pdf"
                            className="sr-only"
                            disabled={cardBusy}
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (!file || !f.slot) return;
                              setBusyId(job._id);
                              try {
                                const data = await uploadPrepFile(job, file, f.slot);
                                if (data?.job) onPatchJob?.(data.job);
                                toast.success('Replaced the bounced file.');
                              } catch (err) {
                                toast.error(err.message);
                                onRefresh?.();
                              } finally {
                                setBusyId('');
                              }
                            }}
                          />
                        </label>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px] shrink-0"
                        disabled={!prepOpen}
                        title={prepOpen ? 'View' : prepLock}
                        onClick={() => { if (prepOpen) openFile(job, f.slot); }}
                      >
                        {prepOpen ? 'View' : <><Lock className="w-3 h-3 mr-1" />{prepLock}</>}
                      </Button>
                    </span>
                  </li>
                  );
                })}
              </ul>
            )}
            <label className={`flex items-center justify-center h-9 rounded-md border border-dashed border-emerald-300 bg-emerald-50 text-[11px] font-bold text-emerald-800 cursor-pointer ${cardBusy ? 'opacity-50 pointer-events-none' : ''}`}>
              Add files
              <input
                type="file"
                multiple
                accept="application/pdf"
                className="sr-only"
                disabled={cardBusy}
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  e.target.value = '';
                  if (!files.length) return;
                  setBusyId(job._id);
                  try {
                    let latest = job;
                    for (const file of files) {
                      const bouncedIds = new Set((latest.bounced_slots || []).map(String));
                      const nextBounced = (latest.prep_files || []).find((row) => bouncedIds.has(String(row.slot)));
                      const slot = nextBounced?.slot || `slot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                      const data = await uploadPrepFile(latest, file, slot);
                      if (data?.job) latest = data.job;
                    }
                    onPatchJob?.(latest);
                    toast.success(`${files.length} file${files.length === 1 ? '' : 's'} stored.`);
                  } catch (err) {
                    toast.error(err.message);
                    onRefresh?.();
                  } finally {
                    setBusyId('');
                  }
                }}
              />
            </label>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <h3 className="font-bold text-[#0A2647]">Internal tracking</h3>
      {jobs.length === 0 && <p className="text-sm text-slate-400">No jobs in the internal pipeline.</p>}
      {sections.map((section) => (
        <div key={section.title} className="space-y-2">
          <h4 className="text-sm font-semibold text-[#0A2647]">{section.title}</h4>
          {section.items.length === 0 ? (
            <p className="text-sm text-slate-400">None right now</p>
          ) : (
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              {section.items.map(renderJobCard)}
            </div>
          )}
        </div>
      ))}

      <Dialog open={!!checklistJob} onOpenChange={() => setChecklistJob(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Checklist PDF + Team Lead</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Checklist document *</Label>
              <input type="file" accept="application/pdf" className="mt-1 block w-full text-sm" onChange={(e) => setChecklistFile(e.target.files?.[0] || null)} />
            </div>
            <div>
              <Label>Route to TL *</Label>
              <Select value={tlId} onValueChange={setTlId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select TL" /></SelectTrigger>
                <SelectContent>
                  {tls.map((t) => <SelectItem key={t.emp_id} value={t.emp_id}>{t.name} ({t.emp_id})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={submitChecklist} disabled={busyId === checklistJob?._id}>Route</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!makerJob} onOpenChange={() => setMakerJob(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Assign employee</DialogTitle></DialogHeader>
              {makerOptions.length === 0 ? (
                <p className="text-sm text-slate-500">No employees on this Team Lead’s team.</p>
              ) : (
                <Select value={makerId} onValueChange={setMakerId}>
                  <SelectTrigger><SelectValue placeholder="Team employee" /></SelectTrigger>
                  <SelectContent>
                    {makerOptions.map((m) => <SelectItem key={m.emp_id} value={m.emp_id}>{m.name} ({m.emp_id})</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
          <DialogFooter><Button onClick={assignMaker} disabled={busyId === makerJob?._id}>Assign</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!receiptJob} onOpenChange={() => setReceiptJob(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Submission receipt + Drive pack</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">
            {busyId === receiptJob?._id
              ? 'Uploading the Drive pack for this card only. Other jobs stay clickable.'
              : 'Upload the GeM submission receipt. Confirm packs SOW, checklist, employee finals, and receipt into a Drive child folder named [Tender Number] - [Tender Title]. The job stays unsubmitted if Drive fails.'}
          </p>
          <Input type="file" accept="application/pdf" onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} />
          <DialogFooter>
            <Button onClick={confirmReceipt} disabled={busyId === receiptJob?._id} className="bg-emerald-600 hover:bg-emerald-700">
              {busyId === receiptJob?._id ? 'Uploading pack…' : 'Confirm & push to Drive'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!bounceJob} onOpenChange={() => setBounceJob(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{bounceMode === 'gm' ? 'Bounce to TL' : 'Bounce to employee'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {bounceMode === 'tl' && (
              <div className="space-y-2">
                <Label>Files to replace *</Label>
                {(bounceJob?.prep_files || []).length === 0 ? (
                  <p className="text-sm text-slate-500">No files on this job.</p>
                ) : (
                  <ul className="space-y-2 max-h-40 overflow-y-auto border rounded-md p-2">
                    {(bounceJob.prep_files || []).map((f, i) => (
                      <li key={f.slot || i} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={bounceSlots.includes(f.slot)}
                          onChange={() => toggleBounceSlot(f.slot)}
                        />
                        <span className="truncate">{f.name || f.slot || `File ${i + 1}`}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div>
              <Label>Bounce note *</Label>
              <Textarea
                className="mt-1"
                rows={3}
                value={bounceNote}
                onChange={(e) => setBounceNote(e.target.value)}
                placeholder={bounceMode === 'gm' ? 'Tell the TL what to fix.' : 'Tell the employee which files to replace and why.'}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBounceJob(null)}>Cancel</Button>
            <Button onClick={submitBounce} disabled={busyId === bounceJob?._id} className="bg-red-600 hover:bg-red-700">Bounce</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default memo(InternalTrackingBoard);

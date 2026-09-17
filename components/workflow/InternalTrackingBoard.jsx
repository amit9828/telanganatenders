'use client';

import { useState } from 'react';
import CompactTenderCard from '@/components/workflow/CompactTenderCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { workflowFetch, openWorkflowFile } from '@/components/workflow/api';

const STATUS_LABEL = {
  MD_CHECKLIST: 'MD Checklist',
  TL_ASSIGN: 'TL Assign',
  MAKER_PREP: 'Employee Prep',
  TL_QC: 'TL QC',
  GM_QC: 'GM QC',
  MD_SUBMIT: 'Ready to Submit',
  AWAITING_RECEIPT: 'Awaiting Receipt',
};

export default function InternalTrackingBoard({ desk, tls = [], members = [], team = [], onRefresh, jobs = [], actorEmpId = '' }) {
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
  const [busy, setBusy] = useState(false);

  const openFile = (job, slot) => openWorkflowFile(job._id, slot).catch((err) => toast.error(err.message || 'Could not open file'));
  const makerTeamKeys = [makerJob?.team_id, makerJob?.routed_tl_emp_id, desk === 'tl' ? actorEmpId : '']
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const makerOptions = members.filter((m) => makerTeamKeys.includes(String(m.team_id || '').trim()));

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      onRefresh?.();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  const submitChecklist = async () => {
    if (!checklistFile) return toast.error('Upload the checklist PDF. Typed items are not allowed.');
    if (!tlId) return toast.error('Select a Team Lead.');
    const form = new FormData();
    form.append('checklist', checklistFile);
    form.append('routed_tl_emp_id', tlId);
    await workflowFetch(`/api/workflow/jobs/${checklistJob._id}/checklist`, { method: 'PUT', body: form });
    toast.success('Checklist uploaded and routed to TL.');
    setChecklistJob(null);
    setChecklistFile(null);
    setTlId('');
    onRefresh?.();
  };

  const assignMaker = async () => {
    if (!makerId) return toast.error('Select an employee in your team.');
    await workflowFetch(`/api/workflow/jobs/${makerJob._id}/advance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'assign_maker', assigned_emp_id: makerId }),
    });
    toast.success('Employee assigned.');
    setMakerJob(null);
    onRefresh?.();
  };

  const confirmReceipt = async () => {
    if (!receiptFile) return toast.error('Submission Receipt PDF is required.');
    const form = new FormData();
    form.append('receipt', receiptFile);
    try {
      await workflowFetch(`/api/workflow/jobs/${receiptJob._id}/files`, { method: 'POST', body: form });
      await workflowFetch(`/api/workflow/jobs/${receiptJob._id}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm_receipt' }),
      });
      toast.success('Drive pack uploaded. Status is Submitted.');
      setReceiptJob(null);
      setReceiptFile(null);
      onRefresh?.();
    } catch (err) {
      toast.error(err.message || 'Drive upload failed. Job stays unsubmitted.');
    }
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
    if (bounceMode === 'tl') {
      if ((bounceJob.prep_files || []).length && bounceSlots.length === 0) {
        return toast.error('Select at least one file to bounce.');
      }
      await workflowFetch(`/api/workflow/jobs/${bounceJob._id}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bounce', slots: bounceSlots, note }),
      });
      toast.success('Bounced to employee.');
    } else {
      await workflowFetch(`/api/workflow/jobs/${bounceJob._id}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'gm_bounce', note }),
      });
      toast.success('Bounced to TL.');
    }
    setBounceJob(null);
    setBounceNote('');
    setBounceSlots([]);
    onRefresh?.();
  };

  return (
    <div className="space-y-3">
      <h3 className="font-bold text-[#0A2647]">Internal tracking</h3>
      {jobs.length === 0 && <p className="text-sm text-slate-400">No jobs in the internal pipeline.</p>}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {jobs.map((job) => {
          const actions = [
            { label: 'View SOW', icon: 'eye', onClick: () => openFile(job, 'sow') },
          ].filter(Boolean);
          if (job.checklist_file) actions.push({ label: 'Checklist', onClick: () => openFile(job, 'checklist') });
          if (desk === 'md' && job.status === 'MD_CHECKLIST') {
            actions.push({ label: 'Upload checklist + TL', variant: 'default', icon: 'upload', onClick: () => setChecklistJob(job) });
          }
          if ((desk === 'tl' || desk === 'md') && job.status === 'TL_ASSIGN') {
            actions.push({ label: 'Assign employee', variant: 'default', onClick: () => { setMakerId(''); setMakerJob(job); } });
          }
          if (desk === 'employee' && job.status === 'MAKER_PREP') {
            actions.push({
              label: 'Send to TL',
              variant: 'default',
              disabled: (job.prep_files || []).length < 2,
              onClick: () => {
                if ((job.prep_files || []).length < 2) return toast.error('Upload at least 2 files before sending to TL.');
                return run(() => workflowFetch(`/api/workflow/jobs/${job._id}/advance`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'send_tl' }),
                }));
              },
            });
          }
          if (desk === 'tl' && job.status === 'TL_QC') {
            actions.push({
              label: 'Pass to GM',
              variant: 'default',
              onClick: () => run(() => workflowFetch(`/api/workflow/jobs/${job._id}/advance`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'send_gm' }),
              })),
            });
            actions.push({
              label: 'Bounce',
              onClick: () => openTlBounce(job),
            });
          }
          if (desk === 'gm' && job.status === 'GM_QC') {
            actions.push({
              label: 'Send to MD',
              variant: 'default',
              onClick: () => run(() => workflowFetch(`/api/workflow/jobs/${job._id}/advance`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'send_md' }),
              })),
            });
            actions.push({
              label: 'Bounce',
              onClick: () => openGmBounce(job),
            });
          }
          if (desk === 'md' && job.status === 'MD_SUBMIT') {
            actions.push({
              label: 'Submit Tender',
              variant: 'default',
              onClick: () => run(async () => {
                await workflowFetch(`/api/workflow/jobs/${job._id}/advance`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ action: 'submit_tender' }),
                });
                setReceiptJob(job);
              }),
            });
          }
          if (desk === 'md' && job.status === 'AWAITING_RECEIPT') {
            actions.push({ label: 'Receipt + Drive', icon: 'upload', variant: 'default', onClick: () => setReceiptJob(job) });
          }
          return (
            <div key={job._id}>
              <CompactTenderCard
                job={{ ...job, display_status: STATUS_LABEL[job.status] || job.status }}
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
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] shrink-0" onClick={() => openFile(job, f.slot)}>
                            View
                          </Button>
                        </li>
                        );
                      })}
                    </ul>
                  )}
                  <label className={`flex items-center justify-center h-9 rounded-md border border-dashed border-emerald-300 bg-emerald-50 text-[11px] font-bold text-emerald-800 cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
                    Add files
                    <input
                      type="file"
                      multiple
                      accept="application/pdf"
                      className="sr-only"
                      disabled={busy}
                      onChange={async (e) => {
                        const files = Array.from(e.target.files || []);
                        e.target.value = '';
                        if (!files.length) return;
                        setBusy(true);
                        try {
                          for (const file of files) {
                            const form = new FormData();
                            form.append('file', file);
                            form.append('slot', `slot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
                            form.append('kind', 'final');
                            await workflowFetch(`/api/workflow/jobs/${job._id}/files`, { method: 'POST', body: form });
                          }
                          toast.success(`${files.length} file${files.length === 1 ? '' : 's'} stored.`);
                          onRefresh?.();
                        } catch (err) {
                          toast.error(err.message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>

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
            <Button onClick={() => run(submitChecklist)} disabled={busy}>Route</Button>
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
          <DialogFooter><Button onClick={() => run(assignMaker)} disabled={busy}>Assign</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!receiptJob} onOpenChange={() => setReceiptJob(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Submission receipt + Drive pack</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">Upload the GeM submission receipt. Confirm packs SOW, checklist, employee finals, and receipt into a Drive child folder named [Tender Number] - [Tender Title]. The job stays unsubmitted if Drive fails.</p>
          <Input type="file" accept="application/pdf" onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} />
          <DialogFooter>
            <Button onClick={confirmReceipt} disabled={busy} className="bg-emerald-600 hover:bg-emerald-700">Confirm & push to Drive</Button>
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
            <Button onClick={() => run(submitBounce)} disabled={busy} className="bg-red-600 hover:bg-red-700">Bounce</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

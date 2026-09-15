import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { DESIGNATIONS, resolveActorRole, resolveClientEmail } from '@/lib/staff-auth';
import { uploadWorkflowDocument, deleteR2Key, fetchR2Buffer } from '@/lib/cloudflare-r2';
import {
  JOB_STATUS,
  DISPLAY_STATUS,
  TRACKING_STAGES,
  INTERNAL_BOARD_STATUSES,
  SUBMITTED_BOARD_STATUSES,
  CLIENT_VISIBLE_STATUSES,
  queueFilterForActor,
  canSeeJob,
  sanitizeJobForAudience,
  pushHistory,
  createOpsAlert,
  loadJob,
  saveJob,
  jobsCol,
  asObjectId,
  archiveLostJob,
  displayAfterSubmit,
  ensureWorkflowIndexes,
  actorLabel,
} from '@/lib/workflow';

export const workflowRouteConfig = {
  runtime: 'nodejs',
  dynamic: 'force-dynamic',
  fetchCache: 'force-no-store',
};

function json(data, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function deny(message, status = 403) {
  return json({ error: message }, status);
}

function isGm(actor) {
  return actor?.designation === DESIGNATIONS.GM;
}
function isTl(actor) {
  return actor?.designation === DESIGNATIONS.DOC_TEAM_TL;
}
function isMember(actor) {
  return actor?.designation === DESIGNATIONS.DOC_TEAM_MEMBER && actor?.empId;
}

async function requireStaffActor(request) {
  const actor = await resolveActorRole(request);
  if (!actor.role) return { actor: null, error: deny('Please sign in with a staff account.', 401) };
  return { actor, error: null };
}

async function fileFromForm(form, field = 'file') {
  const file = form.get(field);
  if (!file || typeof file === 'string' || !file.arrayBuffer) return null;
  const buf = Buffer.from(await file.arrayBuffer());
  if (!buf.length) return null;
  return { buffer: buf, name: file.name || 'document.pdf', type: file.type || 'application/pdf' };
}

async function uploadSlot(jobId, file, hint) {
  const uploaded = await uploadWorkflowDocument(file.buffer, file.name, {
    jobId,
    contentType: file.type,
  });
  if (!uploaded) throw new Error('R2 upload failed');
  return { r2_key: uploaded.key, url: uploaded.url, name: file.name, kind: hint || 'other' };
}

export async function handleQueueGet(request) {
  const { actor, error } = await requireStaffActor(request);
  if (error) return error;
  const db = await getDb();
  await ensureWorkflowIndexes(db);
  const board = request.nextUrl.searchParams.get('board') || 'all';
  const filter = queueFilterForActor(actor);
  if (board === 'internal') filter.status = { $in: INTERNAL_BOARD_STATUSES };
  else if (board === 'submitted') filter.status = { $in: SUBMITTED_BOARD_STATUSES };
  else if (board === 'live') filter.status = JOB_STATUS.LIVE;
  else if (board === 'awaiting_publish') filter.status = JOB_STATUS.AWAITING_PUBLISH;
  else if (board === 'suggestions') filter.status = JOB_STATUS.AWAITING_CLIENT;
  const jobs = await jobsCol(db).find(filter).sort({ updated_at: -1, created_at: -1 }).toArray();
  return json({ jobs: jobs.map((j) => sanitizeJobForAudience(j, 'staff')) });
}

export async function handleJobsGet(request) {
  return handleQueueGet(request);
}

export async function handleJobsPost(request) {
  const { actor, error } = await requireStaffActor(request);
  if (error) return error;
  if (!isTl(actor) && actor.role !== 'MD') return deny('Only a Doc Team TL can create a task.');
  const body = await request.json().catch(() => ({}));
  const assignedEmpId = String(body.assigned_emp_id || '').trim();
  if (!assignedEmpId) return deny('Select a team member.', 400);

  const db = await getDb();
  await ensureWorkflowIndexes(db);
  const member = await db.collection('employees').findOne({ emp_id: assignedEmpId });
  if (!member) return deny('Team member not found.', 404);

  const teamId = actor.role === 'MD' ? (body.team_id || member.team_id || assignedEmpId) : actor.empId;
  if (actor.role !== 'MD' && member.team_id !== actor.empId) {
    return deny('You can only assign members in your own team.');
  }

  const job = {
    status: JOB_STATUS.AWAITING_PUBLISH,
    display_status: null,
    team_id: teamId,
    routed_tl_emp_id: actor.role === 'MD' ? (body.routed_tl_emp_id || teamId) : actor.empId,
    assigned_emp_id: assignedEmpId,
    assigned_emp_name: member.name || assignedEmpId,
    created_by_tl: actor.empId || actor.email,
    title: body.title || 'Check Drive / Publish tender',
    notes: body.notes || '',
    tender_id: null,
    bid_no: null,
    sow: null,
    checklist_file: null,
    prep_files: [],
    bounced_slots: [],
    receipt: null,
    client_email: null,
    suggested_by: null,
    history: [],
    created_at: new Date(),
    updated_at: new Date(),
  };
  job.history = pushHistory(job, { actor, action: 'create_task', to: JOB_STATUS.AWAITING_PUBLISH, note: job.notes });
  const result = await jobsCol(db).insertOne(job);
  await createOpsAlert(db, {
    recipient_emp_id: assignedEmpId,
    type: 'WORK_ASSIGNED',
    message: `Work assigned: ${job.title}. Check Drive, then publish from your desk.`,
    job_id: result.insertedId,
  });
  return json({ success: true, job: sanitizeJobForAudience({ ...job, _id: result.insertedId }, 'staff') }, 201);
}

export async function handleJobGet(request, id) {
  const db = await getDb();
  const job = await loadJob(db, id);
  if (!job) return deny('Job not found.', 404);

  const clientEmail = await resolveClientEmail(request);
  if (clientEmail && String(job.client_email || '').toLowerCase() === clientEmail) {
    return json({ job: sanitizeJobForAudience(job, 'client') });
  }

  const { actor, error } = await requireStaffActor(request);
  if (error) return error;
  if (!canSeeJob(actor, job)) return deny('Not allowed to view this job.');
  return json({ job: sanitizeJobForAudience(job, 'staff') });
}

export async function handlePublishAttach(request, id) {
  const { actor, error } = await requireStaffActor(request);
  if (error) return error;
  const db = await getDb();
  const job = await loadJob(db, id);
  if (!job) return deny('Job not found.', 404);
  if (!canSeeJob(actor, job)) return deny('Not allowed.');
  if (job.status !== JOB_STATUS.AWAITING_PUBLISH) return deny('This job is not waiting to be published.', 400);
  if (isMember(actor) && job.assigned_emp_id !== actor.empId) return deny('This task is not assigned to you.');
  if (isTl(actor) && job.team_id !== actor.empId) return deny('Not your team.');

  const body = await request.json().catch(() => ({}));
  const tenderId = body.tender_id;
  if (!tenderId) return deny('tender_id is required.', 400);

  const tenderOid = asObjectId(tenderId);
  const tender = tenderOid
    ? await db.collection('tenders').findOne({ _id: tenderOid })
    : await db.collection('tenders').findOne({ bid_no: String(tenderId) });
  if (!tender) return deny('Published tender not found.', 404);

  const next = await saveJob(db, id, {
    status: JOB_STATUS.LIVE,
    tender_id: String(tender._id),
    bid_no: tender.bid_no || body.bid_no || null,
    title: tender.title || job.title,
    last_date: tender.last_date || null,
    tender_date: tender.created_at || tender.last_date || new Date(),
    department: tender.department || null,
    district: tender.district || null,
    history: pushHistory(job, { actor, action: 'publish_attach', from: job.status, to: JOB_STATUS.LIVE }),
  });
  return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
}

export async function handleSuggest(request, id) {
  const { actor, error } = await requireStaffActor(request);
  if (error) return error;
  if (!isGm(actor) && actor.role !== 'MD') return deny('Only GM can pitch a client with a SOW PDF.');

  const db = await getDb();
  const job = await loadJob(db, id);
  if (!job) return deny('Job not found.', 404);
  if (job.status !== JOB_STATUS.LIVE && job.status !== JOB_STATUS.AWAITING_CLIENT) {
    return deny('Suggest is only available on live tenders.', 400);
  }
  if (job.client_email && job.status === JOB_STATUS.AWAITING_CLIENT) {
    return deny('This job already has a pending client. Clone it to pitch another client.', 400);
  }

  const form = await request.formData();
  const clientEmail = String(form.get('client_email') || '').trim().toLowerCase();
  if (!clientEmail) return deny('Select a client.', 400);
  const file = await fileFromForm(form, 'sow');
  if (!file) return deny('SOW PDF is required. Typed scope is not allowed.', 400);

  const client = await db.collection('users').findOne({ email: clientEmail });
  if (!client) return deny('Client not found.', 404);

  const sow = await uploadSlot(id, file, 'sow');
  const next = await saveJob(db, id, {
    status: JOB_STATUS.AWAITING_CLIENT,
    display_status: DISPLAY_STATUS.PENDING_APPROVAL,
    client_email: clientEmail,
    client_name: client.company_name || client.client_name || client.name || clientEmail,
    sow: { ...sow, name: file.name },
    suggested_by: { emp_id: actor.empId, name: actor.name, email: actor.email },
    history: pushHistory(job, { actor, action: 'suggest_sow', from: job.status, to: JOB_STATUS.AWAITING_CLIENT, note: clientEmail }),
  });

  await db.collection('dispatches').insertOne({
    target_type: 'client_alert',
    target_id: clientEmail,
    subject: 'New Tender Suggestion — Scope of Work',
    message: `[JOB:${id}] [BID: ${job.bid_no || 'N/A'}] ${job.title || 'Tender'}`,
    status: 'Sent',
    workflow_job_id: String(id),
    employee_id: actor.empId,
    employee_email: actor.email,
    employee_name: actor.name,
    created_at: new Date(),
  });

  return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
}

export async function handleClientApprove(request, id) {
  const db = await getDb();
  const job = await loadJob(db, id);
  if (!job) return deny('Job not found.', 404);
  if (job.status !== JOB_STATUS.AWAITING_CLIENT) return deny('This tender is not waiting for your approval.', 400);

  const sessionEmail = await resolveClientEmail(request);
  const body = await request.json().catch(() => ({}));
  const email = (sessionEmail || String(body.client_email || '').trim().toLowerCase());
  if (!email || String(job.client_email || '').toLowerCase() !== email) {
    return deny('You can only approve tenders suggested to your account.', 403);
  }

  const next = await saveJob(db, id, {
    status: JOB_STATUS.MD_CHECKLIST,
    display_status: DISPLAY_STATUS.IN_PROGRESS,
    history: pushHistory(job, { actor: { name: email, email }, action: 'client_approve', from: job.status, to: JOB_STATUS.MD_CHECKLIST }),
  });

  await db.collection('bids').insertOne({
    client_email: email,
    bid_no: job.bid_no || '',
    description: job.title || '',
    status: 'In Progress',
    workflow_job_id: String(id),
    employee_id: job.suggested_by?.emp_id || null,
    employee_name: job.suggested_by?.name || null,
    created_at: new Date(),
  });

  await db.collection('dispatches').updateMany(
    { workflow_job_id: String(id), target_id: email },
    { $set: { status: 'Completed', client_reply: 'Client Accepted the Tender', reply: 'Client Accepted the Tender' } }
  );

  return json({ success: true, job: sanitizeJobForAudience(next, 'client') });
}

export async function handleChecklist(request, id) {
  const { actor, error } = await requireStaffActor(request);
  if (error) return error;
  if (actor.role !== 'MD') return deny('Only MD can upload the checklist PDF and route a TL.');

  const db = await getDb();
  const job = await loadJob(db, id);
  if (!job) return deny('Job not found.', 404);
  if (job.status !== JOB_STATUS.MD_CHECKLIST) return deny('Checklist is only uploaded after client approval.', 400);

  const form = await request.formData();
  const tlEmpId = String(form.get('routed_tl_emp_id') || '').trim();
  if (!tlEmpId) return deny('Select a Team Lead.', 400);
  const file = await fileFromForm(form, 'checklist');
  if (!file) return deny('Checklist PDF is required. Typed checklist items are not allowed.', 400);

  const tl = await db.collection('employees').findOne({ emp_id: tlEmpId, designation: DESIGNATIONS.DOC_TEAM_TL });
  if (!tl) return deny('Selected person is not a Doc Team TL.', 400);

  const checklist = await uploadSlot(id, file, 'checklist');
  const next = await saveJob(db, id, {
    status: JOB_STATUS.TL_ASSIGN,
    display_status: DISPLAY_STATUS.IN_PROGRESS,
    routed_tl_emp_id: tlEmpId,
    team_id: tl.team_id || tlEmpId,
    checklist_file: { ...checklist, name: file.name },
    history: pushHistory(job, { actor, action: 'checklist_tl_route', from: job.status, to: JOB_STATUS.TL_ASSIGN, note: tlEmpId }),
  });
  await createOpsAlert(db, {
    recipient_emp_id: tlEmpId,
    type: 'CHECKLIST_READY',
    message: `MD routed ${job.bid_no || job.title} — assign a maker on your team.`,
    job_id: id,
  });
  return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
}

export async function handleFiles(request, id) {
  const { actor, error } = await requireStaffActor(request);
  if (error) return error;
  const db = await getDb();
  const job = await loadJob(db, id);
  if (!job) return deny('Job not found.', 404);
  if (!canSeeJob(actor, job) && actor.role !== 'MD') return deny('Not allowed.');
  const form = await request.formData();
  const kind = String(form.get('kind') || 'other');
  if (kind === 'receipt' || job.status === JOB_STATUS.AWAITING_RECEIPT) {
    request._workflowForm = form;
    return handleReceiptUpload(request, id);
  }
  if (job.status !== JOB_STATUS.MAKER_PREP) return deny('Files can only be uploaded during maker prep.', 400);
  if (job.assigned_emp_id !== actor.empId && actor.role !== 'MD') return deny('Only the assigned maker can upload files.');

  const slot = String(form.get('slot') || `slot-${Date.now()}`);
  const file = await fileFromForm(form, 'file');
  if (!file) return deny('Choose a file to upload.', 400);

  const prep = Array.isArray(job.prep_files) ? [...job.prep_files] : [];
  const existingIdx = prep.findIndex((f) => f.slot === slot);
  if (existingIdx >= 0 && prep[existingIdx].r2_key) {
    await deleteR2Key(prep[existingIdx].r2_key);
  }
  const uploaded = await uploadSlot(id, file, kind);
  const entry = { slot, kind, name: file.name, r2_key: uploaded.r2_key, url: uploaded.url };
  if (existingIdx >= 0) prep[existingIdx] = entry;
  else prep.push(entry);

  const bounced = (job.bounced_slots || []).filter((s) => s !== slot);
  const next = await saveJob(db, id, {
    prep_files: prep,
    bounced_slots: bounced,
    history: pushHistory(job, { actor, action: 'upload_file', note: `${kind}:${file.name}` }),
  });
  return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
}

export async function handleAdvance(request, id) {
  const { actor, error } = await requireStaffActor(request);
  if (error) return error;
  const db = await getDb();
  const job = await loadJob(db, id);
  if (!job) return deny('Job not found.', 404);
  if (!canSeeJob(actor, job) && actor.role !== 'MD') return deny('Not allowed.');

  const body = await request.json().catch(() => ({}));
  const action = String(body.action || '').trim();

  if (action === 'assign_maker') {
    if (!isTl(actor) && actor.role !== 'MD') return deny('Only the Team Lead can assign a maker.');
    if (job.status !== JOB_STATUS.TL_ASSIGN) return deny('Assign a maker after MD routes the TL.', 400);
    const assignedEmpId = String(body.assigned_emp_id || '').trim();
    const member = await db.collection('employees').findOne({ emp_id: assignedEmpId });
    if (!member || member.team_id !== (job.team_id || actor.empId)) {
      return deny('Maker must belong to this TL team.', 400);
    }
    const next = await saveJob(db, id, {
      status: JOB_STATUS.MAKER_PREP,
      assigned_emp_id: assignedEmpId,
      assigned_emp_name: member.name || assignedEmpId,
      history: pushHistory(job, { actor, action, from: job.status, to: JOB_STATUS.MAKER_PREP, note: assignedEmpId }),
    });
    await createOpsAlert(db, {
      recipient_emp_id: assignedEmpId,
      type: 'WORK_ASSIGNED',
      message: `Prepare bid docs for ${job.bid_no || job.title}.`,
      job_id: id,
    });
    return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
  }

  if (action === 'send_tl') {
    if (job.assigned_emp_id !== actor.empId && actor.role !== 'MD') return deny('Only the assigned maker can send to TL.');
    if (job.status !== JOB_STATUS.MAKER_PREP) return deny('Send to TL from maker prep.', 400);
    if ((job.prep_files || []).length < 2) return deny('Upload at least two files before sending to TL.', 400);
    const next = await saveJob(db, id, {
      status: JOB_STATUS.TL_QC,
      history: pushHistory(job, { actor, action, from: job.status, to: JOB_STATUS.TL_QC }),
    });
    await createOpsAlert(db, {
      recipient_emp_id: job.routed_tl_emp_id || job.team_id,
      type: 'CHECKLIST_READY',
      message: `${actorLabel(actor)} sent ${job.bid_no || job.title} for TL review.`,
      job_id: id,
    });
    return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
  }

  if (action === 'bounce') {
    if (!isTl(actor) && actor.role !== 'MD') return deny('Only TL can bounce files.');
    if (job.status !== JOB_STATUS.TL_QC) return deny('Bounce is only from TL QC.', 400);
    const slots = Array.isArray(body.slots) ? body.slots.map(String) : [];
    const next = await saveJob(db, id, {
      status: JOB_STATUS.MAKER_PREP,
      bounced_slots: slots.length ? slots : (job.prep_files || []).map((f) => f.slot),
      bounce_note: body.note || '',
      history: pushHistory(job, { actor, action, from: job.status, to: JOB_STATUS.MAKER_PREP, note: body.note || 'bounced' }),
    });
    await createOpsAlert(db, {
      recipient_emp_id: job.assigned_emp_id,
      type: 'QC_BOUNCE',
      message: `TL bounced ${job.bid_no || job.title}. Replace the marked files (old copies are deleted on re-upload).`,
      job_id: id,
    });
    return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
  }

  if (action === 'send_gm') {
    if (!isTl(actor) && actor.role !== 'MD') return deny('Only TL can pass to GM.');
    if (job.status !== JOB_STATUS.TL_QC) return deny('Pass to GM from TL QC.', 400);
    const next = await saveJob(db, id, {
      status: JOB_STATUS.GM_QC,
      bounced_slots: [],
      history: pushHistory(job, { actor, action, from: job.status, to: JOB_STATUS.GM_QC }),
    });
    return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
  }

  if (action === 'send_md') {
    if (!isGm(actor) && actor.role !== 'MD') return deny('Only GM can send to MD.');
    if (job.status !== JOB_STATUS.GM_QC) return deny('Send to MD from GM QC.', 400);
    const next = await saveJob(db, id, {
      status: JOB_STATUS.MD_SUBMIT,
      history: pushHistory(job, { actor, action, from: job.status, to: JOB_STATUS.MD_SUBMIT }),
    });
    return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
  }

  if (action === 'submit_tender') {
    if (actor.role !== 'MD') return deny('Only MD can mark Submit Tender.');
    if (job.status !== JOB_STATUS.MD_SUBMIT) return deny('Submit Tender is only after GM QC.', 400);
    const next = await saveJob(db, id, {
      status: JOB_STATUS.AWAITING_RECEIPT,
      history: pushHistory(job, { actor, action, from: job.status, to: JOB_STATUS.AWAITING_RECEIPT }),
    });
    return json({ success: true, job: sanitizeJobForAudience(next, 'staff'), need_receipt: true });
  }

  if (action === 'confirm_receipt') {
    return handleConfirmReceipt(request, id, actor, job, db, body);
  }

  return deny(`Unknown action: ${action}`, 400);
}

async function handleConfirmReceipt(request, id, actor, job, db, body) {
  if (actor.role !== 'MD') return deny('Only MD can confirm the submission receipt.');
  if (job.status !== JOB_STATUS.AWAITING_RECEIPT && job.status !== JOB_STATUS.MD_SUBMIT) {
    return deny('Receipt is confirmed after Submit Tender.', 400);
  }
  if (!job.receipt?.r2_key) return deny('Upload the Submission Receipt PDF first.', 400);
  const { isDriveConfigured, ensureEntityDriveFolder, uploadBidPackToClientDrive } = await import('@/lib/drive');
  if (!isDriveConfigured()) return deny('Google Drive is not configured. Submission cannot complete until Drive succeeds.', 500);

  const client = await db.collection('users').findOne({ email: String(job.client_email || '').toLowerCase() });
  if (!client) return deny('Mapped client is missing.', 400);

  let folderId = client.drive_folder_id;
  if (!folderId) {
    const ensured = await ensureEntityDriveFolder({
      db,
      collection: 'users',
      query: { email: client.email },
      folderName: `Client - ${client.company_name || client.email}`,
      email: client.email,
    });
    folderId = ensured.folderId;
  }
  if (!folderId) return deny('Client Drive folder is missing. Create it, then retry.', 500);

  const packFiles = [];
  const slots = [
    job.sow,
    job.checklist_file,
    ...(job.prep_files || []),
    job.receipt,
  ].filter(Boolean);
  for (const slot of slots) {
    const buf = await fetchR2Buffer(slot.r2_key);
    if (!buf) return deny(`Could not read ${slot.name || slot.r2_key} from storage for Drive push.`, 500);
    packFiles.push({ buffer: buf, name: slot.name || 'document.pdf' });
  }

  const folderName = `${job.bid_no || 'Tender'} - ${job.title || 'Untitled'}`.replace(/[\\/]/g, '-');
  let driveResult;
  try {
    driveResult = await uploadBidPackToClientDrive({
      clientFolderId: folderId,
      folderName,
      files: packFiles,
    });
  } catch (err) {
    console.error('[workflow] Drive pack failed:', err?.message || err);
    return deny('Drive upload failed. Job stays unsubmitted until Drive succeeds. Retry.', 502);
  }

  const next = await saveJob(db, id, {
    status: JOB_STATUS.SUBMITTED,
    display_status: DISPLAY_STATUS.SUBMITTED,
    tracking_status: DISPLAY_STATUS.SUBMITTED,
    drive_pushed_at: new Date(),
    drive_bid_folder_id: driveResult.folderId,
    drive_bid_folder_link: driveResult.folderLink,
    history: pushHistory(job, { actor, action: 'confirm_receipt', from: job.status, to: JOB_STATUS.SUBMITTED }),
  });

  await db.collection('bids').updateMany(
    { workflow_job_id: String(id) },
    { $set: { status: 'Submitted' } }
  );

  return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
}

export async function handleReceiptUpload(request, id) {
  const { actor, error } = await requireStaffActor(request);
  if (error) return error;
  if (actor.role !== 'MD') return deny('Only MD uploads the submission receipt.');
  const db = await getDb();
  const job = await loadJob(db, id);
  if (!job) return deny('Job not found.', 404);
  if (job.status !== JOB_STATUS.AWAITING_RECEIPT && job.status !== JOB_STATUS.MD_SUBMIT) {
    return deny('Receipt is uploaded after Submit Tender.', 400);
  }
  const form = request._workflowForm || await request.formData();
  const file = await fileFromForm(form, 'receipt') || await fileFromForm(form, 'file');
  if (!file) return deny('Submission Receipt PDF is required.', 400);
  if (job.receipt?.r2_key) await deleteR2Key(job.receipt.r2_key);
  const uploaded = await uploadSlot(id, file, 'receipt');
  const next = await saveJob(db, id, {
    receipt: { ...uploaded, name: file.name },
    history: pushHistory(job, { actor, action: 'upload_receipt', note: file.name }),
  });
  return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
}

export async function handleTracking(request, id) {
  const { actor, error } = await requireStaffActor(request);
  if (error) return error;
  if (actor.role === 'MD') return deny('MD is read-only on submitted tracking.');
  if (!isGm(actor) && !isMember(actor) && !isTl(actor)) return deny('Not allowed to edit tracking.');

  const db = await getDb();
  const job = await loadJob(db, id);
  if (!job) return deny('Job not found.', 404);
  if (!canSeeJob(actor, job)) return deny('Not allowed.');
  if (job.status !== JOB_STATUS.SUBMITTED && job.status !== JOB_STATUS.WON) {
    return deny('Tracking stages apply after submission.', 400);
  }

  const body = await request.json().catch(() => ({}));
  const stage = String(body.tracking_status || body.status || '').trim();

  if (stage === 'Lost' || stage === 'Loss') {
    await archiveLostJob(db, job, actor);
    await db.collection('bids').updateMany({ workflow_job_id: String(id) }, { $set: { status: 'Lost' } });
    return json({ success: true, archived: true });
  }

  if (stage === 'Won' || stage === DISPLAY_STATUS.WON) {
    const next = await saveJob(db, id, {
      status: JOB_STATUS.WON,
      display_status: DISPLAY_STATUS.WON,
      tracking_status: DISPLAY_STATUS.WON,
      history: pushHistory(job, { actor, action: 'won', from: job.status, to: JOB_STATUS.WON }),
    });
    await db.collection('bids').updateMany({ workflow_job_id: String(id) }, { $set: { status: 'Won' } });
    return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
  }

  if (!TRACKING_STAGES.includes(stage)) return deny('Invalid tracking stage.', 400);
  const next = await saveJob(db, id, {
    tracking_status: stage,
    display_status: displayAfterSubmit(stage),
    history: pushHistory(job, { actor, action: 'tracking', note: stage }),
  });
  return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
}

export async function handleClone(request, id) {
  const { actor, error } = await requireStaffActor(request);
  if (error) return error;
  if (!isGm(actor) && actor.role !== 'MD') return deny('Only GM can clone a live tender for another client.');
  const db = await getDb();
  const job = await loadJob(db, id);
  if (!job) return deny('Job not found.', 404);
  if (!job.tender_id) return deny('Clone requires a published tender.', 400);

  const clone = {
    status: JOB_STATUS.LIVE,
    display_status: null,
    team_id: job.team_id,
    routed_tl_emp_id: job.routed_tl_emp_id,
    assigned_emp_id: job.assigned_emp_id,
    assigned_emp_name: job.assigned_emp_name,
    created_by_tl: job.created_by_tl,
    title: job.title,
    notes: job.notes || '',
    tender_id: job.tender_id,
    bid_no: job.bid_no,
    last_date: job.last_date,
    tender_date: job.tender_date,
    department: job.department,
    district: job.district,
    sow: null,
    checklist_file: null,
    prep_files: [],
    bounced_slots: [],
    receipt: null,
    client_email: null,
    suggested_by: null,
    cloned_from: String(job._id),
    history: [],
    created_at: new Date(),
    updated_at: new Date(),
  };
  clone.history = pushHistory(clone, { actor, action: 'clone', to: JOB_STATUS.LIVE, note: `from ${job._id}` });
  const result = await jobsCol(db).insertOne(clone);
  return json({ success: true, job: sanitizeJobForAudience({ ...clone, _id: result.insertedId }, 'staff') }, 201);
}

export async function handleFileGet(request, id) {
  const db = await getDb();
  const job = await loadJob(db, id);
  if (!job) return deny('Job not found.', 404);
  const slot = request.nextUrl.searchParams.get('slot') || 'sow';

  const clientEmail = await resolveClientEmail(request);
  const isClient = clientEmail && String(job.client_email || '').toLowerCase() === clientEmail;

  let meta = null;
  if (slot === 'sow') meta = job.sow;
  else if (slot === 'checklist') meta = job.checklist_file;
  else if (slot === 'receipt') meta = job.receipt;
  else meta = (job.prep_files || []).find((f) => f.slot === slot);

  if (!meta?.r2_key) return deny('File not found.', 404);

  if (isClient) {
    const allowed = slot === 'sow' || (slot === 'receipt' && (job.status === JOB_STATUS.SUBMITTED || job.status === JOB_STATUS.WON));
    if (!allowed) return deny('Internal files are not visible to clients.');
  } else {
    const { actor, error } = await requireStaffActor(request);
    if (error) return error;
    if (!canSeeJob(actor, job)) return deny('Not allowed.');
  }

  const buf = await fetchR2Buffer(meta.r2_key);
  if (!buf) return deny('Could not read file from storage.', 500);
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(meta.name || 'document.pdf')}"`,
      'Content-Length': String(buf.length),
      'Cache-Control': 'no-store',
    },
  });
}

export async function handleClientQueue(request) {
  const sessionEmail = await resolveClientEmail(request);
  const email = sessionEmail || String(request.nextUrl.searchParams.get('email') || '').trim().toLowerCase();
  if (!email) return deny('Client email required.', 401);
  const db = await getDb();
  const jobs = await jobsCol(db).find({
    client_email: email,
    status: { $in: CLIENT_VISIBLE_STATUSES },
  }).sort({ updated_at: -1 }).toArray();
  return json({ jobs: jobs.map((j) => sanitizeJobForAudience(j, 'client')) });
}

export { json, deny };

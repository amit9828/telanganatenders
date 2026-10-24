import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { findExistingClient, clientIdentFromRequest } from '@/lib/clients';
import { publishWorkflowEvent } from '@/lib/workflow-events';
import { recordStaffRevolt } from '@/lib/reports';
import { TRACKING_LABELS, currentTrackingStage, nextTrackingStage } from '@/lib/tracking-status';
import { DESIGNATIONS, matchDesignation, resolveStaffDesignation, resolveActorRole, resolveClientEmail, isGmActor } from '@/lib/staff-auth';
import { uploadWorkflowDocument, deleteR2Key, fetchWorkflowDocumentBuffer, fetchTenderPDFBuffer } from '@/lib/cloudflare-r2';
import { canViewPrepFiles, prepLockLabel } from '@/lib/prep-access';
import {
  JOB_STATUS,
  DISPLAY_STATUS,
  TRACKING_STAGES,
  parseTrackingStatus,
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
  loadArchivedJob,
  listArchivedJobs,
  displayAfterSubmit,
  ensureWorkflowIndexes,
  actorLabel,
} from '@/lib/workflow';

export const workflowRouteConfig = {
  runtime: 'nodejs',
  dynamic: 'force-dynamic',
  fetchCache: 'force-no-store',
};

// Vercel caps the whole serverless request at ~4.5MB. Stay under that so the
// handler can return a JSON error instead of an opaque platform 413.
export const WORKFLOW_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

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
  return isGmActor(actor);
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

function canPitch(actor) {
  return isGm(actor) || actor?.role === 'MD';
}

async function actorCanPitch(db, actor) {
  if (canPitch(actor)) return true;
  if (!actor?.empId && !actor?.email) return false;
  const emp = await db.collection('employees').findOne({
    $or: [
      ...(actor.empId ? [{ emp_id: actor.empId }] : []),
      ...(actor.email ? [{ email: String(actor.email).toLowerCase() }] : []),
    ],
    deleted: { $ne: true },
    active: { $ne: false },
  });
  return Boolean(emp && (matchDesignation(emp.designation) === DESIGNATIONS.GM || matchDesignation(emp.role) === DESIGNATIONS.GM));
}

function rawId(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object') {
    if (value.$oid) return String(value.$oid);
    if (value.oid) return String(value.oid);
    if (typeof value.toHexString === 'function') return value.toHexString();
  }
  return String(value).trim();
}

function parkedName(client, email) {
  return client?.company_name || client?.client_name || client?.name || email;
}

function isFreeLive(job) {
  if (!job || job.status !== JOB_STATUS.LIVE) return false;
  if (job.client_email) return false;
  if (job.parked_client_email) return false;
  if (job.sow) return false;
  return true;
}

async function findTenderDoc(db, body) {
  const tenderId = rawId(body.tender_id || body.id);
  const oid = asObjectId(tenderId);
  if (oid) {
    const byId = await db.collection('tenders').findOne({ _id: oid });
    if (byId) return byId;
  }
  if (tenderId) {
    const byStr = await db.collection('tenders').findOne({ _id: tenderId });
    if (byStr) return byStr;
  }
  if (body.bid_no) return db.collection('tenders').findOne({ bid_no: String(body.bid_no) });
  return null;
}

async function findClientDoc(db, body) {
  const email = String(body.client_email || '').trim();
  const clientId = String(body.client_id || '').trim();
  return (await findExistingClient(db, email)) || (await findExistingClient(db, clientId));
}

function safeDriveName(value, fallback = 'document.pdf') {
  const cleaned = String(value || '').replace(/[\\/:*?"<>|]/g, '-').trim();
  return cleaned || fallback;
}

async function bufferFromWorkflowSlot(slot, job = null) {
  if (!slot) return null;
  return fetchWorkflowDocumentBuffer(slot, { jobId: job?._id || job?.id || null });
}

function tenderPdfRef(tender) {
  if (!tender) return null;
  return {
    tender_id: String(tender._id),
    bid_no: tender.bid_no || null,
    pdf_url: tender.pdf_url || tender.file_url || null,
    pdf_r2_key: tender.pdf_r2_key || null,
    pdf_filename: tender.pdf_filename || `${tender.bid_no || 'tender'}.pdf`,
  };
}

function memberBelongsToTlTeam(member, job, actor) {
  if (!member) return false;
  const memberTeam = String(member.team_id || '').trim();
  if (!memberTeam) return false;
  const keys = [job?.team_id, job?.routed_tl_emp_id, actor?.empId]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return keys.includes(memberTeam);
}

function decodePdfBase64(value) {
  if (!value) return null;
  const buf = Buffer.from(String(value).replace(/^data:[^;,]*(;base64)?,/, ''), 'base64');
  return buf.length ? buf : null;
}

export async function originalTenderPackFile(db, job) {
  const ref = job?.tender_pdf || {};
  if (ref.pdf_r2_key || ref.pdf_url || ref.r2_key || ref.url) {
    const fromJobRef = await fetchTenderPDFBuffer({
      pdf_url: ref.pdf_url || ref.url,
      pdf_filename: ref.pdf_filename || ref.name,
      pdf_r2_key: ref.pdf_r2_key || ref.r2_key,
    });
    if (fromJobRef?.length) {
      return { buffer: fromJobRef, name: ref.pdf_filename || ref.name || `${job.bid_no || 'tender'}.pdf` };
    }
  }
  const fromSlot = await fetchWorkflowDocumentBuffer({
    r2_key: ref.pdf_r2_key || ref.r2_key,
    file_r2_key: ref.pdf_r2_key || ref.r2_key,
    url: ref.pdf_url || ref.url,
    pdf_base64: ref.pdf_base64 || ref.base64,
    name: ref.pdf_filename || ref.name,
  }, { jobId: job?._id });
  if (fromSlot?.length) {
    return { buffer: fromSlot, name: ref.pdf_filename || ref.name || `${job.bid_no || 'tender'}.pdf` };
  }
  const fromInline = decodePdfBase64(ref.pdf_base64 || ref.base64);
  if (fromInline?.length) {
    return { buffer: fromInline, name: ref.pdf_filename || ref.name || `${job.bid_no || 'tender'}.pdf` };
  }
  if (String(job?.tender_id || '').startsWith('client-req:')) return null;
  const tender = await findTenderDoc(db, {
    tender_id: job.tender_id || ref.tender_id,
    bid_no: job.bid_no || ref.bid_no,
  });
  if (!tender) return null;
  const fromR2 = await fetchTenderPDFBuffer({
    pdf_url: tender.pdf_url,
    pdf_filename: tender.pdf_filename,
    pdf_r2_key: tender.pdf_r2_key,
  });
  if (fromR2?.length) {
    return { buffer: fromR2, name: tender.pdf_filename || `${job.bid_no || 'tender'}.pdf` };
  }
  if (tender.pdf_base64) {
    const buf = Buffer.from(String(tender.pdf_base64).replace(/^data:[^;,]*(;base64)?,/, ''), 'base64');
    if (buf.length) {
      return { buffer: buf, name: tender.pdf_filename || `${job.bid_no || 'tender'}.pdf` };
    }
  }
  return null;
}

function liveJobDoc(actor, tender, extra = {}) {
  return {
    status: JOB_STATUS.LIVE,
    display_status: null,
    team_id: null,
    routed_tl_emp_id: null,
    assigned_emp_id: null,
    assigned_emp_name: null,
    created_by_tl: actorLabel(actor),
    title: extra.title || tender.title || '',
    notes: extra.notes || '',
    tender_id: String(tender._id),
    bid_no: tender.bid_no || extra.bid_no || null,
    last_date: tender.last_date || null,
    department: tender.department || null,
    district: tender.district || null,
    tender_pdf: tenderPdfRef(tender),
    sow: null,
    checklist_file: null,
    prep_files: [],
    bounced_slots: [],
    receipt: null,
    client_email: null,
    client_name: null,
    parked_client_email: null,
    parked_client_name: null,
    parked_at: null,
    parked_by: null,
    suggested_by: null,
    history: [],
    created_at: new Date(),
    updated_at: new Date(),
  };
}

async function cloneLiveShell(db, actor, job) {
  const clone = {
    status: JOB_STATUS.LIVE,
    display_status: null,
    team_id: job.team_id || null,
    routed_tl_emp_id: job.routed_tl_emp_id || null,
    assigned_emp_id: job.assigned_emp_id || null,
    assigned_emp_name: job.assigned_emp_name || null,
    created_by_tl: job.created_by_tl,
    title: job.title,
    notes: job.notes || '',
    tender_id: job.tender_id,
    bid_no: job.bid_no,
    last_date: job.last_date,
    tender_date: job.tender_date,
    department: job.department,
    district: job.district,
    tender_pdf: job.tender_pdf || null,
    sow: null,
    checklist_file: null,
    prep_files: [],
    bounced_slots: [],
    receipt: null,
    client_email: null,
    client_name: null,
    parked_client_email: null,
    parked_client_name: null,
    parked_at: null,
    parked_by: null,
    suggested_by: null,
    cloned_from: String(job._id),
    history: [],
    created_at: new Date(),
    updated_at: new Date(),
  };
  clone.history = pushHistory(clone, { actor, action: 'clone', to: JOB_STATUS.LIVE, note: `from ${job._id}` });
  const result = await jobsCol(db).insertOne(clone);
  return { ...clone, _id: result.insertedId };
}

async function parkOnto(db, actor, job, client) {
  const email = String(client.email || '').trim().toLowerCase();
  let target = job;
  const occupied = target.status === JOB_STATUS.AWAITING_CLIENT
    || target.client_email
    || (target.parked_client_email && target.parked_client_email !== email);
  if (occupied) {
    target = await cloneLiveShell(db, actor, target);
  }
  if (target.parked_client_email === email && target.status === JOB_STATUS.LIVE && !target.sow) {
    return target;
  }
  return saveJob(db, target._id, {
    parked_client_email: email,
    parked_client_name: parkedName(client, email),
    parked_client_id: client.client_id || null,
    parked_at: new Date(),
    parked_by: actor.empId || actor.role || 'MD',
    history: pushHistory(target, { actor, action: 'park_client', note: email }),
  });
}

async function ensureAndPark(db, actor, tender, client, extra = {}) {
  const tenderId = String(tender._id);
  const email = String(client.email || '').trim().toLowerCase();
  const samePark = await jobsCol(db).findOne({
    tender_id: tenderId,
    status: JOB_STATUS.LIVE,
    parked_client_email: email,
  });
  if (samePark && !samePark.sow) return samePark;

  const freeLive = await jobsCol(db).findOne({
    tender_id: tenderId,
    status: JOB_STATUS.LIVE,
    $and: [
      { $or: [{ parked_client_email: { $exists: false } }, { parked_client_email: null }, { parked_client_email: '' }] },
      { $or: [{ client_email: { $exists: false } }, { client_email: null }, { client_email: '' }] },
    ],
  });
  if (freeLive && isFreeLive(freeLive)) {
    const parked = await parkOnto(db, actor, freeLive, client);
    if (extra.title && !String(parked.title || '').trim()) {
      return saveJob(db, parked._id, { title: extra.title });
    }
    return parked;
  }

  const any = await jobsCol(db).findOne({
    tender_id: tenderId,
    status: { $in: [JOB_STATUS.LIVE, JOB_STATUS.AWAITING_CLIENT] },
  });
  if (any) {
    const cloned = await cloneLiveShell(db, actor, any);
    return parkOnto(db, actor, cloned, client);
  }

  const job = liveJobDoc(actor, tender, { notes: 'Parked on Suggestion Bar', title: extra.title, bid_no: extra.bid_no });
  job.history = pushHistory(job, { actor, action: 'md_forward_gm', to: JOB_STATUS.LIVE });
  const result = await jobsCol(db).insertOne(job);
  return parkOnto(db, actor, { ...job, _id: result.insertedId }, client);
}

function clientRequestPdfRef(req, tenderId) {
  if (!req) return null;
  const hasFile = Boolean(req.file_r2_key || req.file_url || req.file_base64);
  if (!hasFile) return null;
  const name = req.file_name || `${req.link_or_id || 'attachment'}.pdf`;
  return {
    tender_id: tenderId,
    bid_no: req.link_or_id || null,
    pdf_url: req.file_url || null,
    pdf_r2_key: req.file_r2_key || null,
    pdf_filename: name,
    name,
    ...(req.file_base64 ? { pdf_base64: req.file_base64 } : {}),
  };
}

export async function parkClientBidSupport(db, actor, req) {
  const email = String(req?.client_email || '').trim().toLowerCase();
  const client = (await findExistingClient(db, email))
    || (await findExistingClient(db, req?.client_id));
  if (!client) return { error: 'Client not found.', status: 404 };

  await ensureWorkflowIndexes(db);
  const link = String(req.link_or_id || '').trim();
  const title = String(req.description || '').split('\n')[0].slice(0, 180) || link || 'Client bid request';

  const catalog = await findTenderDoc(db, { tender_id: link, bid_no: link });
  if (catalog) {
    const parked = await ensureAndPark(db, actor, catalog, client, {
      title: catalog.title || title,
      bid_no: catalog.bid_no || link,
    });
    return { job: parked, client };
  }

  const requestId = String(req._id);
  const tenderId = `client-req:${requestId}`;
  const parkedEmail = String(client.email || email).trim().toLowerCase();
  const samePark = await jobsCol(db).findOne({
    tender_id: tenderId,
    status: JOB_STATUS.LIVE,
    parked_client_email: parkedEmail,
  });
  if (samePark) return { job: samePark, client };

  const job = {
    status: JOB_STATUS.LIVE,
    display_status: null,
    team_id: null,
    routed_tl_emp_id: null,
    assigned_emp_id: null,
    assigned_emp_name: null,
    created_by_tl: actorLabel(actor),
    title,
    notes: [req.description, link && link !== title ? `Reference: ${link}` : '']
      .filter(Boolean)
      .join('\n\n'),
    tender_id: tenderId,
    bid_no: link || null,
    last_date: null,
    department: null,
    district: null,
    tender_pdf: clientRequestPdfRef(req, tenderId),
    sow: null,
    checklist_file: null,
    prep_files: [],
    bounced_slots: [],
    receipt: null,
    client_email: null,
    client_name: null,
    client_request_id: requestId,
    parked_client_email: parkedEmail,
    parked_client_name: parkedName(client, parkedEmail),
    parked_client_id: client.client_id || req.client_id || null,
    parked_at: new Date(),
    parked_by: actor.empId || actor.role || 'GM',
    suggested_by: { emp_id: actor.empId || null, name: actor.name || null, email: actor.email || null },
    history: [],
    created_at: new Date(),
    updated_at: new Date(),
  };
  job.history = pushHistory(job, { actor, action: 'park_client', to: JOB_STATUS.LIVE, note: parkedEmail });
  const result = await jobsCol(db).insertOne(job);
  return { job: { ...job, _id: result.insertedId }, client };
}

async function fileFromForm(form, field = 'file') {
  const file = form.get(field);
  if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') return null;
  const buf = Buffer.from(await file.arrayBuffer());
  if (!buf.length) return null;
  return { buffer: buf, name: file.name || 'document.pdf', type: file.type || 'application/pdf' };
}

function isPdfBuffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 5) return false;
  return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
}

function requirePdfFile(file, label = 'PDF') {
  if (!file) return `${label} is required.`;
  if (file.buffer.length > WORKFLOW_MAX_UPLOAD_BYTES) {
    return `${label} must be under 4MB. Larger files are rejected by the host (413) before upload can finish.`;
  }
  if (!isPdfBuffer(file.buffer)) return `${label} must be a valid PDF file.`;
  return null;
}

async function uploadSlot(jobId, file, hint) {
  const uploaded = await uploadWorkflowDocument(file.buffer, file.name, {
    jobId,
    contentType: file.type,
  });
  if (uploaded?.key) {
    return { r2_key: uploaded.key, url: uploaded.url, name: file.name, kind: hint || 'other' };
  }
  // R2 is staging only. Keep bytes on the job so Confirm can still pack Drive.
  // Staff sanitize strips pdf_base64 from queue JSON.
  console.warn('[workflow] R2 upload failed; storing document on the job for Drive pack.');
  return {
    r2_key: null,
    url: null,
    name: file.name,
    kind: hint || 'other',
    pdf_base64: file.buffer.toString('base64'),
  };
}

function bidDriveFolderName(job) {
  const bid = String(job?.bid_no || '').trim();
  const title = String(job?.title || '').trim();
  if (bid && title) return safeDriveName(`${bid} - ${title}`, 'Tender');
  return safeDriveName(bid || title, 'Tender');
}

async function collectDrivePackFiles(db, job, receiptBuf, receiptName) {
  const packFiles = [];
  const tenderFile = await originalTenderPackFile(db, job);
  if (!tenderFile?.buffer?.length) {
    return { error: 'Original tender PDF is missing. Drive pack cannot complete.' };
  }
  packFiles.push({
    buffer: tenderFile.buffer,
    name: `Tender - ${safeDriveName(tenderFile.name, `${job.bid_no || 'tender'}.pdf`)}`,
  });

  const sowBuf = await bufferFromWorkflowSlot(job.sow, job);
  if (!sowBuf?.length) return { error: 'SOW PDF is missing. Drive pack cannot complete.' };
  packFiles.push({ buffer: sowBuf, name: `SOW - ${safeDriveName(job.sow?.name, 'sow.pdf')}` });

  const checkBuf = await bufferFromWorkflowSlot(job.checklist_file, job);
  if (!checkBuf?.length) return { error: 'Checklist PDF is missing. Drive pack cannot complete.' };
  packFiles.push({
    buffer: checkBuf,
    name: `Checklist - ${safeDriveName(job.checklist_file?.name, 'checklist.pdf')}`,
  });

  const prep = Array.isArray(job.prep_files) ? job.prep_files : [];
  if (!prep.length) return { error: 'Employee prep documents are missing. Drive pack cannot complete.' };
  for (let i = 0; i < prep.length; i += 1) {
    const slot = prep[i];
    const buf = await bufferFromWorkflowSlot(slot, job);
    if (!buf?.length) {
      return { error: `Could not read employee prep file ${slot.name || i + 1} for Drive push.` };
    }
    packFiles.push({ buffer: buf, name: `Prep ${i + 1} - ${safeDriveName(slot.name, `prep-${i + 1}.pdf`)}` });
  }

  if (!receiptBuf?.length) return { error: 'Upload the Submission Receipt PDF first.' };
  packFiles.push({
    buffer: receiptBuf,
    name: `Receipt - ${safeDriveName(receiptName || job.receipt?.name, 'receipt.pdf')}`,
  });
  return { packFiles };
}

export async function handleQueueGet(request) {
  const { actor, error } = await requireStaffActor(request);
  if (error) return error;
  const db = await getDb();
  const board = request.nextUrl.searchParams.get('board') || 'all';
  let filter;
  if (board === 'suggestions') {
    filter = { status: JOB_STATUS.AWAITING_CLIENT };
  } else if (board === 'parked') {
    filter = {
      status: JOB_STATUS.LIVE,
      parked_client_email: { $exists: true, $nin: [null, ''] },
    };
  } else if (board === 'submitted') {
    filter = { status: { $in: SUBMITTED_BOARD_STATUSES } };
  } else {
    filter = queueFilterForActor(actor);
    if (board === 'internal') filter.status = { $in: INTERNAL_BOARD_STATUSES };
    else if (board === 'winning') filter.status = JOB_STATUS.WON;
    else if (board === 'live') {
      filter.status = JOB_STATUS.LIVE;
      filter.$and = [
        ...(filter.$and || []),
        { $or: [{ parked_client_email: { $exists: false } }, { parked_client_email: null }, { parked_client_email: '' }] },
      ];
    } else if (board === 'awaiting_publish') filter.status = JOB_STATUS.AWAITING_PUBLISH;
  }
  const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get('limit')) || 100));
  const page = Math.max(1, Number(request.nextUrl.searchParams.get('page')) || 1);
  const skip = (page - 1) * limit;
  const projection = {
    'tender_pdf.pdf_base64': 0,
    'sow.pdf_base64': 0,
    'checklist_file.pdf_base64': 0,
    'receipt.pdf_base64': 0,
    'prep_files.pdf_base64': 0,
    history: 0,
  };
  const col = jobsCol(db);
  const [total, jobs] = await Promise.all([
    col.countDocuments(filter),
    col.find(filter, { projection }).sort({ updated_at: -1, created_at: -1 }).skip(skip).limit(limit).toArray(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / limit) || 1);
  return json({
    jobs: jobs.map((j) => sanitizeJobForAudience(j, 'staff')),
    page,
    limit,
    total,
    totalPages,
    hasMore: page < totalPages,
  });
}

export async function handleJobsGet(request) {
  return handleQueueGet(request);
}

export async function handleJobsPost(request) {
  const { actor, error } = await requireStaffActor(request);
  if (error) return error;
  const body = await request.json().catch(() => ({}));

  const clientEmail = String(body.client_email || '').trim().toLowerCase();
  const clientId = String(body.client_id || '').trim();
  const isClientPitch = Boolean(clientEmail || clientId);
  const tenderRef = rawId(body.tender_id || body.id) || String(body.bid_no || '').trim();

  // Park a client onto the Suggestion Bar. Never attach SOW here — GM sends SOW later.
  if (isClientPitch) {
    const db = await getDb();
    await ensureWorkflowIndexes(db);
    if (actor.role !== 'MD' && !isGm(actor)) {
      return deny('Only GM or MD can park a tender on the Suggestion Bar.', 403);
    }
    const tender = await findTenderDoc(db, body);
    if (!tender) return deny('Tender not found.', 404);
    const client = await findClientDoc(db, body);
    if (!client) return deny('Client not found.', 404);
    const { canParticipate } = await import('@/lib/billing-access');
    if (!canParticipate(client)) {
      return deny('This client needs a participate plan or bid balance before a tender can be suggested.', 403);
    }
    const parked = await ensureAndPark(db, actor, tender, client, { title: body.title, bid_no: body.bid_no });
    return json({ success: true, job: sanitizeJobForAudience(parked, 'staff') });
  }

  if (tenderRef) {
    const db = await getDb();
    await ensureWorkflowIndexes(db);
    if (!(await actorCanPitch(db, actor))) {
      return deny('Only MD or GM can forward a live tender.', 403);
    }
    const tender = await findTenderDoc(db, body);
    if (!tender) return deny('Tender not found.', 404);
    const tenderId = String(tender._id);
    const existing = await jobsCol(db).findOne({
      tender_id: tenderId,
      status: JOB_STATUS.LIVE,
      $and: [
        { $or: [{ parked_client_email: { $exists: false } }, { parked_client_email: null }, { parked_client_email: '' }] },
        { $or: [{ client_email: { $exists: false } }, { client_email: null }, { client_email: '' }] },
      ],
    });
    if (existing) {
      return json({ success: true, job: sanitizeJobForAudience(existing, 'staff'), reused: true });
    }
    const job = liveJobDoc(actor, tender, { title: body.title, bid_no: body.bid_no, notes: 'Forwarded to GM Suggestion Module' });
    job.history = pushHistory(job, { actor, action: 'md_forward_gm', to: JOB_STATUS.LIVE });
    const result = await jobsCol(db).insertOne(job);
    return json({ success: true, job: sanitizeJobForAudience({ ...job, _id: result.insertedId }, 'staff') }, 201);
  }

  if (!isTl(actor) && actor.role !== 'MD') return deny('Only a Doc Team TL can create a task.');
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

function workflowSlotKeys(job) {
  const keys = [];
  const push = (slot) => {
    if (slot?.r2_key) keys.push(slot.r2_key);
  };
  push(job?.sow);
  push(job?.checklist_file);
  push(job?.receipt);
  for (const file of job?.prep_files || []) push(file);
  return keys;
}

export async function handleJobDelete(request, id) {
  const { actor, error } = await requireStaffActor(request);
  if (error) return error;
  if (actor.role !== 'MD') return deny('Only MD can delete a workflow card.', 403);

  const db = await getDb();
  let job = await loadJob(db, id);
  if (!job) job = await loadArchivedJob(db, id);
  if (!job) return deny('Job not found.', 404);

  const oid = asObjectId(id) || job._id;
  for (const key of workflowSlotKeys(job)) {
    try { await deleteR2Key(key); } catch { /* still remove the card */ }
  }
  await jobsCol(db).deleteOne({ _id: oid });
  await db.collection('workflow_archive').deleteOne({ _id: oid });
  return json({ success: true, deleted: true, status: job.status || null });
}

export async function handlePublishAttach(request, id) {
  const { actor, error } = await requireStaffActor(request);
  if (error) return error;
  const db = await getDb();
  const job = await loadJob(db, id);
  if (!job) return deny('Job not found.', 404);
  if (!canSeeJob(actor, job)) return deny('Not allowed.');
  if (job.status !== JOB_STATUS.AWAITING_PUBLISH) return deny('This job is not waiting to be published.', 400);
  if (isMember(actor) && String(job.assigned_emp_id || '') !== String(actor.empId || '')) return deny('This task is not assigned to you.');
  if (isTl(actor) && String(job.team_id || '') !== String(actor.empId || '')) return deny('Not your team.');

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
    tender_pdf: tenderPdfRef(tender),
    history: pushHistory(job, { actor, action: 'publish_attach', from: job.status, to: JOB_STATUS.LIVE }),
  });
  return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
}

export async function handleSuggest(request, id) {
  const { actor, error } = await requireStaffActor(request);
  if (error) return error;

  try {
    const db = await getDb();
    if (!isGm(actor)) return deny('Only GM can attach a SOW and forward to the client.', 403);
    const job = await loadJob(db, id);
    if (!job) return deny('Job not found.', 404);
    if (job.status !== JOB_STATUS.LIVE) {
      return deny('Attach SOW on a live tender.', 400);
    }

    const contentType = String(request.headers.get('content-type') || '');
    let clientEmail = '';
    let clientId = '';
    let file = null;
    let quotationRequired = false;
    if (contentType.includes('application/json') && !contentType.includes('multipart/form-data')) {
      const body = await request.json().catch(() => ({}));
      clientEmail = String(body.client_email || '').trim().toLowerCase();
      clientId = String(body.client_id || '').trim();
      quotationRequired = ['true', '1', 'yes'].includes(String(body.quotation_required ?? '').trim().toLowerCase());
    } else {
      const form = await request.formData().catch(() => null);
      if (form) {
        clientEmail = String(form.get('client_email') || '').trim().toLowerCase();
        clientId = String(form.get('client_id') || '').trim();
        quotationRequired = ['true', '1', 'yes'].includes(String(form.get('quotation_required') ?? '').trim().toLowerCase());
        file = await fileFromForm(form, 'sow') || await fileFromForm(form, 'file');
      }
    }

    if (!file) return deny('SOW PDF is required.', 400);
    const sowPdfError = requirePdfFile(file, 'SOW PDF');
    if (sowPdfError) return deny(sowPdfError, 400);
    file.type = 'application/pdf';

    const parkedEmail = String(job.parked_client_email || '').trim().toLowerCase();
    const parkedId = String(job.parked_client_id || job.client_id || '').trim();
    const targetEmail = (clientEmail || parkedEmail).toLowerCase();
    const targetId = clientId || parkedId;
    if (!targetEmail && !targetId) return deny('Select a client.', 400);
    if (parkedEmail && clientEmail && targetEmail !== parkedEmail) {
      return deny('SOW must be attached for the parked client.', 400);
    }
    const client = await findClientDoc(db, { client_email: targetEmail, client_id: targetId });
    if (!client) return deny('Client not found.', 404);
    const resolvedEmail = String(client.email || targetEmail).trim().toLowerCase();
    if (!resolvedEmail) return deny('Client email is missing.', 400);

    let sow;
    try {
      sow = await uploadSlot(id, file, 'sow');
    } catch (err) {
      return deny(err.message || 'File storage failed.', 500);
    }
    const tender = await findTenderDoc(db, { tender_id: job.tender_id, bid_no: job.bid_no });
    const tender_pdf = tender ? tenderPdfRef(tender) : (job.tender_pdf || null);
    const next = await saveJob(db, id, {
      status: JOB_STATUS.AWAITING_CLIENT,
      display_status: DISPLAY_STATUS.PENDING_APPROVAL,
      client_email: resolvedEmail,
      client_id: client.client_id || targetId || null,
      client_name: parkedName(client, resolvedEmail),
      quotation_required: quotationRequired,
      sow: { ...sow, name: file.name },
      tender_id: tender ? String(tender._id) : job.tender_id,
      bid_no: tender?.bid_no || job.bid_no || null,
      tender_pdf,
      suggested_by: { emp_id: actor.empId, name: actor.name, email: actor.email },
      parked_client_email: null,
      parked_client_name: null,
      parked_client_id: null,
      parked_at: null,
      parked_by: null,
      history: pushHistory(job, { actor, action: 'suggest_sow', from: job.status, to: JOB_STATUS.AWAITING_CLIENT, note: resolvedEmail }),
    });

    await db.collection('dispatches').insertOne({
      target_type: 'client_alert',
      target_id: resolvedEmail,
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
  } catch (err) {
    console.error('[workflow] suggest SOW failed:', err?.message || err);
    return deny(err.message || 'SOW upload failed.', 500);
  }
}

export async function handleUnpark(request, id) {
  const { actor, error } = await requireStaffActor(request);
  if (error) return error;
  const db = await getDb();
  if (!(await actorCanPitch(db, actor))) return deny('Only MD or GM can remove a parked suggestion.');
  const job = await loadJob(db, id);
  if (!job) return deny('Job not found.', 404);
  if (job.status !== JOB_STATUS.LIVE) return deny('Only parked live tenders can be removed from the Suggestion Bar.', 400);
  if (!job.parked_client_email) return deny('This tender is not on the Suggestion Bar.', 400);

  const next = await saveJob(db, id, {
    parked_client_email: null,
    parked_client_name: null,
    parked_at: null,
    parked_by: null,
    history: pushHistory(job, { actor, action: 'unpark_suggestion', from: job.status, to: job.status }),
  });
  return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
}

export async function handleClientQuotation(request, id) {
  const db = await getDb();
  const job = await loadJob(db, id);
  if (!job) return deny('Job not found.', 404);
  if (job.status !== JOB_STATUS.AWAITING_CLIENT) return deny('This tender is not waiting for your approval.', 400);
  if (!job.quotation_required) return deny('This tender does not require a quotation.', 400);

  const email = String(await resolveClientEmail(request) || '').trim().toLowerCase();
  if (!email) return deny('Client identity required.', 401);
  if (String(job.client_email || '').toLowerCase() !== email) {
    return deny('You can only upload a quotation for your own tender.', 403);
  }

  const form = await request.formData().catch(() => null);
  const file = form ? (await fileFromForm(form, 'quotation') || await fileFromForm(form, 'file')) : null;
  if (!file) return deny('Quotation PDF is required.', 400);
  const pdfError = requirePdfFile(file, 'Quotation PDF');
  if (pdfError) return deny(pdfError, 400);
  file.type = 'application/pdf';

  let quotation;
  try {
    quotation = await uploadSlot(id, file, 'quotation');
  } catch (err) {
    return deny(err.message || 'File storage failed.', 500);
  }

  const next = await saveJob(db, id, {
    quotation: { ...quotation, name: file.name },
    history: pushHistory(job, { actor: { name: email, email }, action: 'upload_quotation', note: file.name }),
  });
  return json({ success: true, job: sanitizeJobForAudience(next, 'client') });
}

export async function handleClientApprove(request, id) {
  const db = await getDb();
  const job = await loadJob(db, id);
  if (!job) return deny('Job not found.', 404);
  if (job.status !== JOB_STATUS.AWAITING_CLIENT) return deny('This tender is not waiting for your approval.', 400);

  const email = String(await resolveClientEmail(request) || '').trim().toLowerCase();
  if (!email) return deny('Client identity required.', 401);
  if (String(job.client_email || '').toLowerCase() !== email) {
    return deny('You can only approve tenders suggested to your account.', 403);
  }
  const hasQuotation = Boolean(job.quotation?.r2_key || job.quotation?.pdf_base64);
  if (job.quotation_required && !hasQuotation) {
    return deny('Please upload the required quotation to proceed.', 400);
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

export async function handleClientReject(request, id) {
  const db = await getDb();
  const job = await loadJob(db, id);
  if (!job) return deny('Job not found.', 404);
  if (job.status !== JOB_STATUS.AWAITING_CLIENT) return deny('This tender is not waiting for your approval.', 400);

  const email = String(await resolveClientEmail(request) || '').trim().toLowerCase();
  if (!email) return deny('Client identity required.', 401);
  if (String(job.client_email || '').toLowerCase() !== email) {
    return deny('You can only reject tenders suggested to your account.', 403);
  }

  if (job.sow?.r2_key) {
    try { await deleteR2Key(job.sow.r2_key); } catch { /* keep reverting even if storage cleanup fails */ }
  }

  const next = await saveJob(db, id, {
    status: JOB_STATUS.LIVE,
    display_status: null,
    client_email: null,
    client_name: null,
    sow: null,
    suggested_by: job.suggested_by || null,
    parked_client_email: null,
    parked_client_name: null,
    parked_at: null,
    parked_by: null,
    history: pushHistory(job, { actor: { name: email, email }, action: 'client_reject', from: job.status, to: JOB_STATUS.LIVE }),
  });

  await db.collection('dispatches').updateMany(
    { workflow_job_id: String(id), target_id: email },
    { $set: { status: 'Completed', client_reply: 'Client Rejected the Tender', reply: 'Client Rejected the Tender' } }
  );

  await createOpsAlert(db, {
    recipient_emp_id: job.suggested_by?.emp_id || null,
    type: 'CLIENT_REJECT',
    message: `${email} rejected ${job.bid_no || job.title}. Job returned to LIVE.`,
    job_id: id,
  });

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
  const checklistPdfError = requirePdfFile(file, 'Checklist PDF');
  if (checklistPdfError) return deny(checklistPdfError, 400);
  file.type = 'application/pdf';

  const tl = await db.collection('employees').findOne({
    emp_id: tlEmpId,
    deleted: { $ne: true },
    active: { $ne: false },
  });
  if (!tl || resolveStaffDesignation(tl) !== DESIGNATIONS.DOC_TEAM_TL) {
    return deny('Selected person is not a Doc Team TL.', 400);
  }

  let checklist;
  try {
    checklist = await uploadSlot(id, file, 'checklist');
  } catch (err) {
    return deny(err.message || 'File storage failed.', 500);
  }
  const next = await saveJob(db, id, {
    status: JOB_STATUS.TL_ASSIGN,
    display_status: DISPLAY_STATUS.IN_PROGRESS,
    routed_tl_emp_id: tlEmpId,
    team_id: tlEmpId,
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
  if (String(job.assigned_emp_id || '') !== String(actor.empId || '') && actor.role !== 'MD') {
    return deny('Only the assigned maker can upload files.');
  }

  const file = await fileFromForm(form, 'file');
  if (!file) return deny('Choose a file to upload.', 400);
  const prepPdfError = requirePdfFile(file, 'Employee file');
  if (prepPdfError) return deny(prepPdfError, 400);
  file.type = 'application/pdf';

  const prep = Array.isArray(job.prep_files) ? [...job.prep_files] : [];
  const bouncedSlots = (job.bounced_slots || []).map(String).filter(Boolean);
  let slot = String(form.get('slot') || `slot-${Date.now()}`);
  let existingIdx = prep.findIndex((f) => f.slot === slot);
  if (existingIdx < 0 && bouncedSlots.length) {
    const bounceIdx = prep.findIndex((f) => bouncedSlots.includes(String(f.slot)));
    if (bounceIdx >= 0) {
      slot = String(prep[bounceIdx].slot);
      existingIdx = bounceIdx;
    }
  }
  const previousKey = existingIdx >= 0 ? prep[existingIdx].r2_key : null;
  let uploaded;
  try {
    uploaded = await uploadSlot(id, file, kind);
  } catch (err) {
    return deny(err.message || 'File storage failed.', 500);
  }
  const entry = {
    ...uploaded,
    slot,
    kind,
    name: file.name,
    r2_key: uploaded.r2_key || null,
    url: uploaded.url || null,
  };
  if (existingIdx >= 0) prep[existingIdx] = entry;
  else prep.push(entry);
  if (previousKey && previousKey !== entry.r2_key) {
    try { await deleteR2Key(previousKey); } catch { /* replacement already stored */ }
  }

  const bounced = (job.bounced_slots || []).filter((s) => String(s) !== String(slot));
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

  const contentType = String(request.headers.get('content-type') || '');
  let body = {};
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    request._workflowForm = form;
    body = { action: String(form.get('action') || '').trim() };
  } else {
    body = await request.json().catch(() => ({}));
  }
  const action = String(body.action || '').trim();

  if (action === 'assign_maker') {
    if (!isTl(actor) && actor.role !== 'MD') return deny('Only the Team Lead can assign a maker.');
    if (job.status !== JOB_STATUS.TL_ASSIGN) return deny('Assign a maker after MD routes the TL.', 400);
    const assignedEmpId = String(body.assigned_emp_id || '').trim();
    const member = await db.collection('employees').findOne({
      emp_id: assignedEmpId,
      deleted: { $ne: true },
      active: { $ne: false },
    });
    if (!member || !memberBelongsToTlTeam(member, job, actor)) {
      return deny('Employee must belong to this TL team.', 400);
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
    if (String(job.assigned_emp_id || '') !== String(actor.empId || '') && actor.role !== 'MD') return deny('Only the assigned maker can send to TL.');
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
    const note = String(body.note || '').trim();
    if (!note) return deny('A bounce note is required.', 400);
    const slots = Array.isArray(body.slots) ? body.slots.map(String).filter(Boolean) : [];
    if ((job.prep_files || []).length && !slots.length) return deny('Select at least one file to bounce.', 400);
    const next = await saveJob(db, id, {
      status: JOB_STATUS.MAKER_PREP,
      bounced_slots: slots,
      bounce_note: note,
      history: pushHistory(job, { actor, action, from: job.status, to: JOB_STATUS.MAKER_PREP, note }),
    });
    await createOpsAlert(db, {
      recipient_emp_id: job.assigned_emp_id,
      type: 'QC_BOUNCE',
      message: `TL bounced ${job.bid_no || job.title}: ${note}. Replace the marked files (old copies are deleted on re-upload).`,
      job_id: id,
    });
    try {
      await recordStaffRevolt(db, { emp_id: job.assigned_emp_id, job_id: id, action: 'bounce' });
    } catch (err) {
      console.warn('[staff-revolts]', err?.message || err);
    }
    return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
  }

  if (action === 'send_gm') {
    if (!isTl(actor) && actor.role !== 'MD') return deny('Only TL can pass to GM.');
    if (job.status !== JOB_STATUS.TL_QC) return deny('Pass to GM from TL QC.', 400);
    const next = await saveJob(db, id, {
      status: JOB_STATUS.GM_QC,
      bounced_slots: [],
      bounce_note: null,
      history: pushHistory(job, { actor, action, from: job.status, to: JOB_STATUS.GM_QC }),
    });
    return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
  }

  if (action === 'send_md') {
    if (!isGm(actor) && actor.role !== 'MD') return deny('Only GM can send to MD.');
    if (job.status !== JOB_STATUS.GM_QC) return deny('Send to MD from GM QC.', 400);
    const next = await saveJob(db, id, {
      status: JOB_STATUS.MD_SUBMIT,
      bounce_note: null,
      history: pushHistory(job, { actor, action, from: job.status, to: JOB_STATUS.MD_SUBMIT }),
    });
    return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
  }

  if (action === 'gm_bounce') {
    if (!isGm(actor) && actor.role !== 'MD') return deny('Only GM can bounce to TL.');
    if (job.status !== JOB_STATUS.GM_QC) return deny('GM bounce is only from GM QC.', 400);
    const note = String(body.note || '').trim();
    if (!note) return deny('A bounce note is required.', 400);
    const next = await saveJob(db, id, {
      status: JOB_STATUS.TL_QC,
      bounce_note: note,
      history: pushHistory(job, { actor, action, from: job.status, to: JOB_STATUS.TL_QC, note }),
    });
    await createOpsAlert(db, {
      recipient_emp_id: job.routed_tl_emp_id || job.team_id,
      type: 'QC_BOUNCE',
      message: `GM bounced ${job.bid_no || job.title}: ${note}`,
      job_id: id,
    });
    try {
      await recordStaffRevolt(db, {
        emp_id: job.routed_tl_emp_id || job.team_id,
        job_id: id,
        action: 'gm_bounce',
      });
    } catch (err) {
      console.warn('[staff-revolts]', err?.message || err);
    }
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
  if (job.status !== JOB_STATUS.AWAITING_RECEIPT) {
    return deny('Receipt is confirmed after Submit Tender.', 400);
  }

  let receiptBuf = null;
  let receiptName = job.receipt?.name || 'receipt.pdf';
  const form = request._workflowForm;
  const file = form
    ? (await fileFromForm(form, 'receipt') || await fileFromForm(form, 'file'))
    : null;
  if (file) {
    const receiptPdfError = requirePdfFile(file, 'Submission Receipt PDF');
    if (receiptPdfError) return deny(receiptPdfError, 400);
    file.type = 'application/pdf';
    if (job.receipt?.r2_key) {
      try { await deleteR2Key(job.receipt.r2_key); } catch { /* keep confirming */ }
    }
    const uploaded = await uploadSlot(id, file, 'receipt');
    receiptBuf = file.buffer;
    receiptName = file.name;
    job = await saveJob(db, id, {
      receipt: { ...uploaded, name: file.name },
      history: pushHistory(job, { actor, action: 'upload_receipt', note: file.name }),
    });
  } else {
    receiptBuf = await bufferFromWorkflowSlot(job.receipt, job);
  }
  if (!receiptBuf?.length) return deny('Upload the Submission Receipt PDF first.', 400);

  const { isDriveConfigured, uploadBidPackToClientDrive, resolveClientDriveFolder } = await import('@/lib/drive');
  if (!isDriveConfigured()) return deny('Google Drive is not configured. Submission cannot complete until Drive succeeds.', 500);

  const client = await findExistingClient(db, job.client_email)
    || await findExistingClient(db, job.client_id);
  if (!client) return deny('Mapped client is missing.', 400);

  const packed = await collectDrivePackFiles(db, job, receiptBuf, receiptName);
  if (packed.error) return deny(packed.error, packed.error.includes('Could not read') ? 500 : 400);

  const folderName = bidDriveFolderName(job);
  let driveResult;
  try {
    const repaired = await resolveClientDriveFolder({ db, client });
    if (!repaired?.folderId) {
      throw new Error('Drive folder was not created for this client.');
    }
    driveResult = await uploadBidPackToClientDrive({
      clientFolderId: repaired.folderId,
      folderName,
      files: packed.packFiles,
    });
  } catch (err) {
    const detail = String(err?.message || err || '').trim();
    console.error('[workflow] Drive pack failed:', detail);
    return deny(`Drive upload failed. Job stays unsubmitted until Drive succeeds. ${detail || 'Google Drive request failed.'}`, 502);
  }

  try {
    const { spendParticipateBid } = await import('@/lib/billing-access');
    const spent = await spendParticipateBid(db, client, 1);
    if (!spent.ok) console.error('[workflow] bid not deducted after Drive submit for', job.client_email || job.client_id);
  } catch (err) {
    console.error('[workflow] bid deduction failed after Drive submit:', err?.message || err);
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
  if (job.status !== JOB_STATUS.AWAITING_RECEIPT) {
    return deny('Receipt is uploaded after Submit Tender.', 400);
  }
  const form = request._workflowForm || await request.formData();
  const file = await fileFromForm(form, 'receipt') || await fileFromForm(form, 'file');
  if (!file) return deny('Submission Receipt PDF is required.', 400);
  const receiptPdfError = requirePdfFile(file, 'Submission Receipt PDF');
  if (receiptPdfError) return deny(receiptPdfError, 400);
  file.type = 'application/pdf';
  const previousKey = job.receipt?.r2_key || null;
  let uploaded;
  try {
    uploaded = await uploadSlot(id, file, 'receipt');
  } catch (err) {
    return deny(err.message || 'File storage failed.', 500);
  }
  if (previousKey && previousKey !== uploaded.r2_key) {
    try { await deleteR2Key(previousKey); } catch { /* replacement already stored */ }
  }
  const next = await saveJob(db, id, {
    receipt: { ...uploaded, name: file.name },
    history: pushHistory(job, { actor, action: 'upload_receipt', note: file.name }),
  });
  return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
}

export async function handleTracking(request, id) {
  const { actor, error } = await requireStaffActor(request);
  if (error) return error;
  if (actor.role === 'MD' || isGm(actor) || isTl(actor)) {
    return deny('Only the assigned employee can update submitted tracking.', 403);
  }

  const db = await getDb();
  const job = await loadJob(db, id);
  if (!job) return deny('Job not found.', 404);
  if (!actor.empId || String(job.assigned_emp_id || '') !== String(actor.empId)) {
    return deny('Only the assigned employee can update submitted tracking.', 403);
  }
  if (job.status !== JOB_STATUS.SUBMITTED) {
    return deny('Tracking stages apply after submission.', 400);
  }

  const body = await request.json().catch(() => ({}));
  const rawStage = String(body.tracking_status || body.status || '').trim();
  if (!rawStage) return deny('Tracking stage is required.', 400);
  const stage = parseTrackingStatus(rawStage);
  if (!stage) return deny('Invalid tracking stage.', 400);

  const current = currentTrackingStage(job);
  const outcome = stage === TRACKING_LABELS.WON || stage === TRACKING_LABELS.LOST;
  if (outcome) {
    if (current !== TRACKING_LABELS.BID_AWARDED) {
      return deny('Win or Loss is only available after Bid Awarded.', 400);
    }
  } else if (stage !== nextTrackingStage(current)) {
    return deny('That status is not the next stage.', 400);
  }

  const updatedAtIso = (row) => {
    const d = row?.updated_at ? new Date(row.updated_at) : new Date();
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  };

  if (stage === TRACKING_LABELS.LOST) {
    const archived = await archiveLostJob(db, job, actor);
    await db.collection('bids').updateMany({ workflow_job_id: String(id) }, { $set: { status: 'Lost' } });
    publishWorkflowEvent({
      jobId: String(job._id),
      status: JOB_STATUS.SUBMITTED,
      tracking_status: TRACKING_LABELS.LOST,
      display_status: TRACKING_LABELS.LOST,
      updated_at: updatedAtIso(archived),
      client_email: job.client_email || '',
      assigned_emp_id: job.assigned_emp_id || '',
      team_id: job.team_id || '',
      routed_tl_emp_id: job.routed_tl_emp_id || '',
      archived: true,
    });
    return json({ success: true, archived: true });
  }

  if (stage === DISPLAY_STATUS.WON) {
    const l1_price = Number(String(body.l1_price ?? '').replace(/,/g, '').trim());
    if (!Number.isFinite(l1_price) || l1_price <= 0) return deny('L1 price is required.', 400);
    const next = await saveJob(db, id, {
      status: JOB_STATUS.WON,
      display_status: DISPLAY_STATUS.WON,
      tracking_status: DISPLAY_STATUS.WON,
      l1_price,
      history: pushHistory(job, { actor, action: 'won', from: job.status, to: JOB_STATUS.WON, note: String(l1_price) }),
    });
    await db.collection('bids').updateMany(
      { workflow_job_id: String(id) },
      { $set: { status: 'Won', l1_price, contract_value: l1_price } },
    );
    publishWorkflowEvent({
      jobId: String(next._id),
      status: next.status,
      tracking_status: next.tracking_status,
      display_status: next.display_status,
      updated_at: updatedAtIso(next),
      client_email: next.client_email || '',
      assigned_emp_id: next.assigned_emp_id || '',
      team_id: next.team_id || '',
      routed_tl_emp_id: next.routed_tl_emp_id || '',
      archived: false,
    });
    return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
  }

  if (!TRACKING_STAGES.includes(stage)) return deny('Invalid tracking stage.', 400);
  const next = await saveJob(db, id, {
    tracking_status: stage,
    display_status: displayAfterSubmit(stage),
    history: pushHistory(job, { actor, action: 'tracking', note: stage }),
  });
  publishWorkflowEvent({
    jobId: String(next._id),
    status: next.status,
    tracking_status: next.tracking_status,
    display_status: next.display_status,
    updated_at: updatedAtIso(next),
    client_email: next.client_email || '',
    assigned_emp_id: next.assigned_emp_id || '',
    team_id: next.team_id || '',
    routed_tl_emp_id: next.routed_tl_emp_id || '',
    archived: false,
  });
  return json({ success: true, job: sanitizeJobForAudience(next, 'staff') });
}

export async function handleClone(request, id) {
  const { actor, error } = await requireStaffActor(request);
  if (error) return error;
  if (!canPitch(actor)) return deny('Only GM can clone a live tender for another client.');
  const db = await getDb();
  const job = await loadJob(db, id);
  if (!job) return deny('Job not found.', 404);
  if (!job.tender_id) return deny('Clone requires a published tender.', 400);
  const clone = await cloneLiveShell(db, actor, job);
  return json({ success: true, job: sanitizeJobForAudience(clone, 'staff') }, 201);
}

export async function handleArchiveGet(request) {
  const { actor, error } = await requireStaffActor(request);
  if (error) return error;
  if (actor.role !== 'MD' && !isGm(actor)) return deny('Only MD or GM can open the archive.', 403);
  const db = await getDb();
  const jobs = await listArchivedJobs(db);
  return json({ jobs: jobs.map((j) => sanitizeJobForAudience(j, 'staff')) });
}

export async function handleFileGet(request, id) {
  const db = await getDb();
  let job = await loadJob(db, id);
  let fromArchive = false;
  if (!job) {
    job = await loadArchivedJob(db, id);
    fromArchive = Boolean(job);
  }
  if (!job) return deny('Job not found.', 404);
  const slot = request.nextUrl.searchParams.get('slot') || 'sow';
  const isTenderSlot = slot === 'tender' || slot === 'tender_pdf';

  const staffHeader = String(request.headers.get('x-employee-email') || '').trim();
  const clientHeader = String(request.headers.get('x-client-id') || '').trim();
  const actor = await resolveActorRole(request);
  const useStaff = Boolean(staffHeader || (!clientHeader && actor?.role));

  if (fromArchive || useStaff) {
    if (!actor?.role) return deny('Please sign in with a staff account.', 401);
    if (fromArchive) {
      if (actor.role !== 'MD' && !isGm(actor) && !canSeeJob(actor, job)) return deny('Not allowed.');
    } else if (!canSeeJob(actor, job)) {
      return deny('Not allowed.');
    }
    const prepFile = (job.prep_files || []).find((file) => String(file?.slot || '') === String(slot));
    if (prepFile && !canViewPrepFiles(actor, job)) return deny(prepLockLabel(job.status), 403);
  } else {
    const clientEmail = await resolveClientEmail(request);
    const isClient = clientEmail && String(job.client_email || '').toLowerCase() === clientEmail;
    if (!isClient) return deny('Please sign in with a staff account.', 401);
    const allowed = isTenderSlot || slot === 'sow' || slot === 'quotation'
      || (slot === 'receipt' && (job.status === JOB_STATUS.SUBMITTED || job.status === JOB_STATUS.WON));
    if (!allowed) return deny('Internal files are not visible to clients.');
  }

  if (isTenderSlot) {
    const pack = await originalTenderPackFile(db, job);
    if (!pack?.buffer?.length) return deny('Original tender PDF is missing.', 404);
    const name = pack.name || 'tender.pdf';
    const head = Buffer.from(pack.buffer.subarray(0, 5)).toString('latin1');
    const zip = pack.buffer.length >= 4 && pack.buffer.subarray(0, 4).toString('hex') === '504b0304';
    const contentType = zip ? 'application/zip' : (head === '%PDF-' ? 'application/pdf' : 'application/octet-stream');
    const inline = contentType === 'application/pdf';
    return new NextResponse(new Uint8Array(pack.buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(name)}"`,
        'Content-Length': String(pack.buffer.length),
        'Cache-Control': 'no-store',
      },
    });
  }

  let meta = null;
  if (slot === 'sow') meta = job.sow;
  else if (slot === 'quotation') meta = job.quotation;
  else if (slot === 'checklist') meta = job.checklist_file;
  else if (slot === 'receipt') meta = job.receipt;
  else meta = (job.prep_files || []).find((f) => f.slot === slot);

  if (!meta) return deny('File not found.', 404);

  const buf = await bufferFromWorkflowSlot(meta, job);
  if (!buf?.length) return deny('Could not read file from storage.', 500);
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
  const db = await getDb();
  const queryEmail = String(request.nextUrl.searchParams.get('email') || '').trim();
  const ident = clientIdentFromRequest(request)
    || (await resolveClientEmail(request))
    || queryEmail
    || '';
  if (!ident) return deny('Client identity required.', 401);
  const user = await findExistingClient(db, ident);
  if (!user) return deny('Client not found.', 404);
  const email = String(user.email || '').toLowerCase();
  const jobs = await jobsCol(db).find({
    client_email: email,
    status: { $in: CLIENT_VISIBLE_STATUSES },
  }).sort({ updated_at: -1 }).toArray();
  return json({ jobs: jobs.map((j) => sanitizeJobForAudience(j, 'client')) });
}

export { json, deny };

import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { DESIGNATIONS } from '@/lib/designations';
import { TRACKING_LABELS, TRACKING_STAGES, normalizeTrackingStatus, parseTrackingStatus } from '@/lib/tracking-status';

export { TRACKING_STAGES, normalizeTrackingStatus, parseTrackingStatus };

export const JOB_STATUS = {
  AWAITING_PUBLISH: 'AWAITING_PUBLISH',
  LIVE: 'LIVE',
  AWAITING_CLIENT: 'AWAITING_CLIENT',
  MD_CHECKLIST: 'MD_CHECKLIST',
  TL_ASSIGN: 'TL_ASSIGN',
  MAKER_PREP: 'MAKER_PREP',
  TL_QC: 'TL_QC',
  GM_QC: 'GM_QC',
  MD_SUBMIT: 'MD_SUBMIT',
  AWAITING_RECEIPT: 'AWAITING_RECEIPT',
  SUBMITTED: 'SUBMITTED',
  WON: 'WON',
};

export const DISPLAY_STATUS = {
  PENDING_APPROVAL: 'Pending Approval',
  IN_PROGRESS: 'In Progress',
  SUBMITTED: 'Submitted',
  TECHNICAL_EVALUATION: TRACKING_LABELS.TECHNICAL_EVALUATION,
  FINANCIAL_EVALUATION: TRACKING_LABELS.FINANCIAL_EVALUATION,
  WON: TRACKING_LABELS.WON,
};

export const INTERNAL_BOARD_STATUSES = [
  JOB_STATUS.MD_CHECKLIST,
  JOB_STATUS.TL_ASSIGN,
  JOB_STATUS.MAKER_PREP,
  JOB_STATUS.TL_QC,
  JOB_STATUS.GM_QC,
  JOB_STATUS.MD_SUBMIT,
  JOB_STATUS.AWAITING_RECEIPT,
];

export const SUBMITTED_BOARD_STATUSES = [JOB_STATUS.SUBMITTED, JOB_STATUS.WON];

export const GM_VISIBLE_STATUSES = [
  JOB_STATUS.LIVE,
  JOB_STATUS.AWAITING_CLIENT,
  JOB_STATUS.MD_CHECKLIST,
  JOB_STATUS.TL_ASSIGN,
  JOB_STATUS.MAKER_PREP,
  JOB_STATUS.TL_QC,
  JOB_STATUS.GM_QC,
  JOB_STATUS.MD_SUBMIT,
  JOB_STATUS.AWAITING_RECEIPT,
  JOB_STATUS.SUBMITTED,
  JOB_STATUS.WON,
];

export const CLIENT_VISIBLE_STATUSES = [
  JOB_STATUS.AWAITING_CLIENT,
  JOB_STATUS.MD_CHECKLIST,
  JOB_STATUS.TL_ASSIGN,
  JOB_STATUS.MAKER_PREP,
  JOB_STATUS.TL_QC,
  JOB_STATUS.GM_QC,
  JOB_STATUS.MD_SUBMIT,
  JOB_STATUS.AWAITING_RECEIPT,
  JOB_STATUS.SUBMITTED,
  JOB_STATUS.WON,
];

const COLLECTION = 'workflow_jobs';
const ARCHIVE = 'workflow_archive';
const ALERTS = 'ops_alerts';

let indexesEnsured = false;
export async function ensureWorkflowIndexes(db) {
  if (indexesEnsured) return;
  try {
    await db.collection(COLLECTION).createIndex({ status: 1, assigned_emp_id: 1 });
    await db.collection(COLLECTION).createIndex({ status: 1, team_id: 1 });
    await db.collection(COLLECTION).createIndex({ client_email: 1 });
    await db.collection(COLLECTION).createIndex({ tender_id: 1 });
    await db.collection(ALERTS).createIndex({ recipient_emp_id: 1, status: 1, created_at: -1 });
    await db.collection(ARCHIVE).createIndex({ archived_at: -1 });
    await db.collection('staff_chats').createIndex({ created_at: 1 }, { expireAfterSeconds: 7 * 24 * 3600 });
    await db.collection('staff_chats').createIndex({ thread_key: 1, created_at: 1 });
    await db.collection('staff_chats').createIndex({ job_id: 1, created_at: 1 });
    indexesEnsured = true;
  } catch (err) {
    console.error('[workflow] ensure indexes failed:', err?.message || err);
  }
}

export function jobsCol(db) {
  return db.collection(COLLECTION);
}

export function asObjectId(id) {
  if (!id) return null;
  if (id instanceof ObjectId) return id;
  const s = String(id);
  return ObjectId.isValid(s) ? new ObjectId(s) : null;
}

export function actorLabel(actor) {
  if (!actor) return 'system';
  if (actor.role === 'MD') return actor.name || actor.email || 'MD';
  return actor.name || actor.empId || actor.email || 'staff';
}

export function pushHistory(job, { actor, action, from, to, note }) {
  const entry = {
    at: new Date(),
    by: actorLabel(actor),
    emp_id: actor?.empId || null,
    action,
    from: from || job.status,
    to: to || job.status,
    note: note || null,
  };
  return [...(job.history || []), entry];
}

export async function createOpsAlert(db, { recipient_emp_id, type, message, job_id }) {
  if (!recipient_emp_id) return;
  await db.collection(ALERTS).insertOne({
    recipient_emp_id,
    type,
    message,
    job_id: job_id ? String(job_id) : null,
    status: 'OPEN',
    created_at: new Date(),
  });
}

function sameStaffId(a, b) {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  return Boolean(left) && left === right;
}

export function queueFilterForActor(actor) {
  if (!actor || (!actor.role && !actor.empId)) return { _id: { $exists: false } };
  if (actor.role === 'MD') return {};
  if (actor.designation === DESIGNATIONS.GM) {
    return { status: { $in: GM_VISIBLE_STATUSES } };
  }
  if (actor.designation === DESIGNATIONS.DOC_TEAM_TL) {
    return { $or: [{ team_id: actor.empId }, { routed_tl_emp_id: actor.empId }] };
  }
  if (actor.empId) {
    return { assigned_emp_id: actor.empId };
  }
  return { _id: { $exists: false } };
}

export function canSeeJob(actor, job) {
  if (!job) return false;
  if (actor?.role === 'MD') return true;
  if (actor?.designation === DESIGNATIONS.GM) return GM_VISIBLE_STATUSES.includes(job.status);
  if (actor?.designation === DESIGNATIONS.DOC_TEAM_TL) {
    return sameStaffId(job.team_id, actor.empId) || sameStaffId(job.routed_tl_emp_id, actor.empId);
  }
  if (actor?.empId) return sameStaffId(job.assigned_emp_id, actor.empId);
  return false;
}

export function sanitizeJobForAudience(job, audience = 'staff') {
  if (!job) return null;
  const base = {
    ...job,
    _id: String(job._id),
  };
  if (audience === 'client') {
    const publicDisplay = [JOB_STATUS.AWAITING_CLIENT, JOB_STATUS.SUBMITTED, JOB_STATUS.WON].includes(job.status)
      ? job.display_status
      : DISPLAY_STATUS.IN_PROGRESS;
    return {
      _id: base._id,
      bid_no: job.bid_no,
      title: job.title,
      tender_id: job.tender_id || job.tender_pdf?.tender_id || null,
      tender_date: job.tender_date || job.last_date || null,
      last_date: job.last_date || null,
      status: job.status === JOB_STATUS.AWAITING_CLIENT ? JOB_STATUS.AWAITING_CLIENT : job.status,
      display_status: publicDisplay,
      sow: job.sow ? { name: job.sow.name } : null,
      tender_pdf: (job.tender_id || job.tender_pdf)
        ? { name: job.tender_pdf?.pdf_filename || job.tender_pdf?.name || `${job.bid_no || 'tender'}.pdf` }
        : null,
      receipt: job.status === JOB_STATUS.SUBMITTED || job.status === JOB_STATUS.WON
        ? (job.receipt ? { name: job.receipt.name } : null)
        : null,
      client_email: job.client_email,
      tracking_status: job.tracking_status || null,
    };
  }
  if (audience === 'md_public') {
    return {
      ...base,
      display_status: INTERNAL_BOARD_STATUSES.includes(job.status)
        ? DISPLAY_STATUS.IN_PROGRESS
        : job.display_status,
    };
  }
  const stripBlob = (slot) => {
    if (!slot || typeof slot !== 'object') return slot;
    const { pdf_base64, base64, ...meta } = slot;
    return meta;
  };
  if (base.sow) base.sow = stripBlob(base.sow);
  if (base.checklist_file) base.checklist_file = stripBlob(base.checklist_file);
  if (base.receipt) base.receipt = stripBlob(base.receipt);
  if (Array.isArray(base.prep_files)) base.prep_files = base.prep_files.map(stripBlob);
  return base;
}

export async function loadJob(db, id) {
  const oid = asObjectId(id);
  if (!oid) return null;
  return jobsCol(db).findOne({ _id: oid });
}

export async function saveJob(db, id, patch) {
  const oid = asObjectId(id);
  await jobsCol(db).updateOne({ _id: oid }, { $set: { ...patch, updated_at: new Date() } });
  return loadJob(db, id);
}

export function displayAfterSubmit(tracking) {
  const stage = parseTrackingStatus(tracking);
  if (stage === DISPLAY_STATUS.WON) return DISPLAY_STATUS.WON;
  if (TRACKING_STAGES.includes(stage)) return stage;
  return DISPLAY_STATUS.SUBMITTED;
}

export async function archiveLostJob(db, job, actor) {
  const oid = asObjectId(job._id) || job._id;
  const archived = {
    ...job,
    _id: oid,
    archived_at: new Date(),
    archived_by: actorLabel(actor),
    archive_reason: 'Lost',
  };
  await db.collection(ARCHIVE).replaceOne({ _id: oid }, archived, { upsert: true });
  const deleted = await jobsCol(db).deleteOne({ _id: oid });
  if (!deleted.deletedCount) {
    throw new Error('Archived copy saved but the live job could not be deleted from workflow_jobs.');
  }
  return archived;
}

export async function loadArchivedJob(db, id) {
  const oid = asObjectId(id);
  if (!oid) return null;
  return db.collection(ARCHIVE).findOne({ _id: oid });
}

export async function listArchivedJobs(db, limit = 200) {
  return db.collection(ARCHIVE).find({}).sort({ archived_at: -1 }).limit(limit).toArray();
}

export async function getDbReady() {
  const db = await getDb();
  await ensureWorkflowIndexes(db);
  return db;
}

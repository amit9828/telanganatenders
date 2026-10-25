import { getDb } from '@/lib/db';
import { asObjectId } from '@/lib/workflow';
import { DESIGNATIONS, isGmActor, resolveActorRole, resolveStaffDesignation } from '@/lib/staff-auth';
import { computeDocTaskStatus, compareDocTasks, normalizeIsoDate } from '@/lib/doc-task-dates';

export const DOC_TASK_DUPLICATE = 'This bid number is already on the sheet.';

export function docTaskConflict(message = DOC_TASK_DUPLICATE) {
  const err = new Error(message);
  err.code = 'DOC_TASK_CONFLICT';
  return err;
}

export function isDocTaskConflict(err) {
  return err?.code === 'DOC_TASK_CONFLICT' || err?.code === 11000;
}

function tasks(db) {
  return db.collection('doc_team_tasks');
}

function namesFromClient(client) {
  return {
    clientName: String(client?.client_name || '').trim(),
    companyName: String(client?.company_name || '').trim(),
  };
}

function deskOf(actor) {
  if (!actor?.role) return null;
  if (actor.role === 'MD') return 'md';
  if (isGmActor(actor)) return 'gm';
  if (actor.designation === DESIGNATIONS.DOC_TEAM_TL) return 'tl';
  if (actor.designation === DESIGNATIONS.DOC_TEAM_MEMBER && actor.empId) return 'maker';
  return null;
}

async function assertBidAvailable(db, bidNumber, workflowJobId) {
  if (!bidNumber) return;
  const other = await tasks(db).findOne({
    bidNumber,
    workflowJobId: { $ne: String(workflowJobId) },
  });
  if (other) throw docTaskConflict();
}

function identityFromJob(job, client) {
  const names = namesFromClient(client);
  const bidNumber = String(job?.bid_no || '').trim();
  return {
    workflowJobId: String(job._id),
    ...(bidNumber ? { bidNumber } : {}),
    clientEmail: String(job?.client_email || client?.email || '').trim().toLowerCase(),
    clientName: names.clientName,
    companyName: names.companyName,
    lastDate: normalizeIsoDate(job?.last_date),
  };
}

export async function ensureQuotationTask(db, job, client) {
  const identity = identityFromJob(job, client);
  if (!identity.clientEmail) {
    identity.clientEmail = String(job?.parked_client_email || client?.email || '').trim().toLowerCase();
  }
  await assertBidAvailable(db, identity.bidNumber, identity.workflowJobId);
  const now = new Date();
  const existing = await tasks(db).findOne({ workflowJobId: identity.workflowJobId });
  if (existing) {
    const status = existing.status || computeDocTaskStatus(existing);
    if (status !== 'Waiting for Quotation') return existing;
    const update = { $set: { ...identity, updatedAt: now } };
    if (!identity.bidNumber) update.$unset = { bidNumber: '' };
    await tasks(db).updateOne({ _id: existing._id }, update);
    return existing;
  }
  const created = {
    ...identity,
    quotationRequired: true,
    missingDocuments: false,
    workCompleted: false,
    assignedEmployeeId: '',
    assignedEmployeeName: '',
    status: 'Waiting for Quotation',
    clientNextUpdateDate: null,
    missingDocDetails: '',
    checklistError: '',
    remark: '',
    createdAt: now,
    updatedAt: now,
  };
  await tasks(db).insertOne(created);
  return created;
}

export async function ensureDocTaskFromSuggestion(db, job, client) {
  return ensureQuotationTask(db, job, client);
}

export async function backfillSuggestionDocTasks(db) {
  const jobs = await db.collection('workflow_jobs').find({
    $or: [
      { status: 'AWAITING_CLIENT' },
      { status: 'LIVE', parked_client_email: { $exists: true, $nin: [null, ''] } },
    ],
  }, { projection: { bid_no: 1, client_email: 1, parked_client_email: 1, last_date: 1 } }).toArray();
  if (!jobs.length) return;
  const emails = [...new Set(jobs.map((job) => String(job.client_email || job.parked_client_email || '').trim().toLowerCase()).filter(Boolean))];
  const users = emails.length
    ? await db.collection('users').find({ email: { $in: emails } }, { projection: { email: 1, client_name: 1, company_name: 1 } }).toArray()
    : [];
  const byEmail = new Map(users.map((user) => [String(user.email || '').toLowerCase(), user]));
  for (const job of jobs) {
    const email = String(job.client_email || job.parked_client_email || '').trim().toLowerCase();
    try {
      await ensureQuotationTask(db, { ...job, client_email: email || job.client_email }, byEmail.get(email) || null);
    } catch (err) {
      if (!isDocTaskConflict(err)) console.error('[doc-tasks] suggestion backfill skipped:', err?.message || err);
    }
  }
}

export async function deleteQuotationTaskForJob(db, jobId) {
  const workflowJobId = String(jobId || '');
  if (!workflowJobId) return;
  await tasks(db).deleteMany({ workflowJobId, status: 'Waiting for Quotation' });
}

const SUGGESTION_JOBS = {
  $or: [
    { status: 'AWAITING_CLIENT' },
    { status: 'LIVE', parked_client_email: { $exists: true, $nin: [null, ''] } },
  ],
};

function suggestionClientEmail(job) {
  return String(job?.client_email || job?.parked_client_email || '').trim().toLowerCase();
}

export async function retainJobsWithLiveClients(db, jobs) {
  const emails = [...new Set(jobs.map(suggestionClientEmail).filter(Boolean))];
  const users = emails.length
    ? await db.collection('users').find(
      { $expr: { $in: [{ $toLower: { $ifNull: ['$email', ''] } }, emails] } },
      { projection: { email: 1, client_name: 1, company_name: 1 } },
    ).toArray()
    : [];
  const byEmail = new Map(users.map((user) => [String(user.email || '').trim().toLowerCase(), user]));
  return {
    jobs: jobs.filter((job) => byEmail.has(suggestionClientEmail(job))),
    byEmail,
  };
}

export async function syncQuotationTasks(db) {
  const found = await db.collection('workflow_jobs').find(SUGGESTION_JOBS, {
    projection: { bid_no: 1, client_email: 1, parked_client_email: 1, last_date: 1 },
  }).toArray();
  const { jobs, byEmail } = await retainJobsWithLiveClients(db, found);
  const liveIds = new Set(jobs.map((job) => String(job._id)));
  const rows = await tasks(db).find({ status: 'Waiting for Quotation' }, { projection: { workflowJobId: 1 } }).toArray();
  const stale = rows.filter((row) => !liveIds.has(String(row.workflowJobId || ''))).map((row) => row._id);
  if (stale.length) await tasks(db).deleteMany({ _id: { $in: stale } });
  for (const job of jobs) {
    const email = suggestionClientEmail(job);
    try {
      await ensureQuotationTask(db, { ...job, client_email: email || job.client_email }, byEmail.get(email) || null);
    } catch (err) {
      if (!isDocTaskConflict(err)) console.error('[doc-tasks] suggestion sync skipped:', err?.message || err);
    }
  }
  return jobs.length;
}

export async function dropStaleQuotationTasks(db) {
  await syncQuotationTasks(db);
}

export async function ensureDocumentsTask(db, job, member) {
  const email = String(job?.client_email || '').trim().toLowerCase();
  const client = email
    ? await db.collection('users').findOne({ email }, { projection: { client_name: 1, company_name: 1, email: 1 } })
    : null;
  const identity = identityFromJob(job, client);
  await assertBidAvailable(db, identity.bidNumber, identity.workflowJobId);
  const now = new Date();
  const assignee = {
    assignedEmployeeId: String(member?.emp_id || ''),
    assignedEmployeeName: member?.name || String(member?.emp_id || ''),
  };
  const existing = await tasks(db).findOne({ workflowJobId: identity.workflowJobId });
  if (existing) {
    const status = existing.status || computeDocTaskStatus(existing);
    if (status === 'Under Preparation' || status === 'Completed') {
      await tasks(db).updateOne({ _id: existing._id }, { $set: { ...assignee, updatedAt: now } });
      return;
    }
    const next = {
      ...existing,
      ...identity,
      ...assignee,
      quotationRequired: false,
      missingDocuments: true,
    };
    const update = {
      $set: {
        ...identity,
        ...assignee,
        quotationRequired: false,
        missingDocuments: true,
        status: computeDocTaskStatus(next),
        updatedAt: now,
      },
    };
    if (!identity.bidNumber) update.$unset = { bidNumber: '' };
    await tasks(db).updateOne({ _id: existing._id }, update);
    return;
  }
  const created = {
    ...identity,
    ...assignee,
    quotationRequired: false,
    missingDocuments: true,
    workCompleted: false,
    status: 'Waiting for Documents',
    clientNextUpdateDate: null,
    missingDocDetails: '',
    checklistError: '',
    remark: '',
    createdAt: now,
    updatedAt: now,
  };
  await tasks(db).insertOne(created);
}

export async function applyChecklistToDocTask(db, job) {
  const email = String(job?.client_email || '').trim().toLowerCase();
  const client = email
    ? await db.collection('users').findOne({ email }, { projection: { client_name: 1, company_name: 1, email: 1 } })
    : null;
  const identity = identityFromJob(job, client);
  await assertBidAvailable(db, identity.bidNumber, identity.workflowJobId);
  const now = new Date();
  const existing = await tasks(db).findOne({ workflowJobId: identity.workflowJobId });
  if (existing) {
    const bidNumber = identity.bidNumber || existing.bidNumber || '';
    const next = {
      ...existing,
      bidNumber,
      clientEmail: identity.clientEmail || existing.clientEmail || '',
      clientName: identity.clientName || existing.clientName || '',
      companyName: identity.companyName || existing.companyName || '',
      lastDate: identity.lastDate || existing.lastDate || null,
      missingDocuments: true,
      quotationRequired: false,
    };
    const update = {
      $set: {
        clientEmail: next.clientEmail,
        clientName: next.clientName,
        companyName: next.companyName,
        lastDate: next.lastDate,
        missingDocuments: true,
        quotationRequired: false,
        status: computeDocTaskStatus(next),
        updatedAt: now,
      },
    };
    if (bidNumber) update.$set.bidNumber = bidNumber;
    await tasks(db).updateOne({ _id: existing._id }, update);
    return;
  }
  const created = {
    ...identity,
    quotationRequired: false,
    missingDocuments: true,
    workCompleted: false,
    assignedEmployeeId: '',
    assignedEmployeeName: '',
    clientNextUpdateDate: null,
    missingDocDetails: '',
    checklistError: '',
    remark: '',
    createdAt: now,
    updatedAt: now,
  };
  created.status = computeDocTaskStatus(created);
  await tasks(db).insertOne(created);
}

export function presentDocTask(doc) {
  return {
    id: String(doc._id),
    workflowJobId: doc.workflowJobId || '',
    bidNumber: doc.bidNumber || '',
    clientEmail: doc.clientEmail || '',
    clientName: doc.clientName || '',
    companyName: doc.companyName || '',
    assignedEmployeeId: doc.assignedEmployeeId || '',
    assignedEmployeeName: doc.assignedEmployeeName || '',
    lastDate: doc.lastDate || '',
    clientNextUpdateDate: doc.clientNextUpdateDate || '',
    quotationRequired: doc.quotationRequired === true,
    missingDocuments: doc.missingDocuments === true,
    missingDocDetails: doc.missingDocDetails || '',
    checklistError: doc.checklistError || '',
    workCompleted: doc.workCompleted === true,
    remark: doc.remark || '',
    status: doc.status || computeDocTaskStatus(doc),
  };
}

export async function aggregateDocTaskSummary(db) {
  const grouped = await tasks(db).aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]).toArray();
  const summary = {
    waitingForQuotation: 0,
    waitingForDocuments: 0,
    underPreparation: 0,
    completed: 0,
    totalOngoing: 0,
  };
  for (const row of grouped) {
    const count = Number(row.count) || 0;
    if (row._id === 'Waiting for Quotation') summary.waitingForQuotation = count;
    else if (row._id === 'Waiting for Documents') summary.waitingForDocuments = count;
    else if (row._id === 'Under Preparation') summary.underPreparation = count;
    else if (row._id === 'Completed') summary.completed = count;
  }
  summary.totalOngoing = summary.waitingForQuotation + summary.waitingForDocuments + summary.underPreparation;
  return summary;
}

function visibleFilter(actor) {
  const desk = deskOf(actor);
  if (!desk) return { filter: null, desk };
  if (desk === 'md' || desk === 'gm' || desk === 'tl') return { filter: {}, desk };
  const quotation = { status: 'Waiting for Quotation' };
  if (desk === 'maker') {
    return { filter: { $or: [{ assignedEmployeeId: String(actor.empId) }, quotation] }, desk };
  }
  return { filter: quotation, desk };
}

async function loadVisible(db, actor) {
  const scope = visibleFilter(actor);
  if (!scope.filter) return { ...scope, rows: [] };
  const docs = await tasks(db).find(scope.filter).toArray();
  const rows = docs.map(presentDocTask).sort(compareDocTasks);
  return { ...scope, rows };
}

function asBool(value) {
  if (value === true || value === false) return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'true' || text === 'yes' || text === '1') return true;
  if (text === 'false' || text === 'no' || text === '0') return false;
  return null;
}

async function routedToTl(db, actor, row) {
  if (deskOf(actor) !== 'tl') return false;
  const empId = String(actor.empId || '');
  if (!empId || !row?.workflowJobId) return false;
  const oid = asObjectId(row.workflowJobId);
  if (!oid) return false;
  const job = await db.collection('workflow_jobs').findOne({ _id: oid }, { projection: { team_id: 1, routed_tl_emp_id: 1 } });
  return Boolean(job && (String(job.team_id || '') === empId || String(job.routed_tl_emp_id || '') === empId));
}

export async function handleDocTasksGet(request) {
  const actor = await resolveActorRole(request);
  const desk = deskOf(actor);
  if (!desk) return { error: 'Please sign in with a staff account.', status: 401 };
  const db = await getDb();
  const liveQuotationCount = await syncQuotationTasks(db);
  const view = new URL(request.url).searchParams.get('view');
  if (view === 'assignees') {
    if (desk !== 'gm' && desk !== 'tl') return { error: 'Only a GM or TL can assign a maker.', status: 403 };
    const members = await db.collection('employees').find({
      deleted: { $ne: true },
      active: { $ne: false },
    }, { projection: { emp_id: 1, name: 1, designation: 1, role: 1 } }).toArray();
    const assignees = members
      .filter((member) => resolveStaffDesignation(member) === DESIGNATIONS.DOC_TEAM_MEMBER)
      .map((member) => ({ empId: member.emp_id, name: member.name || member.emp_id }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return { body: { assignees } };
  }
  const summary = await aggregateDocTaskSummary(db);
  summary.waitingForQuotation = liveQuotationCount;
  summary.totalOngoing = summary.waitingForQuotation + summary.waitingForDocuments + summary.underPreparation;
  if (view === 'summary') return { body: summary };
  const { rows, desk: rowDesk } = await loadVisible(db, actor);
  const body = { tasks: rows, summary };
  if (rowDesk === 'maker') {
    const docs = await tasks(db).find({}).toArray();
    body.overview = docs.map(presentDocTask).sort(compareDocTasks);
  }
  return { body };
}

async function canAdvanceTask(db, actor, row) {
  const desk = deskOf(actor);
  if (desk === 'gm') return true;
  if (desk === 'maker' && String(row?.assignedEmployeeId || '') === String(actor.empId || '')) return true;
  if (desk === 'tl') return routedToTl(db, actor, row);
  return false;
}

async function applyStageAction(db, actor, existing, action) {
  if (!(await canAdvanceTask(db, actor, existing))) {
    return { error: 'You cannot move this row.', status: 403 };
  }
  const status = existing.status || computeDocTaskStatus(existing);
  const now = new Date();
  if (action === 'documentSubmitted') {
    if (status !== 'Waiting for Documents') return { error: 'Document Submitted is only for Waiting for Documents.', status: 400 };
    const next = { ...existing, quotationRequired: false, missingDocuments: false, workCompleted: false };
    const patch = {
      quotationRequired: false,
      missingDocuments: false,
      workCompleted: false,
      status: computeDocTaskStatus(next),
      updatedAt: now,
    };
    await tasks(db).updateOne({ _id: existing._id }, { $set: patch });
    return { body: { task: presentDocTask({ ...existing, ...patch }) } };
  }
  if (action === 'markCompleted') {
    if (status !== 'Under Preparation') return { error: 'Completed is only for Under Preparation.', status: 400 };
    const patch = { workCompleted: true, status: 'Completed', updatedAt: now };
    await tasks(db).updateOne({ _id: existing._id }, { $set: patch });
    return { body: { task: presentDocTask({ ...existing, ...patch }) } };
  }
  if (action === 'submitDocuments') {
    if (status !== 'Completed') return { error: 'Documents Submitted is only for a completed row.', status: 400 };
    await tasks(db).deleteOne({ _id: existing._id });
    return { body: { success: true, deleted: true } };
  }
  return { error: 'Unknown action.', status: 400 };
}

export async function handleDocTaskPut(request, id) {
  const actor = await resolveActorRole(request);
  const desk = deskOf(actor);
  if (!desk) return { error: 'Please sign in with a staff account.', status: 401 };
  if (desk === 'md') return { error: 'The MD desk is read-only.', status: 403 };
  const oid = asObjectId(id);
  if (!oid) return { error: 'Row not found.', status: 404 };
  const db = await getDb();
  const existing = await tasks(db).findOne({ _id: oid });
  if (!existing) return { error: 'Row not found.', status: 404 };
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || '').trim();
  if (action) return applyStageAction(db, actor, existing, action);

  if ((desk === 'gm' || desk === 'tl') && 'clientNextUpdateDate' in body && !('assignedEmployeeId' in body)) {
    const currentStatus = existing.status || computeDocTaskStatus(existing);
    if (currentStatus !== 'Waiting for Quotation') {
      return { error: 'Client Next Update Date is only edited on Waiting for Quotation.', status: 400 };
    }
    const text = String(body.clientNextUpdateDate ?? '');
    const saved = { clientNextUpdateDate: text, updatedAt: new Date() };
    await tasks(db).updateOne({ _id: oid }, { $set: saved });
    return { body: { task: presentDocTask({ ...existing, ...saved }) } };
  }

  if (desk === 'gm' || desk === 'tl') {
    if (desk === 'tl' && !(await routedToTl(db, actor, existing))) {
      return { error: 'This row is outside your team.', status: 403 };
    }
    if (!('assignedEmployeeId' in body)) return { error: 'Choose an employee.', status: 400 };
    const currentStatus = existing.status || computeDocTaskStatus(existing);
    if (currentStatus === 'Waiting for Quotation') {
      return { error: 'Assign an employee after this row reaches Waiting for Documents.', status: 400 };
    }
    const assignedEmployeeId = String(body.assignedEmployeeId || '').trim();
    if (!assignedEmployeeId) {
      const cleared = {
        assignedEmployeeId: '',
        assignedEmployeeName: '',
        updatedAt: new Date(),
      };
      await tasks(db).updateOne({ _id: oid }, { $set: cleared });
      return { body: { task: presentDocTask({ ...existing, ...cleared }) } };
    }
    const member = await db.collection('employees').findOne({
      emp_id: assignedEmployeeId,
      deleted: { $ne: true },
      active: { $ne: false },
    });
    if (!member || resolveStaffDesignation(member) !== DESIGNATIONS.DOC_TEAM_MEMBER) {
      return { error: 'Assign a Doc Team employee.', status: 400 };
    }
    const patch = {
      assignedEmployeeId,
      assignedEmployeeName: member.name || assignedEmployeeId,
      updatedAt: new Date(),
    };
    await tasks(db).updateOne({ _id: oid }, { $set: patch });
    return { body: { task: presentDocTask({ ...existing, ...patch }) } };
  }

  const assignedToMaker = String(existing.assignedEmployeeId || '') === String(actor.empId || '');
  const quotationOpen = (existing.status || computeDocTaskStatus(existing)) === 'Waiting for Quotation';
  if (!assignedToMaker && !quotationOpen) return { error: 'This row is not assigned to you.', status: 403 };
  if (!assignedToMaker) {
    const extra = Object.keys(body).filter((key) => key !== 'quotationRequired' && key !== 'clientNextUpdateDate');
    if (extra.length) return { error: 'This row is not assigned to you.', status: 403 };
  }
  const patch = {};
  if ('clientNextUpdateDate' in body) patch.clientNextUpdateDate = String(body.clientNextUpdateDate ?? '');
  for (const key of ['quotationRequired', 'missingDocuments', 'workCompleted']) {
    if (key in body) {
      const flag = asBool(body[key]);
      if (flag == null) return { error: 'Choose Yes or No.', status: 400 };
      patch[key] = flag;
    }
  }
  for (const key of ['missingDocDetails', 'checklistError', 'remark']) {
    if (key in body) patch[key] = String(body[key] ?? '');
  }
  if (!Object.keys(patch).length) return { error: 'Nothing to save.', status: 400 };
  const next = { ...existing, ...patch };
  patch.status = computeDocTaskStatus(next);
  patch.updatedAt = new Date();
  await tasks(db).updateOne({ _id: oid }, { $set: patch });
  return { body: { task: presentDocTask({ ...existing, ...patch }) } };
}

export async function handleDocTaskDelete(request, id) {
  const actor = await resolveActorRole(request);
  const desk = deskOf(actor);
  if (!desk) return { error: 'Please sign in with a staff account.', status: 401 };
  if (desk !== 'gm' && desk !== 'tl' && desk !== 'md') return { error: 'Only a GM, TL, or MD can delete a row.', status: 403 };
  const oid = asObjectId(id);
  if (!oid) return { error: 'Row not found.', status: 404 };
  const db = await getDb();
  const existing = await tasks(db).findOne({ _id: oid });
  if (!existing) return { error: 'Row not found.', status: 404 };
  const quotationRow = (existing.status || computeDocTaskStatus(existing)) === 'Waiting for Quotation';
  if (desk === 'md' && !quotationRow) {
    return { error: 'The MD can delete only a Waiting for Quotation row.', status: 403 };
  }
  if (desk === 'tl' && !quotationRow && !(await routedToTl(db, actor, existing))) {
    return { error: 'This row is outside your team.', status: 403 };
  }
  await tasks(db).deleteOne({ _id: oid });
  return { body: { success: true } };
}

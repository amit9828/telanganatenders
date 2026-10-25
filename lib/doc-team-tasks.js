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

export async function ensureDocTaskFromSuggestion(db, job, client) {
  const identity = identityFromJob(job, client);
  await assertBidAvailable(db, identity.bidNumber, identity.workflowJobId);
  const now = new Date();
  const existing = await tasks(db).findOne({ workflowJobId: identity.workflowJobId });
  const flags = {
    quotationRequired: true,
    missingDocuments: false,
    workCompleted: false,
    assignedEmployeeId: '',
    assignedEmployeeName: '',
  };
  const status = computeDocTaskStatus(flags);
  if (existing) {
    const update = {
      $set: { ...identity, ...flags, status, updatedAt: now },
    };
    if (!identity.bidNumber) update.$unset = { bidNumber: '' };
    await tasks(db).updateOne({ _id: existing._id }, update);
    return;
  }
  await tasks(db).insertOne({
    ...identity,
    ...flags,
    status,
    clientNextUpdateDate: null,
    missingDocDetails: '',
    checklistError: '',
    remark: '',
    createdAt: now,
    updatedAt: now,
  });
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

export function summarizeDocTasks(rows) {
  const summary = { pending: 0, active: 0, completed: 0 };
  for (const row of rows) {
    if (row.status === 'Completed') summary.completed += 1;
    else if (row.status === 'Under Preparation') summary.active += 1;
    else summary.pending += 1;
  }
  return summary;
}

async function visibleFilter(db, actor) {
  const desk = deskOf(actor);
  if (!desk) return { filter: null, desk };
  if (desk === 'md' || desk === 'gm') return { filter: {}, desk };
  if (desk === 'maker') {
    return { filter: { assignedEmployeeId: String(actor.empId) }, desk };
  }
  const empId = String(actor.empId || '');
  if (!empId) return { filter: { workflowJobId: { $in: [] } }, desk };
  const jobs = await db.collection('workflow_jobs').find({
    $or: [{ team_id: empId }, { routed_tl_emp_id: empId }],
  }, { projection: { _id: 1 } }).toArray();
  return {
    filter: { workflowJobId: { $in: jobs.map((job) => String(job._id)) } },
    desk,
  };
}

async function loadVisible(db, actor) {
  const scope = await visibleFilter(db, actor);
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
  const { rows } = await loadVisible(db, actor);
  const summary = summarizeDocTasks(rows);
  if (view === 'summary') return { body: summary };
  return { body: { tasks: rows, summary } };
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

  if (desk === 'gm' || desk === 'tl') {
    if (desk === 'tl' && !(await routedToTl(db, actor, existing))) {
      return { error: 'This row is outside your team.', status: 403 };
    }
    if (!('assignedEmployeeId' in body)) return { error: 'Choose an employee.', status: 400 };
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

  if (String(existing.assignedEmployeeId || '') !== String(actor.empId || '')) {
    return { error: 'This row is not assigned to you.', status: 403 };
  }
  const patch = {};
  if ('clientNextUpdateDate' in body) {
    const raw = String(body.clientNextUpdateDate || '').trim();
    if (!raw) patch.clientNextUpdateDate = null;
    else {
      const iso = normalizeIsoDate(raw, { defaultYear: new Date().getFullYear() });
      if (!iso) return { error: 'Enter the date as DD-MM.', status: 400 };
      patch.clientNextUpdateDate = iso;
    }
  }
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
  if (desk !== 'gm' && desk !== 'tl') return { error: 'Only a GM or TL can delete a row.', status: 403 };
  const oid = asObjectId(id);
  if (!oid) return { error: 'Row not found.', status: 404 };
  const db = await getDb();
  const existing = await tasks(db).findOne({ _id: oid });
  if (!existing) return { error: 'Row not found.', status: 404 };
  if (desk === 'tl' && !(await routedToTl(db, actor, existing))) {
    return { error: 'This row is outside your team.', status: 403 };
  }
  await tasks(db).deleteOne({ _id: oid });
  return { body: { success: true } };
}

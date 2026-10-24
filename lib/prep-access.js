import { DESIGNATIONS, matchDesignation } from '@/lib/designations';

function sameStaffId(a, b) {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  return Boolean(left) && left === right;
}

function isMaker(actor, job) {
  return sameStaffId(job?.assigned_emp_id, actor?.empId);
}

function isJobTl(actor, job) {
  if (matchDesignation(actor?.designation) !== DESIGNATIONS.DOC_TEAM_TL) return false;
  return sameStaffId(job?.routed_tl_emp_id, actor?.empId) || sameStaffId(job?.team_id, actor?.empId);
}

function isGm(actor) {
  if (matchDesignation(actor?.designation) === DESIGNATIONS.GM) return true;
  const role = String(actor?.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return role === 'GM' || role === 'GENERAL_MANAGER';
}

function isMd(actor) {
  const role = String(actor?.role || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return role === 'MD' || role === 'ADMIN';
}

export function prepLockLabel(status) {
  if (status === 'TL_ASSIGN' || status === 'MAKER_PREP' || status === 'TL_QC') return 'Locked: Pending TL Approval';
  if (status === 'GM_QC') return 'Locked: Pending GM QC';
  if (status === 'MD_SUBMIT' || status === 'AWAITING_RECEIPT') return 'Locked: Pending MD Submit';
  return 'Locked';
}

export function canViewPrepFiles(actor, job) {
  if (!actor || !job) return false;
  const status = String(job.status || '');
  const maker = isMaker(actor, job);
  const tl = isJobTl(actor, job);
  if (status === 'TL_ASSIGN' || status === 'MAKER_PREP' || status === 'TL_QC') return maker || tl;
  if (status === 'GM_QC') return maker || tl || isGm(actor);
  if (status === 'MD_SUBMIT' || status === 'AWAITING_RECEIPT') return maker || tl || isGm(actor) || isMd(actor);
  if (status === 'SUBMITTED' || status === 'WON') return Boolean(actor.role || actor.empId || actor.designation);
  return false;
}

export function viewerFromDesk(desk, empId) {
  const id = String(empId || '').trim() || null;
  if (desk === 'md') return { role: 'MD', empId: id, designation: null };
  if (desk === 'gm') return { role: 'EMPLOYEE', empId: id, designation: DESIGNATIONS.GM };
  if (desk === 'tl') return { role: 'EMPLOYEE', empId: id, designation: DESIGNATIONS.DOC_TEAM_TL };
  return { role: 'EMPLOYEE', empId: id, designation: DESIGNATIONS.DOC_TEAM_MEMBER };
}

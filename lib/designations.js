export const DESIGNATIONS = {
  GM: 'GM',
  DOC_TEAM_TL: 'DOC_TEAM_TL',
  DOC_TEAM_MEMBER: 'DOC_TEAM_MEMBER',
};

export const DESIGNATION_LABELS = {
  GM: 'General Manager',
  DOC_TEAM_TL: 'Doc Team TL',
  DOC_TEAM_MEMBER: 'Doc Team Member',
};

export function matchDesignation(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (!raw) return null;
  if (raw === 'GM' || raw === 'GENERAL_MANAGER') return DESIGNATIONS.GM;
  if (raw === 'DOC_TEAM_TL' || raw === 'TL' || raw === 'TEAM_LEAD' || raw === 'TEAMLEAD') return DESIGNATIONS.DOC_TEAM_TL;
  if (raw === 'DOC_TEAM_MEMBER' || raw === 'MEMBER' || raw === 'EMPLOYEE' || raw === 'MAKER') {
    return DESIGNATIONS.DOC_TEAM_MEMBER;
  }
  return null;
}

export function normalizeDesignation(value) {
  return matchDesignation(value) || DESIGNATIONS.DOC_TEAM_MEMBER;
}

export function resolveStaffDesignation(member) {
  return matchDesignation(member?.designation) || matchDesignation(member?.role) || DESIGNATIONS.DOC_TEAM_MEMBER;
}

export function deskPathForDesignation(designation) {
  const d = normalizeDesignation(designation);
  if (d === DESIGNATIONS.GM) return '/gm';
  if (d === DESIGNATIONS.DOC_TEAM_TL) return '/tl';
  return '/employee';
}

export function deskPathForStaff(member) {
  const d = resolveStaffDesignation(member);
  if (d === DESIGNATIONS.GM) return '/gm';
  if (d === DESIGNATIONS.DOC_TEAM_TL) return '/tl';
  return '/employee';
}

export function loginAsLabel(member) {
  const d = resolveStaffDesignation(member);
  if (d === DESIGNATIONS.GM) return 'Login as GM';
  if (d === DESIGNATIONS.DOC_TEAM_TL) return 'Login as TL';
  return 'Login as Employee';
}

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

export function normalizeDesignation(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (raw === 'GM' || raw === 'GENERAL_MANAGER') return DESIGNATIONS.GM;
  if (raw === 'DOC_TEAM_TL' || raw === 'TL' || raw === 'TEAM_LEAD') return DESIGNATIONS.DOC_TEAM_TL;
  return DESIGNATIONS.DOC_TEAM_MEMBER;
}

export function deskPathForDesignation(designation) {
  const d = normalizeDesignation(designation);
  if (d === DESIGNATIONS.GM) return '/gm';
  if (d === DESIGNATIONS.DOC_TEAM_TL) return '/tl';
  return '/employee';
}

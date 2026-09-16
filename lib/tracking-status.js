export const TRACKING_LABELS = {
  TECHNICAL_EVALUATION_IN_PROGRESS: 'Technical Evaluation in Progress',
  TECHNICAL_EVALUATION_PASSED: 'Technical Evaluation Passed',
  FINANCIAL: 'Financial',
  WON: 'Won',
  LOST: 'Lost',
};

export const TRACKING_STAGES = [
  TRACKING_LABELS.TECHNICAL_EVALUATION_IN_PROGRESS,
  TRACKING_LABELS.TECHNICAL_EVALUATION_PASSED,
  TRACKING_LABELS.FINANCIAL,
];

const TRACKING_STAGE_ALIASES = {
  Submitted: TRACKING_LABELS.TECHNICAL_EVALUATION_IN_PROGRESS,
  'Technical Evaluation': TRACKING_LABELS.TECHNICAL_EVALUATION_IN_PROGRESS,
  'Financial Evaluation': TRACKING_LABELS.FINANCIAL,
};

export function normalizeTrackingStatus(value) {
  const raw = String(value || '').trim();
  if (!raw) return TRACKING_LABELS.TECHNICAL_EVALUATION_IN_PROGRESS;
  if (raw === 'Won' || raw === TRACKING_LABELS.WON) return TRACKING_LABELS.WON;
  if (raw === 'Lost' || raw === 'Loss' || raw === TRACKING_LABELS.LOST) return TRACKING_LABELS.LOST;
  if (TRACKING_STAGE_ALIASES[raw]) return TRACKING_STAGE_ALIASES[raw];
  if (TRACKING_STAGES.includes(raw)) return raw;
  return TRACKING_LABELS.TECHNICAL_EVALUATION_IN_PROGRESS;
}

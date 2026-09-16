export const TRACKING_LABELS = {
  TECHNICAL_EVALUATION: 'Technical evaluation',
  FINANCIAL_EVALUATION: 'Financial evaluation',
  WON: 'Won',
  LOST: 'Lost',
};

export const TRACKING_STAGES = [
  TRACKING_LABELS.TECHNICAL_EVALUATION,
  TRACKING_LABELS.FINANCIAL_EVALUATION,
];

const TRACKING_STAGE_ALIASES = {
  Submitted: TRACKING_LABELS.TECHNICAL_EVALUATION,
  'Technical Evaluation': TRACKING_LABELS.TECHNICAL_EVALUATION,
  'Technical evaluation': TRACKING_LABELS.TECHNICAL_EVALUATION,
  'Technical Evaluation in Progress': TRACKING_LABELS.TECHNICAL_EVALUATION,
  'Technical Evaluation Passed': TRACKING_LABELS.TECHNICAL_EVALUATION,
  'Financial Evaluation': TRACKING_LABELS.FINANCIAL_EVALUATION,
  'Financial evaluation': TRACKING_LABELS.FINANCIAL_EVALUATION,
  Financial: TRACKING_LABELS.FINANCIAL_EVALUATION,
};

/** Strict parse for API writes. Returns null for empty or unknown values. */
export function parseTrackingStatus(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw === 'Won' || raw === TRACKING_LABELS.WON) return TRACKING_LABELS.WON;
  if (raw === 'Lost' || raw === 'Loss' || raw === TRACKING_LABELS.LOST) return TRACKING_LABELS.LOST;
  if (TRACKING_STAGE_ALIASES[raw]) return TRACKING_STAGE_ALIASES[raw];
  if (TRACKING_STAGES.includes(raw)) return raw;
  return null;
}

/** Display helper for stored values. Unknown/empty stay empty-safe for UI, never invent a stage. */
export function normalizeTrackingStatus(value) {
  return parseTrackingStatus(value);
}

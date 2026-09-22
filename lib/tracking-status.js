export const TRACKING_LABELS = {
  SUBMITTED: 'Submitted',
  TECHNICAL_EVALUATION: 'Technical evaluation',
  FINANCIAL_EVALUATION: 'Financial evaluation',
  BID_AWARDED: 'Bid Awarded',
  WON: 'Won',
  LOST: 'Lost',
};

/** Stages an operator can set after the bid is already Submitted. */
export const TRACKING_STAGES = [
  TRACKING_LABELS.TECHNICAL_EVALUATION,
  TRACKING_LABELS.FINANCIAL_EVALUATION,
  TRACKING_LABELS.BID_AWARDED,
];

/** Progress-bar order. Win and Loss are outcomes, not extra segments. */
export const TRACKING_ORDER = [
  TRACKING_LABELS.SUBMITTED,
  TRACKING_LABELS.TECHNICAL_EVALUATION,
  TRACKING_LABELS.FINANCIAL_EVALUATION,
  TRACKING_LABELS.BID_AWARDED,
];

const TRACKING_STAGE_ALIASES = {
  'Technical Evaluation': TRACKING_LABELS.TECHNICAL_EVALUATION,
  'Technical evaluation': TRACKING_LABELS.TECHNICAL_EVALUATION,
  'Technical Evaluation in Progress': TRACKING_LABELS.TECHNICAL_EVALUATION,
  'Technical Evaluation Passed': TRACKING_LABELS.TECHNICAL_EVALUATION,
  'Financial Evaluation': TRACKING_LABELS.FINANCIAL_EVALUATION,
  'Financial evaluation': TRACKING_LABELS.FINANCIAL_EVALUATION,
  Financial: TRACKING_LABELS.FINANCIAL_EVALUATION,
  'Bid awarded': TRACKING_LABELS.BID_AWARDED,
  'Bid Awarded': TRACKING_LABELS.BID_AWARDED,
  BID_AWARDED: TRACKING_LABELS.BID_AWARDED,
  Submitted: TRACKING_LABELS.SUBMITTED,
};

/** Strict parse for API writes. Returns null for empty or unknown values. */
export function parseTrackingStatus(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw === 'Won' || raw === TRACKING_LABELS.WON) return TRACKING_LABELS.WON;
  if (raw === 'Lost' || raw === 'Loss' || raw === TRACKING_LABELS.LOST) return TRACKING_LABELS.LOST;
  if (TRACKING_STAGE_ALIASES[raw]) return TRACKING_STAGE_ALIASES[raw];
  if (TRACKING_STAGES.includes(raw) || TRACKING_ORDER.includes(raw)) return raw;
  return null;
}

/** Display helper for stored values. Unknown/empty stay empty-safe for UI, never invent a stage. */
export function normalizeTrackingStatus(value) {
  return parseTrackingStatus(value);
}

export function currentTrackingStage(job) {
  if (!job) return null;
  if (job.status === 'WON') return TRACKING_LABELS.WON;
  const parsed = parseTrackingStatus(job.tracking_status) || parseTrackingStatus(job.display_status);
  if (parsed === TRACKING_LABELS.WON || parsed === TRACKING_LABELS.LOST) return parsed;
  if (TRACKING_ORDER.includes(parsed)) return parsed;
  if (job.status === 'SUBMITTED') return TRACKING_LABELS.SUBMITTED;
  return null;
}

/** The only stage an operator may set next. Null when the next step is Win or Loss. */
export function nextTrackingStage(stage) {
  const idx = TRACKING_ORDER.indexOf(stage);
  if (idx < 0 || idx >= TRACKING_ORDER.length - 1) return null;
  return TRACKING_ORDER[idx + 1];
}

/** Client dashboard only. Staff bars keep TRACKING_ORDER. */
export const CLIENT_TRACKING_LABELS = {
  BID_ACCEPTED: 'Bid Accepted',
  DOCUMENT_PREPARING: 'Document Preparing',
  BID_SUBMITTED: 'Bid Submitted',
  TECHNICAL_EVALUATION: 'Technical Evaluation',
  FINANCIAL_EVALUATION: 'Financial Evaluation',
  BID_AWARDED: 'Bid Awarded',
};

export const CLIENT_TRACKING_ORDER = [
  CLIENT_TRACKING_LABELS.BID_ACCEPTED,
  CLIENT_TRACKING_LABELS.DOCUMENT_PREPARING,
  CLIENT_TRACKING_LABELS.BID_SUBMITTED,
  CLIENT_TRACKING_LABELS.TECHNICAL_EVALUATION,
  CLIENT_TRACKING_LABELS.FINANCIAL_EVALUATION,
  CLIENT_TRACKING_LABELS.BID_AWARDED,
];

const CLIENT_ACCEPTED_STATUSES = ['MD_CHECKLIST', 'TL_ASSIGN'];
const CLIENT_PREPARING_STATUSES = ['MAKER_PREP', 'TL_QC', 'GM_QC', 'MD_SUBMIT', 'AWAITING_RECEIPT'];

/** Client-facing stage. Does not change stored status or staff labels. */
export function clientTrackingStage(job) {
  if (!job) return null;
  if (job.status === 'WON') return CLIENT_TRACKING_LABELS.BID_AWARDED;
  if (CLIENT_ACCEPTED_STATUSES.includes(job.status)) return CLIENT_TRACKING_LABELS.BID_ACCEPTED;
  if (CLIENT_PREPARING_STATUSES.includes(job.status)) return CLIENT_TRACKING_LABELS.DOCUMENT_PREPARING;
  const stage = currentTrackingStage(job);
  if (stage === TRACKING_LABELS.SUBMITTED) return CLIENT_TRACKING_LABELS.BID_SUBMITTED;
  if (stage === TRACKING_LABELS.TECHNICAL_EVALUATION) return CLIENT_TRACKING_LABELS.TECHNICAL_EVALUATION;
  if (stage === TRACKING_LABELS.FINANCIAL_EVALUATION) return CLIENT_TRACKING_LABELS.FINANCIAL_EVALUATION;
  if (stage === TRACKING_LABELS.BID_AWARDED || stage === TRACKING_LABELS.WON) return CLIENT_TRACKING_LABELS.BID_AWARDED;
  if (job.status === 'SUBMITTED') return CLIENT_TRACKING_LABELS.BID_SUBMITTED;
  return null;
}

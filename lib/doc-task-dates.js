export const DOC_TASK_STATUS = {
  QUOTATION: 'Waiting for Quotation',
  DOCUMENTS: 'Waiting for Documents',
  PREPARATION: 'Under Preparation',
  COMPLETED: 'Completed',
};

export function computeDocTaskStatus(row) {
  if (row?.workCompleted === true) return DOC_TASK_STATUS.COMPLETED;
  if (row?.quotationRequired === true) return DOC_TASK_STATUS.QUOTATION;
  if (row?.missingDocuments === true) return DOC_TASK_STATUS.DOCUMENTS;
  return DOC_TASK_STATUS.PREPARATION;
}

export const MISSING_DATE_LABEL = 'Missing Date';

const MONTH_INDEX = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function validYmd(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function expandYear(year, defaultYear) {
  const raw = String(year || '');
  if (!raw) return String(defaultYear || new Date().getFullYear());
  if (raw.length === 2) return `20${raw}`;
  return raw;
}

function fromLocalDate(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return validYmd(value.getFullYear(), value.getMonth() + 1, value.getDate());
}

export function normalizeIsoDate(value, { defaultYear } = {}) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return fromLocalDate(value);
  const raw = String(value).trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return validYmd(iso[1], iso[2], iso[3]);

  const dmy = raw.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?(?:\s|$|T)/);
  if (dmy) return validYmd(expandYear(dmy[3], defaultYear), dmy[2], dmy[1]);

  const dMonY = raw.match(/^(\d{1,2})[-/.,\s]+([A-Za-z]{3,9})[-/.,\s]+(\d{2,4})/);
  if (dMonY) {
    const month = MONTH_INDEX[dMonY[2].toLowerCase()];
    if (month) return validYmd(expandYear(dMonY[3], defaultYear), month, dMonY[1]);
  }

  const monDY = raw.match(/^([A-Za-z]{3,9})[-/.,\s]+(\d{1,2}),?\s+(\d{2,4})/);
  if (monDY) {
    const month = MONTH_INDEX[monDY[1].toLowerCase()];
    if (month) return validYmd(expandYear(monDY[3], defaultYear), month, monDY[2]);
  }

  const parsed = new Date(raw);
  return fromLocalDate(parsed);
}

export function formatDisplayDate(iso) {
  const normalized = normalizeIsoDate(iso);
  if (!normalized) return MISSING_DATE_LABEL;
  const [year, month, day] = normalized.split('-');
  return `${day}-${month}-${year}`;
}

export function isMissingDisplayDate(text) {
  return text === MISSING_DATE_LABEL;
}

export function compareDocTasks(a, b) {
  const aMissing = !a?.lastDate;
  const bMissing = !b?.lastDate;
  if (aMissing && bMissing) return String(a?.bidNumber || '').localeCompare(String(b?.bidNumber || ''));
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (a.lastDate !== b.lastDate) return a.lastDate < b.lastDate ? -1 : 1;
  return String(a?.bidNumber || '').localeCompare(String(b?.bidNumber || ''));
}

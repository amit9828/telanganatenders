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

function validYmd(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!y || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function normalizeIsoDate(value, { defaultYear } = {}) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return validYmd(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return validYmd(iso[1], iso[2], iso[3]);
  const dmy = raw.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?$/);
  if (dmy) {
    let year = dmy[3] || '';
    if (!year) year = String(defaultYear || new Date().getFullYear());
    else if (year.length === 2) year = `20${year}`;
    return validYmd(year, dmy[2], dmy[1]);
  }
  return null;
}

export function formatDisplayDate(iso) {
  const normalized = normalizeIsoDate(iso);
  if (!normalized) return '';
  const [year, month, day] = normalized.split('-');
  return `${day}-${month}-${year}`;
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

'use client';

import { compareDocTasks, formatDisplayDate } from '@/lib/doc-task-dates';

const ROW_FILL = {
  'Waiting for Quotation': '#c084fc',
  'Waiting for Documents': '#fb923c',
  'Under Preparation': '#60a5fa',
};

const STAGE_ACTIONS = {
  documents: { label: 'Document Submitted', confirm: 'Move this row to Under Preparation?', action: 'documentSubmitted' },
  preparation: { label: 'Completed: Yes', confirm: 'Move this row to Completed?', action: 'markCompleted' },
  completed: { label: 'Documents Submitted: Yes', confirm: 'Remove this completed row from the sheet?', action: 'submitDocuments' },
};

const COLUMNS = [
  { key: 'sno', label: 'S.No', width: 56 },
  { key: 'bidNumber', label: 'Bid Number', width: 200 },
  { key: 'lastDate', label: 'Last Date', width: 150 },
  { key: 'assigned', label: 'Employee Assigned', width: 180 },
  { key: 'clientName', label: 'Client Name', width: 160 },
  { key: 'companyName', label: 'Company Name', width: 180 },
  { key: 'clientNextUpdateDate', label: 'Client Next Update Date', width: 170 },
  { key: 'quotationRequired', label: 'Quotation Required', width: 130 },
  { key: 'missingDocuments', label: 'Missing Documents', width: 140 },
  { key: 'missingDocDetails', label: 'Missing Doc Details', width: 240 },
  { key: 'checklistError', label: 'Check list error', width: 240 },
  { key: 'workCompleted', label: 'Completed', width: 110 },
  { key: 'remark', label: 'Remark', width: 220 },
  { key: 'status', label: 'Current Status', width: 190 },
  { key: 'delete', label: 'Delete', width: 84 },
  { key: 'action', label: 'Action', width: 210 },
];

const OVERVIEW_KEYS = ['sno', 'bidNumber', 'lastDate', 'clientName', 'companyName', 'remark', 'status'];
const QUOTATION_KEYS = ['sno', 'bidNumber', 'lastDate', 'clientName', 'companyName', 'clientNextUpdateDate'];
const DOCUMENTS_KEYS = ['sno', 'bidNumber', 'lastDate', 'assigned', 'clientName', 'companyName', 'missingDocDetails', 'checklistError', 'action'];
const PREPARATION_KEYS = ['sno', 'bidNumber', 'lastDate', 'assigned', 'clientName', 'companyName', 'action'];
const COMPLETED_KEYS = ['bidNumber', 'clientName', 'companyName', 'assigned', 'lastDate', 'action'];

const cellStyle = {
  border: '1px solid #64748b',
  padding: '8px 10px',
  fontSize: 13,
  lineHeight: 1.35,
  verticalAlign: 'top',
  color: '#0f172a',
  background: 'transparent',
};

const headerStyle = {
  ...cellStyle,
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: '#facc15',
  color: '#000',
  fontWeight: 700,
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

function yesNo(value) {
  return value ? 'Yes' : 'No';
}

function NextUpdateField({ value, onCommit }) {
  return (
    <input
      type="text"
      defaultValue={value || ''}
      key={value || ''}
      aria-label="Client Next Update Date"
      onBlur={(event) => {
        const next = event.target.value;
        if (next !== (value || '')) onCommit(next);
      }}
      style={{ width: '100%', border: 0, background: 'transparent', font: 'inherit', padding: 0 }}
    />
  );
}

function YesNoField({ value, label, onChange }) {
  return (
    <select
      aria-label={label}
      value={value ? 'yes' : 'no'}
      onChange={(event) => onChange(event.target.value === 'yes')}
      style={{ width: '100%', border: 0, background: 'transparent', font: 'inherit' }}
    >
      <option value="yes">Yes</option>
      <option value="no">No</option>
    </select>
  );
}

function fitTextarea(element) {
  if (!element) return;
  element.style.height = 'auto';
  element.style.height = `${element.scrollHeight}px`;
}

function TextField({ value, label, disabled, onCommit, grow = false }) {
  return (
    <textarea
      aria-label={label}
      defaultValue={value || ''}
      key={`${label}:${value || ''}`}
      disabled={disabled}
      rows={grow ? 1 : 2}
      ref={(node) => { if (grow) fitTextarea(node); }}
      onInput={(event) => { if (grow) fitTextarea(event.currentTarget); }}
      onBlur={(event) => {
        if (disabled) return;
        if (event.target.value !== (value || '')) onCommit(event.target.value);
      }}
      style={grow ? {
        width: '100%',
        border: 0,
        background: 'transparent',
        font: 'inherit',
        resize: 'none',
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        wordBreak: 'break-word',
        padding: 0,
        minHeight: '1.4em',
        color: 'inherit',
      } : {
        width: '100%',
        border: 0,
        background: 'transparent',
        font: 'inherit',
        resize: 'vertical',
        maxHeight: 96,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        padding: 0,
        color: 'inherit',
      }}
    />
  );
}

function readText(value, { wrap = false } = {}) {
  return (
    <div style={{
      whiteSpace: 'pre-wrap',
      overflowWrap: 'break-word',
      wordBreak: 'break-word',
      ...(wrap ? {} : { maxHeight: 96, overflow: 'auto' }),
    }}
    >
      {value || ''}
    </div>
  );
}

export default function DocTaskGrid({
  rows,
  variant = 'full',
  editable = false,
  editorEmpId = '',
  canAssign = false,
  canDelete = false,
  assignees = [],
  onPatch,
  onAssign,
  onDelete,
  outline,
  allowQuotationEdit = false,
  advanceMode = 'none',
  canEditNextUpdate = false,
}) {
  const ordered = [...rows].sort(compareDocTasks);
  const byKey = Object.fromEntries(COLUMNS.map((column) => [column.key, column]));
  const fullKeys = COLUMNS.map((column) => column.key).filter((key) => key !== 'status' && key !== 'action');
  const columnKeys = variant === 'completed'
    ? COMPLETED_KEYS
    : variant === 'overview'
      ? OVERVIEW_KEYS
      : variant === 'quotation'
        ? QUOTATION_KEYS
        : variant === 'documents'
          ? DOCUMENTS_KEYS
          : variant === 'preparation'
            ? PREPARATION_KEYS
            : fullKeys;
  const columns = columnKeys
    .filter((key) => key !== 'delete' || canDelete)
    .map((key) => byKey[key])
    .filter(Boolean);

  const fillFor = (row) => (variant === 'completed' ? '#fff' : (ROW_FILL[row.status] || '#fff'));

  return (
    <div className="w-full" style={{
      width: '100%',
      overflowX: 'auto',
      border: variant === 'completed' ? 'none' : `${outline ? 3 : 1}px solid ${outline || '#64748b'}`,
    }}>
      <table className="w-full" style={{ borderCollapse: 'collapse', width: '100%', minWidth: columns.reduce((sum, column) => sum + column.width, 0) }}>
        <colgroup>
          {columns.map((column) => <col key={column.key} style={{ width: column.width }} />)}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} style={{ ...headerStyle, minWidth: column.width, whiteSpace: 'nowrap' }}>{column.key === 'delete' && variant === 'quotation' ? 'Actions' : column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ordered.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ ...cellStyle, background: '#fff' }}>No rows.</td>
            </tr>
          ) : ordered.map((row, index) => {
            const fill = fillFor(row);
            const paint = { ...cellStyle, background: fill };
            const rowEditable = editable && Boolean(editorEmpId) && String(row.assignedEmployeeId || '') === String(editorEmpId);
            const quotationEditable = allowQuotationEdit && row.status === 'Waiting for Quotation';
            const cells = {
              sno: index + 1,
              bidNumber: row.bidNumber,
              lastDate: formatDisplayDate(row.lastDate),
              clientName: row.clientName,
              companyName: row.companyName,
              status: row.status,
            };
            return (
              <tr key={row.id} style={{ background: fill }}>
                {columns.map((column) => {
                  if (column.key === 'assigned') {
                    if (canAssign) {
                      return (
                        <td key={column.key} style={paint}>
                          <select
                            aria-label="Employee Assigned"
                            value={row.assignedEmployeeId || ''}
                            onChange={(event) => onAssign?.(row, event.target.value)}
                            style={{ width: '100%', border: 0, background: 'transparent', font: 'inherit' }}
                          >
                            <option value="">Unassigned</option>
                            {row.assignedEmployeeId && !assignees.some((member) => member.empId === row.assignedEmployeeId) ? (
                              <option value={row.assignedEmployeeId}>{row.assignedEmployeeName || row.assignedEmployeeId}</option>
                            ) : null}
                            {assignees.map((member) => (
                              <option key={member.empId} value={member.empId}>{member.name}</option>
                            ))}
                          </select>
                        </td>
                      );
                    }
                    return <td key={column.key} style={paint}>{row.assignedEmployeeName || ''}</td>;
                  }
                  if (column.key === 'bidNumber' || column.key === 'lastDate') {
                    return <td key={column.key} style={{ ...paint, whiteSpace: 'nowrap' }}>{cells[column.key] ?? ''}</td>;
                  }
                  if (column.key === 'clientNextUpdateDate') {
                    const note = { ...paint, whiteSpace: 'pre-wrap', overflowWrap: 'break-word' };
                    if (!(canEditNextUpdate && variant === 'quotation' && row.status === 'Waiting for Quotation')) {
                      return <td key={column.key} style={note}>{row.clientNextUpdateDate || ''}</td>;
                    }
                    return (
                      <td key={column.key} style={note}>
                        <NextUpdateField
                          value={row.clientNextUpdateDate}
                          onCommit={(text) => onPatch?.(row, { clientNextUpdateDate: text })}
                        />
                      </td>
                    );
                  }
                  if (column.key === 'quotationRequired' || column.key === 'missingDocuments' || column.key === 'workCompleted') {
                    const fieldEditable = column.key === 'quotationRequired' ? (rowEditable || quotationEditable) : rowEditable;
                    if (!fieldEditable) return <td key={column.key} style={paint}>{yesNo(row[column.key])}</td>;
                    return (
                      <td key={column.key} style={paint}>
                        <YesNoField
                          label={column.label}
                          value={row[column.key]}
                          onChange={(next) => onPatch?.(row, { [column.key]: next })}
                        />
                      </td>
                    );
                  }
                  if (variant === 'overview' && column.key === 'remark') {
                    const text = row.status === 'Waiting for Quotation'
                      ? (row.clientNextUpdateDate || '')
                      : row.status === 'Waiting for Documents'
                        ? (row.missingDocDetails || '')
                        : (row.remark || '');
                    const note = { ...paint, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'break-word' };
                    return <td key={column.key} style={note}>{readText(text, { wrap: true })}</td>;
                  }
                  if (column.key === 'missingDocDetails' || column.key === 'checklistError' || column.key === 'remark') {
                    const locked = column.key === 'missingDocDetails' && row.missingDocuments !== true;
                    const wrapping = column.key === 'missingDocDetails' || column.key === 'checklistError';
                    const note = wrapping
                      ? { ...paint, whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'break-word' }
                      : paint;
                    if (!rowEditable) return <td key={column.key} style={note}>{readText(row[column.key], { wrap: wrapping })}</td>;
                    return (
                      <td key={column.key} style={note}>
                        <TextField
                          label={column.label}
                          value={row[column.key]}
                          disabled={locked}
                          grow={wrapping}
                          onCommit={(text) => onPatch?.(row, { [column.key]: text })}
                        />
                      </td>
                    );
                  }
                  if (column.key === 'action') {
                    const stage = STAGE_ACTIONS[variant];
                    const mayAct = Boolean(stage) && (
                      advanceMode === 'lead'
                      || (advanceMode === 'maker' && Boolean(editorEmpId) && String(row.assignedEmployeeId || '') === String(editorEmpId))
                    );
                    if (!mayAct) return <td key={column.key} style={paint} />;
                    return (
                      <td key={column.key} style={paint}>
                        <button
                          type="button"
                          onClick={() => {
                            if (!window.confirm(stage.confirm)) return;
                            onPatch?.(row, { action: stage.action });
                          }}
                          style={{ border: '1px solid #0f172a', background: '#0f172a', color: '#fff', fontWeight: 700, padding: '4px 8px', whiteSpace: 'nowrap' }}
                        >
                          {stage.label}
                        </button>
                      </td>
                    );
                  }
                  if (column.key === 'delete') {
                    return (
                      <td key={column.key} style={paint}>
                        <button
                          type="button"
                          onClick={() => onDelete?.(row)}
                          style={{ border: '1px solid #991b1b', background: '#dc2626', color: '#fff', fontWeight: 700, padding: '2px 8px' }}
                        >
                          Delete
                        </button>
                      </td>
                    );
                  }
                  return <td key={column.key} style={paint}>{cells[column.key] ?? ''}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

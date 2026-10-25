'use client';

import { compareDocTasks, formatDisplayDate, normalizeIsoDate } from '@/lib/doc-task-dates';

const ROW_FILL = {
  'Waiting for Quotation': '#e9d5ff',
  'Waiting for Documents': '#fdba74',
  'Under Preparation': '#93c5fd',
};

const COLUMNS = [
  { key: 'sno', label: 'S.No', width: 56 },
  { key: 'bidNumber', label: 'Bid Number', width: 140 },
  { key: 'lastDate', label: 'Last Date', width: 118 },
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
];

const OVERVIEW_KEYS = ['sno', 'bidNumber', 'lastDate', 'assigned', 'clientName', 'companyName', 'clientNextUpdateDate', 'status', 'delete'];
const COMPLETED_KEYS = ['bidNumber', 'clientName', 'companyName', 'assigned', 'lastDate', 'delete'];

const cellStyle = {
  border: '1px solid #64748b',
  padding: '4px 6px',
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

function DateField({ value, onCommit }) {
  const shown = formatDisplayDate(value);
  return (
    <input
      defaultValue={shown}
      key={shown}
      aria-label="Client Next Update Date"
      onBlur={(event) => {
        const raw = event.target.value.trim();
        if (!raw) {
          onCommit('');
          return;
        }
        const iso = normalizeIsoDate(raw, { defaultYear: new Date().getFullYear() });
        if (!iso) {
          event.target.value = shown;
          onCommit(null);
          return;
        }
        event.target.value = formatDisplayDate(iso);
        if (iso !== value) onCommit(iso);
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

function TextField({ value, label, disabled, onCommit }) {
  return (
    <textarea
      aria-label={label}
      defaultValue={value || ''}
      key={`${label}:${value || ''}`}
      disabled={disabled}
      rows={2}
      onBlur={(event) => {
        if (disabled) return;
        if (event.target.value !== (value || '')) onCommit(event.target.value);
      }}
      style={{
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

function readText(value) {
  return (
    <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 96, overflow: 'auto' }}>
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
  onDateError,
  outline,
}) {
  const ordered = [...rows].sort(compareDocTasks);
  const byKey = Object.fromEntries(COLUMNS.map((column) => [column.key, column]));
  const fullKeys = COLUMNS.map((column) => column.key).filter((key) => key !== 'status');
  const columnKeys = variant === 'completed' ? COMPLETED_KEYS : variant === 'overview' ? OVERVIEW_KEYS : fullKeys;
  const columns = columnKeys
    .filter((key) => key !== 'delete' || canDelete)
    .map((key) => byKey[key])
    .filter(Boolean);

  const fillFor = (row) => (variant === 'completed' ? '#fff' : (ROW_FILL[row.status] || '#fff'));

  return (
    <div style={{
      overflow: 'auto',
      maxHeight: 'calc(100vh - 220px)',
      border: variant === 'completed' ? 'none' : `${outline ? 3 : 1}px solid ${outline || '#64748b'}`,
    }}>
      <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: columns.reduce((sum, column) => sum + column.width, 0) }}>
        <colgroup>
          {columns.map((column) => <col key={column.key} style={{ width: column.width }} />)}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} style={headerStyle}>{column.label}</th>
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
                  if (column.key === 'clientNextUpdateDate') {
                    if (!rowEditable) return <td key={column.key} style={paint}>{formatDisplayDate(row.clientNextUpdateDate)}</td>;
                    return (
                      <td key={column.key} style={paint}>
                        <DateField
                          value={row.clientNextUpdateDate}
                          onCommit={(iso) => {
                            if (iso == null) {
                              onDateError?.('Enter the date as DD-MM.');
                              return;
                            }
                            onPatch?.(row, { clientNextUpdateDate: iso });
                          }}
                        />
                      </td>
                    );
                  }
                  if (column.key === 'quotationRequired' || column.key === 'missingDocuments' || column.key === 'workCompleted') {
                    if (!rowEditable) return <td key={column.key} style={paint}>{yesNo(row[column.key])}</td>;
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
                  if (column.key === 'missingDocDetails' || column.key === 'checklistError' || column.key === 'remark') {
                    const locked = column.key === 'missingDocDetails' && row.missingDocuments !== true;
                    if (!rowEditable) return <td key={column.key} style={paint}>{readText(row[column.key])}</td>;
                    return (
                      <td key={column.key} style={paint}>
                        <TextField
                          label={column.label}
                          value={row[column.key]}
                          disabled={locked}
                          onCommit={(text) => onPatch?.(row, { [column.key]: text })}
                        />
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

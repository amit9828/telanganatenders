'use client';

import DocTaskGrid from '@/components/doc-team/DocTaskGrid';

const SECTIONS = [
  'Waiting for Quotation',
  'Waiting for Documents',
  'Under Preparation',
];

export default function DocTaskWorkflow({
  rows,
  editable,
  canAssign,
  canDelete,
  assignees,
  onPatch,
  onAssign,
  onDelete,
  onDateError,
}) {
  return (
    <div>
      {SECTIONS.map((status) => (
        <section key={status} style={{ marginBottom: 18 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{status}</h3>
          <DocTaskGrid
            rows={rows.filter((row) => row.status === status)}
            editable={editable}
            canAssign={canAssign}
            canDelete={canDelete}
            assignees={assignees}
            onPatch={onPatch}
            onAssign={onAssign}
            onDelete={onDelete}
            onDateError={onDateError}
          />
        </section>
      ))}
    </div>
  );
}

'use client';

import DocTaskGrid from '@/components/doc-team/DocTaskGrid';

const SECTIONS = [
  { status: 'Waiting for Quotation', color: '#7e22ce', assign: false },
  { status: 'Waiting for Documents', color: '#c2410c', assign: true },
  { status: 'Under Preparation', color: '#1d4ed8', assign: true },
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
      {SECTIONS.map((section) => (
        <section key={section.status} style={{ marginBottom: 18 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700, color: section.color }}>{section.status}</h3>
          <DocTaskGrid
            rows={rows.filter((row) => row.status === section.status)}
            editable={editable}
            canAssign={canAssign && section.assign}
            canDelete={canDelete}
            assignees={assignees}
            outline={section.color}
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

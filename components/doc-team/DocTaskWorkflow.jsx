'use client';

import DocTaskGrid from '@/components/doc-team/DocTaskGrid';

const SECTIONS = [
  { status: 'Waiting for Quotation', color: '#7e22ce', assign: false, variant: 'quotation' },
  { status: 'Waiting for Documents', color: '#c2410c', assign: true, variant: 'documents' },
  { status: 'Under Preparation', color: '#1d4ed8', assign: true, variant: 'preparation' },
];

export default function DocTaskWorkflow({
  rows,
  editable,
  editorEmpId = '',
  canAssign,
  canDelete,
  canDeleteQuotation = false,
  advanceMode = 'none',
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
            variant={section.variant}
            rows={rows.filter((row) => row.status === section.status)}
            editable={editable}
            editorEmpId={editorEmpId}
            canAssign={canAssign && section.assign}
            canDelete={section.variant === 'quotation' ? canDeleteQuotation : false}
            advanceMode={advanceMode}
            allowQuotationEdit={false}
            confirmDate={false}
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

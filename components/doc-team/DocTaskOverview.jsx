'use client';

import DocTaskGrid from '@/components/doc-team/DocTaskGrid';

export default function DocTaskOverview({ rows, canDelete, onDelete }) {
  return (
    <DocTaskGrid
      rows={rows}
      editable={false}
      canAssign={false}
      canDelete={canDelete}
      onDelete={onDelete}
    />
  );
}

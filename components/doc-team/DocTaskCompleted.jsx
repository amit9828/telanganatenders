'use client';

import DocTaskGrid from '@/components/doc-team/DocTaskGrid';

export default function DocTaskCompleted({ rows, canDelete, onDelete }) {
  return (
    <DocTaskGrid
      variant="completed"
      rows={rows}
      editable={false}
      canDelete={canDelete}
      onDelete={onDelete}
    />
  );
}

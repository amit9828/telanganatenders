'use client';

import DocTaskGrid from '@/components/doc-team/DocTaskGrid';

export default function DocTaskOverview({ rows }) {
  const ongoing = rows.filter((row) => row.status !== 'Completed');
  return (
    <DocTaskGrid
      variant="overview"
      rows={ongoing}
      editable={false}
      canAssign={false}
      canDelete={false}
    />
  );
}

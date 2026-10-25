'use client';

import DocTaskGrid from '@/components/doc-team/DocTaskGrid';

export default function DocTaskCompleted({ rows, advanceMode = 'none', onPatch }) {
  return (
    <DocTaskGrid
      variant="completed"
      rows={rows}
      editable={false}
      canDelete={false}
      advanceMode={advanceMode}
      onPatch={onPatch}
    />
  );
}

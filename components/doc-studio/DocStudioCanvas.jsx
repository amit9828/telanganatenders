'use client';

import { PHASE } from '@/lib/doc-session';
import EmptyCanvas from './EmptyCanvas';
import OutlinePreview from './OutlinePreview';
import DocumentPreview from './DocumentPreview';

/** Right pane. Which view is showing IS the session phase — there is no local state. */
export default function DocStudioCanvas({
  session,
  files,
  busy,
  requirements,
  analysing,
  analysisError,
  onReanalyse,
  onConfirm,
}) {
  const phase = session?.phase || PHASE.GATHERING;

  if (phase === PHASE.RENDERED && (files?.length || session?.files?.length)) {
    return <DocumentPreview session={session} files={files} />;
  }

  if (phase === PHASE.OUTLINE_PENDING || phase === PHASE.CONFIRMED) {
    return <OutlinePreview session={session} busy={busy} onConfirm={onConfirm} />;
  }

  return (
    <EmptyCanvas
      session={session}
      requirements={requirements}
      analysing={analysing}
      analysisError={analysisError}
      onReanalyse={onReanalyse}
    />
  );
}

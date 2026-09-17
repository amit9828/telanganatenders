export function workflowDocActions(job, openFile) {
  const actions = [];
  if (!job || typeof openFile !== 'function') return actions;
  if (job.tender_id || job.tender_pdf) {
    actions.push({ label: 'Tender PDF', icon: 'file', onClick: () => openFile(job, 'tender') });
  }
  if (job.sow) {
    actions.push({ label: 'View SOW', icon: 'eye', onClick: () => openFile(job, 'sow') });
  }
  if (job.checklist_file) {
    actions.push({ label: 'Checklist', onClick: () => openFile(job, 'checklist') });
  }
  (job.prep_files || []).forEach((file, index) => {
    const slot = file?.slot || `prep-${index}`;
    const name = file?.name || slot;
    actions.push({
      label: `Prep ${index + 1}: ${name}`,
      onClick: () => openFile(job, slot),
    });
  });
  if (job.receipt) {
    actions.push({ label: 'Receipt', icon: 'download', onClick: () => openFile(job, 'receipt') });
  }
  return actions;
}

export function mdDeleteCardAction(job, onDelete) {
  if (!job || typeof onDelete !== 'function') return null;
  return {
    label: 'Delete',
    variant: 'destructive',
    icon: 'trash',
    onClick: () => onDelete(job),
  };
}

import { belongsOnSuggestions } from './job-board-state.js';

export function suggestionTenderRows(jobs) {
  const ranked = [...(jobs || [])].sort((a, b) => {
    const left = new Date(a?.updated_at || a?.created_at || 0).getTime();
    const right = new Date(b?.updated_at || b?.created_at || 0).getTime();
    return right - left;
  });
  const seen = new Set();
  const rows = [];
  for (const job of ranked) {
    if (!belongsOnSuggestions(job)) continue;
    const bidNo = String(job.bid_no || '').trim();
    const tenderId = String(job.tender_id || '').trim();
    const key = bidNo || tenderId || String(job._id || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const title = String(job.title || '').trim();
    const organisation = String(job.department || job.organisation || '').trim();
    const client = String(job.parked_client_name || job.client_name || job.parked_client_email || job.client_email || '').trim();
    const head = bidNo || 'No bid number';
    const middle = [title, organisation].filter(Boolean).join(' / ');
    rows.push({
      jobId: String(job._id || ''),
      bidNo,
      title,
      organisation,
      client,
      tenderId,
      label: [head, middle, client].filter(Boolean).join(' — '),
    });
  }
  return rows;
}

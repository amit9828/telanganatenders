// Shared formatters — Enterprise UI/UX Blueprint (section D) calls for a single
// currency formatter so ₹ renders identically (en-IN grouping, '—' for zero/invalid)
// across the MD, Employee, and Client dashboards instead of 4 independently
// duplicated copies of the same function.
export function formatINR(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `₹${n.toLocaleString('en-IN')}`;
}

// Telangana and Andhra Pradesh district lists, shared by the matchmaker so its regional
// filter stays in step with the district dropdowns used across the dashboards.

export const TS_DISTRICTS = [
  'Hyderabad', 'Adilabad', 'Nizamabad', 'Karimnagar', 'Medak', 'Ranga Reddy',
  'Mahabubnagar', 'Nalgonda', 'Warangal', 'Khammam', 'Sangareddy',
  'Medchal-Malkajgiri', 'Siddipet', 'Vikarabad',
];

export const AP_DISTRICTS = [
  'Srikakulam', 'Vizianagaram', 'Visakhapatnam', 'East Godavari', 'West Godavari',
  'Krishna', 'Guntur', 'Prakasam', 'Nellore', 'Kadapa', 'Kurnool', 'Anantapur', 'Chittoor',
];

export const TS_AP_DISTRICTS = [...TS_DISTRICTS, ...AP_DISTRICTS];

// Free-text signals that place a tender in the two states even when `district` is blank —
// common for state-level departments that never name a district.
const STATE_KEYWORDS = [
  'telangana', 'andhra pradesh', 'andhrapradesh', ' ts ', ' ap ',
  'hyderabad', 'secunderabad', 'amaravati', 'vijayawada', 'visakhapatnam',
];

export function stateForDistrict(district) {
  const value = String(district || '').trim().toLowerCase();
  if (!value) return null;
  if (TS_DISTRICTS.some((d) => d.toLowerCase() === value)) return 'TS';
  if (AP_DISTRICTS.some((d) => d.toLowerCase() === value)) return 'AP';
  return null;
}

/**
 * True when a tender belongs to Telangana or Andhra Pradesh.
 *
 * Checks the structured `district` field first, then falls back to scanning the free-text
 * fields — a tender with no district set is still ours if the department or title names
 * the state.
 */
export function isTelanganaOrAndhra(tender) {
  if (stateForDistrict(tender?.district)) return true;

  const haystack = ` ${[tender?.title, tender?.department, tender?.address, tender?.supply_details]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()} `;

  if (STATE_KEYWORDS.some((kw) => haystack.includes(kw))) return true;
  return TS_AP_DISTRICTS.some((d) => haystack.includes(d.toLowerCase()));
}

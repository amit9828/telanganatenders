// Normalisation and baseline maths for the L1 Benchmark Repository.
//
// Kept free of Mongo and Gemini imports so the numeric behaviour can be unit-tested
// directly — these figures drive real pricing recommendations.

import { parseIndianAmount } from './matchmaking.js';

export const HISTORICAL_COLLECTION = 'historical_tender_results';

// Anything outside this band means the estimate on that record was wrong, not that the
// bidder genuinely quoted 300% below estimate. Such rows would wreck the median.
const MIN_DISCOUNT_PCT = -50;
const MAX_DISCOUNT_PCT = 90;

/** Discount of the winning price below the pre-bid estimate, as a percentage. */
export function computeDiscountPct(l1Price, estimateValue) {
  const l1 = parseIndianAmount(l1Price);
  const estimate = parseIndianAmount(estimateValue);
  if (!l1 || !estimate || estimate <= 0) return null;
  const pct = ((estimate - l1) / estimate) * 100;
  if (pct < MIN_DISCOUNT_PCT || pct > MAX_DISCOUNT_PCT) return null;
  return Number(pct.toFixed(2));
}

function cleanString(value, maxLength = 300) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text || /^(n\/?a|null|undefined|-|—)$/i.test(text)) return '';
  return text.slice(0, maxLength);
}

/**
 * Coerces one row — from AI extraction, a CSV, or a manual form — into the stored schema.
 * Returns null when the row lacks the two fields that make it useful: a title and a price.
 */
export function normaliseHistoricalRow(row = {}, defaults = {}) {
  const tender_title = cleanString(row.tender_title ?? row.title ?? row.tender ?? row.work_name);
  const l1_price = parseIndianAmount(row.l1_price ?? row.winning_price ?? row.awarded_value ?? row.l1);
  if (!tender_title || !l1_price) return null;

  const estimate_value = parseIndianAmount(
    row.estimate_value ?? row.estimated_value ?? row.estimate ?? row.ecv
  ) || null;

  // Prefer a discount we can verify against the two prices; only fall back to a supplied
  // percentage when the estimate is missing.
  const derivedDiscount = computeDiscountPct(l1_price, estimate_value);
  const suppliedDiscount = Number(String(row.discount_pct ?? row.discount ?? '').replace(/[%\s]/g, ''));
  const discount_pct = derivedDiscount != null
    ? derivedDiscount
    : (Number.isFinite(suppliedDiscount) && suppliedDiscount >= MIN_DISCOUNT_PCT && suppliedDiscount <= MAX_DISCOUNT_PCT
        ? Number(suppliedDiscount.toFixed(2))
        : null);

  return {
    tender_title,
    department: cleanString(row.department ?? row.dept ?? defaults.department),
    category: cleanString(row.category ?? defaults.category),
    l1_price,
    estimate_value,
    discount_pct,
    winner_name: cleanString(row.winner_name ?? row.winner ?? row.l1_winner ?? row.awarded_to, 200),
    award_year: (() => {
      const year = Number(String(row.award_year ?? row.year ?? '').match(/\b(19|20)\d{2}\b/)?.[0]);
      return Number.isFinite(year) ? year : null;
    })(),
    created_at: new Date(),
  };
}

/** Keyword set used to find records comparable to a tender. Short words are too noisy. */
export function titleKeywords(title, limit = 6) {
  return String(title || '')
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/g, ''))
    .filter((word) => word.length > 4)
    .slice(0, limit);
}

/**
 * Turns matched historical records into the baseline the model is shown. Doing the
 * arithmetic here rather than in the prompt keeps the recommendation reproducible.
 */
export function summariseBaseline(records = []) {
  const discounts = [];
  const winners = new Map();

  for (const record of records) {
    const pct = record?.discount_pct != null
      ? Number(record.discount_pct)
      : computeDiscountPct(record?.l1_price, record?.estimate_value);
    if (Number.isFinite(pct) && pct >= MIN_DISCOUNT_PCT && pct <= MAX_DISCOUNT_PCT) {
      discounts.push(Number(pct.toFixed(2)));
    }
    const winner = cleanString(record?.winner_name, 200);
    if (winner) winners.set(winner, (winners.get(winner) || 0) + 1);
  }

  const sorted = [...discounts].sort((a, b) => a - b);
  const median = sorted.length
    ? Number((sorted.length % 2
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2).toFixed(2))
    : null;

  return {
    records: records.length,
    usable_discounts: discounts.length,
    median_discount_pct: median,
    average_discount_pct: discounts.length
      ? Number((discounts.reduce((sum, d) => sum + d, 0) / discounts.length).toFixed(2))
      : null,
    min_discount_pct: sorted.length ? sorted[0] : null,
    max_discount_pct: sorted.length ? sorted[sorted.length - 1] : null,
    observed_discounts_pct: sorted,
    frequent_winners: [...winners.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, wins]) => ({ name, wins_observed: wins })),
  };
}

/**
 * Minimal RFC-4180 CSV parser — enough for the exported result sheets staff paste in,
 * without pulling in a dependency. Handles quoted fields and embedded commas/newlines.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const source = String(text || '').replace(/\r\n?/g, '\n');

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1; }
        else inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') { inQuotes = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += char;
  }

  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  const nonEmpty = rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
  if (nonEmpty.length < 2) return [];

  const headers = nonEmpty[0].map((h) => String(h).trim().toLowerCase().replace(/\s+/g, '_'));
  return nonEmpty.slice(1).map((cells) => {
    const record = {};
    headers.forEach((header, index) => { record[header] = cells[index] ?? ''; });
    return record;
  });
}

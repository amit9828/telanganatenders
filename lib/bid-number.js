import { z } from 'zod';

/** GeM bid numbers as printed on the document, for example GEM/2026/B/8091830. */
export const BID_NUMBER_PATTERN = /^GEM\/\d{4}\/B\/\d+$/;

export const BID_NUMBER_FORMAT_MESSAGE = 'Use the format GEM/2026/B/8091830.';

export const DUPLICATE_BID_MESSAGE = 'This bid number is already existed';

export const bidNumberSchema = z.string().trim().regex(BID_NUMBER_PATTERN, BID_NUMBER_FORMAT_MESSAGE);

/**
 * Inline format error for a bid number the user has started typing.
 * An empty field is not a format error; required-field checks stay with the form.
 * @param {unknown} value
 * @returns {string|null}
 */
export function bidNumberError(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  return bidNumberSchema.safeParse(raw).success ? null : BID_NUMBER_FORMAT_MESSAGE;
}

/**
 * @param {unknown} value
 * @returns {string|null} The trimmed bid number when it matches, otherwise null.
 */
export function parseBidNumber(value) {
  const parsed = bidNumberSchema.safeParse(String(value ?? ''));
  return parsed.success ? parsed.data : null;
}

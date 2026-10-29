// Fast, model-free read of a GeM bid cover page for the publisher auto-fill.
// Pure helpers: no Next.js or database imports.

import { TS_AP_DISTRICTS } from './regions.js';

const GEM_BID_RE = /GEM\s*[\/\-]?\s*(\d{4})\s*[\/\-]?\s*([A-Z])\s*[\/\-]?\s*(\d{4,})/i;

export const EMPTY_FAST_FIELDS = {
  bid_no: '',
  title: '',
  department: '',
  last_date: '',
  district: '',
  category: '',
  emd_amount: '',
};

export const CORE_FAST_FIELDS = ['bid_no', 'title', 'department', 'last_date'];

function squash(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function labeled(text, pattern) {
  const match = text.match(pattern);
  return match ? squash(match[1]).replace(/%+/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

/** Text of the first pages only, capped near 2000 tokens. Empty for scans. */
export async function firstPagesText(buffer, pages = 3, maxChars = 8000) {
  const { extractText } = await import('unpdf');
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: false });
  const list = Array.isArray(text) ? text : [String(text || '')];
  return squash(list.slice(0, pages).join(' ')).slice(0, maxChars);
}

function isoFromDmy(value) {
  const match = String(value || '').match(/(\d{2})[-/.](\d{2})[-/.](\d{4})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
}

const DISTRICT_PATTERNS = TS_AP_DISTRICTS.map((name) => ({
  name,
  re: new RegExp(`\\b${name.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&')}\\b`, 'i'),
}));

function findDistrict(text) {
  return DISTRICT_PATTERNS.find(({ re }) => re.test(text))?.name || '';
}

/** Fields a GeM cover page prints under fixed labels. Missing ones stay empty. */
export function parseGemCover(rawText) {
  const text = squash(rawText);
  if (!text) return { ...EMPTY_FAST_FIELDS };

  const bid = text.toUpperCase().match(GEM_BID_RE);
  const endAt = labeled(text, /Bid End Date\s*\/?\s*Time\s*:?\s*(\d{2}[-/.]\d{2}[-/.]\d{4})/i);
  const department = labeled(text, /Department Name\s*:?\s*(.+?)\s*\/?\s*Organisation Name/i);
  const organisation = labeled(text, /Organisation Name\s*:?\s*(.+?)\s*(?:%|\/?\s*Office Name)/i);
  const itemCategory = labeled(text, /Item Category\s*:?\s*(.+?)\s*\/?\s*(?:Similar Category|Contract Period|GeMARPTS|Minimum Average)/i);
  const emd = labeled(text, /EMD Amount\s*:?\s*([0-9][0-9,]*)/i).replace(/[^\d]/g, '');
  const service = /custom bid for services/i.test(text) || /service/i.test(itemCategory);

  return {
    bid_no: bid ? `GEM/${bid[1]}/${bid[2]}/${bid[3]}` : '',
    title: itemCategory.slice(0, 300),
    department: (department || organisation).slice(0, 200),
    last_date: isoFromDmy(endAt),
    district: findDistrict(text),
    category: service ? 'Service' : '',
    emd_amount: emd,
  };
}

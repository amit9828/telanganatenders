// GeM Live Hunter — targeted, district-aware BidPlus scrape for Telangana & Andhra Pradesh.
//
// Strategy (no blind page sweeps):
//   1. Prefetch approved-client keywords + compute From=today / To=+3 months
//   2. Open BidPlus headful, solve CAPTCHA if needed
//   3. Telangana districts first, then Andhra Pradesh — for each:
//      State → District → Date range → Search → infinite Next pagination
//   4. Keep only official GEM/YYYY/B/XXXXXXX bids whose Start/Published Date is
//      TODAY (all districts). Keyword hits are optional annotations only;
//      text-only upsert into live_scraped_bids by bid_no (no PDF / R2)
//
// Run on the MD/employee laptop only: `npm run gem:watch`
// The dashboard never scrapes GeM itself; it only asks this process to start.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { loadLocalEnv } from './load-local-env.js';
import { getDb } from '../lib/db.js';
import { AP_DISTRICTS, TS_DISTRICTS } from '../lib/regions.js';
import { parseServiceKeywords } from '../lib/matchmaking.js';

loadLocalEnv();

const START_URL = 'https://bidplus.gem.gov.in/all-bids';
const ADVANCE_SEARCH_URL = 'https://bidplus.gem.gov.in/advance-search';
const CAPTCHA_POLL_MS = 2500;
const CAPTCHA_TIMEOUT_MS = 15 * 60 * 1000;
const DISTRICT_TIMEOUT_MS = 8 * 60 * 1000;

/** Official BidPlus bid number: GEM/YYYY/B/XXXXXXX (B = Bid). */
const GEM_BID_RE = /GEM\/(\d{4})\/B\/(\d{5,})/i;

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

/** GeM City dropdown often uses slightly different spellings than our CRM list. */
const GEM_DISTRICT_ALIASES = {
  'Ranga Reddy': ['Ranga Reddy', 'Rangareddy', 'RangaReddy'],
  'Mahabubnagar': ['Mahabubnagar', 'Mahbubnagar'],
  'Medchal-Malkajgiri': ['Medchal-Malkajgiri', 'Medchal Malkajgiri', 'Medchal'],
  'Warangal': ['Warangal', 'Warangal Urban', 'Warangal Rural', 'Hanumakonda'],
  'Vijayawada (NTR)': ['Vijayawada', 'NTR', 'NTR District', 'Krishna'],
  'Kadapa (YSR)': ['Kadapa', 'YSR', 'Y.S.R.', 'Y.S.R', 'Cuddapah'],
  'Tirupati': ['Tirupati', 'Chittoor'],
  'Visakhapatnam': ['Visakhapatnam', 'Vizag', 'Visakhapatnam (Urban)'],
};

/** Telangana first, then Andhra Pradesh — never reverse this order. */
const STATE_PLANS = [
  { state: 'Telangana', districts: [...TS_DISTRICTS] },
  { state: 'Andhra Pradesh', districts: [...AP_DISTRICTS] },
];

function log(message) {
  console.log(`[gem-hunter] ${message}`);
}

function chime(message) {
  log(message);
  try {
    if (process.platform === 'win32') {
      spawn('powershell', [
        '-NoProfile', '-Command',
        '[console]::beep(880,350); Start-Sleep -Milliseconds 160; [console]::beep(660,350)',
      ], { stdio: 'ignore', windowsHide: true });
    } else {
      process.stdout.write('\x07');
    }
  } catch {
    /* a missing beep must never abort the hunt */
  }
}

function normaliseDate(value) {
  const text = String(value || '').trim();
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0];
  const dmy = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${month}-${day}`;
  }
  return text.slice(0, 32) || null;
}

/** Calendar YYYY-MM-DD for "today" in IST. */
function todayIsoDate() {
  const d = todayInIndia();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Parse a GeM Start / Published date into YYYY-MM-DD.
 * Supports DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD.
 */
function parseGemCalendarDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${month}-${day}`;
  }
  return null;
}

/**
 * Strict rule: Start Date / Published Date must equal today's IST date.
 * Missing or unparseable start dates are skipped (no backdated / older tenders).
 */
function isStartDateToday(bid) {
  const startIso = parseGemCalendarDate(bid?.start_date || bid?.published_date);
  if (!startIso) return false;
  return startIso === todayIsoDate();
}

function districtAliases(district) {
  const base = String(district || '').trim();
  const extras = GEM_DISTRICT_ALIASES[base] || [];
  return [...new Set([base, ...extras].map((v) => v.trim()).filter(Boolean))];
}

/** Normalise and accept only official GEM/YYYY/B/XXXXXXX bid numbers. */
function normaliseGemBidNo(value) {
  const match = String(value || '').toUpperCase().match(GEM_BID_RE);
  if (!match) return null;
  return `GEM/${match[1]}/B/${match[2]}`;
}

function assertPageAlive(page) {
  if (!page || page.isClosed()) {
    throw new Error('Browser/page was closed. Stopped district loop — relaunch the hunter.');
  }
}

function tokenizeFreeText(value) {
  return String(value || '')
    .split(/[,;/|]+/)
    .flatMap((part) => part.split(/[:\-]+/).pop().split(/\s+/))
    .map((word) => word.trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((word) => word.length > 2);
}

/**
 * Step 1 — pull approved clients and build a unified lowercase keyword list from
 * service_category, tender_interest, and related business fields.
 */
async function fetchClientKeywords(db) {
  const clients = await db.collection('users')
    .find(
      { is_approved: true },
      {
        projection: {
          email: 1,
          company_name: 1,
          service_category: 1,
          tender_interest: 1,
          company_type: 1,
          description: 1,
          business_category: 1,
        },
      },
    )
    .toArray();

  const keywords = new Set();
  for (const client of clients) {
    for (const kw of parseServiceKeywords(client.service_category)) keywords.add(kw);
    for (const field of [
      client.tender_interest,
      client.company_type,
      client.description,
      client.business_category,
    ]) {
      for (const kw of tokenizeFreeText(field)) keywords.add(kw);
    }
  }

  // Drop ultra-generic tokens that would match nearly every GeM listing.
  for (const noise of ['gem', 'bid', 'government', 'india', 'telangana', 'andhra', 'pradesh']) {
    keywords.delete(noise);
  }

  return {
    clients,
    keywords: [...keywords].sort(),
  };
}

function bidMatchesClientKeywords(bid, keywords) {
  if (!keywords.length) return false;
  const haystack = [
    bid.title,
    bid.department,
    bid.category,
    bid.location,
    bid.supply_details,
  ].filter(Boolean).join(' ').toLowerCase();

  const hits = keywords.filter((kw) => haystack.includes(kw));
  return hits.length ? hits : null;
}

async function captchaVisible(page) {
  return page.evaluate(() => {
    const body = (document.body?.innerText || '').toLowerCase();
    const textHit = /verify you are (a )?human|i.?m not a robot|solve (the )?captcha|attention required|checking your browser|enable javascript and cookies/.test(body);
    const node = document.querySelector([
      'iframe[src*="recaptcha"]',
      'iframe[src*="hcaptcha"]',
      'iframe[src*="captcha"]',
      '.g-recaptcha',
      '#captcha',
      'input[name*="captcha" i]',
      '[id*="captcha" i]',
      '[class*="captcha" i]',
    ].join(','));
    return Boolean(textHit || node);
  }).catch(() => false);
}

async function waitForCaptchaClear(page) {
  if (!(await captchaVisible(page))) return false;
  chime('⚠️ CAPTCHA detected. Please solve it on screen...');
  const started = Date.now();
  while (Date.now() - started < CAPTCHA_TIMEOUT_MS) {
    if (page.isClosed()) throw new Error('Browser closed while waiting for CAPTCHA.');
    await page.waitForTimeout(CAPTCHA_POLL_MS);
    if (!(await captchaVisible(page))) {
      log('CAPTCHA cleared — resuming.');
      return true;
    }
  }
  throw new Error('Timed out waiting for the CAPTCHA to be solved.');
}

async function clickFirstVisible(page, candidates, timeout = 2500) {
  for (const candidate of candidates) {
    const loc = typeof candidate === 'string'
      ? page.locator(candidate).first()
      : candidate;
    if (!(await loc.count().catch(() => 0))) continue;
    try {
      if (!(await loc.isVisible().catch(() => false))) continue;
      await loc.click({ timeout });
      return true;
    } catch {
      /* try next candidate */
    }
  }
  return false;
}

/** Short settle pause so GeM's Angular/Select2 UI can finish rendering. */
async function settle(page, ms = 500) {
  if (!page || page.isClosed()) return;
  try {
    await page.waitForTimeout(ms);
  } catch (err) {
    if (/closed|Target page/i.test(err?.message || '')) return;
    throw err;
  }
}

/**
 * Wait until at least one dropdown option panel / option node is visible.
 * GeM BidPlus uses Select2, native <select>, and assorted custom listboxes.
 */
async function waitForDropdownOptions(page, timeout = 10000) {
  if (!page || page.isClosed()) return false;
  const optionSelectors = [
    '.select2-results__option:not(.select2-results__message)',
    '.select2-container--open .select2-results__option',
    '[role="listbox"] [role="option"]',
    '[role="option"]',
    '.ng-dropdown-panel .ng-option',
    'mat-option',
    'ul.dropdown-menu li a',
    '.dropdown-menu.show .dropdown-item',
  ];

  try {
    await page.waitForSelector(optionSelectors.join(', '), {
      state: 'visible',
      timeout,
    });
    await settle(page, 350);
    return true;
  } catch {
    return false;
  }
}

/** Read the visible value of one filter control (Select2 / select / input). */
async function readControlValue(control) {
  if (!control) return '';
  return control.evaluate((el) => {
    const pick = (node) => {
      if (!node) return '';
      if (node.tagName === 'SELECT') {
        const opt = node.options?.[node.selectedIndex];
        return (opt?.text || node.value || '').trim();
      }
      if (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA') {
        return (node.value || node.getAttribute('title') || '').trim();
      }
      const rendered = node.querySelector?.('.select2-selection__rendered, .filter-option-inner-inner, .chosen-single span');
      if (rendered) {
        return (rendered.getAttribute('title') || rendered.textContent || '').trim();
      }
      return (node.getAttribute?.('title') || node.textContent || '').trim();
    };

    let text = pick(el);
    // If we clicked a wrapper, prefer an inner select / Select2 render node.
    if (!text || /select\s/i.test(text)) {
      const inner = el.querySelector?.(
        'select, .select2-selection__rendered, input, [role="combobox"]',
      );
      const innerText = pick(inner);
      if (innerText) text = innerText;
    }
    return String(text || '').replace(/\s+/g, ' ').trim();
  }).catch(() => '');
}

function valueMatchesWanted(value, expectedTexts) {
  const hay = String(value || '').toLowerCase();
  if (!hay || /^(select\b|choose\b|--|please\s*select)/i.test(hay)) return false;
  return expectedTexts.some((t) => {
    const needle = String(t).trim().toLowerCase();
    return needle && hay.includes(needle);
  });
}

/**
 * Resolve a GeM Advanced Search filter control by label / placeholder / nearby text
 * instead of brittle CSS class chains.
 */
async function findFilterControl(page, fieldLabels, placeholders = []) {
  // 1) Accessible name / label
  for (const label of fieldLabels) {
    const byLabel = page.getByLabel(new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`, 'i')).first()
      .or(page.getByLabel(new RegExp(escapeRegExp(label), 'i')).first());
    if (await byLabel.isVisible().catch(() => false)) return byLabel;

    const combo = page.getByRole('combobox', { name: new RegExp(escapeRegExp(label), 'i') }).first();
    if (await combo.isVisible().catch(() => false)) return combo;
  }

  // 2) Placeholder text ("Select State", "Select City", …)
  for (const ph of placeholders) {
    const byPh = page.getByPlaceholder(new RegExp(escapeRegExp(ph), 'i')).first();
    if (await byPh.isVisible().catch(() => false)) return byPh;
  }

  // 3) Select2 closed state still shows "Select State" as text inside the widget
  for (const ph of placeholders) {
    const byText = page.getByText(new RegExp(`^\\s*${escapeRegExp(ph)}\\s*$`, 'i')).first();
    if (!(await byText.isVisible().catch(() => false))) continue;
    const container = byText.locator(
      'xpath=ancestor::*[contains(@class,"select2") or contains(@class,"form-group") '
      + 'or contains(@class,"dropdown") or self::div][1]',
    ).first();
    if (await container.isVisible().catch(() => false)) return container;
    return byText;
  }

  // 4) Exact label text → nearest select / Select2 in the same form-group
  for (const label of fieldLabels) {
    const labelNode = page.getByText(new RegExp(`^\\s*${escapeRegExp(label)}\\s*:?\\s*$`, 'i')).first();
    if (!(await labelNode.isVisible().catch(() => false))) continue;

    const group = labelNode.locator(
      'xpath=ancestor::*[contains(@class,"form-group") or contains(@class,"row") '
      + 'or self::div or self::li or self::td][1]',
    ).first();

    const inGroup = group.locator(
      '.select2-selection, .select2-container, select, [role="combobox"], input',
    ).first();
    if (await inGroup.isVisible().catch(() => false)) return inGroup;

    const followingSelect = labelNode.locator('xpath=following::select[1]').first();
    if (await followingSelect.isVisible().catch(() => false)) return followingSelect;

    const followingSelect2 = labelNode.locator(
      'xpath=following::*[contains(@class,"select2-selection")][1]',
    ).first();
    if (await followingSelect2.isVisible().catch(() => false)) return followingSelect2;
  }

  return null;
}

/**
 * Click a dropdown option by visible text once the options panel is open.
 * Prefer option roles / Select2 results — avoid bare getByText on the whole page.
 */
async function clickDropdownOption(page, optionTexts) {
  for (const text of optionTexts) {
    const exact = new RegExp(`^\\s*${escapeRegExp(text)}\\s*$`, 'i');
    const soft = new RegExp(escapeRegExp(text), 'i');

    const candidates = [
      page.locator('.select2-results__option', { hasText: exact }).first(),
      page.locator('.select2-container--open .select2-results__option', { hasText: soft }).first(),
      page.getByRole('option', { name: exact }).first(),
      page.getByRole('option', { name: soft }).first(),
      page.locator('.ng-option', { hasText: soft }).first(),
      page.locator('mat-option', { hasText: soft }).first(),
      page.locator('[role="listbox"] [role="option"]', { hasText: soft }).first(),
    ];

    for (const opt of candidates) {
      if (!(await opt.isVisible().catch(() => false))) continue;
      try {
        await opt.scrollIntoViewIfNeeded().catch(() => {});
        await settle(page, 200);
        await opt.click({ timeout: 3000 });
        return text;
      } catch {
        /* try next candidate */
      }
    }
  }
  return null;
}

/**
 * Robust GeM filter selection: open control → wait for options → pick → verify
 * against THAT control only (never page-wide text matches).
 */
async function selectDropdownOption(page, labels, optionTexts, {
  placeholders = [],
  verify = true,
} = {}) {
  const wanted = optionTexts.map((t) => String(t).trim()).filter(Boolean);
  if (!wanted.length) return false;

  const phList = placeholders.length
    ? placeholders
    : labels.flatMap((l) => [`Select ${l}`, `Select ${l.toLowerCase()}`, l]);

  const control = await findFilterControl(page, labels, phList);

  // Skip only when THIS control already shows the value — never scan the whole page
  // (GeM pages mention "Telangana" / "Hyderabad" in footers and bid cards).
  if (control && verify) {
    const current = await readControlValue(control);
    if (valueMatchesWanted(current, wanted)) {
      log(`${labels[0]} control already set to "${current}".`);
      return true;
    }
  }

  // --- Native <select> near label ---
  for (const label of labels) {
    const byLabel = page.locator(
      `xpath=//label[contains(translate(normalize-space(.), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${label.toLowerCase()}")]//following::select[1]`,
    ).first();
    if (!(await byLabel.count().catch(() => 0))) continue;
    if (!(await byLabel.isVisible().catch(() => false))) continue;

    const options = await byLabel.locator('option').allTextContents().catch(() => []);
    const match = options.find((opt) => wanted.some((w) => opt.toLowerCase().includes(w.toLowerCase())));
    if (!match) continue;

    await byLabel.scrollIntoViewIfNeeded().catch(() => {});
    await settle(page, 250);
    await byLabel.selectOption({ label: match }).catch(async () => {
      await byLabel.selectOption({ value: match });
    });
    await settle(page, 500);
    const after = await readControlValue(byLabel);
    if (!verify || valueMatchesWanted(after, wanted)) {
      log(`Verified ${label} → ${after || match}`);
      return true;
    }
  }

  if (!control) {
    log(`Could not locate filter control for: ${labels.join(', ')}`);
    return false;
  }

  await control.scrollIntoViewIfNeeded().catch(() => {});
  await settle(page, 300);

  // Open the widget (Select2 needs the rendered selection clicked).
  const openTargets = [
    control,
    control.locator('.select2-selection, .select2-selection__rendered, .select2-selection__arrow').first(),
  ];
  let opened = false;
  for (const target of openTargets) {
    try {
      if (!(await target.count().catch(() => 0))) continue;
      await target.click({ timeout: 4000 });
      opened = true;
      break;
    } catch {
      /* try next */
    }
  }
  if (!opened) {
    log(`Could not open dropdown for ${labels[0]}.`);
    return false;
  }

  await settle(page, 500);
  let optionsReady = await waitForDropdownOptions(page, 10000);
  if (!optionsReady) {
    await control.click({ timeout: 3000 }).catch(() => {});
    await settle(page, 700);
    optionsReady = await waitForDropdownOptions(page, 8000);
  }
  if (!optionsReady) {
    log(`Dropdown options never appeared for ${labels[0]}.`);
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  }

  // Type-ahead inside open Select2 (long city lists).
  const typeahead = page.locator(
    '.select2-container--open .select2-search__field, '
    + '.select2-search--dropdown .select2-search__field, '
    + 'input.select2-search__field',
  ).first();
  if (await typeahead.isVisible().catch(() => false)) {
    await typeahead.fill('');
    await typeahead.type(wanted[0], { delay: 40 });
    await settle(page, 600);
    await waitForDropdownOptions(page, 5000);
  }

  const picked = await clickDropdownOption(page, wanted);
  if (!picked) {
    await page.keyboard.press('Escape').catch(() => {});
    log(`No dropdown option matched for ${labels[0]} among: ${wanted.join(', ')}`);
    return false;
  }

  await settle(page, 800);
  await page.keyboard.press('Escape').catch(() => {});

  if (verify) {
    // Re-find control — Select2 may re-render the node after selection.
    const afterControl = (await findFilterControl(page, labels, phList)) || control;
    const after = await readControlValue(afterControl);
    if (!valueMatchesWanted(after, wanted)) {
      log(`Selection of "${picked}" for ${labels[0]} did not stick (control shows "${after || 'empty'}").`);
      return false;
    }
    log(`Verified ${labels[0]} → ${after}`);
  }
  return true;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Local calendar date in Asia/Kolkata (GeM buyers work IST). */
function todayInIndia() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const day = Number(parts.find((p) => p.type === 'day')?.value);
  return new Date(year, month - 1, day);
}

function currentGemYear() {
  return todayInIndia().getFullYear();
}

/** Add whole months without drifting the day when the target month is shorter. */
function addMonths(date, months) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = result.getDate();
  result.setMonth(result.getMonth() + months);
  if (result.getDate() < day) result.setDate(0);
  return result;
}

function formatGemDate(date, separator = '-') {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  return `${dd}${separator}${mm}${separator}${yyyy}`;
}

function huntDateWindow() {
  const from = todayInIndia();
  const to = addMonths(from, 3);
  return {
    from,
    to,
    fromDash: formatGemDate(from, '-'),
    toDash: formatGemDate(to, '-'),
    fromSlash: formatGemDate(from, '/'),
    toSlash: formatGemDate(to, '/'),
    fromIso: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`,
    toIso: `${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, '0')}-${String(to.getDate()).padStart(2, '0')}`,
  };
}

/**
 * Types / injects a date into a GeM Bid End Date field.
 * Consignee Location uses jQuery/Bootstrap datepickers that are often readonly,
 * so Playwright fill() fails — we set the value via the DOM and fire change events.
 */
async function fillDateInput(locator, dashValue, slashValue, isoValue) {
  if (!(await locator.count().catch(() => 0))) return false;
  try {
    if (!(await locator.isVisible().catch(() => false))) return false;
    await locator.scrollIntoViewIfNeeded().catch(() => {});

    // Prefer interacting with a real <input>; the locator may be a wrapper.
    const input = locator.locator('input').first();
    const target = (await input.count().catch(() => 0)) ? input : locator;

    await target.click({ timeout: 2500 }).catch(() => {});

    const inputType = (await target.getAttribute('type').catch(() => '')) || '';
    const readOnly = (await target.getAttribute('readonly').catch(() => null)) != null;

    // 1) Native / editable text fields
    if (!readOnly && inputType !== 'hidden') {
      try {
        const preferred = inputType === 'date' ? isoValue : dashValue;
        await target.fill('');
        await target.fill(preferred);
        let current = await target.inputValue().catch(() => '');
        if (!current || !/\d{2}/.test(current)) {
          await target.fill('');
          await target.type(slashValue, { delay: 30 });
          current = await target.inputValue().catch(() => '');
        }
        if (current && /\d{2}/.test(current)) {
          await target.press('Tab').catch(() => {});
          return true;
        }
      } catch {
        /* fall through to DOM inject */
      }
    }

    // 2) Readonly datepicker — unlock, set value, notify jQuery/Angular listeners
    const applied = await target.evaluate((el, values) => {
      const node = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
        ? el
        : el.querySelector?.('input');
      if (!node) return false;

      node.removeAttribute('readonly');
      node.removeAttribute('disabled');

      const candidates = [values.dash, values.slash, values.iso];
      let ok = false;
      for (const next of candidates) {
        node.value = next;
        node.setAttribute('value', next);
        node.dispatchEvent(new Event('input', { bubbles: true }));
        node.dispatchEvent(new Event('change', { bubbles: true }));
        node.dispatchEvent(new Event('blur', { bubbles: true }));
        // jQuery datepicker / Angular listeners
        if (typeof window.jQuery === 'function') {
          try {
            window.jQuery(node).val(next).trigger('change').trigger('input').datepicker?.('setDate', next);
          } catch { /* ignore */ }
        }
        if (node.value && /\d/.test(node.value)) {
          ok = true;
          break;
        }
      }
      return ok;
    }, { dash: dashValue, slash: slashValue, iso: isoValue }).catch(() => false);

    if (applied) {
      await target.press('Tab').catch(() => {});
      const finalValue = await target.inputValue().catch(() => '');
      return Boolean(finalValue && /\d{2}/.test(finalValue));
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Locate Bid End Date From / To inputs inside the Consignee Location panel.
 * GeM labels them "Bid End Date" with From / To; fields are often readonly datepickers.
 */
async function findConsigneeDateInputs(page) {
  // Prefer the expanded Consignee Location card so we don't hit other Advanced Search panels.
  const panel = page.locator(
    '.collapse.show, .tab-pane.active, .card, .panel, form, .accordion-body, [class*="consignee"]',
  ).filter({ hasText: /consignee/i }).first();

  const scope = (await panel.count().catch(() => 0)) && (await panel.isVisible().catch(() => false))
    ? panel
    : page;

  const fromLocators = [
    scope.getByLabel(/bid\s*end\s*date\s*\(?\s*from/i).first(),
    scope.getByPlaceholder(/from|dd[\/\-.]mm/i).first(),
    scope.locator('input[id*="bid" i][id*="from" i], input[name*="bid" i][name*="from" i]').first(),
    scope.locator('input[id*="end" i][id*="from" i], input[name*="end" i][name*="from" i]').first(),
    scope.locator('input[id*="from" i][class*="date" i], input[name*="from" i][class*="date" i]').first(),
    scope.locator(
      'xpath=.//label[contains(translate(.,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"bid end") '
      + 'and contains(translate(.,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"from")]'
      + '/following::input[1]',
    ).first(),
    scope.locator(
      'xpath=.//*[contains(translate(normalize-space(.),"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"bid end date")]'
      + '//input[contains(translate(@id,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"from") '
      + 'or contains(translate(@name,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"from") '
      + 'or contains(translate(@placeholder,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"from")][1]',
    ).first(),
    scope.locator(
      'xpath=.//label[contains(translate(.,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"from")]'
      + '/following::input[contains(@class,"date") or contains(@id,"date") or @type="text" or @type="date"][1]',
    ).first(),
  ];

  const toLocators = [
    scope.getByLabel(/bid\s*end\s*date\s*\(?\s*to/i).first(),
    scope.getByPlaceholder(/^\s*to\s*$|dd[\/\-.]mm/i).first(),
    scope.locator('input[id*="bid" i][id*="to" i], input[name*="bid" i][name*="to" i]').first(),
    scope.locator('input[id*="end" i][id*="to" i], input[name*="end" i][name*="to" i]').first(),
    scope.locator('input[id*="to" i][class*="date" i], input[name*="to" i][class*="date" i]').first(),
    scope.locator(
      'xpath=.//label[contains(translate(.,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"bid end") '
      + 'and contains(translate(.,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"to")]'
      + '/following::input[1]',
    ).first(),
    scope.locator(
      'xpath=.//*[contains(translate(normalize-space(.),"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"bid end date")]'
      + '//input[contains(translate(@id,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"to") '
      + 'or contains(translate(@name,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"to") '
      + 'or contains(translate(@placeholder,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"to")][1]',
    ).first(),
    scope.locator(
      'xpath=.//label[contains(translate(.,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"to")]'
      + '/following::input[contains(@class,"date") or contains(@id,"date") or @type="text" or @type="date"][1]',
    ).first(),
  ];

  return { scope, fromLocators, toLocators };
}

/**
 * Sets Bid End Date range on Advanced Search Consignee Location:
 * From = today (IST), To = today + 3 months.
 */
async function setAdvancedSearchDateRange(page) {
  assertPageAlive(page);
  const window = huntDateWindow();
  log(`Date range → From ${window.fromSlash}  To ${window.toSlash} (+3 months)`);

  await settle(page, 400);
  const { scope, fromLocators, toLocators } = await findConsigneeDateInputs(page);

  let fromOk = false;
  for (const loc of fromLocators) {
    fromOk = await fillDateInput(loc, window.fromDash, window.fromSlash, window.fromIso);
    if (fromOk) {
      log(`Bid End Date (From) set to ${window.fromDash}`);
      break;
    }
  }
  await settle(page, 350);

  let toOk = false;
  for (const loc of toLocators) {
    toOk = await fillDateInput(loc, window.toDash, window.toSlash, window.toIso);
    if (toOk) {
      log(`Bid End Date (To) set to ${window.toDash}`);
      break;
    }
  }

  // Last resort: visible date-like inputs inside the Consignee panel, in document order.
  if (!fromOk || !toOk) {
    const dateInputs = scope.locator(
      'input.hasDatepicker, input.datepicker, input[class*="date" i], '
      + 'input[placeholder*="dd" i], input[placeholder*="date" i], '
      + 'input[id*="date" i], input[name*="date" i], input[type="date"]',
    );
    const visible = [];
    const count = await dateInputs.count().catch(() => 0);
    for (let i = 0; i < count; i += 1) {
      const el = dateInputs.nth(i);
      if (await el.isVisible().catch(() => false)) visible.push(el);
    }
    log(`Fallback date inputs visible in panel: ${visible.length}`);
    if (!fromOk && visible[0]) {
      fromOk = await fillDateInput(visible[0], window.fromDash, window.fromSlash, window.fromIso);
      if (fromOk) log(`Bid End Date (From) set via fallback #1 → ${window.fromDash}`);
    }
    if (!toOk && visible[1]) {
      toOk = await fillDateInput(visible[1], window.toDash, window.toSlash, window.toIso);
      if (toOk) log(`Bid End Date (To) set via fallback #2 → ${window.toDash}`);
    } else if (!toOk && visible[0] && fromOk && visible.length === 1) {
      // Unlikely single field — skip
    }
  }

  // Absolute last resort: inject into first two datepicker inputs GeM rendered under Consignee.
  if (!fromOk || !toOk) {
    const injected = await page.evaluate(({ fromDash, toDash, fromSlash, toSlash }) => {
      const isConsigneeContext = (el) => {
        let n = el;
        for (let i = 0; i < 12 && n; i += 1) {
          const t = (n.innerText || n.textContent || '').toLowerCase();
          if (t.includes('consignee')) return true;
          n = n.parentElement;
        }
        return false;
      };
      const inputs = [...document.querySelectorAll(
        'input.hasDatepicker, input.datepicker, input[class*="date"], '
        + 'input[id*="date"], input[name*="date"], input[placeholder*="dd"], input[type="date"]',
      )].filter((el) => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
      });

      const scoped = inputs.filter(isConsigneeContext);
      const list = scoped.length >= 2 ? scoped : inputs;

      const write = (el, dash, slash) => {
        if (!el) return false;
        el.removeAttribute('readonly');
        el.removeAttribute('disabled');
        for (const v of [dash, slash]) {
          el.value = v;
          el.setAttribute('value', v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          if (typeof window.jQuery === 'function') {
            try { window.jQuery(el).val(v).trigger('change'); } catch { /* ignore */ }
          }
          if (el.value && /\d/.test(el.value)) return true;
        }
        return false;
      };

      return {
        from: write(list[0], fromDash, fromSlash),
        to: write(list[1], toDash, toSlash),
        found: list.length,
      };
    }, {
      fromDash: window.fromDash,
      toDash: window.toDash,
      fromSlash: window.fromSlash,
      toSlash: window.toSlash,
    }).catch(() => ({ from: false, to: false, found: 0 }));

    if (injected.from) fromOk = true;
    if (injected.to) toOk = true;
    if (injected.found) {
      log(`DOM inject date fields: found=${injected.found}, from=${injected.from}, to=${injected.to}`);
    }
  }

  if (!fromOk || !toOk) {
    log(`Date pickers partially unavailable (from=${fromOk}, to=${toOk}) — continuing with other filters.`);
  } else {
    log(`Date range applied: ${window.fromDash} → ${window.toDash}`);
  }

  return { ...window, fromOk, toOk };
}

/**
 * After State / City / dates are set, click ONLY the Consignee Location "Search"
 * button — never "View all Bids/RAs", "View all", or "Search by Consignee Location".
 */
async function clickConsigneeSearchButton(page) {
  assertPageAlive(page);

  const isForbiddenLabel = (text) => {
    const t = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!t) return true;
    if (/view\s*all/.test(t)) return true;
    if (/view\s*orbit/.test(t)) return true;
    if (/search\s*by/.test(t)) return true;
    if (/advance(d)?\s*search/.test(t)) return true;
    return false;
  };

  const isExactSearch = (text) => {
    const t = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return t === 'search' || t === 'search »' || t === 'search >';
  };

  // Scope to Consignee Location panel first.
  const panel = page.locator(
    '.collapse.show, .tab-pane.active, .card, .panel, form, .accordion-body',
  ).filter({ hasText: /consignee\s*(location|state|city)/i }).first();

  const scopes = [];
  if (await panel.isVisible().catch(() => false)) scopes.push(panel);
  scopes.push(page);

  for (const scope of scopes) {
    const candidates = [
      scope.getByRole('button', { name: /^search$/i }),
      scope.getByRole('link', { name: /^search$/i }),
      scope.locator('button, input[type="submit"], input[type="button"], a.btn').filter({
        hasText: /^search$/i,
      }),
      scope.getByText(/^search$/i),
    ];

    for (const group of candidates) {
      const count = await group.count().catch(() => 0);
      for (let i = 0; i < count; i += 1) {
        const loc = group.nth(i);
        if (!(await loc.isVisible().catch(() => false))) continue;

        const label = (
          await loc.innerText().catch(() => '')
          || await loc.getAttribute('value').catch(() => '')
          || await loc.getAttribute('aria-label').catch(() => '')
          || ''
        ).trim();

        if (isForbiddenLabel(label)) {
          log(`Skipping non-Search control: "${label}"`);
          continue;
        }
        if (!isExactSearch(label) && label.length > 0) {
          // getByText(/^search$/i) already exact; empty value buttons may still be OK
          if (!/^search$/i.test(label)) continue;
        }

        try {
          await loc.scrollIntoViewIfNeeded().catch(() => {});
          await settle(page, 250);
          await loc.click({ timeout: 4000 });
          log(`Clicked Consignee Search (label="${label || 'Search'}").`);
          await settle(page, 1200);
          return true;
        } catch (err) {
          log(`Search click soft-failed: ${err.message}`);
        }
      }
    }
  }

  // Final attempt: evaluate click on exact Search buttons inside Consignee block.
  const clicked = await page.evaluate(() => {
    const forbidden = (t) => /view\s*all|search\s*by|advance/i.test(t);
    const nodes = [...document.querySelectorAll('button, input[type="submit"], input[type="button"], a')];
    const searchNodes = nodes.filter((el) => {
      const t = ((el.innerText || el.value || el.getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim();
      if (!/^search$/i.test(t)) return false;
      if (forbidden(t)) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && el.offsetParent !== null;
    });

    // Prefer a Search that sits under a Consignee heading.
    const preferred = searchNodes.find((el) => {
      let n = el;
      for (let i = 0; i < 14 && n; i += 1) {
        if (/consignee/i.test(n.innerText || '')) return true;
        n = n.parentElement;
      }
      return false;
    }) || searchNodes[0];

    if (!preferred) return false;
    preferred.click();
    return true;
  }).catch(() => false);

  if (clicked) {
    log('Clicked Consignee Search via DOM fallback.');
    await settle(page, 1200);
    return true;
  }

  return false;
}

/**
 * Opens Advanced Search and expands the "Search by Consignee Location" panel.
 * Returns true only when Consignee State / Select State is actually visible.
 */
async function openConsigneeLocationSearch(page) {
  assertPageAlive(page);

  const onAdvanced = /advance-search|advanced/i.test(page.url());
  if (!onAdvanced) {
    const opened = await clickFirstVisible(page, [
      page.getByRole('link', { name: /advance(d)?\s*search/i }).first(),
      page.getByRole('button', { name: /advance(d)?\s*search/i }).first(),
      page.getByText(/advance(d)?\s*search/i).first(),
    ], 4000);

    if (opened) {
      await settle(page, 900);
      await waitForCaptchaClear(page);
    } else {
      await page.goto(ADVANCE_SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await settle(page, 1000);
      await waitForCaptchaClear(page);
    }
  }

  assertPageAlive(page);

  const consigneeTriggers = [
    page.getByRole('button', { name: /search\s*by\s*consignee\s*location/i }).first(),
    page.getByRole('tab', { name: /consignee\s*location/i }).first(),
    page.getByRole('link', { name: /consignee\s*location/i }).first(),
    page.getByText(/search\s*by\s*consignee\s*location/i).first(),
    page.getByText(/consignee\s*location/i).first(),
  ];

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    assertPageAlive(page);
    await clickFirstVisible(page, consigneeTriggers, 4000);
    await settle(page, 900);

    const stateReady = await page.getByText(/consignee\s*state/i).first().isVisible().catch(() => false)
      || await page.getByText(/^select\s*state$/i).first().isVisible().catch(() => false)
      || await page.getByPlaceholder(/select\s*state/i).first().isVisible().catch(() => false)
      || await page.getByLabel(/consignee\s*state|^state$/i).first().isVisible().catch(() => false);

    if (stateReady) {
      log('Consignee Location panel expanded — State field visible.');
      await settle(page, 500);
      return true;
    }

    await clickFirstVisible(page, [
      page.locator('a, button, span').filter({ hasText: /consignee\s*location/i }).first(),
      page.locator('[data-toggle="collapse"], .accordion-toggle, .card-header').filter({
        hasText: /consignee/i,
      }).first(),
    ], 2500);
    await settle(page, 800);
    log(`Consignee Location expand attempt ${attempt}/3 — State field not visible yet.`);
  }

  log('Timed out waiting for Consignee State field after expanding Consignee Location.');
  return false;
}

/**
 * Step 2 — for one district: Advanced Search → Consignee Location →
 * State → District → Date range (today → +3 months) → Search.
 * Falls back to keyword search only if location filters fail verification.
 */
async function applyStateDistrictFilter(page, state, district) {
  assertPageAlive(page);
  const aliases = districtAliases(district);
  log(`Filtering → ${state} / ${district} (State → District → Date → Search)`);

  const panelOpen = await openConsigneeLocationSearch(page);
  assertPageAlive(page);

  if (!panelOpen) {
    log('Consignee Location form did not open — skipping dropdowns for this district.');
  }

  // 1) State — must actually open the dropdown (no page-wide false positives).
  const stateOk = panelOpen && await selectDropdownOption(
    page,
    ['Consignee State', 'State'],
    [state, state.replace(/\s+Pradesh$/i, ''), state.toUpperCase()],
    {
      placeholders: ['Select State', 'Select Consignee State', 'State'],
      verify: true,
    },
  );
  if (!stateOk) {
    log(`State selection failed for "${state}" — district list may be empty.`);
  } else {
    await settle(page, 1200);
    try {
      await page.getByText(/consignee\s*city|^city$|select\s*city/i).first()
        .waitFor({ state: 'visible', timeout: 10000 });
    } catch {
      /* City Select2 may already be present */
    }
    await settle(page, 500);
  }

  // 2) District / City
  const cityOk = stateOk && await selectDropdownOption(
    page,
    ['Consignee City', 'City', 'District', 'Consignee District'],
    aliases,
    {
      placeholders: ['Select City', 'Select District', 'City', 'District'],
      verify: true,
    },
  );
  if (!cityOk) {
    log(`District/City selection failed for "${district}" (aliases: ${aliases.join(', ')}).`);
  } else {
    await settle(page, 700);
  }

  if (stateOk && cityOk) {
    log(`Location verified → ${state} / ${district}. Proceeding to date range.`);
  } else if (stateOk || cityOk) {
    log(`Partial location filter (state=${stateOk}, city=${cityOk}) — still applying dates.`);
  }

  await settle(page, 400);
  const dateRange = await setAdvancedSearchDateRange(page);
  await settle(page, 500);

  // GeM shows both "Search" and "View all Bids/RAs" — NEVER click View all.
  // Only the exact Search control under Consignee Location runs the filtered query.
  const searched = await clickConsigneeSearchButton(page);
  if (!searched) {
    log('Search button was not clicked — refusing to use View all Bids/RAs.');
  }

  if (stateOk || cityOk || searched || dateRange.fromOk || dateRange.toOk) {
    await settle(page, 1600);
    if (!page.isClosed()) await waitForCaptchaClear(page);
    return {
      stateOk: Boolean(stateOk),
      cityOk: Boolean(cityOk),
      searched,
      dateFrom: dateRange.fromSlash,
      dateTo: dateRange.toSlash,
      mode: 'filter',
    };
  }

  log(`Dropdown filters unavailable for ${district} — falling back to keyword search.`);
  if (page.isClosed()) {
    throw new Error('Browser/page was closed during location filter.');
  }
  if (!/all-bids/i.test(page.url())) {
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await waitForCaptchaClear(page);
  }

  const search = page.getByPlaceholder(/search|bid/i).first()
    .or(page.locator('input[type="search"]').first());
  if (await search.count().catch(() => 0)) {
    await search.fill(`${state} ${aliases[0]}`);
    await page.keyboard.press('Enter');
    await settle(page, 1500);
    await waitForCaptchaClear(page);
    return {
      stateOk: false,
      cityOk: false,
      searched: true,
      dateFrom: dateRange.fromSlash,
      dateTo: dateRange.toSlash,
      mode: 'keyword',
    };
  }

  return { stateOk: false, cityOk: false, searched: false, mode: 'none' };
}

/**
 * Step 3 — scrape visible result cards for official GEM/YYYY/B/XXXXXXX bids.
 * Captures Start/Published date separately from Bid End date.
 */
async function extractVisibleBids(page) {
  assertPageAlive(page);
  const year = currentGemYear();
  return page.evaluate(({ yearNow }) => {
    const GEM_RE = /GEM\/(\d{4})\/B\/(\d{5,})/gi;
    const seen = new Map();

    const pickField = (text, labels) => {
      for (const label of labels) {
        const re = new RegExp(`${label}\\s*[:\\-]?\\s*([^\\n|]{3,120})`, 'i');
        const m = text.match(re);
        if (m) return m[1].trim();
      }
      return '';
    };

    const pickLabeledDate = (text, labels) => {
      for (const label of labels) {
        const re = new RegExp(
          `${label}\\s*[:\\-]?\\s*(\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4}|\\d{4}-\\d{2}-\\d{2})`,
          'i',
        );
        const m = text.match(re);
        if (m) return m[1];
      }
      return '';
    };

    const push = (partial) => {
      const raw = String(partial.bid_no || '').toUpperCase();
      const match = raw.match(/GEM\/(\d{4})\/B\/(\d{5,})/i);
      if (!match) return;
      const bidYear = Number(match[1]);
      if (Math.abs(bidYear - yearNow) > 1) return;
      const bid_no = `GEM/${match[1]}/B/${match[2]}`;
      if (seen.has(bid_no)) {
        seen.set(bid_no, { ...seen.get(bid_no), ...partial, bid_no });
        return;
      }
      seen.set(bid_no, {
        bid_no,
        title: '',
        department: '',
        category: '',
        start_date: '',
        published_date: '',
        last_date: '',
        location: '',
        href: '',
      });
    };

    const cards = document.querySelectorAll(
      'a, article, .card, tr, li, [class*="bid"], [class*="card"], [class*="result"], [class*="list"]',
    );
    cards.forEach((el) => {
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      GEM_RE.lastIndex = 0;
      const match = GEM_RE.exec(text);
      if (!match) return;
      const bid_no = `GEM/${match[1]}/B/${match[2]}`;

      const start_date = pickLabeledDate(text, [
        'Bid Start Date',
        'Start Date',
        'Published Date',
        'Bid Publish Date',
        'Publish Date',
        'Published On',
        'Bid Published',
      ]);
      const end_date = pickLabeledDate(text, [
        'Bid End Date',
        'End Date',
        'Closing Date',
        'Last Date',
        'Bid Closing Date',
      ]);
      // Never treat a generic unlabeled date as Start Date — that is usually End Date.
      const title = pickField(text, ['Bid Title', 'Title', 'Item', 'BOQ', 'Work Description', 'Description'])
        || text.replace(bid_no, '').replace(/\s+/g, ' ').trim().slice(0, 280);
      push({
        bid_no,
        title: title || bid_no,
        department: pickField(text, ['Ministry', 'Organisation', 'Organization', 'Department', 'Buyer']),
        category: pickField(text, ['Category', 'Product Category', 'Service Category', 'Item Category']),
        start_date,
        published_date: start_date,
        last_date: end_date || '',
        location: text,
        href: el.tagName === 'A' ? el.href : (el.querySelector?.('a')?.href || ''),
      });
    });

    const html = document.body?.innerText || '';
    for (const match of html.matchAll(/GEM\/(\d{4})\/B\/(\d{5,})/gi)) {
      const snippet = html.slice(Math.max(0, match.index - 160), match.index + 260);
      const start_date = pickLabeledDate(snippet, [
        'Bid Start Date', 'Start Date', 'Published Date', 'Bid Publish Date',
        'Publish Date', 'Published On', 'Bid Published',
      ]);
      const end_date = pickLabeledDate(snippet, [
        'Bid End Date', 'End Date', 'Closing Date', 'Last Date', 'Bid Closing Date',
      ]);
      push({
        bid_no: `GEM/${match[1]}/B/${match[2]}`,
        title: `GEM/${match[1]}/B/${match[2]}`,
        start_date,
        published_date: start_date,
        last_date: end_date || '',
        location: snippet,
      });
    }

    return [...seen.values()];
  }, { yearNow: year });
}

/**
 * Step 4 — keep clicking Next until it is missing or disabled. No page cap.
 */
async function clickNextPage(page) {
  const candidates = [
    page.getByRole('link', { name: /^\s*next\s*$/i }).first(),
    page.getByRole('button', { name: /^\s*next\s*$/i }).first(),
    page.locator('a[aria-label*="Next" i], button[aria-label*="Next" i]').first(),
    page.locator('.pagination a, .pagination button, li.page-item a, .page-link').filter({ hasText: /^next$/i }).first(),
    page.locator('a:has-text("›"), a:has-text(">"), button:has-text("›")').first(),
  ];

  for (const next of candidates) {
    if (!(await next.count().catch(() => 0))) continue;
    try {
      const disabled = await next.evaluate((el) => {
        const item = el.closest('li, .page-item, .disabled') || el;
        return Boolean(
          el.hasAttribute('disabled')
          || el.getAttribute('aria-disabled') === 'true'
          || /disabled|inactive/i.test(el.className || '')
          || /disabled|inactive/i.test(item.className || ''),
        );
      }).catch(() => false);
      if (disabled) return false;

      const before = page.url();
      await next.click({ timeout: 3000 });
      await page.waitForTimeout(1400);
      await waitForCaptchaClear(page);
      // If the URL and first bid stamp did not change, treat as end-of-list.
      if (page.url() === before) {
        await page.waitForTimeout(600);
      }
      return true;
    } catch {
      /* try next candidate */
    }
  }
  return false;
}

async function upsertLiveScrapedBid(db, record, district, state) {
  const bid_no = normaliseGemBidNo(record.bid_no);
  if (!bid_no) return { id: null, status: 'skipped_invalid_bid_no' };

  const last_date = normaliseDate(record.last_date);
  const start_date = parseGemCalendarDate(record.start_date || record.published_date);
  const keywords = Array.isArray(record.matched_keywords)
    ? record.matched_keywords.map((k) => String(k).trim()).filter(Boolean)
    : [];
  const matched_keyword = String(
    record.matched_keyword || (keywords.length ? keywords.join(', ') : '')
  ).trim();

  const col = db.collection('live_scraped_bids');
  await col.createIndex({ bid_no: 1 }, { unique: true }).catch(() => {});

  const existing = await col.findOne({ bid_no }, { projection: { _id: 1 } });

  // Text-only feed for the Admin Live Scraped grid — no PDF / R2 fields.
  const doc = {
    bid_no,
    title: record.title || bid_no,
    department: record.department || 'GeM',
    district: district || '',
    state: state || '',
    start_date: start_date || null,
    last_date: last_date || '',
    matched_keyword,
    matched_keywords: keywords.length ? keywords : (matched_keyword ? matched_keyword.split(/,\s*/) : []),
    listing_url: record.href || null,
    source: 'gem_live_hunter',
    updated_at: new Date(),
  };

  if (existing) {
    await col.updateOne({ bid_no }, { $set: doc });
    return { id: String(existing._id), status: 'updated' };
  }

  const inserted = await col.insertOne({ ...doc, created_at: new Date() });
  return { id: String(inserted.insertedId), status: 'inserted' };
}

async function harvestStartDateFromBidPage(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || '').replace(/\s+/g, ' ');
    const labels = [
      'Bid Start Date', 'Start Date', 'Published Date', 'Bid Publish Date',
      'Publish Date', 'Published On', 'Bid Published',
    ];
    for (const label of labels) {
      const re = new RegExp(
        `${label}\\s*[:\\-]?\\s*(\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4}|\\d{4}-\\d{2}-\\d{2})`,
        'i',
      );
      const m = text.match(re);
      if (m) return m[1];
    }
    return '';
  }).catch(() => '');
}

/**
 * Text-only ingest into live_scraped_bids (no PDF / R2).
 * Requires: official GEM/B bid no + Start/Published Date === today.
 * Keyword hits are recorded when present but NEVER required to save the row.
 * Opens the bid detail page only when the listing card lacks a Start/Published date.
 */
async function ingestTodaysBid(page, db, bid, { district, state, keywords }) {
  const bid_no = normaliseGemBidNo(bid.bid_no);
  if (!bid_no) return { bid_no: bid.bid_no, skipped: 'invalid_gem_bid_format' };
  bid = { ...bid, bid_no };

  // Optional enrichment only — pure today's feed does not filter on client keywords.
  const hits = bidMatchesClientKeywords(bid, keywords) || [];

  assertPageAlive(page);

  const listUrl = page.url();
  let startDate = bid.start_date || bid.published_date || '';

  // Detail peek only for missing start date — never for PDFs.
  if (!parseGemCalendarDate(startDate) && bid.href && !bid.href.includes('javascript:')) {
    try {
      await page.goto(bid.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitForCaptchaClear(page);
      startDate = await harvestStartDateFromBidPage(page);
      await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await waitForCaptchaClear(page);
    } catch (err) {
      log(`Could not open ${bid_no}: ${err.message}`);
      try {
        assertPageAlive(page);
        await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForCaptchaClear(page);
      } catch {
        /* list restore best-effort */
      }
    }
  }

  bid = { ...bid, start_date: startDate, published_date: startDate };
  if (!isStartDateToday(bid)) {
    log(`Skipped ${bid_no}: Start/Published Date is not today (${startDate || 'missing'}).`);
    return {
      bid_no,
      skipped: 'start_date_not_today',
      start_date: startDate || null,
    };
  }

  const record = {
    bid_no,
    title: bid.title || bid_no,
    department: bid.department || 'GeM',
    category: bid.category || (hits.length ? hits.slice(0, 3).join(', ') : 'Service'),
    start_date: startDate,
    published_date: startDate,
    last_date: bid.last_date || '',
    location: bid.location || '',
    href: bid.href || '',
    matched_keywords: hits,
    matched_keyword: hits.length ? hits.join(', ') : '',
  };

  const saved = await upsertLiveScrapedBid(db, record, district, state);
  log(
    `${saved.status} ${bid_no} ← start ${parseGemCalendarDate(startDate)}`
    + `${hits.length ? ` [${hits.join(', ')}]` : ' [feed]'} @ ${state}/${district}`,
  );
  return { bid_no, ...saved, hits };
}

async function scrapeDistrict(page, db, { state, district, keywords, seenBidNos }) {
  assertPageAlive(page);
  const started = Date.now();
  const stats = { pages: 0, visible: 0, matched: 0, inserted: 0, updated: 0, skipped: 0 };

  await applyStateDistrictFilter(page, state, district);

  // Infinite pagination: stop only when Next is gone/disabled.
  while (Date.now() - started < DISTRICT_TIMEOUT_MS) {
    assertPageAlive(page);
    stats.pages += 1;
    const batch = await extractVisibleBids(page);
    stats.visible += batch.length;
    log(`${state}/${district} page ${stats.pages}: ${batch.length} GEM/.../B/... bid(s) visible.`);

    for (const bid of batch) {
      const bid_no = normaliseGemBidNo(bid.bid_no);
      if (!bid_no) {
        stats.skipped += 1;
        continue;
      }
      if (seenBidNos.has(bid_no)) {
        stats.skipped += 1;
        continue;
      }
      seenBidNos.add(bid_no);

      // Fast path: card already shows an older Start/Published Date → skip immediately.
      if (parseGemCalendarDate(bid.start_date || bid.published_date) && !isStartDateToday(bid)) {
        stats.skipped += 1;
        continue;
      }

      // Pure today's feed — no client-keyword lock. Every today-published GEM/B bid is saved.
      stats.matched += 1;
      try {
        const result = await ingestTodaysBid(page, db, { ...bid, bid_no }, { district, state, keywords });
        if (result.status === 'inserted') stats.inserted += 1;
        else if (result.status === 'updated') stats.updated += 1;
        else stats.skipped += 1;
      } catch (err) {
        stats.skipped += 1;
        log(`Ingest failed for ${bid_no}: ${err.message}`);
        if (/browser\/page was closed/i.test(err.message)) throw err;
      }
    }

    const moved = await clickNextPage(page);
    if (!moved) {
      log(`${state}/${district}: reached last page (${stats.pages}).`);
      break;
    }
  }

  if (Date.now() - started >= DISTRICT_TIMEOUT_MS) {
    log(`${state}/${district}: district time budget hit — moving on.`);
  }

  return stats;
}

async function main() {
  log('Starting targeted GeM Live Hunter (visible Chrome).');
  if (!process.env.MONGO_URL) {
    throw new Error('MONGO_URL is not set. Add it to .env before running the hunter.');
  }

  // --- Step 1: client intel + date window BEFORE the browser opens ---
  const db = await getDb();
  const { clients, keywords } = await fetchClientKeywords(db);
  const dateWindow = huntDateWindow();
  log(`Approved clients: ${clients.length}. Keyword intel: ${keywords.length} token(s) (annotation only).`);
  log(`Date window: From ${dateWindow.fromSlash} → To ${dateWindow.toSlash} (+3 months)`);
  log('Mode: pure today\'s feed → live_scraped_bids (no keyword lock).');
  if (keywords.length) {
    log(`Optional match tags: ${keywords.slice(0, 40).join(', ')}${keywords.length > 40 ? ', …' : ''}`);
  }

  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    userAgent: DESKTOP_UA,
    viewport: { width: 1440, height: 900 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  const totals = {
    districts: 0,
    failed_districts: 0,
    pages: 0,
    visible: 0,
    matched: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
  };
  const seenBidNos = new Set();
  let aborted = false;

  try {
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForCaptchaClear(page);
    await page.waitForTimeout(1000);

    // State 1 Telangana → all districts, then State 2 Andhra Pradesh → all districts.
    for (const plan of STATE_PLANS) {
      if (aborted) break;
      log(`===== STATE: ${plan.state} (${plan.districts.length} districts) =====`);
      for (const district of plan.districts) {
        if (aborted) break;
        totals.districts += 1;
        try {
          assertPageAlive(page);
          const stats = await scrapeDistrict(page, db, {
            state: plan.state,
            district,
            keywords,
            seenBidNos,
          });
          totals.pages += stats.pages;
          totals.visible += stats.visible;
          totals.matched += stats.matched;
          totals.inserted += stats.inserted;
          totals.updated += stats.updated;
          totals.skipped += stats.skipped;
        } catch (err) {
          totals.failed_districts += 1;
          log(`District failed (${plan.state}/${district}): ${err.message} — continuing.`);
          if (/browser\/page was closed/i.test(err.message)) {
            aborted = true;
            log('Browser closed by user — stopping remaining districts.');
            break;
          }
          try {
            assertPageAlive(page);
            await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
            await waitForCaptchaClear(page);
          } catch (navErr) {
            log(`Could not recover list page: ${navErr.message}`);
            if (/closed/i.test(navErr.message)) {
              aborted = true;
              break;
            }
          }
        }
      }
    }

    log(
      `Done. Districts ${totals.districts} (failed ${totals.failed_districts}), `
      + `pages ${totals.pages}, visible ${totals.visible}, matched ${totals.matched}, `
      + `inserted ${totals.inserted}, updated ${totals.updated}, skipped ${totals.skipped}.`,
    );
    if (!aborted) {
      log('Chrome will stay open for 8s so you can confirm.');
      await page.waitForTimeout(8000).catch(() => {});
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error('[gem-hunter] failed:', err?.message || err);
  process.exitCode = 1;
});

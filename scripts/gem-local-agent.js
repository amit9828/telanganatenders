// GeM Live Hunter — headful Playwright scrape of BidPlus for Telangana & Andhra Pradesh.
//
// Run on the MD/employee laptop only: `npm run gem:watch`
// The dashboard never scrapes GeM itself; it only asks this process to start.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { loadLocalEnv } from './load-local-env.js';
import { getDb } from '../lib/db.js';
import { isR2Configured, isValidPDFBuffer, uploadTenderPDF } from '../lib/cloudflare-r2.js';
import { isTelanganaOrAndhra } from '../lib/regions.js';

loadLocalEnv();

const START_URL = 'https://bidplus.gem.gov.in/all-bids';
const MAX_BIDS = 30;
const MAX_PAGES = 4;
const CAPTCHA_POLL_MS = 2500;
const CAPTCHA_TIMEOUT_MS = 15 * 60 * 1000;

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

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

async function applyLocationFilters(page) {
  // BidPlus changes class names often. Try labelled filters first, then a text search.
  const labels = ['Telangana', 'Andhra Pradesh', 'ANDHRA PRADESH', 'TELANGANA'];
  for (const label of labels) {
    const loc = page.getByText(label, { exact: false }).first();
    if (await loc.count().catch(() => 0)) {
      try {
        await loc.click({ timeout: 2500 });
        await page.waitForTimeout(800);
      } catch {
        /* not clickable — keep trying */
      }
    }
  }

  const search = page.locator('input[type="search"], input[placeholder*="Search" i], input[placeholder*="Bid" i]').first();
  if (await search.count().catch(() => 0)) {
    try {
      await search.fill('Telangana');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1500);
    } catch {
      /* search box may be a custom widget */
    }
  }
}

async function extractVisibleBids(page) {
  return page.evaluate(() => {
    const gemRe = /GEM\/\d{4}\/[A-Z]\/\d+/g;
    const seen = new Map();

    const push = (partial) => {
      const bid_no = String(partial.bid_no || '').toUpperCase().trim();
      if (!/^GEM\/\d{4}\/[A-Z]\/\d+$/.test(bid_no)) return;
      if (seen.has(bid_no)) {
        seen.set(bid_no, { ...seen.get(bid_no), ...partial, bid_no });
        return;
      }
      seen.set(bid_no, { bid_no, title: '', department: '', last_date: '', location: '', document_url: '', href: '' });
    };

    const cards = document.querySelectorAll('a, article, .card, [class*="bid"], [class*="card"]');
    cards.forEach((el) => {
      const text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      const match = text.match(/GEM\/\d{4}\/[A-Z]\/\d+/);
      if (!match) return;
      const dateMatch = text.match(/(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}-\d{2}-\d{2})/);
      const pdf = el.querySelector?.('a[href*=".pdf" i]')?.href
        || (el.href && /\.pdf($|\?)/i.test(el.href) ? el.href : '');
      push({
        bid_no: match[0],
        title: text.slice(0, 280),
        last_date: dateMatch ? dateMatch[0] : '',
        location: text,
        document_url: pdf || '',
        href: el.tagName === 'A' ? el.href : (el.querySelector?.('a')?.href || ''),
      });
    });

    const html = document.body?.innerText || '';
    for (const match of html.matchAll(/GEM\/\d{4}\/[A-Z]\/\d+/g)) {
      push({ bid_no: match[0], title: match[0], location: html.slice(Math.max(0, match.index - 120), match.index + 200) });
    }

    return [...seen.values()];
  });
}

async function downloadPdf(page, url) {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const response = await page.request.get(url, { timeout: 25000 });
    if (!response.ok()) return null;
    const buffer = Buffer.from(await response.body());
    return isValidPDFBuffer(buffer) ? buffer : null;
  } catch {
    return null;
  }
}

async function harvestPdfFromBidPage(page) {
  const pdfLink = page.locator('a[href*=".pdf" i], a:has-text("Bid Document"), a:has-text("Download")').first();
  if (!(await pdfLink.count().catch(() => 0))) return { buffer: null, url: null };
  const href = await pdfLink.getAttribute('href').catch(() => null);
  const absolute = href ? new URL(href, page.url()).toString() : null;
  const buffer = absolute ? await downloadPdf(page, absolute) : null;
  return { buffer, url: absolute };
}

async function upsertTender(db, record) {
  const bid_no = record.bid_no;
  const last_date = normaliseDate(record.last_date);
  const district = /andhra/i.test(record.location) ? 'Andhra Pradesh'
    : /telangana|hyderabad/i.test(record.location) ? 'Hyderabad'
      : '';

  const existing = await db.collection('tenders').findOne({ bid_no }, { projection: { _id: 1, pdf_url: 1, pdf_r2_key: 1 } });

  const doc = {
    bid_no,
    title: record.title || bid_no,
    department: record.department || 'GeM',
    last_date,
    district,
    category: 'Service',
    supply_details: record.location || '',
    source: 'gem_live_hunter',
    gem_document_url: record.document_url || record.href || null,
    updated_at: new Date(),
    hunter_ingested_at: new Date(),
  };

  if (record.pdf_url) doc.pdf_url = record.pdf_url;
  if (record.pdf_r2_key) doc.pdf_r2_key = record.pdf_r2_key;
  if (record.pdf_filename) doc.pdf_filename = record.pdf_filename;

  if (existing) {
    await db.collection('tenders').updateOne({ bid_no }, { $set: doc });
    return { id: String(existing._id), status: 'updated' };
  }

  const inserted = await db.collection('tenders').insertOne({ ...doc, created_at: new Date() });
  return { id: String(inserted.insertedId), status: 'inserted' };
}

async function ingestBid(page, db, bid) {
  if (!isTelanganaOrAndhra({
    title: bid.title,
    department: bid.department,
    district: bid.location,
    supply_details: bid.location,
  })) {
    return { bid_no: bid.bid_no, skipped: 'not_ts_ap' };
  }

  let pdfBuffer = bid.document_url ? await downloadPdf(page, bid.document_url) : null;
  let documentUrl = bid.document_url || null;

  if (!pdfBuffer && bid.href && !bid.href.includes('javascript:')) {
    try {
      await page.goto(bid.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await waitForCaptchaClear(page);
      const harvested = await harvestPdfFromBidPage(page);
      pdfBuffer = harvested.buffer;
      documentUrl = harvested.url || documentUrl;
    } catch (err) {
      log(`Could not open ${bid.bid_no}: ${err.message}`);
    }
  }

  const record = { ...bid, document_url: documentUrl };
  if (pdfBuffer && isR2Configured()) {
    const uploaded = await uploadTenderPDF(pdfBuffer, `${Date.now()}-${bid.bid_no.replace(/\//g, '_')}.pdf`);
    if (uploaded?.url) {
      record.pdf_url = uploaded.url;
      record.pdf_r2_key = uploaded.key;
      record.pdf_filename = `${bid.bid_no.replace(/\//g, '_')}.pdf`;
    }
  } else if (pdfBuffer && !isR2Configured()) {
    log('R2 is not configured — storing metadata without the PDF bytes.');
  }

  const saved = await upsertTender(db, record);
  log(`${saved.status} ${bid.bid_no}`);
  return { bid_no: bid.bid_no, ...saved };
}

async function clickNextPage(page) {
  const next = page.getByRole('link', { name: /next/i }).or(page.getByRole('button', { name: /next/i })).first();
  if (!(await next.count().catch(() => 0))) return false;
  try {
    await next.click({ timeout: 3000 });
    await page.waitForTimeout(1500);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  log('Starting GeM Live Hunter (visible Chrome).');
  if (!process.env.MONGO_URL) {
    throw new Error('MONGO_URL is not set. Add it to .env before running the hunter.');
  }

  const db = await getDb();
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

  try {
    await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForCaptchaClear(page);
    await page.waitForTimeout(1200);
    await applyLocationFilters(page);
    await waitForCaptchaClear(page);

    const collected = new Map();
    for (let pageNo = 1; pageNo <= MAX_PAGES && collected.size < MAX_BIDS; pageNo += 1) {
      const batch = await extractVisibleBids(page);
      batch.forEach((bid) => collected.set(bid.bid_no, bid));
      log(`Page ${pageNo}: ${batch.length} bid(s) visible, ${collected.size} unique so far.`);
      if (collected.size >= MAX_BIDS) break;
      if (!(await clickNextPage(page))) break;
      await waitForCaptchaClear(page);
    }

    const targets = [...collected.values()].slice(0, MAX_BIDS);
    const tsAp = targets.filter((bid) => isTelanganaOrAndhra({
      title: bid.title, department: bid.department, district: bid.location, supply_details: bid.location,
    }));
    log(`Ingesting ${tsAp.length} Telangana/AP bid(s) of ${targets.length} extracted.`);

    let inserted = 0;
    let updated = 0;
    for (const bid of tsAp) {
      const result = await ingestBid(page, db, bid);
      if (result.status === 'inserted') inserted += 1;
      if (result.status === 'updated') updated += 1;
    }

    log(`Done. Inserted ${inserted}, updated ${updated}. Chrome will stay open for 8s so you can confirm.`);
    await page.waitForTimeout(8000);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error('[gem-hunter] failed:', err?.message || err);
  process.exitCode = 1;
});

/**
 * GeM Co-Pilot Weekly Knowledge Harvester (Playwright + direct Mongo/R2 sync)
 *
 * 1. Opens BidPlus / gem.gov.in and collects footer + resource links
 * 2. Syncs curated sources + discovered PDFs into Mongo `gem_copilot_knowledge`
 *    and R2 prefix `gem_copilot_knowledge/` — no Next.js server required
 *
 * Usage:
 *   npm run gem:copilot-kb
 *   node scripts/gem-copilot-knowledge-scraper.js --headed
 *
 * Production: Vercel cron GET /api/cron/gem-copilot-knowledge (Sundays).
 */

import { chromium } from 'playwright';
import { loadLocalEnv } from './load-local-env.js';
import { syncGemCopilotKnowledge } from '../lib/gem-copilot-sync.js';

loadLocalEnv();

const HEADED = process.argv.includes('--headed');

function log(msg) {
  console.log(`[copilot-scraper] ${msg}`);
}

async function harvestWithPlaywright() {
  const browser = await chromium.launch({
    headless: !HEADED,
    channel: process.env.GEM_CHROME_CHANNEL || undefined,
  });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  const seedUrls = [
    'https://bidplus.gem.gov.in/advance-search',
    'https://gem.gov.in/',
    'https://gem.gov.in/resources',
  ];

  const found = new Map();

  for (const url of seedUrls) {
    try {
      log(`open ${url}`);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForTimeout(1500);

      const links = await page.evaluate(() => {
        const out = [];
        const nodes = Array.from(document.querySelectorAll('footer a, a[href]'));
        for (const a of nodes) {
          const href = a.href || '';
          const label = (a.textContent || '').replace(/\s+/g, ' ').trim();
          if (!href || href.startsWith('javascript:')) continue;
          const hay = `${label} ${href}`.toLowerCase();
          const interesting =
            /handbook|circular|o\.?m\.?|terms|condition|gtc|policy|manual|misc|mou|gfr|faq|train|resource|guideline|memorandum/.test(hay)
            || /\.pdf(\?|$)/i.test(href);
          if (interesting) out.push({ href, label: label || href });
        }
        return out;
      });

      for (const link of links) {
        if (!found.has(link.href)) found.set(link.href, link.label);
      }
      log(`${url} → ${links.length} candidate link(s)`);
    } catch (err) {
      console.warn(`[copilot-scraper] failed ${url}:`, err?.message || err);
    }
  }

  await browser.close();
  return Array.from(found.entries()).map(([href, label]) => ({ href, label }));
}

async function tryCronSync(links) {
  const base = process.env.NEXTAUTH_URL || process.env.APP_URL || 'http://localhost:3000';
  const secret = process.env.CRON_SECRET || process.env.ADMIN_TOKEN || '';
  const url = `${base.replace(/\/$/, '')}/api/cron/gem-copilot-knowledge`;
  const probe = await fetch(base.replace(/\/$/, ''), { method: 'HEAD', signal: AbortSignal.timeout(4000) }).catch(() => null);
  if (!probe) {
    log(`Next.js not reachable at ${base} — using direct Mongo/R2 sync`);
    return null;
  }

  log(`triggering server sync ${url}`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: secret ? `Bearer ${secret}` : '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ discovered_links: links }),
  });
  const data = await res.json().catch(() => ({}));
  log(`cron result: ${res.status} ${JSON.stringify(data?.stats || data)}`);
  return data?.ok ? data : null;
}

(async () => {
  log('GeM Co-Pilot weekly knowledge harvest starting…');

  let links = [];
  try {
    links = await harvestWithPlaywright();
    log(`discovered ${links.length} unique resource link(s)`);
  } catch (err) {
    console.warn('[copilot-scraper] Playwright harvest skipped:', err?.message || err);
  }

  let useDirect = false;
  let result = null;
  for (let batch = 0; batch < 20; batch += 1) {
    const payload = batch === 0 ? links : [];
    if (!useDirect) {
      result = await tryCronSync(payload).catch((e) => {
        console.warn('[copilot-scraper] cron POST failed:', e?.message || e);
        return null;
      });
      if (!result?.ok) useDirect = true;
    }
    if (useDirect) {
      log('Running direct sync into gem_copilot_knowledge…');
      result = await syncGemCopilotKnowledge({
        batchSize: 6,
        discoveredLinks: payload,
      });
      log(`direct sync: ${JSON.stringify(result.stats)}`);
    }
    const remaining = result?.stats?.queue_remaining || 0;
    log(`batch ${batch + 1}: ${remaining} PDF(s) still queued`);
    if (!result?.ok || remaining <= 0) break;
  }

  if (!result?.ok) {
    console.error('[copilot-scraper] sync failed');
    process.exit(1);
  }

  log('done.');
  process.exit(0);
})().catch((err) => {
  console.error('[copilot-scraper] fatal:', err);
  process.exit(1);
});

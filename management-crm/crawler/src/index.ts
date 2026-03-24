import { chromium, Browser, Page } from 'playwright';
import { login, scrapePage, getTotalPages, CrawledCompany } from './scraper';
import { prisma, upsertCompanies, logCrawl, isDbEmpty } from './db';

// Configuration from environment variables
const BASE_URL = process.env.CRAWLER_TARGET_URL || 'https://payment.nldb.co.kr';
const LOGIN_ID = process.env.CRAWLER_LOGIN_ID || '';
const LOGIN_PW = process.env.CRAWLER_LOGIN_PW || '';
const CRAWLER_INTERVAL_MS = parseInt(process.env.CRAWLER_INTERVAL_MS || '300000', 10); // 5 min default

let browser: Browser | null = null;

/**
 * Initialize browser and log in.
 * Returns a logged-in page instance.
 */
async function initBrowser(): Promise<Page> {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, BASE_URL, LOGIN_ID, LOGIN_PW);
  return page;
}

/**
 * Crawl recent pages only (page 1 and 2).
 * Used for recurring quick checks.
 */
async function crawlRecent(page: Page): Promise<void> {
  const startTime = Date.now();
  console.log('[crawler] Starting recent crawl (pages 1-2)...');

  let allCompanies: CrawledCompany[] = [];

  for (let p = 1; p <= 2; p++) {
    const companies = await scrapePage(page, BASE_URL, p);
    console.log(`[crawler] Page ${p}: scraped ${companies.length} rows`);
    allCompanies = allCompanies.concat(companies);
  }

  const { newCount, updateCount } = await upsertCompanies(allCompanies);
  const duration = Date.now() - startTime;

  console.log(
    `[crawler] Recent crawl done: ${allCompanies.length} scanned, ${newCount} new, ${updateCount} updated (${duration}ms)`,
  );

  await logCrawl({
    status: 'success',
    newCount,
    updateCount,
    totalScanned: allCompanies.length,
    duration,
  });
}

/**
 * Crawl all pages from page 1 until no more data.
 * Used for initial full sync.
 */
async function crawlAll(page: Page): Promise<void> {
  const startTime = Date.now();
  console.log('[crawler] Starting full crawl (all pages)...');

  // First, navigate to page 1 to determine total pages
  await page.goto(`${BASE_URL}/admin/payment/list?page=1&pageSize=20`, {
    waitUntil: 'networkidle',
  });
  const totalPages = await getTotalPages(page);
  console.log(`[crawler] Total pages detected: ${totalPages}`);

  let totalScanned = 0;
  let totalNew = 0;
  let totalUpdated = 0;

  for (let p = 1; p <= totalPages; p++) {
    const companies = await scrapePage(page, BASE_URL, p);
    console.log(`[crawler] Page ${p}/${totalPages}: scraped ${companies.length} rows`);

    if (companies.length === 0) {
      console.log(`[crawler] Empty page ${p}, stopping.`);
      break;
    }

    // DB에 즉시 저장 (페이지 단위)
    const { newCount, updateCount } = await upsertCompanies(companies);
    totalScanned += companies.length;
    totalNew += newCount;
    totalUpdated += updateCount;

    if (p % 50 === 0) {
      console.log(`[crawler] Progress: ${totalScanned} scanned, ${totalNew} new, ${totalUpdated} updated`);
    }
  }

  const duration = Date.now() - startTime;

  console.log(
    `[crawler] Full crawl done: ${totalScanned} scanned, ${totalNew} new, ${totalUpdated} updated (${duration}ms)`,
  );

  await logCrawl({
    status: 'success',
    newCount: totalNew,
    updateCount: totalUpdated,
    totalScanned,
    duration,
  });
}

/**
 * Run a crawl with error handling.
 * Wraps the crawl function and logs errors to CrawlLog.
 */
async function safeCrawl(
  page: Page,
  crawlFn: (page: Page) => Promise<void>,
): Promise<void> {
  try {
    await crawlFn(page);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[crawler] Crawl error:', message);
    await logCrawl({
      status: 'error',
      errorMessage: message,
    });
  }
}

/**
 * Main entry point.
 * 1. If DB is empty, run a full crawl.
 * 2. Schedule recurring recent crawls every CRAWLER_INTERVAL_MS.
 */
async function main(): Promise<void> {
  console.log('[crawler] Starting management-crm crawler...');
  console.log(`[crawler] Target: ${BASE_URL}`);
  console.log(`[crawler] Interval: ${CRAWLER_INTERVAL_MS}ms`);

  if (!LOGIN_ID || !LOGIN_PW) {
    console.error('[crawler] CRAWLER_LOGIN_ID and CRAWLER_LOGIN_PW must be set');
    process.exit(1);
  }

  let page: Page;

  try {
    page = await initBrowser();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[crawler] Failed to initialize browser:', message);
    await logCrawl({ status: 'error', errorMessage: `Browser init failed: ${message}` });
    process.exit(1);
  }

  // 전체 크롤링: DB가 비었거나 FORCE_FULL_CRAWL=1이면 전체 크롤링
  const empty = await isDbEmpty();
  const forceFull = process.env.FORCE_FULL_CRAWL === '1';
  if (empty || forceFull) {
    console.log(`[crawler] Running full crawl (empty=${empty}, force=${forceFull})...`);
    await safeCrawl(page, crawlAll);
  } else {
    console.log('[crawler] Database has existing data, running recent crawl...');
    await safeCrawl(page, crawlRecent);
  }

  // Schedule recurring crawls using setTimeout to prevent overlap
  console.log(`[crawler] Scheduling recurring crawl every ${CRAWLER_INTERVAL_MS / 1000}s...`);
  async function scheduleNext() {
    setTimeout(async () => {
      try {
        // Re-login if session expired (navigate to list page and check)
        await page.goto(`${BASE_URL}/admin/payment/list?page=1&pageSize=20`, {
          waitUntil: 'networkidle',
        });

        // If redirected to signin, re-login
        if (page.url().includes('/signin')) {
          console.log('[crawler] Session expired, re-logging in...');
          await login(page, BASE_URL, LOGIN_ID, LOGIN_PW);
        }

        await safeCrawl(page, crawlRecent);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[crawler] Recurring crawl failed:', message);
        await logCrawl({ status: 'error', errorMessage: message });

        // Try to re-initialize browser on failure
        try {
          if (browser) await browser.close().catch(() => {});
          page = await initBrowser();
          console.log('[crawler] Browser re-initialized successfully');
        } catch (reinitError) {
          console.error('[crawler] Browser re-init failed:', reinitError);
        }
      }
      // Schedule next crawl after current one completes
      scheduleNext();
    }, CRAWLER_INTERVAL_MS);
  }
  scheduleNext();
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[crawler] Shutting down...');
  if (browser) await browser.close().catch(() => {});
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[crawler] Shutting down...');
  if (browser) await browser.close().catch(() => {});
  await prisma.$disconnect();
  process.exit(0);
});

main().catch(async (error) => {
  console.error('[crawler] Fatal error:', error);
  if (browser) await browser.close().catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});

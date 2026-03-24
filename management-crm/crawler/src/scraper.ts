import { Page } from 'playwright';

export interface CrawledCompany {
  sourceId: number;
  registrant: string;
  paymentDate: string;
  companyName: string;
  representative: string;
  phone: string;
  paymentType: string;      // 결제종류 (플레이스/정상/뿌토)
  staffName: string;
  managerName: string;
  paymentAmount: number | null;  // 결제금액
  cardCompany: string;            // 카드사 (국민/BC/삼성 등)
  installmentMonths: string;      // 할부개월
}

/**
 * Log in to the target site.
 * Navigates to /signin, fills credentials, clicks login, and waits for redirect.
 */
export async function login(
  page: Page,
  baseUrl: string,
  id: string,
  pw: string,
): Promise<void> {
  console.log('[scraper] Navigating to login page...');
  await page.goto(`${baseUrl}/signin`, { waitUntil: 'networkidle', timeout: 30_000 });

  // Wait for SPA to render login form
  const idInput = page.getByRole('textbox', { name: '아이디' });
  await idInput.waitFor({ state: 'visible', timeout: 15_000 });

  await idInput.fill(id);
  await page.getByRole('textbox', { name: '비밀번호' }).fill(pw);
  await page.getByRole('button', { name: '로그인' }).click();

  // Wait for redirect after login (lands on /admin/*)
  await page.waitForURL('**/admin/**', { timeout: 15_000 });
  console.log('[scraper] Login successful, redirected to:', page.url());
}

/**
 * Scrape a single page of the payment list table.
 * Returns an array of parsed company rows.
 */
export async function scrapePage(
  page: Page,
  baseUrl: string,
  pageNum: number,
): Promise<CrawledCompany[]> {
  const url = `${baseUrl}/admin/payment/list?page=${pageNum}&pageSize=20`;
  await page.goto(url, { waitUntil: 'networkidle' });

  const rows = await page.locator('table tbody tr').all();
  const companies: CrawledCompany[] = [];

  for (const row of rows) {
    const cells = await row.locator('td').all();
    if (cells.length < 11) continue;

    const sourceIdText = (await cells[1].textContent())?.trim() ?? '';
    const sourceId = parseInt(sourceIdText, 10);
    if (isNaN(sourceId)) continue;

    const registrant = (await cells[3].textContent())?.trim() ?? '';
    const paymentDate = (await cells[4].textContent())?.trim() ?? '';
    const companyName = (await cells[5].textContent())?.trim() ?? '';
    const representative = (await cells[6].textContent())?.trim() ?? '';
    const phone = (await cells[7].textContent())?.trim() ?? '';
    const paymentType = (await cells[8].textContent())?.trim() ?? '';
    const staffName = (await cells[9].textContent())?.trim() ?? '';
    const managerName = (await cells[10].textContent())?.trim() ?? '';

    // 결제금액 (column 11): "₩2,640,000" → 2640000
    let paymentAmount: number | null = null;
    if (cells.length > 11) {
      const amountText = (await cells[11].textContent())?.trim().replace(/[₩,원\s]/g, '') ?? '';
      const parsed = parseInt(amountText, 10);
      if (!isNaN(parsed) && parsed > 0) paymentAmount = parsed;
    }

    // 카드사 (column 12)
    let cardCompany = '';
    if (cells.length > 12) {
      cardCompany = (await cells[12].textContent())?.trim() ?? '';
    }

    // 할부개월 (column 13)
    let installmentMonths = '';
    if (cells.length > 13) {
      installmentMonths = (await cells[13].textContent())?.trim().replace(/\s+/g, ' ') ?? '';
    }

    companies.push({
      sourceId,
      registrant,
      paymentDate,
      companyName,
      representative,
      phone,
      paymentType,
      staffName,
      managerName,
      paymentAmount,
      cardCompany,
      installmentMonths,
    });
  }

  return companies;
}

/**
 * Determine the total number of pages by parsing pagination links.
 * Navigates through pagination by using URL query params instead of clicking.
 */
export async function getTotalPages(page: Page): Promise<number> {
  let maxPage = 1;

  // Collect all page number links visible in the current pagination block
  const pageLinks = await page.locator('a[href*="page="]').all();

  for (const link of pageLinks) {
    const href = await link.getAttribute('href');
    if (!href) continue;
    const match = href.match(/page=(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxPage) maxPage = num;
    }
  }

  // Check if "다음" link exists and is NOT disabled (parent li not having 'disabled' class)
  const nextLi = page.locator('li.paginate_button.next:not(.disabled)');
  if ((await nextLi.count()) > 0) {
    // Navigate to the next pagination block via URL
    const nextUrl = `?page=${maxPage + 1}&pageSize=20&companyName=&startDt=&endDt=&pg=&memberName=`;
    await page.goto(page.url().split('?')[0] + nextUrl, { waitUntil: 'networkidle' });
    // Recursively get more pages
    const deeper = await getTotalPages(page);
    if (deeper > maxPage) maxPage = deeper;
  }

  return maxPage;
}

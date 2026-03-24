import { PrismaClient } from '@prisma/client';
import { CrawledCompany } from './scraper';

const prisma = new PrismaClient();

export { prisma };

/**
 * Branch mapping: registrant name -> branch name.
 */
const BRANCH_MAP: Record<string, string> = {
  '인천마스터': '인천',
  '인천파링': '인천',
  '수원마스터': '수원',
  '수원플레이스': '수원',
  '동탄마스터': '동탄',
  '동탄플레이스': '동탄',
  '용인마스터': '용인',
  '용인플레이스': '용인',
  '부산마스터': '부산',
  '부산플레이스': '부산',
  '안산플레이스': '본사',
  'place1': '본사',
  '플레이스팀': '본사',
  '관리자': '본사',
};

/**
 * Extract branch from registrant name using BRANCH_MAP.
 */
export function extractBranch(registrant: string): string {
  return BRANCH_MAP[registrant] ?? '본사';
}

/**
 * Parse a payment date string into a Date.
 */
function parsePaymentDate(dateStr: string): Date {
  const normalized = dateStr.replace(/\./g, '-').trim();
  const parsed = new Date(normalized);
  if (isNaN(parsed.getTime())) {
    console.warn(`[db] Failed to parse date "${dateStr}", using current date`);
    return new Date();
  }
  const now = new Date();
  const threeMonthsFromNow = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate());
  if (parsed > threeMonthsFromNow) {
    parsed.setFullYear(parsed.getFullYear() - 1);
  }
  return parsed;
}

/**
 * 날짜를 KST 기준 YYYY-MM-DD 문자열로 변환 (타임존 안전)
 */
function toDateString(d: Date): string {
  const offset = 9 * 60; // KST = UTC+9
  const local = new Date(d.getTime() + offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

/**
 * Upsert companies into the database (배치 처리).
 * 기존 데이터를 한번에 조회한 후 변경분만 처리.
 */
export async function upsertCompanies(
  companies: CrawledCompany[],
): Promise<{ newCount: number; updateCount: number }> {
  if (companies.length === 0) return { newCount: 0, updateCount: 0 };

  // 1. sourceId 목록으로 기존 레코드 일괄 조회
  const sourceIds = companies.map((c) => c.sourceId);
  const existingRecords = await prisma.company.findMany({
    where: { sourceId: { in: sourceIds } },
  });
  const existingMap = new Map(existingRecords.map((r) => [r.sourceId, r]));

  // 2. 신규 vs 변경 분류
  const toCreate: Parameters<typeof prisma.company.create>[0]['data'][] = [];
  const toUpdate: { sourceId: number; data: Parameters<typeof prisma.company.update>[0]['data'] }[] = [];

  for (const company of companies) {
    const branch = extractBranch(company.registrant);
    const paymentDate = parsePaymentDate(company.paymentDate);
    const existing = existingMap.get(company.sourceId);

    const record = {
      registrant: company.registrant,
      paymentDate,
      companyName: company.companyName,
      representative: company.representative,
      phone: company.phone,
      staffName: company.staffName,
      managerName: company.managerName,
      branch,
      paymentType: company.paymentType || null,
      cardCompany: company.cardCompany || null,
      paymentAmount: company.paymentAmount,
      installmentMonths: company.installmentMonths || null,
      crawledAt: new Date(),
    };

    if (!existing) {
      toCreate.push({ sourceId: company.sourceId, ...record });
    } else {
      const hasChanges =
        existing.registrant !== company.registrant ||
        toDateString(existing.paymentDate) !== toDateString(paymentDate) ||
        existing.companyName !== company.companyName ||
        existing.representative !== company.representative ||
        existing.phone !== company.phone ||
        existing.staffName !== company.staffName ||
        existing.managerName !== company.managerName ||
        existing.branch !== branch ||
        (existing.paymentType || '') !== (company.paymentType || '') ||
        (existing.cardCompany || '') !== (company.cardCompany || '') ||
        (existing.paymentAmount ?? null) !== (company.paymentAmount ?? null) ||
        (existing.installmentMonths || '') !== (company.installmentMonths || '');

      if (hasChanges) {
        toUpdate.push({ sourceId: company.sourceId, data: record });
      }
    }
  }

  // 3. 트랜잭션으로 일괄 처리
  if (toCreate.length > 0 || toUpdate.length > 0) {
    await prisma.$transaction([
      // 신규 일괄 생성
      ...(toCreate.length > 0
        ? [prisma.company.createMany({ data: toCreate, skipDuplicates: true })]
        : []),
      // 변경분 개별 업데이트 (updateMany는 where 조건이 제한적이라 개별 처리)
      ...toUpdate.map(({ sourceId, data }) =>
        prisma.company.update({ where: { sourceId }, data }),
      ),
    ]);
  }

  return { newCount: toCreate.length, updateCount: toUpdate.length };
}

/**
 * Log a crawl result to the CrawlLog table.
 */
export async function logCrawl(data: {
  status: string;
  newCount?: number;
  updateCount?: number;
  totalScanned?: number;
  errorMessage?: string | null;
  duration?: number;
}): Promise<void> {
  await prisma.crawlLog.create({
    data: {
      status: data.status,
      newCount: data.newCount ?? 0,
      updateCount: data.updateCount ?? 0,
      totalScanned: data.totalScanned ?? 0,
      errorMessage: data.errorMessage ?? null,
      duration: data.duration ?? 0,
    },
  });
}

/**
 * Check if the companies table is empty.
 */
export async function isDbEmpty(): Promise<boolean> {
  const count = await prisma.company.count();
  return count === 0;
}

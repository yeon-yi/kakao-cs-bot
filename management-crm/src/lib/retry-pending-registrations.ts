import { prisma } from '@/lib/prisma';
import { updateStep } from '@/lib/solution-utils';
import { registerKeyword, registerReport, searchKeywords } from '@/lib/homejeonsan';

export interface RetryResults {
  scanned: number;
  retried: number;
  succeeded: number;
  stillFailed: number;
  skipped: number;
}

export const PENDING_PATTERNS = {
  inProgress: '등록 진행 중...',
  retryable: ['등록 진행 중...', '등록 실패 (수동 등록 필요)', '백그라운드 처리 실패'],
  classifiable: {
    pending: '등록 진행 중',
    failedPrefixes: ['등록 실패', '백그라운드 처리 실패'],
  },
} as const;

export async function retryPendingRegistrations(): Promise<RetryResults> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const results: RetryResults = {
    scanned: 0,
    retried: 0,
    succeeded: 0,
    stillFailed: 0,
    skipped: 0,
  };

  const pendingLogs = await prisma.homejeonsanLog.findMany({
    where: {
      status: 'success',
      errorMessage: { not: null },
      createdAt: { lte: fiveMinutesAgo },
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  results.scanned = pendingLogs.length;

  for (const log of pendingLogs) {
    const msg = log.errorMessage || '';
    if (!PENDING_PATTERNS.retryable.some(p => msg.startsWith(p)) || !log.placeId) {
      results.skipped++;
      continue;
    }

    // 재시도 횟수 추적: errorMessage에서 "(retry N)" 패턴으로 카운트
    const retryMatch = msg.match(/\(retry (\d+)\)/);
    const retryCount = retryMatch ? parseInt(retryMatch[1]) : 0;
    if (retryCount >= 3) {
      // 3회 이상 실패 → 재시도 중단, 수동 처리로 전환
      await prisma.homejeonsanLog.update({
        where: { id: log.id },
        data: { errorMessage: `${retryCount}회 재시도 실패 (수동 등록 필요)` },
      });
      results.stillFailed++;
      continue;
    }

    results.retried++;

    try {
      if (log.action === 'register') {
        const outcome = await retryKeyword(log.placeId, log.businessName, log.staffName);
        if (outcome.success) {
          await prisma.homejeonsanLog.update({
            where: { id: log.id },
            data: { keyword: outcome.keyword, errorMessage: null },
          });
          results.succeeded++;
        } else {
          await prisma.homejeonsanLog.update({
            where: { id: log.id },
            data: { errorMessage: `등록 실패 (수동 등록 필요) (retry ${retryCount + 1})` },
          });
          results.stillFailed++;
        }
      } else if (log.action === 'register_report') {
        const company = await prisma.company.findFirst({
          where: { placeId: log.placeId },
          select: {
            id: true,
            phone: true,
            setting: { select: { contractStart: true, contractEnd: true } },
          },
        });
        if (!company?.phone || !company.setting?.contractStart) {
          await prisma.homejeonsanLog.update({
            where: { id: log.id },
            data: { errorMessage: `필수 정보 없음 (수동 등록 필요) (retry ${retryCount + 1})` },
          });
          results.stillFailed++;
          continue;
        }

        const diffMs = company.setting.contractEnd
          ? company.setting.contractEnd.getTime() - company.setting.contractStart.getTime()
          : 0;
        const months = diffMs > 0 ? Math.round(diffMs / (1000 * 60 * 60 * 24 * 30)) || 6 : 6;

        const result = await registerReport({
          placeId: log.placeId,
          phone1: company.phone,
          contractStart: company.setting.contractStart.toISOString().split('T')[0],
          months,
        });

        if (result.success) {
          await prisma.homejeonsanLog.update({
            where: { id: log.id },
            data: { errorMessage: null },
          });
          await updateStep(company.id).catch(() => {});
          results.succeeded++;
        } else {
          await prisma.homejeonsanLog.update({
            where: { id: log.id },
            data: { errorMessage: `등록 실패 (수동 등록 필요) (retry ${retryCount + 1})` },
          });
          results.stillFailed++;
        }
      } else {
        results.skipped++;
      }
    } catch (err) {
      console.error('[retryPendingRegistrations] log id', log.id, err);
      await prisma.homejeonsanLog.update({
        where: { id: log.id },
        data: { errorMessage: `백그라운드 처리 실패 (retry ${retryCount + 1})` },
      }).catch(() => {});
      results.stillFailed++;
    }
  }

  return results;
}

async function retryKeyword(
  placeId: string,
  businessNameFallback: string | null,
  staffNameFallback: string | null,
): Promise<{ success: boolean; keyword: string | null }> {
  let finalKeyword: string | null = null;

  try {
    const cached = await searchKeywords(placeId);
    const existingKws = cached.keywords.map((k: { keyword: string }) => k.keyword);
    if (existingKws.length > 0) {
      return { success: true, keyword: existingKws.join(',') };
    }
  } catch { /* 조회 실패 → 등록 시도로 폴백 */ }

  const kwLog = await prisma.homejeonsanLog.findFirst({
    where: { placeId, action: 'register', keyword: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: { keyword: true, category: true, businessName: true, staffName: true },
  });
  if (!kwLog?.keyword) return { success: false, keyword: null };

  const keywords = kwLog.keyword.split(',').map(k => k.trim()).filter(Boolean);
  let anySuccess = false;
  for (const kw of keywords) {
    const result = await registerKeyword({
      businessName: kwLog.businessName || businessNameFallback || '',
      placeId,
      keyword: kw,
      category: kwLog.category || '기타',
      staffName: kwLog.staffName || staffNameFallback || '',
      adType: '정상',
    });
    if (result.success) {
      anySuccess = true;
      finalKeyword = finalKeyword ? `${finalKeyword},${kw}` : kw;
    }
  }

  return { success: anySuccess, keyword: finalKeyword };
}

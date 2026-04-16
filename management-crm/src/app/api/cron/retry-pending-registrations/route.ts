import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyCronKey } from '@/lib/notification-sender';
import { updateStep } from '@/lib/solution-utils';
import { registerKeyword, registerReport, searchKeywords } from '@/lib/homejeonsan';

// POST /api/cron/retry-pending-registrations — 10분마다 호출
// advance-step의 백그라운드 처리가 실패했거나 프로세스 재시작 등으로 유실된
// 모집플레이스 등록을 재시도한다.
//
// 대상:
//   - errorMessage가 "등록 진행 중..." 인 로그 (5분 이상 경과)
//   - errorMessage가 "등록 실패 (수동 등록 필요)" / "백그라운드 처리 실패" 로 시작하는 로그
//   - errorMessage가 "*필요)" 로 끝나는 로그 중 재시도 가능한 것

const RETRY_PATTERNS = [
  '등록 진행 중...',
  '등록 실패 (수동 등록 필요)',
  '백그라운드 처리 실패',
];

export async function POST(request: Request) {
  if (!verifyCronKey(request)) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const results = {
    scanned: 0,
    retried: 0,
    succeeded: 0,
    stillFailed: 0,
    skipped: 0,
  };

  try {
    const pendingLogs = await prisma.homejeonsanLog.findMany({
      where: {
        status: 'success',
        errorMessage: {
          not: null,
        },
        createdAt: { lte: fiveMinutesAgo },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    results.scanned = pendingLogs.length;

    for (const log of pendingLogs) {
      const msg = log.errorMessage || '';
      const shouldRetry = RETRY_PATTERNS.some(p => msg.startsWith(p));
      if (!shouldRetry) {
        results.skipped++;
        continue;
      }
      if (!log.placeId) {
        results.skipped++;
        continue;
      }

      results.retried++;

      try {
        if (log.action === 'register') {
          let registered = false;
          let finalKeyword: string | null = log.keyword;

          try {
            const cached = await searchKeywords(log.placeId);
            const existingKws = cached.keywords.map((k: { keyword: string }) => k.keyword);
            if (existingKws.length > 0) {
              registered = true;
              finalKeyword = existingKws.join(',');
            }
          } catch { /* */ }

          if (!registered) {
            const kwLog = await prisma.homejeonsanLog.findFirst({
              where: { placeId: log.placeId, action: 'register', keyword: { not: null } },
              orderBy: { createdAt: 'desc' },
              select: { keyword: true, category: true, businessName: true, staffName: true },
            });
            if (kwLog?.keyword) {
              const keywords = kwLog.keyword.split(',').map(k => k.trim()).filter(Boolean);
              for (const kw of keywords) {
                const result = await registerKeyword({
                  businessName: kwLog.businessName || log.businessName || '',
                  placeId: log.placeId,
                  keyword: kw,
                  category: kwLog.category || '기타',
                  staffName: kwLog.staffName || log.staffName || '',
                  adType: '정상',
                });
                if (result.success) {
                  registered = true;
                  finalKeyword = finalKeyword ? `${finalKeyword},${kw}` : kw;
                }
              }
            }
          }

          if (registered) {
            await prisma.homejeonsanLog.update({
              where: { id: log.id },
              data: { keyword: finalKeyword, errorMessage: null },
            });
            results.succeeded++;
          } else {
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
            results.stillFailed++;
            continue;
          }

          let months = 6;
          if (company.setting.contractEnd) {
            const diffMs = company.setting.contractEnd.getTime() - company.setting.contractStart.getTime();
            months = Math.round(diffMs / (1000 * 60 * 60 * 24 * 30)) || 6;
          }

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
            results.stillFailed++;
          }
        } else {
          results.skipped++;
        }
      } catch (err) {
        console.error('[retry-pending-registrations] failed for log id', log.id, err);
        results.stillFailed++;
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    console.error('POST /api/cron/retry-pending-registrations error:', error);
    return NextResponse.json({ message: '재시도 실패', error: String(error) }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { updateStep } from '@/lib/solution-utils';
import {
  registerKeyword,
  registerReport,
  searchKeywords,
  fetchReportStats,
} from '@/lib/homejeonsan';

/**
 * POST /api/admin/fix-fake-logs
 *
 * [일회성 마이그레이션] 2026-04-16 실행 완료.
 * 재실행 시 추가 가짜 로그가 없으면 no-op.
 * 더 이상 필요 없으면 이 파일을 삭제해도 됨.
 *
 * system-advance로 생성된 가짜 성공 로그를 찾아서
 * 모집플레이스.com에 실제 등록 여부를 확인하고, 누락분을 등록한다.
 *
 * body: { dryRun?: boolean }  (dryRun=true면 확인만, 실제 등록 안 함)
 */
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);

    // admin만 실행 가능
    const user = await prisma.user.findUnique({ where: { id: auth.userId }, select: { role: true } });
    if (user?.role !== 'admin') {
      return NextResponse.json({ message: '관리자만 실행 가능' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const dryRun = body?.dryRun === true;

    // system-advance로 생성된 가짜 로그 조회
    const fakeLogs = await prisma.homejeonsanLog.findMany({
      where: { actorName: 'system-advance', status: 'success' },
      orderBy: { createdAt: 'asc' },
    });

    if (fakeLogs.length === 0) {
      return NextResponse.json({ message: '처리할 가짜 로그 없음', total: 0, results: [] });
    }

    // placeId별 그룹핑
    const byPlace = new Map<string, typeof fakeLogs>();
    for (const log of fakeLogs) {
      if (!log.placeId) continue;
      const arr = byPlace.get(log.placeId) || [];
      arr.push(log);
      byPlace.set(log.placeId, arr);
    }

    // N+1 방지: 관련 placeId들의 진짜 성공 로그를 한 번에 조회
    const allPlaceIds = [...byPlace.keys()];
    const realSuccessLogs = await prisma.homejeonsanLog.findMany({
      where: {
        placeId: { in: allPlaceIds },
        status: 'success',
        actorName: { not: 'system-advance' },
      },
      select: { placeId: true, action: true },
    });
    const realLogKeys = new Set(realSuccessLogs.map(l => `${l.placeId}|${l.action}`));

    // N+1 방지: company도 배치 조회
    const allCompanies = await prisma.company.findMany({
      where: { placeId: { in: allPlaceIds } },
      select: {
        id: true,
        placeId: true,
        companyName: true,
        phone: true,
        staffName: true,
        branch: true,
        setting: { select: { contractStart: true, contractEnd: true } },
      },
    });
    const companyByPlace = new Map(allCompanies.map(c => [c.placeId!, c]));

    const results: Array<{
      placeId: string;
      companyName: string | null;
      action: string;
      alreadyExists: boolean;
      registered: boolean;
      error: string | null;
      fakeLogId: number;
    }> = [];

    for (const [placeId, logs] of byPlace) {
      const company = companyByPlace.get(placeId) || null;

      if (!company) {
        for (const log of logs) {
          results.push({
            placeId,
            companyName: log.businessName,
            action: log.action,
            alreadyExists: false,
            registered: false,
            error: '업체 정보 없음',
            fakeLogId: log.id,
          });
        }
        continue;
      }

      // 같은 placeId에 대해 실제 actorName이 아닌 진짜 성공 로그가 있는지 확인 (배치 조회 결과 사용)
      for (const log of logs) {
        const hasRealLog = realLogKeys.has(`${placeId}|${log.action}`);

        if (hasRealLog) {
          // 진짜 로그가 있으면 가짜 로그만 삭제
          if (!dryRun) {
            await prisma.homejeonsanLog.delete({ where: { id: log.id } });
          }
          results.push({
            placeId,
            companyName: company.companyName,
            action: log.action,
            alreadyExists: true,
            registered: false,
            error: null,
            fakeLogId: log.id,
          });
          continue;
        }

        // -- 키워드 확인/등록 --
        if (log.action === 'register') {
          // 모집플레이스에 이미 등록된 키워드 확인
          let existingKws: string[] = [];
          try {
            const cached = await searchKeywords(placeId);
            existingKws = cached.keywords.map((k: { keyword: string }) => k.keyword);
          } catch { /* */ }

          if (existingKws.length > 0) {
            // 이미 등록됨 → 가짜 로그를 진짜 로그로 교체
            if (!dryRun) {
              await prisma.homejeonsanLog.update({
                where: { id: log.id },
                data: {
                  actorName: 'migration-fix',
                  keyword: existingKws.join(','),
                  errorMessage: '이미 등록 확인됨',
                },
              });
            }
            results.push({
              placeId,
              companyName: company.companyName,
              action: 'register',
              alreadyExists: true,
              registered: false,
              error: null,
              fakeLogId: log.id,
            });
          } else {
            // 키워드 정보가 없어서 등록 불가 (키워드를 알 수 없음)
            if (!dryRun) {
              await prisma.homejeonsanLog.update({
                where: { id: log.id },
                data: {
                  status: 'failed',
                  actorName: 'migration-fix',
                  errorMessage: '모집플레이스에 키워드 미등록 확인, 키워드 정보 없어 수동 처리 필요',
                },
              });
            }
            results.push({
              placeId,
              companyName: company.companyName,
              action: 'register',
              alreadyExists: false,
              registered: false,
              error: '키워드 정보 없음 (수동 처리 필요)',
              fakeLogId: log.id,
            });
          }
          continue;
        }

        // -- 리포트 확인/등록 --
        if (log.action === 'register_report') {
          // 모집플레이스에 리포트가 이미 있는지 확인
          let reportExists = false;
          try {
            const stats = await fetchReportStats(placeId);
            reportExists = stats.exists;
          } catch { /* */ }

          if (reportExists) {
            // 이미 등록됨 → 가짜 로그를 진짜 로그로 교체
            if (!dryRun) {
              await prisma.homejeonsanLog.update({
                where: { id: log.id },
                data: {
                  actorName: 'migration-fix',
                  errorMessage: '이미 등록 확인됨',
                },
              });
            }
            results.push({
              placeId,
              companyName: company.companyName,
              action: 'register_report',
              alreadyExists: true,
              registered: false,
              error: null,
              fakeLogId: log.id,
            });
          } else {
            // 실제 등록 시도
            if (!company.phone || !company.setting?.contractStart) {
              if (!dryRun) {
                await prisma.homejeonsanLog.update({
                  where: { id: log.id },
                  data: {
                    status: 'failed',
                    actorName: 'migration-fix',
                    errorMessage: `필수 정보 누락: phone=${company.phone ? 'O' : 'X'}, contractStart=${company.setting?.contractStart ? 'O' : 'X'}`,
                  },
                });
              }
              results.push({
                placeId,
                companyName: company.companyName,
                action: 'register_report',
                alreadyExists: false,
                registered: false,
                error: `필수 정보 누락`,
                fakeLogId: log.id,
              });
              continue;
            }

            let months = 6;
            if (company.setting.contractEnd) {
              const diffMs = company.setting.contractEnd.getTime() - company.setting.contractStart.getTime();
              months = Math.round(diffMs / (1000 * 60 * 60 * 24 * 30)) || 6;
            }

            if (dryRun) {
              results.push({
                placeId,
                companyName: company.companyName,
                action: 'register_report',
                alreadyExists: false,
                registered: false,
                error: 'dryRun - 등록 예정',
                fakeLogId: log.id,
              });
            } else {
              const result = await registerReport({
                placeId,
                phone1: company.phone,
                contractStart: company.setting.contractStart.toISOString().split('T')[0],
                months,
              });

              // 가짜 로그를 실제 결과로 업데이트
              await prisma.homejeonsanLog.update({
                where: { id: log.id },
                data: {
                  status: result.success ? 'success' : 'failed',
                  actorName: 'migration-fix',
                  errorMessage: result.success ? null : result.message,
                },
              });

              if (result.success) {
                await updateStep(company.id).catch(() => {});
              }

              results.push({
                placeId,
                companyName: company.companyName,
                action: 'register_report',
                alreadyExists: false,
                registered: result.success,
                error: result.success ? null : result.message,
                fakeLogId: log.id,
              });
            }
          }
        }
      }
    }

    // step 일괄 갱신 (배치 조회로 N+1 방지)
    if (!dryRun) {
      const affectedPlaceIds = [...new Set(results.map(r => r.placeId))];
      const affectedCompanies = await prisma.company.findMany({
        where: { placeId: { in: affectedPlaceIds } },
        select: { id: true },
      });
      for (const comp of affectedCompanies) {
        await updateStep(comp.id).catch(() => {});
      }
    }

    const summary = {
      total: results.length,
      alreadyExists: results.filter(r => r.alreadyExists).length,
      registered: results.filter(r => r.registered).length,
      failed: results.filter(r => !r.alreadyExists && !r.registered && r.error).length,
      dryRun,
    };

    return NextResponse.json({ message: '처리 완료', summary, results });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('POST /api/admin/fix-fake-logs error:', error);
    return NextResponse.json({ message: '처리 실패' }, { status: 500 });
  }
}

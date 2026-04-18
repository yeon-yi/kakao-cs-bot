import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { updateStep } from '@/lib/solution-utils';
import { registerKeyword, registerReport, searchKeywords } from '@/lib/homejeonsan';
import { PENDING_PATTERNS } from '@/lib/retry-pending-registrations';

// POST /api/companies/[id]/advance-step — 사용자가 "다음 단계" 버튼 클릭 시 호출
// body: { to: 3 | 4 }  (3 = S2→S3, 4 = S3→진행)
// 즉시 pending 로그 생성 후 응답 → 모집플레이스 등록은 백그라운드에서 처리
// 백그라운드 실패 시 /api/cron/retry-pending-registrations (10분 cron)이 3회까지 재시도

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);

    const { id } = await params;
    const companyId = parseInt(id);
    if (isNaN(companyId)) {
      return NextResponse.json({ message: '유효하지 않은 ID' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const to = Number(body?.to);
    if (to !== 3 && to !== 4) {
      return NextResponse.json({ message: 'to는 3 또는 4여야 합니다' }, { status: 400 });
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        placeId: true,
        branch: true,
        companyName: true,
        phone: true,
        staffName: true,
        setting: { select: { createdAt: true, contractStart: true, contractEnd: true } },
      },
    });

    if (!company?.placeId) {
      return NextResponse.json({ message: 'placeId가 없습니다' }, { status: 400 });
    }
    if (!company.setting) {
      return NextResponse.json({ message: '솔루션 설정이 없습니다' }, { status: 400 });
    }

    const placeId = company.placeId;
    const cutoff = company.setting.createdAt;
    const targetAction = to === 3 ? 'register' : 'register_report';

    // 중복 방지: 체크와 pending 로그 생성을 advisory lock 하에서 원자적으로 실행
    // (영업자가 "다음 단계" 버튼을 빠르게 두 번 눌러 pending 로그가 중복 생성되는 것을 방지)
    const [lockKey1, lockKey2] = hashPlaceAction(placeId, targetAction);
    const txResult = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey1}::int, ${lockKey2}::int)`;

      const existing = await tx.homejeonsanLog.findFirst({
        where: {
          placeId,
          action: targetAction,
          createdAt: { gte: cutoff },
          ...(targetAction === 'register'
            ? { status: 'success' }
            : { OR: [{ status: 'success' }, { errorMessage: { contains: '진행중인 리포트가 존재' } }] }),
          actorName: { not: 'system-advance' },
        },
        select: { id: true },
      });

      if (existing) return { existing: true as const };

      const pendingLog = await tx.homejeonsanLog.create({
        data: {
          action: targetAction,
          placeId,
          businessName: company.companyName,
          keyword: null,
          category: null,
          staffName: company.staffName,
          status: 'success',
          errorMessage: PENDING_PATTERNS.inProgress,
          actorId: auth.userId,
          actorName: auth.displayName,
          actorBranch: company.branch || null,
        },
      });

      return { existing: false as const, pendingLog };
    });

    if (txResult.existing) {
      const newStep = await updateStep(companyId);
      return NextResponse.json({
        ok: true,
        created: false,
        step: newStep,
        message: '이미 진행된 단계',
      });
    }

    const pendingLog = txResult.pendingLog;

    // pending 로그가 status='success'이므로 updateStep이 step을 즉시 전환 → UI 반영 빠름
    const newStep = await updateStep(companyId);

    // 백그라운드에서 실제 모집플레이스 등록 (응답은 즉시 반환)
    const bgCompany = company;
    void (async () => {
      try {
        if (to === 3) {
          let registered = false;
          let finalKeyword: string | null = null;

          try {
            const cached = await searchKeywords(placeId);
            const existingKws = cached.keywords.map((k: { keyword: string }) => k.keyword);
            if (existingKws.length > 0) {
              registered = true;
              finalKeyword = existingKws.join(',');
            }
          } catch { /* 조회 실패 시 다음 단계로 */ }

          if (!registered) {
            const kwLog = await prisma.homejeonsanLog.findFirst({
              where: { placeId, action: 'register', keyword: { not: null } },
              orderBy: { createdAt: 'desc' },
              select: { keyword: true, category: true },
            });
            if (kwLog?.keyword) {
              const keywords = kwLog.keyword.split(',').map(k => k.trim()).filter(Boolean);
              for (const kw of keywords) {
                const result = await registerKeyword({
                  businessName: bgCompany.companyName,
                  placeId,
                  keyword: kw,
                  category: kwLog.category || '기타',
                  staffName: bgCompany.staffName,
                  adType: '정상',
                });
                if (result.success) {
                  registered = true;
                  finalKeyword = finalKeyword ? `${finalKeyword},${kw}` : kw;
                }
              }
            }
          }

          // step 강등 방지: pending 로그는 status='success' 유지, 실패 시 errorMessage에만 기록
          await prisma.homejeonsanLog.update({
            where: { id: pendingLog.id },
            data: {
              keyword: finalKeyword,
              errorMessage: registered ? null : '키워드 정보 없음 (수동 등록 필요)',
            },
          });
        } else {
          const contractStart = bgCompany.setting?.contractStart;
          if (bgCompany.phone && contractStart) {
            let months = 6;
            if (bgCompany.setting?.contractEnd) {
              const diffMs = bgCompany.setting.contractEnd.getTime() - contractStart.getTime();
              months = Math.round(diffMs / (1000 * 60 * 60 * 24 * 30)) || 6;
            }
            const result = await registerReport({
              placeId,
              phone1: bgCompany.phone,
              contractStart: contractStart.toISOString().split('T')[0],
              months,
            });
            // step 강등 방지: 실패해도 status='success' 유지, errorMessage에만 실패 사유 기록
            await prisma.homejeonsanLog.update({
              where: { id: pendingLog.id },
              data: {
                errorMessage: result.success ? null : `등록 실패 (수동 등록 필요): ${result.message}`,
              },
            });
          } else {
            const missing = [
              !bgCompany.phone ? '연락처' : '',
              !contractStart ? '계약시작일' : '',
            ].filter(Boolean).join(', ');
            await prisma.homejeonsanLog.update({
              where: { id: pendingLog.id },
              data: {
                errorMessage: `${missing} 없음 (수동 등록 필요)`,
              },
            });
          }
        }

        // 백그라운드 완료 후 step 재계산 (실패 시 status='success' 유지로 강등은 없지만
        // 키워드/리포트가 실제 등록되면 다른 관련 상태도 갱신될 수 있어 재계산)
        await updateStep(companyId).catch(() => {});
      } catch (err) {
        console.error('[advance-step background] failed:', err);
        // step 강등 방지: 예외 시에도 status='success' 유지, errorMessage에만 기록
        await prisma.homejeonsanLog.update({
          where: { id: pendingLog.id },
          data: {
            errorMessage: `백그라운드 처리 실패 (수동 등록 필요): ${err instanceof Error ? err.message : String(err)}`,
          },
        }).catch(() => {});
      }
    })();

    return NextResponse.json({
      ok: true,
      created: true,
      step: newStep,
      message: '단계 전환됨 (모집플레이스 등록은 백그라운드 처리)',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('POST /api/companies/[id]/advance-step error:', error);
    return NextResponse.json({ message: '단계 전환 실패' }, { status: 500 });
  }
}

// placeId + action을 PostgreSQL advisory lock용 int 키로 변환
// (동일 업체의 동일 액션에 대해서만 직렬화, 다른 업체는 병렬 처리)
// pg_advisory_xact_lock(int, int) 시그니처 사용 — 32비트 2개로 충돌 확률 최소화
function hashPlaceAction(placeId: string, action: string): [number, number] {
  const str = `${placeId}:${action}`;
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1, 33) ^ c;
    h2 = Math.imul(h2, 33) ^ c;
  }
  return [h1 | 0, h2 | 0];
}

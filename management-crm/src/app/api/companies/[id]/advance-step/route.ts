import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { updateStep } from '@/lib/solution-utils';
import { registerKeyword, registerReport, searchKeywords } from '@/lib/homejeonsan';

// POST /api/companies/[id]/advance-step — 사용자가 "다음 단계" 버튼 클릭 시 호출
// body: { to: 3 | 4 }  (3 = S2→S3, 4 = S3→진행)
// to=3: 모집플레이스에 키워드 실제 등록 후 로그 기록
// to=4: 모집플레이스에 리포트 실제 등록 후 로그 기록

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

    const cutoff = company.setting.createdAt;
    const targetAction = to === 3 ? 'register' : 'register_report';

    // 이 업체 기준(cutoff 이후) 이미 성공 로그가 있는지 확인
    const existing = await prisma.homejeonsanLog.findFirst({
      where: {
        placeId: company.placeId,
        action: targetAction,
        createdAt: { gte: cutoff },
        ...(targetAction === 'register'
          ? { status: 'success' }
          : { OR: [{ status: 'success' }, { errorMessage: { contains: '진행중인 리포트가 존재' } }] }),
        actorName: { not: 'system-advance' }, // 가짜 로그 제외
      },
      select: { id: true },
    });

    if (existing) {
      const newStep = await updateStep(companyId);
      return NextResponse.json({
        ok: true,
        created: false,
        step: newStep,
        message: '이미 진행된 단계',
      });
    }

    // -- to=3: 키워드 등록 --
    if (to === 3) {
      // 최근 키워드 로그에서 키워드/카테고리 가져오기
      const kwLog = await prisma.homejeonsanLog.findFirst({
        where: { placeId: company.placeId, action: 'register', keyword: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { keyword: true, category: true },
      });

      // 모집플레이스에 이미 등록된 키워드 확인
      let existingKeywords = new Set<string>();
      try {
        const cached = await searchKeywords(company.placeId);
        existingKeywords = new Set(cached.keywords.map((k: { keyword: string }) => k.keyword));
      } catch { /* 조회 실패 시 중복 체크 없이 진행 */ }

      if (existingKeywords.size > 0) {
        // 이미 모집플레이스에 키워드가 있으면 성공 로그 기록
        await prisma.homejeonsanLog.create({
          data: {
            action: 'register',
            placeId: company.placeId,
            businessName: company.companyName,
            keyword: [...existingKeywords].join(','),
            category: kwLog?.category || '기타',
            staffName: company.staffName,
            status: 'success',
            errorMessage: null,
            actorId: auth.userId,
            actorName: auth.displayName,
            actorBranch: company.branch || null,
          },
        });
      } else if (kwLog?.keyword) {
        // 키워드 정보가 있으면 실제 등록
        const keywords = kwLog.keyword.split(',').map(k => k.trim()).filter(Boolean);
        let successCount = 0;

        for (const kw of keywords) {
          const result = await registerKeyword({
            businessName: company.companyName,
            placeId: company.placeId,
            keyword: kw,
            category: kwLog.category || '기타',
            staffName: company.staffName,
            adType: '정상',
          });

          await prisma.homejeonsanLog.create({
            data: {
              action: 'register',
              placeId: company.placeId,
              businessName: company.companyName,
              keyword: kw,
              category: kwLog.category || '기타',
              staffName: company.staffName,
              status: result.success ? 'success' : 'failed',
              errorMessage: result.success ? null : result.message,
              actorId: auth.userId,
              actorName: auth.displayName,
              actorBranch: company.branch || null,
            },
          });

          if (result.success) successCount++;
        }

        if (successCount === 0) {
          return NextResponse.json({ ok: false, message: '키워드 등록 실패' }, { status: 400 });
        }
      } else {
        return NextResponse.json({ ok: false, message: '등록할 키워드 정보가 없습니다' }, { status: 400 });
      }
    }

    // -- to=4: 리포트 등록 --
    if (to === 4) {
      if (!company.phone) {
        return NextResponse.json({ ok: false, message: '업체 연락처가 없습니다' }, { status: 400 });
      }

      const contractStart = company.setting.contractStart;
      if (!contractStart) {
        return NextResponse.json({ ok: false, message: '계약 시작일이 없습니다' }, { status: 400 });
      }

      // 계약 개월수 계산 (contractEnd - contractStart)
      let months = 6;
      if (company.setting.contractEnd) {
        const diffMs = company.setting.contractEnd.getTime() - contractStart.getTime();
        months = Math.round(diffMs / (1000 * 60 * 60 * 24 * 30)) || 6;
      }

      const result = await registerReport({
        placeId: company.placeId,
        phone1: company.phone,
        contractStart: contractStart.toISOString().split('T')[0],
        months,
      });

      await prisma.homejeonsanLog.create({
        data: {
          action: 'register_report',
          placeId: company.placeId,
          businessName: company.companyName,
          keyword: null,
          category: null,
          staffName: company.staffName,
          status: result.success ? 'success' : 'failed',
          errorMessage: result.success ? null : result.message,
          actorId: auth.userId,
          actorName: auth.displayName,
          actorBranch: company.branch || null,
        },
      });

      if (!result.success) {
        return NextResponse.json({ ok: false, message: `리포트 등록 실패: ${result.message}` }, { status: 400 });
      }
    }

    const newStep = await updateStep(companyId);

    return NextResponse.json({
      ok: true,
      created: true,
      step: newStep,
      message: to === 3 ? '키워드 등록 완료' : '리포트 등록 완료',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('POST /api/companies/[id]/advance-step error:', error);
    return NextResponse.json({ message: '단계 전환 실패' }, { status: 500 });
  }
}

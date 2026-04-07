import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { batchStepStatus, calcStep } from '@/lib/solution-utils';

// GET /api/companies — Company list with filtering & pagination
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    const { searchParams } = request.nextUrl;

    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get('pageSize') || '50')));
    const search = searchParams.get('search')?.trim() || '';
    const branch = searchParams.get('branch') || '';
    const managerName = searchParams.get('managerName') || '';
    const staffName = searchParams.get('staffName') || '';
    const holding = searchParams.get('holding') || '';
    const solutionStatus = searchParams.get('solutionStatus') || '';
    const status = searchParams.get('status') || '';
    const startDate = searchParams.get('startDate') || '';
    const endDate = searchParams.get('endDate') || '';
    const noProgressThisMonth = searchParams.get('noProgressThisMonth') || '';
    const paymentAmountMin = searchParams.get('paymentAmountMin') || '';
    const paymentAmountMax = searchParams.get('paymentAmountMax') || '';
    const sortKeyParam = searchParams.get('sortKey') || '';
    const sortDirParam = (searchParams.get('sortDir') || 'desc') as 'asc' | 'desc';

    // 정렬 설정
    const SORTABLE_FIELDS: Record<string, string> = { paymentDate: 'paymentDate', paymentAmount: 'paymentAmount', staffName: 'staffName' };
    const sortField = SORTABLE_FIELDS[sortKeyParam];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const NULLABLE_SORT_FIELDS = ['paymentAmount'];
    const orderBy: any[] = sortField
      ? [{ [sortField]: NULLABLE_SORT_FIELDS.includes(sortKeyParam) ? { sort: sortDirParam, nulls: 'last' } : sortDirParam }, { sourceId: 'desc' }]
      : [{ paymentDate: 'desc' }, { sourceId: 'desc' }];

    // Build where clause
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};

    // Sales/upsell teams only see sales companies (not renewal)
    where.teamSource = { not: 'renewal' };

    // Role-based filtering
    // admin/manager_team/upselling: no branch filter (see all)
    // manager: branch + managerName match
    // staff: branch + staffName match
    // admin, manager_team, upselling 역할은 전체 조회
    // manager: 자기 지사 + 자기 이름, staff: 자기 지사 + 자기 이름
    const fullAccessRoles = ['admin', 'manager_team', 'upselling_director', 'upselling_chief', 'upselling_staff', 'renewal_director', 'renewal_chief', 'renewal_staff'];
    if (!fullAccessRoles.includes(auth.role)) {
      if (auth.branch) {
        where.branch = auth.branch;
      }
      // 과장/차장은 지사 전체, 간부는 본인 이름, 사원은 본인 이름
      if (auth.role === 'manager') {
        where.managerName = auth.displayName;
      } else if (auth.role === 'staff') {
        where.staffName = auth.displayName;
      }
      // branch_manager는 지사 필터만 (이름 제한 없음)
    }

    // Search filter: case-insensitive on companyName, representative, phone
    if (search) {
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { representative: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Branch filter (전체 조회 권한이 있는 역할만 사용)
    if (branch && fullAccessRoles.includes(auth.role)) {
      where.branch = branch;
    }

    // Manager name filter (only for admin/manager_team — manager locked to own name)
    if (managerName && auth.role !== 'manager' && auth.role !== 'staff') {
      where.managerName = { contains: managerName, mode: 'insensitive' };
    }

    // Staff name filter (only for admin/manager_team — manager/staff locked to own name)
    if (staffName && auth.role !== 'staff' && auth.role !== 'manager') {
      where.staffName = { contains: staffName, mode: 'insensitive' };
    }

    // Holding filter — merge with existing setting filter if present
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settingFilter: Record<string, any> = {};
    if (holding === 'true') {
      settingFilter.isHolding = true;
    } else if (holding === 'false') {
      settingFilter.isHolding = false;
    }

    // Date range filter on paymentDate
    if (startDate || endDate) {
      where.paymentDate = {};
      if (startDate) {
        where.paymentDate.gte = new Date(startDate);
      }
      if (endDate) {
        // End of the day
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.paymentDate.lte = end;
      }
    }

    // Payment amount filter
    if (paymentAmountMin || paymentAmountMax) {
      where.paymentAmount = {};
      if (paymentAmountMin) where.paymentAmount.gte = parseInt(paymentAmountMin);
      if (paymentAmountMax) where.paymentAmount.lte = parseInt(paymentAmountMax);
    }

    // Company status filter (active, completed, churned)
    if (status) {
      where.status = status;
    }

    // Solution status filter (merged with holding filter to avoid conflict)
    if (solutionStatus === 'notset') {
      where.setting = { is: null };
    } else if (solutionStatus === 'completed') {
      if (Object.keys(settingFilter).length > 0) {
        where.setting = settingFilter;
      } else {
        where.setting = { isNot: null };
      }
      where.progress = { isCompleted: true };
    } else if (solutionStatus === 'inprogress') {
      if (Object.keys(settingFilter).length > 0) {
        where.setting = settingFilter;
      } else {
        where.setting = { isNot: null };
      }
      where.progress = { isCompleted: false };
    } else if (Object.keys(settingFilter).length > 0) {
      where.setting = settingFilter;
    }

    // 이번달 솔루션 미진행 필터: 설정 있으나 이번달 progress 변경 없는 업체
    // solutionStatus=notset과 동시 사용 시 무의미하므로 무시
    if (noProgressThisMonth === 'true' && solutionStatus !== 'notset') {
      const now = new Date();
      const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const monthStart = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1));

      // 설정 있는 업체만 대상 (기존 setting 필터와 병합)
      if (!where.setting) where.setting = { isNot: null };

      // DB 레벨 필터: progress 없거나 이번달 이전 업데이트
      // search OR과 충돌 방지: AND 배열로 래핑
      const progressCondition = {
        OR: [
          { progress: { is: null } },
          { progress: { updatedAt: { lt: monthStart } } },
        ],
      };
      // 기존 where에 AND로 합치기
      if (where.OR && where.OR.length > 0) {
        // search OR이 있으면 AND로 분리
        const searchOr = where.OR;
        delete where.OR;
        where.AND = [
          { OR: searchOr },
          progressCondition,
        ];
      } else {
        delete where.OR;
        where.AND = [progressCondition];
      }

      const [companies, total] = await Promise.all([
        prisma.company.findMany({
          where,
          include: {
            setting: true,
            progress: true,
            _count: { select: { memos: true } },
          },
          orderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.company.count({ where }),
      ]);

      // 스텝/리포트 배치 조회 (setting.createdAt 이후 로그만 — 재계약 대응)
      const { kwDone: npKwDone, rpDone: npRpDone } = await batchStepStatus(companies);

      const cNames = [...new Set(companies.map(c => c.companyName))];
      const cDups = cNames.length > 0 ? await prisma.$queryRaw<Array<{ company_name: string; representative: string }>>`
        SELECT company_name, representative FROM companies WHERE company_name = ANY(${cNames}::text[]) GROUP BY company_name, representative HAVING COUNT(*) > 1
      ` : [];
      const cDupKeys = new Set(cDups.map(r => `${r.company_name}||${r.representative}`));

      return NextResponse.json({
        companies: companies.map(c => {
          const step = calcStep(c, npKwDone, npRpDone);
          const hasProgress = c.progress && ((c.progress.blogCount || 0) > 0 || (c.progress.instaCount || 0) > 0 || c.progress.homepageDone || c.progress.videoDone || c.progress.seoDone);
          return { ...c, _isDuplicate: cDupKeys.has(`${c.companyName}||${c.representative}`), _step: step, _reportDone: (!!c.placeId && npRpDone.has(c.placeId)) || !!hasProgress };
        }),
        total,
        page,
        pageSize,
      });
    }

    const [companies, total] = await Promise.all([
      prisma.company.findMany({
        where,
        include: {
          setting: true,
          progress: true,
          _count: { select: { memos: true } },
        },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.company.count({ where }),
    ]);

    // 중복 체크 (상호명+대표자)
    const cNames = [...new Set(companies.map(c => c.companyName))];
    const cDups = cNames.length > 0 ? await prisma.$queryRaw<Array<{ company_name: string; representative: string }>>`
      SELECT company_name, representative FROM companies WHERE company_name = ANY(${cNames}::text[]) GROUP BY company_name, representative HAVING COUNT(*) > 1
    ` : [];
    const cDupKeys = new Set(cDups.map(r => `${r.company_name}||${r.representative}`));

    // 스텝 상태 배치 조회 (setting.createdAt 이후 로그만 — 재계약 대응)
    const { kwDone: kwDonePlaces, rpDone: rpDonePlaces } = await batchStepStatus(companies);

    return NextResponse.json({
      companies: companies.map(c => {
        const step = calcStep(c, kwDonePlaces, rpDonePlaces);
        // 리포트 존재 여부: 로그 or progress 데이터 기반
        const hasProgress = c.progress && ((c.progress.blogCount || 0) > 0 || (c.progress.instaCount || 0) > 0 || c.progress.homepageDone || c.progress.videoDone || c.progress.seoDone);
        const reportDone = (!!c.placeId && rpDonePlaces.has(c.placeId)) || !!hasProgress;
        return { ...c, _isDuplicate: cDupKeys.has(`${c.companyName}||${c.representative}`), _step: step, _reportDone: reportDone };
      }),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('GET /api/companies error:', error);
    return NextResponse.json({ message: '업체 목록 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// POST /api/companies — 신규 업체 등록
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);

    const body = await request.json();
    const { companyName, representative, phone, paymentDate, staffName, managerName, cardCompany, paymentAmount } = body;

    // 필수 필드 검증
    if (!companyName?.trim() || !representative?.trim() || !phone?.trim() || !paymentDate || !staffName?.trim() || !managerName?.trim() || !paymentAmount) {
      return NextResponse.json({ message: '필수 항목을 모두 입력해주세요.' }, { status: 400 });
    }

    // 중복 업체 검사 (업체명 + 전화번호) — force=true면 무시
    if (!body.force) {
      const duplicate = await prisma.company.findFirst({
        where: { companyName: companyName.trim(), phone: phone.trim() },
        select: { id: true, companyName: true },
      });
      if (duplicate) {
        return NextResponse.json({ duplicate: true, message: '동일한 업체명과 전화번호의 업체가 이미 존재합니다. 그래도 등록하시겠습니까?' }, { status: 409 });
      }
    }

    // sourceId 자동 생성 (max + 1), 충돌 시 재시도
    let company;
    for (let attempt = 0; attempt < 3; attempt++) {
      const maxResult = await prisma.company.aggregate({ _max: { sourceId: true } });
      const nextSourceId = (maxResult._max.sourceId ?? 0) + 1;
      try {
        company = await prisma.company.create({
          data: {
            sourceId: nextSourceId,
            registrant: '수동등록',
            paymentDate: new Date(paymentDate),
            companyName: companyName.trim(),
            representative: representative.trim(),
            phone: phone.trim(),
            staffName: staffName.trim(),
            managerName: managerName.trim(),
            branch: auth.branch || null,
            cardCompany: cardCompany?.trim() || null,
            paymentAmount: parseInt(paymentAmount) || null,
          },
        });
        break;
      } catch (e: unknown) {
        const isUniqueViolation = e instanceof Error && 'code' in e && (e as { code: string }).code === 'P2002';
        if (!isUniqueViolation || attempt === 2) throw e;
      }
    }

    return NextResponse.json({ company, message: '업체가 등록되었습니다.' }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('POST /api/companies error:', error);
    return NextResponse.json({ message: '업체 등록 중 오류가 발생했습니다.' }, { status: 500 });
  }
}


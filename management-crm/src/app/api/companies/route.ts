import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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

    // Build where clause
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};

    // Role-based filtering
    // admin/manager_team/upselling: no branch filter (see all)
    // manager: branch + managerName match
    // staff: branch + staffName match
    // admin, manager_team, upselling 역할은 전체 조회
    // manager: 자기 지사 + 자기 이름, staff: 자기 지사 + 자기 이름
    const fullAccessRoles = ['admin', 'manager_team', 'upselling_director', 'upselling_chief', 'upselling_staff'];
    if (!fullAccessRoles.includes(auth.role)) {
      if (auth.branch) {
        where.branch = auth.branch;
      }
      // 지사장은 지사 전체, 간부는 본인 이름, 사원은 본인 이름
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

    // Company status filter (active, completed, churned)
    if (status) {
      where.status = status;
    }

    // Solution status filter (merged with holding filter to avoid conflict)
    if (solutionStatus === 'notset') {
      where.setting = { is: null };
    } else if (solutionStatus === 'inprogress' || solutionStatus === 'completed') {
      // has setting (and optionally filter by holding)
      if (Object.keys(settingFilter).length > 0) {
        where.setting = settingFilter;
      } else {
        where.setting = { isNot: null };
      }
    } else if (Object.keys(settingFilter).length > 0) {
      where.setting = settingFilter;
    }

    // For inprogress/completed: fetch ALL matching records first, filter, then paginate
    if (solutionStatus === 'inprogress' || solutionStatus === 'completed') {
      const allCompanies = await prisma.company.findMany({
        where,
        include: {
          setting: true,
          progress: true,
          _count: { select: { memos: true } },
        },
        orderBy: [
          { paymentDate: 'desc' },
          { sourceId: 'desc' },
        ],
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const filtered = allCompanies.filter((c: any) => {
        if (!c.setting || !c.progress) return false;
        if (solutionStatus === 'completed') return isAllDone(c.setting, c.progress);
        return !isAllDone(c.setting, c.progress);
      });

      const paginatedFiltered = filtered.slice((page - 1) * pageSize, page * pageSize);

      // 중복 체크
      const pfNames = [...new Set(paginatedFiltered.map((c: { companyName: string }) => c.companyName))];
      const pfDups = pfNames.length > 0 ? await prisma.$queryRawUnsafe<Array<{ company_name: string; representative: string }>>(
        `SELECT company_name, representative FROM companies WHERE company_name = ANY($1) GROUP BY company_name, representative HAVING COUNT(*) > 1`, pfNames,
      ) : [];
      const pfDupKeys = new Set(pfDups.map((r: { company_name: string; representative: string }) => `${r.company_name}||${r.representative}`));

      return NextResponse.json({
        companies: paginatedFiltered.map((c: { companyName: string; representative: string }) => ({ ...c, _isDuplicate: pfDupKeys.has(`${c.companyName}||${c.representative}`) })),
        total: filtered.length,
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
        orderBy: [
          { paymentDate: 'desc' },
          { sourceId: 'desc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.company.count({ where }),
    ]);

    // 중복 체크 (상호명+대표자)
    const cNames = [...new Set(companies.map(c => c.companyName))];
    const cDups = cNames.length > 0 ? await prisma.$queryRawUnsafe<Array<{ company_name: string; representative: string }>>(
      `SELECT company_name, representative FROM companies WHERE company_name = ANY($1) GROUP BY company_name, representative HAVING COUNT(*) > 1`, cNames,
    ) : [];
    const cDupKeys = new Set(cDups.map(r => `${r.company_name}||${r.representative}`));

    return NextResponse.json({
      companies: companies.map(c => ({ ...c, _isDuplicate: cDupKeys.has(`${c.companyName}||${c.representative}`) })),
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

/** Check if all applicable solution items are done */
function isAllDone(
  setting: { hasReward: boolean; blogTarget: number; instaTarget: number; hasHomepage: boolean; videoType: string },
  progress: { rewardDone: boolean; blogCount: number; instaCount: number; homepageDone: boolean; videoDone: boolean },
): boolean {
  // 리워드 제외 (항상 포함)
  if (setting.blogTarget > 0 && progress.blogCount < setting.blogTarget) return false;
  if (setting.instaTarget > 0 && progress.instaCount < setting.instaTarget) return false;
  if (setting.hasHomepage && !progress.homepageDone) return false;
  if (setting.videoType !== 'none' && !progress.videoDone) return false;
  return true;
}

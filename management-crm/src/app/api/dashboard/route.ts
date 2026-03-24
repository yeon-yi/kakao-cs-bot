import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/dashboard — Dashboard stats
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);

    // 업셀링 역할은 영업팀 대시보드 접근 차단 (자체 대시보드 사용)
    const upsellRoles = ['upselling_director', 'upselling_chief', 'upselling_staff'];
    if (upsellRoles.includes(auth.role)) {
      return NextResponse.json({ message: '업셀링팀은 업셀 대시보드를 이용해주세요.' }, { status: 403 });
    }

    // Role-based company filter
    const roleFilter = buildRoleFilter(auth);

    // 날짜 필터 (선택적) — roleFilter와 분리하여 필요한 쿼리에만 적용
    const { searchParams } = request.nextUrl;
    const filterStart = searchParams.get('startDate');
    const filterEnd = searchParams.get('endDate');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dateFilter: Record<string, any> = {};
    if (filterStart) dateFilter.paymentDate = { ...(dateFilter.paymentDate || {}), gte: new Date(filterStart) };
    if (filterEnd) {
      const endD = new Date(filterEnd); endD.setHours(23, 59, 59, 999);
      dateFilter.paymentDate = { ...(dateFilter.paymentDate || {}), lte: endD };
    }
    const hasDateFilter = !!(filterStart || filterEnd);
    // 날짜 필터 적용된 where (목록/통계용)
    const filteredWhere = hasDateFilter ? { ...roleFilter, ...dateFilter } : roleFilter;

    // Today's date range (start of day to end of day)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // Month range for revenue stats
    const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);
    const monthEnd = new Date(todayStart.getFullYear(), todayStart.getMonth() + 1, 0, 23, 59, 59, 999);

    // 30 days from now for expiring contracts
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const [
      todayNew,
      totalCompanies,
      holdingCount,
      expiringCount,
      monthlyRevenueAgg,
      companiesWithSettings,
      recentCompanies,
    ] = await Promise.all([
      // Companies created today (by crawledAt)
      prisma.company.count({
        where: {
          ...roleFilter,
          crawledAt: { gte: todayStart, lte: todayEnd },
        },
      }),

      // Total company count (날짜 필터 적용)
      prisma.company.count({ where: filteredWhere }),

      // Holding count
      prisma.company.count({
        where: {
          ...roleFilter,
          setting: { isHolding: true },
        },
      }),

      // Expiring within 30 days
      prisma.company.count({
        where: {
          ...roleFilter,
          setting: {
            contractEnd: {
              gte: new Date(),
              lte: thirtyDaysFromNow,
            },
          },
        },
      }),

      // 이번 달 총 결제금액
      prisma.company.aggregate({
        where: {
          ...roleFilter,
          paymentDate: { gte: monthStart, lte: monthEnd },
        },
        _sum: { paymentAmount: true },
      }),

      // All companies with settings + progress (날짜 필터 적용)
      prisma.company.findMany({
        where: {
          ...filteredWhere,
          setting: { isNot: null },
        },
        include: {
          setting: true,
          progress: true,
        },
      }),

      // Recent 5 companies (날짜 필터 적용)
      prisma.company.findMany({
        where: filteredWhere,
        include: {
          setting: true,
          progress: true,
        },
        orderBy: [
          { paymentDate: 'desc' },
          { sourceId: 'desc' },
        ],
        take: 5,
      }),
    ]);

    // Calculate solution summary
    const totalWithSetting = companiesWithSettings.length;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const completedCount = companiesWithSettings.filter((c: any) => {
      if (!c.setting || !c.progress) return false;
      return isAllDone(c.setting, c.progress);
    }).length;
    const inProgressCount = totalWithSetting - completedCount;

    // notSet = total companies minus those with settings
    const notSetCount = await prisma.company.count({
      where: {
        ...filteredWhere,
        setting: { is: null },
      },
    });

    // Staff stats: group by staffName (날짜 필터 적용)
    const allCompaniesForStats = await prisma.company.findMany({
      where: filteredWhere,
      select: {
        staffName: true,
        managerName: true,
        branch: true,
        paymentAmount: true,
        setting: { select: { isHolding: true, hasReward: true, blogTarget: true, instaTarget: true, hasHomepage: true, videoType: true, contractEnd: true } },
        progress: { select: { rewardDone: true, blogCount: true, instaCount: true, homepageDone: true, videoDone: true } },
      },
    });

    // Staff performance
    const staffMap = new Map<string, { total: number; completed: number; inProgress: number; notSet: number }>();
    for (const c of allCompaniesForStats) {
      const key = c.staffName || '(미지정)';
      if (!staffMap.has(key)) staffMap.set(key, { total: 0, completed: 0, inProgress: 0, notSet: 0 });
      const s = staffMap.get(key)!;
      s.total++;
      if (!c.setting) { s.notSet++; continue; }
      if (c.progress && isAllDone(c.setting, c.progress)) { s.completed++; } else { s.inProgress++; }
    }
    const staffStats = Array.from(staffMap.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 20);

    // Branch stats
    const branchMap = new Map<string, { total: number; completed: number; holding: number; revenue: number }>();
    for (const c of allCompaniesForStats) {
      const key = c.branch || '(미지정)';
      if (!branchMap.has(key)) branchMap.set(key, { total: 0, completed: 0, holding: 0, revenue: 0 });
      const s = branchMap.get(key)!;
      s.total++;
      if (c.paymentAmount) s.revenue += c.paymentAmount;
      if (c.setting?.isHolding) s.holding++;
      if (c.setting && c.progress && isAllDone(c.setting, c.progress)) s.completed++;
    }
    const branchStats = Array.from(branchMap.entries())
      .map(([name, stats]) => ({ name, ...stats, rate: stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total);

    // Expiring companies (D-7)
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
    const expiringCompanies = await prisma.company.findMany({
      where: {
        ...roleFilter,
        setting: { contractEnd: { gte: new Date(), lte: sevenDaysFromNow } },
      },
      select: { id: true, companyName: true, staffName: true, managerName: true, branch: true, setting: { select: { contractEnd: true } } },
      orderBy: { setting: { contractEnd: 'asc' } },
      take: 20,
    });

    // Today's contacts
    const todayContactCount = await prisma.consultation.count({
      where: {
        nextContactDate: { gte: todayStart, lte: todayEnd },
        ...(auth.role === 'staff' ? { userId: auth.userId } : auth.role === 'manager' ? { company: { managerName: auth.displayName } } : {}),
      },
    });

    // Status counts (병렬, 날짜 필터 적용)
    const [scActive, scCompleted, scChurned] = await Promise.all([
      prisma.company.count({ where: { ...filteredWhere, status: 'active' } }),
      prisma.company.count({ where: { ...filteredWhere, status: 'completed' } }),
      prisma.company.count({ where: { ...filteredWhere, status: 'churned' } }),
    ]);
    const statusCounts = { active: scActive, completed: scCompleted, churned: scChurned };

    // Alerts
    const noSettingOldCount = await prisma.company.count({
      where: {
        ...roleFilter,
        setting: { is: null },
        paymentDate: { lte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    });

    return NextResponse.json({
      todayNew,
      totalCompanies,
      solutionSummary: {
        notSet: notSetCount,
        inProgress: inProgressCount,
        completed: completedCount,
      },
      holdingCount,
      expiringCount,
      monthlyRevenue: monthlyRevenueAgg._sum.paymentAmount || 0,
      todayContactCount,
      statusCounts,
      recentCompanies,
      staffStats,
      branchStats,
      expiringCompanies,
      alerts: {
        noSettingOld: noSettingOldCount,
        expiringWeek: expiringCompanies.length,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('GET /api/dashboard error:', error);
    return NextResponse.json({ message: '대시보드 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

function buildRoleFilter(auth: { role: string; branch: string; displayName: string }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = {};
  // admin, manager_team은 전체 조회
  if (auth.role !== 'admin' && auth.role !== 'manager_team') {
    if (auth.branch) where.branch = auth.branch;
  }
  // branch_manager는 지사 전체, manager는 본인이름, staff는 본인이름
  if (auth.role === 'manager') where.managerName = auth.displayName;
  else if (auth.role === 'staff') where.staffName = auth.displayName;
  return where;
}

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

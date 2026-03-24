import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// Helper: current YYYY-MM
function currentYearMonth(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// GET /api/mgmt/companies — 관리팀 업체 현황 조회
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (!['admin', 'manager_team'].includes(auth.role)) {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }

    const { searchParams } = request.nextUrl;
    const yearMonth = searchParams.get('yearMonth') || currentYearMonth();
    const teamParam = searchParams.get('team'); // '1' or '2' or null
    const solutionFilter = searchParams.get('solution') || 'all'; // all, blog_incomplete, insta_incomplete, homepage_incomplete, video_incomplete
    const search = searchParams.get('search') || '';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('pageSize') || '50', 10)));

    // Look up user's mgmtPosition from DB to determine if they're a leader
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { mgmtPosition: true, mgmtTeam: true },
    });

    const isLeader = auth.role === 'admin' ||
      user?.mgmtPosition === 'director' ||
      user?.mgmtPosition === 'deputy' ||
      user?.mgmtPosition === 'sp';

    // Determine which branches to query
    let branches: string[] = [];

    if (isLeader && !teamParam) {
      // Leaders see all branches for that month
      const allEntries = await prisma.mgmtTeamBranchHistory.findMany({
        where: { yearMonth },
        select: { branch: true },
      });
      branches = [...new Set(allEntries.map(e => e.branch))];
    } else {
      // Specific team (either from param or from user's team)
      const team = teamParam || user?.mgmtTeam || null;
      if (team) {
        const teamEntries = await prisma.mgmtTeamBranchHistory.findMany({
          where: { yearMonth, team },
          select: { branch: true },
        });
        branches = teamEntries.map(e => e.branch);
      }
    }

    if (branches.length === 0) {
      const noTeam = !isLeader && !teamParam && !user?.mgmtTeam;
      return NextResponse.json({
        companies: [], total: 0, page, pageSize, totalPages: 0,
        message: noTeam ? '소속 팀이 지정되지 않았습니다. 관리자에게 문의하세요.' : undefined,
      });
    }

    // Parse yearMonth for paymentDate filtering
    const [y, m] = yearMonth.split('-').map(Number);
    const startDate = new Date(Date.UTC(y, m - 1, 1));
    const endDate = new Date(Date.UTC(y, m, 1));

    // Build where clause
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {
      branch: { in: branches },
      paymentDate: { gte: startDate, lt: endDate },
      setting: { isNot: null },
    };

    if (search.trim()) {
      where.companyName = { contains: search.trim(), mode: 'insensitive' };
    }

    if (solutionFilter === 'all') {
      // DB 레벨 페이지네이션
      const [companies, total] = await Promise.all([
        prisma.company.findMany({
          where, include: { setting: true, progress: true },
          orderBy: { companyName: 'asc' }, skip: (page - 1) * pageSize, take: pageSize,
        }),
        prisma.company.count({ where }),
      ]);
      return NextResponse.json({
        companies: companies.map(c => formatCompany(c)),
        total, page, pageSize, totalPages: Math.ceil(total / pageSize),
      });
    }

    // 솔루션 필터 → 전체 조회 후 인메모리 필터 + 페이지네이션
    const allCompanies = await prisma.company.findMany({
      where, include: { setting: true, progress: true }, orderBy: { companyName: 'asc' },
    });
    const filtered = allCompanies.filter(c => {
      if (!c.setting) return false;
      const p = c.progress;
      switch (solutionFilter) {
        case 'blog_incomplete': return c.setting.blogTarget > 0 && (!p || p.blogCount < c.setting.blogTarget);
        case 'insta_incomplete': return c.setting.instaTarget > 0 && (!p || p.instaCount < c.setting.instaTarget);
        case 'homepage_incomplete': return c.setting.hasHomepage && (!p || !p.homepageDone);
        case 'video_incomplete': return c.setting.videoType !== 'none' && (!p || !p.videoDone);
        default: return true;
      }
    });
    const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

    return NextResponse.json({
      companies: paginated.map(c => formatCompany(c)),
      total: filtered.length, page, pageSize, totalPages: Math.ceil(filtered.length / pageSize),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('GET /api/mgmt/companies error:', error);
    return NextResponse.json({ message: '조회 실패' }, { status: 500 });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatCompany(c: any) {
  return {
    id: c.id,
    companyName: c.companyName,
    representative: c.representative,
    branch: c.branch,
    staffName: c.staffName,
    managerName: c.managerName,
    paymentDate: c.paymentDate.toISOString(),
    blog: c.setting ? `${c.progress?.blogCount || 0}/${c.setting.blogTarget}` : '-',
    insta: c.setting ? `${c.progress?.instaCount || 0}/${c.setting.instaTarget}` : '-',
    homepage: c.setting?.hasHomepage ? (c.progress?.homepageDone ? 'O' : 'X') : '-',
    video: c.setting?.videoType !== 'none' ? (c.progress?.videoDone ? 'O' : 'X') : '-',
  };
}

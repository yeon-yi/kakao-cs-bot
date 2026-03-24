import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/solutions/pending — 미완료 업체 조회 (월별 매핑 지원)
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (!['admin', 'manager_team'].includes(auth.role)) {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }

    const { searchParams } = request.nextUrl;
    const solution = searchParams.get('solution') || 'blog';
    const branches = searchParams.get('branches')?.split(',').filter(Boolean) || [];

    // yearMonth param for filtering companies by paymentDate
    const yearMonthParam = searchParams.get('yearMonth');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = { setting: { isNot: null } };
    if (branches.length > 0) where.branch = { in: branches };

    // If yearMonth is provided, filter by paymentDate within that month
    if (yearMonthParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonthParam)) {
      const [y, m] = yearMonthParam.split('-').map(Number);
      const startDate = new Date(Date.UTC(y, m - 1, 1));
      const endDate = new Date(Date.UTC(y, m, 1));
      where.paymentDate = { gte: startDate, lt: endDate };
    }

    const companies = await prisma.company.findMany({
      where,
      include: { setting: true, progress: true },
      orderBy: { companyName: 'asc' },
      take: 500,
    });

    const pending = companies.filter(c => {
      if (!c.setting) return false;
      const p = c.progress;
      switch (solution) {
        case 'blog': return c.setting.blogTarget > 0 && (!p || p.blogCount < c.setting.blogTarget);
        case 'insta': return c.setting.instaTarget > 0 && (!p || p.instaCount < c.setting.instaTarget);
        case 'homepage': return c.setting.hasHomepage && (!p || !p.homepageDone);
        case 'video': return c.setting.videoType !== 'none' && (!p || !p.videoDone);
        default: return false;
      }
    }).map(c => ({
      id: c.id,
      companyName: c.companyName,
      representative: c.representative,
      branch: c.branch,
      placeId: (c as Record<string, unknown>).placeId as string | null,
      current: (() => {
        const p = c.progress;
        switch (solution) {
          case 'blog': return `${p?.blogCount || 0}/${c.setting!.blogTarget}`;
          case 'insta': return `${p?.instaCount || 0}/${c.setting!.instaTarget}`;
          case 'homepage': return p?.homepageDone ? '완료' : '미완료';
          case 'video': return p?.videoDone ? '완료' : '미완료';
          default: return '-';
        }
      })(),
    }));

    return NextResponse.json({ companies: pending, total: pending.length });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('GET /api/solutions/pending error:', error);
    return NextResponse.json({ message: '조회 실패' }, { status: 500 });
  }
}

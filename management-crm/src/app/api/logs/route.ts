import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/logs — Activity logs with filtering & pagination
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    const { searchParams } = request.nextUrl;

    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get('pageSize') || '50')));
    const userId = searchParams.get('userId') || '';
    const companyId = searchParams.get('companyId') || '';
    const userName = searchParams.get('userName') || '';
    const companyName = searchParams.get('companyName') || '';
    const startDate = searchParams.get('startDate') || '';
    const endDate = searchParams.get('endDate') || '';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};

    if (userId) {
      const parsed = parseInt(userId);
      if (!isNaN(parsed)) {
        where.userId = parsed;
      }
    }

    if (companyId) {
      const parsed = parseInt(companyId);
      if (!isNaN(parsed)) {
        where.companyId = parsed;
      }
    }

    // Role-based company access filter
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const companyFilter: Record<string, any> = {};
    if (auth.branch) companyFilter.branch = auth.branch;
    if (auth.role === 'manager') companyFilter.managerName = auth.displayName;
    else if (auth.role === 'staff') companyFilter.staffName = auth.displayName;

    if (userName) {
      where.user = { displayName: { contains: userName, mode: 'insensitive' } };
    }

    if (companyName) {
      companyFilter.companyName = { contains: companyName, mode: 'insensitive' };
    }

    if (Object.keys(companyFilter).length > 0) {
      where.company = companyFilter;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.createdAt.lte = end;
      }
    }

    const [logs, total] = await Promise.all([
      prisma.solutionLog.findMany({
        where,
        include: {
          user: {
            select: { displayName: true },
          },
          company: {
            select: { companyName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.solutionLog.count({ where }),
    ]);

    return NextResponse.json({ logs, total, page, pageSize });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('GET /api/logs error:', error);
    return NextResponse.json({ message: '로그 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

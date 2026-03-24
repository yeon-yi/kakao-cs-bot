import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const VALID_STATUSES = ['active', 'completed', 'churned'] as const;
type CompanyStatus = (typeof VALID_STATUSES)[number];

// PATCH /api/companies/[id]/status — Update company status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);
    const { id } = await params;
    const companyId = parseInt(id);

    if (isNaN(companyId)) {
      return NextResponse.json({ message: '유효하지 않은 업체 ID입니다.' }, { status: 400 });
    }

    // Only admin, manager_team, manager can change status
    const allowedRoles = ['admin', 'manager_team', 'manager'];
    if (!allowedRoles.includes(auth.role)) {
      return NextResponse.json({ message: '상태 변경 권한이 없습니다.' }, { status: 403 });
    }

    const body = await request.json();
    const { status } = body as { status: CompanyStatus };

    if (!status || !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { message: `유효하지 않은 상태입니다. (${VALID_STATUSES.join(', ')})` },
        { status: 400 },
      );
    }

    // Verify company exists
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      return NextResponse.json({ message: '업체를 찾을 수 없습니다.' }, { status: 404 });
    }

    // Role-based access check: manager can only update companies in their branch
    if (auth.role === 'manager' && company.branch !== auth.branch) {
      return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
    }

    const updated = await prisma.company.update({
      where: { id: companyId },
      data: { status },
      select: { id: true, status: true, updatedAt: true },
    });

    return NextResponse.json({ status: updated.status, updatedAt: updated.updatedAt });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('PATCH /api/companies/[id]/status error:', error);
    return NextResponse.json({ message: '상태 변경 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

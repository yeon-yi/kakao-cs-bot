import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/companies/[id] — Company detail
export async function GET(
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

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      include: {
        setting: true,
        progress: true,
        logs: {
          take: 50,
          orderBy: { createdAt: 'desc' },
          include: {
            user: {
              select: { displayName: true },
            },
          },
        },
      },
    });

    if (!company) {
      return NextResponse.json({ message: '업체를 찾을 수 없습니다.' }, { status: 404 });
    }

    // Role-based access check
    if (auth.role === 'manager' && company.branch !== auth.branch) {
      return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
    }
    if (auth.role === 'staff' && company.staffName !== auth.displayName) {
      return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
    }

    return NextResponse.json({ company });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('GET /api/companies/[id] error:', error);
    return NextResponse.json({ message: '업체 상세 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// PATCH /api/companies/[id] — 부분 업데이트 (placeId 등)
export async function PATCH(
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

    const body = await request.json();
    const updateData: Record<string, unknown> = {};
    if (body.placeId !== undefined) updateData.placeId = body.placeId || null;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ message: '변경 항목 없음' }, { status: 400 });
    }

    await prisma.company.update({ where: { id: companyId }, data: updateData });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    return NextResponse.json({ message: '업데이트 실패' }, { status: 500 });
  }
}

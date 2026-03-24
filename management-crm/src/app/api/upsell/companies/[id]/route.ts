import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireUpsellAuth, canViewAllCompanies, canViewCardDetails } from '@/lib/upsell-auth';

// GET /api/upsell/companies/[id] — 업체 상세 (업셀용)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);

    const { id } = await params;
    const companyId = parseInt(id);
    if (isNaN(companyId)) {
      return NextResponse.json({ message: '유효하지 않은 업체 ID입니다.' }, { status: 400 });
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      include: {
        upsellAssignments: {
          include: {
            assignedTo: { select: { id: true, displayName: true, role: true } },
            product: {
              include: {
                reviews: {
                  include: { confirmedBy: { select: { displayName: true } } },
                  orderBy: { createdAt: 'desc' },
                },
              },
            },
          },
        },
      },
    });

    if (!company) {
      return NextResponse.json({ message: '업체를 찾을 수 없습니다.' }, { status: 404 });
    }

    // 사원은 자기에게 분배된 업체만 접근 가능
    if (!canViewAllCompanies(auth.role)) {
      const isAssigned = company.upsellAssignments.some((a) => a.assignedToId === auth.userId);
      if (!isAssigned) {
        return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
      }
    }

    // 카드 상세정보 서버사이드 숨김
    const showCardDetails = canViewCardDetails(auth.role);

    return NextResponse.json({
      company: {
        ...company,
        paymentAmount: showCardDetails ? company.paymentAmount : null,
        _canViewCardDetails: showCardDetails,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('GET /api/upsell/companies/[id] error:', error);
    return NextResponse.json({ message: '업체 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

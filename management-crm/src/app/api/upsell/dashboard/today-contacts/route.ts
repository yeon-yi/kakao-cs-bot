import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireUpsellAuth, canViewAllCompanies } from '@/lib/upsell-auth';

// GET /api/upsell/dashboard/today-contacts — 오늘 연락할 업체 (업셀링)
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);

    const isFullView = canViewAllCompanies(auth.role);

    // Today's date range
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const consultationWhere: Record<string, any> = {
      nextContactDate: {
        gte: todayStart,
        lte: todayEnd,
      },
    };

    // Filter by upsell assignment
    if (!isFullView) {
      // Staff: only companies assigned to them
      consultationWhere.company = {
        upsellAssignments: {
          some: { assignedToId: auth.userId },
        },
      };
    }

    const consultations = await prisma.consultation.findMany({
      where: consultationWhere,
      include: {
        company: {
          select: {
            id: true,
            companyName: true,
            phone: true,
            representative: true,
          },
        },
        user: {
          select: { id: true, displayName: true },
        },
      },
      orderBy: { contactDate: 'desc' },
    });

    // Group by company — take the latest consultation per company
    const companyMap = new Map<number, {
      companyId: number;
      companyName: string;
      phone: string;
      representative: string;
      nextAction: string | null;
      consultantName: string;
    }>();

    for (const c of consultations) {
      if (!companyMap.has(c.companyId)) {
        companyMap.set(c.companyId, {
          companyId: c.company.id,
          companyName: c.company.companyName,
          phone: c.company.phone,
          representative: c.company.representative,
          nextAction: c.nextAction,
          consultantName: c.user.displayName,
        });
      }
    }

    const contacts = Array.from(companyMap.values());

    return NextResponse.json({ contacts, total: contacts.length });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('GET /api/upsell/dashboard/today-contacts error:', error);
    return NextResponse.json({ message: '오늘 연락할 업체 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

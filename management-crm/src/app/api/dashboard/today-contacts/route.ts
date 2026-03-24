import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/dashboard/today-contacts — Companies to contact today
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);

    // Today's date range
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // Build consultation filter based on role
    // staff: only consultations created by the current user
    // manager: any user in the same branch
    // admin/manager_team: all consultations
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const consultationWhere: Record<string, any> = {
      nextContactDate: {
        gte: todayStart,
        lte: todayEnd,
      },
    };

    if (auth.role === 'staff') {
      consultationWhere.userId = auth.userId;
    } else if (auth.role === 'manager') {
      // Manager sees consultations from users in their branch
      // Filter via company branch
      consultationWhere.company = {
        branch: auth.branch,
      };
    }
    // admin and manager_team see all

    const consultations = await prisma.consultation.findMany({
      where: consultationWhere,
      include: {
        company: {
          select: {
            id: true,
            companyName: true,
            phone: true,
            representative: true,
            staffName: true,
            managerName: true,
            branch: true,
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
      staffName: string;
      managerName: string;
      branch: string | null;
      lastContent: string;
      nextAction: string | null;
      consultationDate: Date;
      consultantName: string;
    }>();

    for (const c of consultations) {
      if (!companyMap.has(c.companyId)) {
        companyMap.set(c.companyId, {
          companyId: c.company.id,
          companyName: c.company.companyName,
          phone: c.company.phone,
          representative: c.company.representative,
          staffName: c.company.staffName,
          managerName: c.company.managerName,
          branch: c.company.branch,
          lastContent: c.content,
          nextAction: c.nextAction,
          consultationDate: c.contactDate,
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
    console.error('GET /api/dashboard/today-contacts error:', error);
    return NextResponse.json({ message: '오늘 연락할 업체 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

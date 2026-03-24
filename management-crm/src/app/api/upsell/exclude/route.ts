import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireUpsellAuth } from '@/lib/upsell-auth';
import { notifyClients } from '@/lib/ws-notify';

// POST /api/upsell/exclude — 제외가망 토글
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);

    const { assignmentId, isExcluded } = await request.json();

    if (!assignmentId || typeof isExcluded !== 'boolean') {
      return NextResponse.json({ message: '잘못된 요청입니다.' }, { status: 400 });
    }

    const assignment = await prisma.upsellAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        assignedTo: { select: { id: true, displayName: true } },
        company: { select: { companyName: true } },
      },
    });

    if (!assignment) {
      return NextResponse.json({ message: '분배 정보를 찾을 수 없습니다.' }, { status: 404 });
    }

    // 본인 업체 또는 실장/admin만 제외 처리 가능
    const canExclude = assignment.assignedToId === auth.userId || auth.role === 'admin' || auth.role === 'upselling_director';
    if (!canExclude) {
      return NextResponse.json({ message: '본인 업체만 제외 처리할 수 있습니다.' }, { status: 403 });
    }

    await prisma.upsellAssignment.update({
      where: { id: assignmentId },
      data: { isExcluded },
    });

    await prisma.upsellLog.create({
      data: {
        userId: auth.userId,
        companyId: assignment.companyId,
        action: isExcluded ? '제외가망 설정' : '제외가망 해제',
        details: `${assignment.company.companyName} → ${assignment.assignedTo.displayName} ${isExcluded ? '제외가망 설정' : '제외가망 해제'}`,
      },
    });

    notifyClients('assignment_changed', { companyId: assignment.companyId });

    return NextResponse.json({ message: isExcluded ? '제외가망으로 설정되었습니다.' : '제외가망이 해제되었습니다.' });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('POST /api/upsell/exclude error:', error);
    return NextResponse.json({ message: '제외가망 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

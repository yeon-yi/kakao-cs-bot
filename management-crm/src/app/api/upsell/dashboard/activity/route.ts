import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireUpsellAuth, canViewAllCompanies } from '@/lib/upsell-auth';

// GET /api/upsell/dashboard/activity — 오늘 팀원 활동 요약
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);

    // Only director/admin can view team activity
    if (!canViewAllCompanies(auth.role)) {
      return NextResponse.json({ members: [] });
    }

    // Today's date range
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // Get today's upsell logs grouped by user and action
    const logs = await prisma.upsellLog.findMany({
      where: {
        createdAt: {
          gte: todayStart,
          lte: todayEnd,
        },
      },
      select: {
        userId: true,
        action: true,
        user: {
          select: { displayName: true, role: true },
        },
      },
    });

    // Group by user, then by action
    const userMap = new Map<number, {
      displayName: string;
      role: string;
      actionMap: Map<string, number>;
    }>();

    for (const log of logs) {
      if (!userMap.has(log.userId)) {
        userMap.set(log.userId, {
          displayName: log.user.displayName,
          role: log.user.role,
          actionMap: new Map(),
        });
      }
      const user = userMap.get(log.userId)!;
      user.actionMap.set(log.action, (user.actionMap.get(log.action) || 0) + 1);
    }

    // Convert to response format
    const members = Array.from(userMap.values()).map((u) => ({
      displayName: u.displayName,
      role: u.role,
      actions: Array.from(u.actionMap.entries()).map(([action, count]) => ({
        action,
        count,
      })),
    }));

    // Sort by displayName
    members.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return NextResponse.json({ members });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('GET /api/upsell/dashboard/activity error:', error);
    return NextResponse.json({ message: '활동 요약 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireUpsellAuth } from '@/lib/upsell-auth';

// GET /api/upsell/distribution/history — 일자별 분배 이력
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);

    const { searchParams } = request.nextUrl;
    const days = Math.min(90, Math.max(7, parseInt(searchParams.get('days') || '30')));

    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    // 현재 팀원 + 과거 배분에 등장하는 모든 유저 통합
    const currentMembers = await prisma.user.findMany({
      where: { role: { in: ['upselling_director', 'upselling_chief', 'upselling_staff'] } },
      select: { id: true, displayName: true, role: true },
      orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
    });
    const currentIds = new Set(currentMembers.map(m => m.id));

    // 전체 배분 이력 (기간 내) — assignedTo 포함
    const assignments = await prisma.upsellAssignment.findMany({
      where: { assignedAt: { gte: since } },
      select: {
        assignedToId: true,
        assignedAt: true,
        assignedTo: { select: { id: true, displayName: true, role: true } },
      },
    });

    // 과거 이력에만 있는 유저 추가
    const allMembersMap = new Map(currentMembers.map(m => [m.id, m]));
    for (const a of assignments) {
      if (!allMembersMap.has(a.assignedToId)) {
        allMembersMap.set(a.assignedToId, { id: a.assignedTo.id, displayName: a.assignedTo.displayName + ' (해촉)', role: a.assignedTo.role });
      }
    }
    const members = Array.from(allMembersMap.values());

    // 팀원별 누적 총계
    const totals = await prisma.upsellAssignment.groupBy({
      by: ['assignedToId'],
      _count: true,
    });
    const totalMap = new Map(totals.map(t => [t.assignedToId, t._count]));

    // 일자별 × 팀원별 집계
    const dailyMap = new Map<string, Map<number, number>>();
    for (const a of assignments) {
      const dateKey = a.assignedAt.toISOString().slice(0, 10);
      if (!dailyMap.has(dateKey)) dailyMap.set(dateKey, new Map());
      const dayMap = dailyMap.get(dateKey)!;
      dayMap.set(a.assignedToId, (dayMap.get(a.assignedToId) || 0) + 1);
    }

    // 날짜 목록 (내림차순)
    const dates = Array.from(dailyMap.keys()).sort((a, b) => b.localeCompare(a));

    // 테이블 데이터 생성
    const rows = dates.map(date => {
      const dayMap = dailyMap.get(date)!;
      const dayTotal = Array.from(dayMap.values()).reduce((s, v) => s + v, 0);
      const perMember: Record<number, number> = {};
      for (const m of members) {
        perMember[m.id] = dayMap.get(m.id) || 0;
      }
      return { date, total: dayTotal, perMember };
    });

    // 팀원별 기간 내 합계
    const periodTotals: Record<number, number> = {};
    for (const m of members) {
      periodTotals[m.id] = assignments.filter(a => a.assignedToId === m.id).length;
    }

    return NextResponse.json({
      members: members.map(m => ({
        id: m.id,
        displayName: m.displayName,
        role: m.role,
        total: totalMap.get(m.id) || 0,
        periodTotal: periodTotals[m.id] || 0,
      })),
      rows,
      days,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('GET /api/upsell/distribution/history error:', error);
    return NextResponse.json({ message: '분배 이력 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

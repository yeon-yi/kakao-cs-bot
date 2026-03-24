import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// Helper: current YYYY-MM
function currentYearMonth(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

const VALID_YM = /^\d{4}-(0[1-9]|1[0-2])$/;

// GET /api/settings/mgmt-teams?yearMonth=2026-03
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (!['admin', 'manager_team'].includes(auth.role)) {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }

    const { searchParams } = request.nextUrl;
    const yearMonth = searchParams.get('yearMonth') || currentYearMonth();

    // Get mapping for the requested month
    const entries = await prisma.mgmtTeamBranchHistory.findMany({
      where: { yearMonth },
      orderBy: { branch: 'asc' },
    });

    const team1Branches = entries.filter(e => e.team === '1').map(e => e.branch);
    const team2Branches = entries.filter(e => e.team === '2').map(e => e.branch);

    // Get all available months (distinct yearMonth values)
    const allEntries = await prisma.mgmtTeamBranchHistory.findMany({
      select: { yearMonth: true },
      distinct: ['yearMonth'],
      orderBy: { yearMonth: 'desc' },
    });
    const availableMonths = allEntries.map(e => e.yearMonth);

    return NextResponse.json({
      yearMonth,
      team1Branches,
      team2Branches,
      availableMonths,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('GET /api/settings/mgmt-teams error:', error);
    return NextResponse.json({ message: '조회 실패' }, { status: 500 });
  }
}

// PUT /api/settings/mgmt-teams — set mapping for a specific month (admin only)
export async function PUT(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth.role !== 'admin') {
      return NextResponse.json({ message: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const body = await request.json();
    const { yearMonth, team1Branches, team2Branches } = body;

    if (!yearMonth || typeof yearMonth !== 'string' || !VALID_YM.test(yearMonth)) {
      return NextResponse.json({ message: '올바른 월 형식이 아닙니다. (예: 2026-03)' }, { status: 400 });
    }
    if (!Array.isArray(team1Branches) || !Array.isArray(team2Branches)) {
      return NextResponse.json({ message: '올바른 형식이 아닙니다.' }, { status: 400 });
    }

    // Delete existing entries for the month, then insert new ones
    await prisma.$transaction(async (tx) => {
      await tx.mgmtTeamBranchHistory.deleteMany({ where: { yearMonth } });

      const records: { yearMonth: string; team: string; branch: string }[] = [];
      for (const b of team1Branches) {
        if (typeof b === 'string' && b.trim()) {
          records.push({ yearMonth, team: '1', branch: b.trim() });
        }
      }
      for (const b of team2Branches) {
        if (typeof b === 'string' && b.trim()) {
          records.push({ yearMonth, team: '2', branch: b.trim() });
        }
      }

      if (records.length > 0) {
        await tx.mgmtTeamBranchHistory.createMany({ data: records });
      }
    });

    return NextResponse.json({ message: '저장되었습니다.' });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('PUT /api/settings/mgmt-teams error:', error);
    return NextResponse.json({ message: '저장 실패' }, { status: 500 });
  }
}

// POST /api/settings/mgmt-teams — copy mapping from one month to another
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth.role !== 'admin') {
      return NextResponse.json({ message: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const body = await request.json();
    const { sourceMonth, targetMonth } = body;

    if (!sourceMonth || !targetMonth || !VALID_YM.test(sourceMonth) || !VALID_YM.test(targetMonth)) {
      return NextResponse.json({ message: '올바른 월 형식이 아닙니다.' }, { status: 400 });
    }

    if (sourceMonth === targetMonth) {
      return NextResponse.json({ message: '원본과 대상 월이 같습니다.' }, { status: 400 });
    }

    // 트랜잭션 내부에서 읽기+삭제+삽입 (일관성 보장)
    await prisma.$transaction(async (tx) => {
      const sourceEntries = await tx.mgmtTeamBranchHistory.findMany({
        where: { yearMonth: sourceMonth },
      });

      if (sourceEntries.length === 0) {
        throw new Error('NO_SOURCE');
      }

      await tx.mgmtTeamBranchHistory.deleteMany({ where: { yearMonth: targetMonth } });

      await tx.mgmtTeamBranchHistory.createMany({
        data: sourceEntries.map(e => ({ yearMonth: targetMonth, team: e.team, branch: e.branch })),
      });
    }).catch(e => {
      if (e instanceof Error && e.message === 'NO_SOURCE') {
        return NextResponse.json({ message: '원본 월에 매핑 데이터가 없습니다.' }, { status: 400 });
      }
      throw e;
    });

    return NextResponse.json({ message: `${sourceMonth} -> ${targetMonth} 복사 완료` });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('POST /api/settings/mgmt-teams error:', error);
    return NextResponse.json({ message: '복사 실패' }, { status: 500 });
  }
}

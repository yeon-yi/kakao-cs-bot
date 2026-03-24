import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireUpsellAuth, canDistribute } from '@/lib/upsell-auth';
import { notifyClients } from '@/lib/ws-notify';

// GET /api/upsell/distribution — 분배 현황 조회
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);

    if (!canDistribute(auth.role)) {
      return NextResponse.json({ message: '분배 권한이 없습니다.' }, { status: 403 });
    }

    // 팀원별 분배 현황 (실장 본인 포함)
    const members = await prisma.user.findMany({
      where: {
        role: { in: ['upselling_director', 'upselling_chief', 'upselling_staff'] },
      },
      select: {
        id: true,
        displayName: true,
        role: true,
        _count: { select: { assignedUpsell: true } },
      },
      orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
    });

    // 미분배 업체 수
    const unassignedCount = await prisma.company.count({
      where: { upsellAssignments: { none: {} } },
    });

    // 전체 분배 수
    const totalAssigned = await prisma.upsellAssignment.count();

    return NextResponse.json({
      members,
      unassignedCount,
      totalAssigned,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('GET /api/upsell/distribution error:', error);
    return NextResponse.json({ message: '분배 현황 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// POST /api/upsell/distribution — 업체 일괄 분배
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);

    if (!canDistribute(auth.role)) {
      return NextResponse.json({ message: '분배 권한이 없습니다.' }, { status: 403 });
    }

    const body = await request.json();
    const { companyIds, assignToId } = body;

    if (!companyIds || !Array.isArray(companyIds) || companyIds.length === 0) {
      return NextResponse.json({ message: '분배할 업체를 선택하세요.' }, { status: 400 });
    }
    if (!assignToId) {
      return NextResponse.json({ message: '분배 대상 팀원을 선택하세요.' }, { status: 400 });
    }
    if (companyIds.length > 500) {
      return NextResponse.json({ message: '한 번에 최대 500건까지 분배 가능합니다.' }, { status: 400 });
    }

    // 대상 유저 검증
    const targetUser = await prisma.user.findUnique({ where: { id: assignToId } });
    if (!targetUser || !['upselling_director', 'upselling_chief', 'upselling_staff'].includes(targetUser.role)) {
      return NextResponse.json({ message: '유효하지 않은 분배 대상입니다.' }, { status: 400 });
    }

    // 이미 해당 유저에게 분배된 건 제외
    const sameUserExisting = await prisma.upsellAssignment.findMany({
      where: { companyId: { in: companyIds }, assignedToId: assignToId },
      select: { companyId: true },
    });
    const sameUserIds = new Set(sameUserExisting.map((e) => e.companyId));
    const targetIds = companyIds.filter((id: number) => !sameUserIds.has(id));

    if (targetIds.length === 0) {
      return NextResponse.json({ message: '선택한 업체는 이미 해당 팀원에게 분배되었습니다.' }, { status: 400 });
    }

    // 다른 사람에게 이미 배분된 업체는 기존 배분 삭제 (재배분)
    const otherAssignments = await prisma.upsellAssignment.findMany({
      where: { companyId: { in: targetIds } },
      include: { assignedTo: { select: { displayName: true } }, company: { select: { companyName: true } } },
    });
    let reassignedCount = 0;
    if (otherAssignments.length > 0) {
      await prisma.upsellAssignment.deleteMany({
        where: { id: { in: otherAssignments.map((a) => a.id) } },
      });
      reassignedCount = otherAssignments.length;
    }

    // 일괄 생성
    await prisma.upsellAssignment.createMany({
      data: targetIds.map((companyId: number) => ({
        companyId,
        assignedToId: assignToId,
        assignedById: auth.userId,
      })),
      skipDuplicates: true,
    });

    // 로그 기록
    const logDetails = reassignedCount > 0
      ? `${targetUser.displayName}에게 ${targetIds.length}건 분배 (${reassignedCount}건 재배분)`
      : `${targetUser.displayName}에게 ${targetIds.length}건 분배`;
    await prisma.upsellLog.create({
      data: {
        userId: auth.userId,
        action: reassignedCount > 0 ? '업체 재배분' : '업체 분배',
        details: logDetails,
      },
    });

    notifyClients('distribution_changed', { companyIds: targetIds, assignToId });

    return NextResponse.json({
      message: `${targetIds.length}건이 ${targetUser.displayName}에게 분배되었습니다.${reassignedCount > 0 ? ` (${reassignedCount}건 재배분)` : ''}`,
      count: targetIds.length,
      reassigned: reassignedCount,
      skipped: sameUserIds.size,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('POST /api/upsell/distribution error:', error);
    return NextResponse.json({ message: '분배 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// PUT /api/upsell/distribution — 공정 자동 배분
export async function PUT(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);
    if (!canDistribute(auth.role)) {
      return NextResponse.json({ message: '분배 권한이 없습니다.' }, { status: 403 });
    }

    const { startDate, endDate } = await request.json();
    if (!startDate || !endDate) {
      return NextResponse.json({ message: '결제일 범위를 지정해주세요.' }, { status: 400 });
    }

    const endD = new Date(endDate);
    endD.setHours(23, 59, 59, 999);

    // 해당 기간 미배분 업체 조회
    const unassigned = await prisma.company.findMany({
      where: {
        paymentDate: { gte: new Date(startDate), lte: endD },
        upsellAssignments: { none: {} },
      },
      select: { id: true },
      orderBy: [{ paymentAmount: 'desc' }, { id: 'asc' }],
    });

    if (unassigned.length === 0) {
      return NextResponse.json({ message: '해당 기간에 미배분 업체가 없습니다.' }, { status: 400 });
    }

    // 배분 대상 팀원 (실장 본인 포함)
    const members = await prisma.user.findMany({
      where: { role: { in: ['upselling_director', 'upselling_chief', 'upselling_staff'] } },
      select: { id: true, displayName: true, role: true },
      orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
    });

    if (members.length === 0) {
      return NextResponse.json({ message: '배분 대상 팀원이 없습니다.' }, { status: 400 });
    }

    // 실장 찾기 (나머지 배분 대상)
    const director = members.find(m => m.role === 'upselling_director');
    // 실장 제외한 팀원
    const staffMembers = members.filter(m => m.role !== 'upselling_director');

    const companyIds = unassigned.map(c => c.id);
    const totalCompanies = companyIds.length;

    // 균등 배분 계산
    let assignments: { companyId: number; assignedToId: number }[] = [];

    if (staffMembers.length === 0 && director) {
      // 팀원이 없으면 실장이 전부
      assignments = companyIds.map(id => ({ companyId: id, assignedToId: director.id }));
    } else if (staffMembers.length > 0) {
      const perMember = Math.floor(totalCompanies / staffMembers.length);
      const remainder = totalCompanies % staffMembers.length;

      let idx = 0;
      for (const member of staffMembers) {
        for (let i = 0; i < perMember; i++) {
          assignments.push({ companyId: companyIds[idx++], assignedToId: member.id });
        }
      }
      // 나머지 → 실장이 가져감
      if (director) {
        while (idx < totalCompanies) {
          assignments.push({ companyId: companyIds[idx++], assignedToId: director.id });
        }
      } else {
        // 실장이 없으면 첫 번째 팀원부터 1건씩
        let mi = 0;
        while (idx < totalCompanies) {
          assignments.push({ companyId: companyIds[idx++], assignedToId: staffMembers[mi % staffMembers.length].id });
          mi++;
        }
      }
    }

    // 일괄 생성
    await prisma.upsellAssignment.createMany({
      data: assignments.map(a => ({ ...a, assignedById: auth.userId })),
      skipDuplicates: true,
    });

    // 배분 결과 요약
    const countByMember = new Map<string, number>();
    for (const a of assignments) {
      const name = members.find(m => m.id === a.assignedToId)?.displayName || '?';
      countByMember.set(name, (countByMember.get(name) || 0) + 1);
    }
    const detail = Array.from(countByMember.entries()).map(([name, count]) => `${name} ${count}건`).join(', ');

    await prisma.upsellLog.create({
      data: {
        userId: auth.userId,
        action: '공정 배분',
        details: `${totalCompanies}건 공정 배분 (${detail})`,
      },
    });

    notifyClients('distribution_changed', {});

    return NextResponse.json({
      message: `${totalCompanies}건이 공정 배분되었습니다.`,
      total: totalCompanies,
      distribution: Object.fromEntries(countByMember),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('PUT /api/upsell/distribution error:', error);
    return NextResponse.json({ message: '공정 배분 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// DELETE /api/upsell/distribution — 분배 취소
export async function DELETE(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);

    if (!canDistribute(auth.role)) {
      return NextResponse.json({ message: '분배 권한이 없습니다.' }, { status: 403 });
    }

    const { searchParams } = request.nextUrl;
    const assignmentId = searchParams.get('id');

    if (!assignmentId) {
      return NextResponse.json({ message: '분배 ID가 필요합니다.' }, { status: 400 });
    }

    const parsedId = parseInt(assignmentId);
    if (isNaN(parsedId)) {
      return NextResponse.json({ message: '유효하지 않은 분배 ID입니다.' }, { status: 400 });
    }

    const assignment = await prisma.upsellAssignment.findUnique({
      where: { id: parsedId },
      include: {
        assignedTo: { select: { displayName: true } },
        company: { select: { companyName: true } },
      },
    });

    if (!assignment) {
      return NextResponse.json({ message: '분배 정보를 찾을 수 없습니다.' }, { status: 404 });
    }

    // Cascade로 product도 함께 삭제됨
    await prisma.upsellAssignment.delete({ where: { id: parseInt(assignmentId) } });

    await prisma.upsellLog.create({
      data: {
        userId: auth.userId,
        companyId: assignment.companyId,
        action: '분배 취소',
        details: `${assignment.company.companyName} → ${assignment.assignedTo.displayName} 분배 취소`,
      },
    });

    notifyClients('distribution_changed', { companyId: assignment.companyId });

    return NextResponse.json({ message: '분배가 취소되었습니다.' });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('DELETE /api/upsell/distribution error:', error);
    return NextResponse.json({ message: '분배 취소 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

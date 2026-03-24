import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireUpsellAuth, canManageUpsellUser, getCreatableRoles, isUpsellRole } from '@/lib/upsell-auth';

// GET /api/upsell/users — 하위 업셀링 유저 목록
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};

    // admin: 업셀 전체 조회
    // 실장: 주임+사원 전체 조회 (자기 자신 제외)
    // 주임: 사원 전체 조회
    if (auth.role === 'admin') {
      where.role = { in: ['upselling_director', 'upselling_chief', 'upselling_staff'] };
    } else if (auth.role === 'upselling_director') {
      where.role = { in: ['upselling_chief', 'upselling_staff'] };
    } else if (auth.role === 'upselling_chief') {
      where.role = { in: ['upselling_staff'] };
    } else {
      // upselling_staff는 유저 관리 권한 없음
      return NextResponse.json({ users: [] });
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        branch: true,
        createdById: true,
        createdAt: true,
        createdBy: { select: { displayName: true } },
        _count: { select: { assignedUpsell: true } },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'desc' }],
    });

    return NextResponse.json({ users });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('GET /api/upsell/users error:', error);
    return NextResponse.json({ message: '사용자 목록 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// POST /api/upsell/users — 하위 역할 유저 생성
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);

    const body = await request.json();
    const { username, password, displayName, role } = body;

    if (!username || !password || !displayName || !role) {
      return NextResponse.json({ message: '필수 항목을 모두 입력하세요.' }, { status: 400 });
    }

    // 생성 가능한 역할 체크
    const creatableRoles = getCreatableRoles(auth.role);
    if (!creatableRoles.includes(role)) {
      return NextResponse.json({ message: '해당 역할의 계정을 생성할 권한이 없습니다.' }, { status: 403 });
    }

    // 중복 아이디 체크
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json({ message: '이미 존재하는 아이디입니다.' }, { status: 409 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        displayName,
        role,
        branch: null,
        createdById: auth.userId,
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        createdAt: true,
      },
    });

    // 로그 기록
    await prisma.upsellLog.create({
      data: {
        userId: auth.userId,
        action: '팀원 생성',
        details: `${displayName} (${role}) 계정 생성`,
      },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('POST /api/upsell/users error:', error);
    return NextResponse.json({ message: '사용자 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// PUT /api/upsell/users — 하위 역할 유저 수정
export async function PUT(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);

    const body = await request.json();
    const { id, displayName, username, role, password } = body;

    if (!id) {
      return NextResponse.json({ message: '사용자 ID가 필요합니다.' }, { status: 400 });
    }

    const parsedId = parseInt(id);
    if (isNaN(parsedId)) {
      return NextResponse.json({ message: '유효하지 않은 사용자 ID입니다.' }, { status: 400 });
    }

    const target = await prisma.user.findUnique({ where: { id: parsedId } });
    if (!target) {
      return NextResponse.json({ message: '사용자를 찾을 수 없습니다.' }, { status: 404 });
    }

    // 하위 역할만 수정 가능
    if (!canManageUpsellUser(auth.role, target.role)) {
      return NextResponse.json({ message: '해당 사용자를 수정할 권한이 없습니다.' }, { status: 403 });
    }

    // 변경할 역할 검증: 업셀 역할만 허용 (admin 에스컬레이션 방지)
    if (role) {
      if (!isUpsellRole(role) || !canManageUpsellUser(auth.role, role)) {
        return NextResponse.json({ message: '해당 역할로 변경할 권한이 없습니다.' }, { status: 403 });
      }
    }

    // 아이디 중복 체크
    if (username && username !== target.username) {
      const dup = await prisma.user.findUnique({ where: { username } });
      if (dup) {
        return NextResponse.json({ message: '이미 존재하는 아이디입니다.' }, { status: 409 });
      }
    }

    const updateData: Record<string, unknown> = {};
    if (displayName !== undefined) updateData.displayName = displayName;
    if (username !== undefined && username !== target.username) updateData.username = username;
    if (role !== undefined) updateData.role = role;
    if (password) updateData.passwordHash = await bcrypt.hash(password, 10);

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ message: '변경할 항목이 없습니다.' }, { status: 400 });
    }

    const user = await prisma.user.update({
      where: { id: parsedId },
      data: updateData,
      select: { id: true, username: true, displayName: true, role: true, createdAt: true },
    });

    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('PUT /api/upsell/users error:', error);
    return NextResponse.json({ message: '사용자 수정 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// DELETE /api/upsell/users — 하위 역할 유저 삭제
export async function DELETE(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);

    const { searchParams } = request.nextUrl;
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ message: '사용자 ID가 필요합니다.' }, { status: 400 });
    }

    const userId = parseInt(id);
    if (isNaN(userId)) {
      return NextResponse.json({ message: '유효하지 않은 사용자 ID입니다.' }, { status: 400 });
    }

    if (userId === auth.userId) {
      return NextResponse.json({ message: '자기 자신은 삭제할 수 없습니다.' }, { status: 400 });
    }

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      return NextResponse.json({ message: '사용자를 찾을 수 없습니다.' }, { status: 404 });
    }

    if (!canManageUpsellUser(auth.role, target.role)) {
      return NextResponse.json({ message: '해당 사용자를 삭제할 권한이 없습니다.' }, { status: 403 });
    }

    // FK 참조 체크
    const assignmentCount = await prisma.upsellAssignment.count({ where: { assignedToId: userId } });
    if (assignmentCount > 0) {
      return NextResponse.json(
        { message: `이 사용자에게 분배된 업체가 ${assignmentCount}건 있습니다. 먼저 분배를 해제하세요.` },
        { status: 400 },
      );
    }

    // 리뷰 확인자 참조 해제
    await prisma.kakaoMapReview.updateMany({
      where: { confirmedById: userId },
      data: { confirmedById: null },
    });

    // 활동 로그 참조는 유지 (로그 보존)

    await prisma.user.delete({ where: { id: userId } });

    await prisma.upsellLog.create({
      data: {
        userId: auth.userId,
        action: '팀원 삭제',
        details: `${target.displayName} (${target.role}) 계정 삭제`,
      },
    });

    return NextResponse.json({ message: '사용자가 삭제되었습니다.' });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('DELETE /api/upsell/users error:', error);
    return NextResponse.json({ message: '사용자 삭제 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// 계정 관리 접근 가능 역할
function requireAccountAccess(request: NextRequest) {
  const auth = requireAuth(request);
  const allowed = ['admin', 'manager_team', 'branch_manager', 'upselling_director', 'upselling_chief', 'renewal_director', 'renewal_chief'];
  if (!allowed.includes(auth.role)) {
    throw new Error('Forbidden');
  }
  return auth;
}

// GET /api/users — 역할별 계정 목록 (검색 + 페이지네이션)
export async function GET(request: NextRequest) {
  try {
    const auth = requireAccountAccess(request);
    const { searchParams } = request.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '50')));
    const search = searchParams.get('search')?.trim() || '';
    const roleFilter = searchParams.get('role') || '';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};

    // 역할별 조회 범위 (접근 제어)
    let allowedRoles: string[] | null = null; // null = 전체
    if (auth.role === 'branch_manager') {
      allowedRoles = ['branch_manager', 'manager', 'staff'];
      where.branch = auth.branch; // 자기 지사만
    } else if (auth.role === 'upselling_director') {
      allowedRoles = ['upselling_director', 'upselling_chief', 'upselling_staff'];
    } else if (auth.role === 'upselling_chief') {
      allowedRoles = ['upselling_staff'];
    } else if (auth.role === 'renewal_director') {
      allowedRoles = ['renewal_director', 'renewal_chief', 'renewal_staff'];
    } else if (auth.role === 'renewal_chief') {
      allowedRoles = ['renewal_staff'];
    }
    // admin, manager_team은 전체 조회

    // 검색
    if (search) {
      where.OR = [
        { displayName: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
      ];
    }

    // 역할 필터 (단일) — 접근 범위와 교차
    if (roleFilter) {
      if (allowedRoles && !allowedRoles.includes(roleFilter)) {
        where.role = { in: [] }; // 접근 불가 역할 요청 → 빈 결과
      } else {
        where.role = roleFilter;
      }
    } else {
      // 복수 역할 필터 (roles=a,b,c)
      const rolesFilter = searchParams.get('roles') || '';
      if (rolesFilter) {
        let roles = rolesFilter.split(',').filter(Boolean);
        if (allowedRoles) roles = roles.filter(r => allowedRoles!.includes(r));
        where.role = { in: roles.length > 0 ? roles : ['__none__'] };
      } else if (allowedRoles) {
        where.role = { in: allowedRoles };
      }
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          username: true,
          displayName: true,
          role: true,
          branch: true,
          mgmtPosition: true,
          mgmtTeam: true,
          responsibilities: true,
          kakaoRoomId: true,
          createdAt: true,
          lastLoginAt: true,
          createdById: true,
          createdBy: { select: { displayName: true } },
          _count: { select: { assignedUpsell: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.user.count({ where }),
    ]);

    return NextResponse.json({ users, total, page, pageSize });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('GET /api/users error:', error);
    return NextResponse.json({ message: '사용자 목록 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// POST /api/users — Create user (역할 계층 검증)
export async function POST(request: NextRequest) {
  try {
    const auth = requireAccountAccess(request);

    const body = await request.json();
    const { username, password, displayName, role, branch, mgmtPosition, mgmtTeam, responsibilities } = body;

    if (!username || !password || !displayName || !role) {
      return NextResponse.json(
        { message: '필수 항목을 모두 입력하세요.' },
        { status: 400 },
      );
    }

    // Check for duplicate username
    const existing = await prisma.user.findUnique({
      where: { username },
    });

    if (existing) {
      return NextResponse.json(
        { message: '이미 존재하는 아이디입니다.' },
        { status: 409 },
      );
    }

    // Validate role
    const validRoles = ['admin', 'manager_team', 'branch_manager', 'manager', 'staff', 'upselling_director', 'upselling_chief', 'upselling_staff', 'renewal_director', 'renewal_chief', 'renewal_staff'];
    if (!validRoles.includes(role)) {
      return NextResponse.json({ message: '유효하지 않은 역할입니다.' }, { status: 400 });
    }

    // 역할 계층 검증
    const upsellRoles = ['upselling_director', 'upselling_chief', 'upselling_staff'];
    const renewalRoles = ['renewal_director', 'renewal_chief', 'renewal_staff'];
    if (auth.role === 'admin') {
      // admin은 모든 역할 생성 가능
    } else if (renewalRoles.includes(role)) {
      if (auth.role === 'renewal_director' && role === 'renewal_director') {
        return NextResponse.json({ message: '동일 직책은 생성할 수 없습니다.' }, { status: 403 });
      }
      if (auth.role === 'renewal_chief' && role !== 'renewal_staff') {
        return NextResponse.json({ message: '사원만 생성할 수 있습니다.' }, { status: 403 });
      }
      if (!['renewal_director', 'renewal_chief'].includes(auth.role)) {
        return NextResponse.json({ message: '재계약팀 계정 생성 권한이 없습니다.' }, { status: 403 });
      }
    } else if (upsellRoles.includes(role)) {
      // 업셀링 역할: 상위만 생성 가능
      if (auth.role === 'upselling_director' && role === 'upselling_director') {
        return NextResponse.json({ message: '동일 직책은 생성할 수 없습니다.' }, { status: 403 });
      }
      if (auth.role === 'upselling_chief' && role !== 'upselling_staff') {
        return NextResponse.json({ message: '사원만 생성할 수 있습니다.' }, { status: 403 });
      }
    } else if (role === 'manager_team') {
      // 관리팀 역할: admin 또는 관리팀 실장/부실장이 생성 가능
      if (auth.role === 'manager_team') {
        // 관리팀 내 직급 계층: 실장은 부실장/사원 생성, 부실장은 사원만
        const authUser = await prisma.user.findUnique({ where: { id: auth.userId }, select: { mgmtPosition: true } });
        const authPos = authUser?.mgmtPosition;
        const targetPos = mgmtPosition || 'staff';
        if (authPos === 'director') {
          // 실장은 부실장/SP/사원 생성 가능 (실장은 불가)
          if (targetPos === 'director') {
            return NextResponse.json({ message: '동일 직책은 생성할 수 없습니다.' }, { status: 403 });
          }
        } else if (authPos === 'deputy') {
          // 부실장은 사원/SP만 생성 가능
          if (targetPos !== 'staff' && targetPos !== 'sp') {
            return NextResponse.json({ message: '사원/SP만 생성할 수 있습니다.' }, { status: 403 });
          }
        } else {
          // SP, 사원은 계정 생성 불가
          return NextResponse.json({ message: '관리팀 계정 생성 권한이 없습니다.' }, { status: 403 });
        }
      } else {
        return NextResponse.json({ message: '관리팀 계정 생성 권한이 없습니다.' }, { status: 403 });
      }
    } else if (auth.role === 'branch_manager') {
      // 과장/차장은 자기 지사의 manager, staff만 생성 가능
      if (!['manager', 'staff'].includes(role)) {
        return NextResponse.json({ message: '간부 또는 영업자만 생성할 수 있습니다.' }, { status: 403 });
      }
    } else {
      // 영업팀 역할(manager, staff)은 admin만
      return NextResponse.json({ message: '영업팀 계정은 관리자만 생성 가능합니다.' }, { status: 403 });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // 업셀링/재계약 역할은 지사를 "본사"로 고정, 과장/차장은 자기 지사로 고정
    const isUpsellRole = upsellRoles.includes(role);
    const isRenewalRole = renewalRoles.includes(role);
    const finalBranch = (isUpsellRole || isRenewalRole) ? '본사' : auth.role === 'branch_manager' ? auth.branch : (branch || null);

    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        displayName,
        role,
        branch: finalBranch,
        mgmtPosition: role === 'manager_team' ? (mgmtPosition || null) : null,
        mgmtTeam: role === 'manager_team' ? (mgmtTeam || null) : null,
        responsibilities: role === 'manager_team' ? (responsibilities || null) : null,
        createdById: auth.userId,
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        branch: true,
        mgmtPosition: true,
        mgmtTeam: true,
        responsibilities: true,
        createdAt: true,
      },
    });

    // Audit log (non-blocking)
    prisma.adminLog.create({
      data: {
        action: 'user_create',
        targetId: user.id,
        targetName: displayName,
        detail: role,
        actorId: auth.userId,
        actorName: auth.displayName,
      },
    }).catch(() => {});

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '관리자 권한이 필요합니다.' }, { status: 403 });
    }
    console.error('POST /api/users error:', error);
    return NextResponse.json({ message: '사용자 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// PUT /api/users — Update user (role hierarchy enforced)
export async function PUT(request: NextRequest) {
  try {
    const auth = requireAccountAccess(request);

    const body = await request.json();
    const { id, displayName, username, role, branch, password, mgmtPosition, mgmtTeam, responsibilities, kakaoRoomId } = body;

    if (!id) {
      return NextResponse.json(
        { message: '사용자 ID가 필요합니다.' },
        { status: 400 },
      );
    }

    const parsedId = parseInt(id);
    if (isNaN(parsedId)) {
      return NextResponse.json({ message: '유효하지 않은 사용자 ID입니다.' }, { status: 400 });
    }

    // Check user exists
    const existing = await prisma.user.findUnique({
      where: { id: parsedId },
    });

    if (!existing) {
      return NextResponse.json(
        { message: '사용자를 찾을 수 없습니다.' },
        { status: 404 },
      );
    }

    // 과장/차장은 자기 지사의 manager/staff만 수정 가능
    if (auth.role === 'branch_manager') {
      if (!['manager', 'staff'].includes(existing.role) || existing.branch !== auth.branch) {
        return NextResponse.json({ message: '자기 지사의 간부/영업자만 수정할 수 있습니다.' }, { status: 403 });
      }
    }

    // 역할 변경 권한 체크 — admin만 역할 변경 가능, 그 외는 본인 범위 내에서만
    if (role && role !== existing.role) {
      const validRoles = ['admin', 'manager_team', 'branch_manager', 'manager', 'staff', 'upselling_director', 'upselling_chief', 'upselling_staff', 'renewal_director', 'renewal_chief', 'renewal_staff'];
      if (!validRoles.includes(role)) {
        return NextResponse.json({ message: '유효하지 않은 역할입니다.' }, { status: 400 });
      }
      // admin만 역할 변경 가능
      if (auth.role !== 'admin') {
        return NextResponse.json({ message: '역할 변경은 시스템 관리자만 가능합니다.' }, { status: 403 });
      }
    }
    // 비밀번호 변경 — admin 또는 본인만 (본인 변경은 설정 페이지에서)
    if (password && auth.role !== 'admin' && auth.userId !== parsedId) {
      return NextResponse.json({ message: '비밀번호 변경 권한이 없습니다.' }, { status: 403 });
    }

    // Check username uniqueness if changed
    if (username && username !== existing.username) {
      const duplicate = await prisma.user.findUnique({
        where: { username },
      });
      if (duplicate) {
        return NextResponse.json(
          { message: '이미 존재하는 아이디입니다.' },
          { status: 409 },
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (displayName !== undefined) updateData.displayName = displayName;
    if (username !== undefined && username !== existing.username) updateData.username = username;
    if (role !== undefined) updateData.role = role;
    if (branch !== undefined) updateData.branch = branch || null;
    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, 10);
    }

    // mgmtPosition / responsibilities: only for manager_team, null otherwise
    const effectiveRole = role !== undefined ? role : existing.role;
    if (effectiveRole === 'manager_team') {
      if (mgmtPosition !== undefined) updateData.mgmtPosition = mgmtPosition || null;
      if (mgmtTeam !== undefined) updateData.mgmtTeam = mgmtTeam || null;
      if (responsibilities !== undefined) updateData.responsibilities = responsibilities || null;
      if (kakaoRoomId !== undefined) updateData.kakaoRoomId = kakaoRoomId || null;
    } else {
      // Clear mgmt fields when switching away from manager_team
      updateData.mgmtPosition = null;
      updateData.mgmtTeam = null;
      updateData.responsibilities = null;
      updateData.kakaoRoomId = null;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { message: '변경할 항목이 없습니다.' },
        { status: 400 },
      );
    }

    const user = await prisma.user.update({
      where: { id: parseInt(id) },
      data: updateData,
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        branch: true,
        mgmtPosition: true,
        mgmtTeam: true,
        responsibilities: true,
        createdAt: true,
      },
    });

    // Audit log (non-blocking)
    const changedFields = Object.keys(updateData).filter(k => k !== 'passwordHash').join(', ');
    prisma.adminLog.create({
      data: {
        action: 'user_update',
        targetId: parsedId,
        targetName: displayName || existing.displayName,
        detail: changedFields || 'password',
        actorId: auth.userId,
        actorName: auth.displayName,
      },
    }).catch(() => {});

    return NextResponse.json({ user });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '관리자 권한이 필요합니다.' }, { status: 403 });
    }
    console.error('PUT /api/users error:', error);
    return NextResponse.json({ message: '사용자 수정 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// DELETE /api/users — Delete user (admin + branch_manager for own branch)
export async function DELETE(request: NextRequest) {
  try {
    const auth = requireAccountAccess(request);
    if (auth.role !== 'admin' && auth.role !== 'branch_manager') {
      return NextResponse.json({ message: '사용자 삭제 권한이 없습니다.' }, { status: 403 });
    }
    const { searchParams } = request.nextUrl;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { message: '사용자 ID가 필요합니다.' },
        { status: 400 },
      );
    }

    const userId = parseInt(id);

    if (isNaN(userId)) {
      return NextResponse.json(
        { message: '유효하지 않은 사용자 ID입니다.' },
        { status: 400 },
      );
    }

    // Prevent self-deletion
    if (userId === auth.userId) {
      return NextResponse.json(
        { message: '자기 자신은 삭제할 수 없습니다.' },
        { status: 400 },
      );
    }

    // Check user exists
    const existing = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existing) {
      return NextResponse.json(
        { message: '사용자를 찾을 수 없습니다.' },
        { status: 404 },
      );
    }

    // 과장/차장은 자기 지사의 manager/staff만 삭제 가능
    if (auth.role === 'branch_manager') {
      if (!['manager', 'staff'].includes(existing.role) || existing.branch !== auth.branch) {
        return NextResponse.json({ message: '자기 지사의 간부/영업자만 삭제할 수 있습니다.' }, { status: 403 });
      }
    }

    // Check for FK references before deletion
    const settingCount = await prisma.solutionSetting.count({
      where: { setById: userId },
    });
    const logCount = await prisma.solutionLog.count({
      where: { userId: userId },
    });

    if (settingCount > 0 || logCount > 0) {
      return NextResponse.json(
        { message: '이 사용자와 연결된 솔루션 데이터가 있어 삭제할 수 없습니다. 역할을 변경하거나 비활성화하세요.' },
        { status: 400 },
      );
    }

    await prisma.user.delete({
      where: { id: userId },
    });

    // Audit log (non-blocking)
    prisma.adminLog.create({
      data: {
        action: 'user_delete',
        targetId: userId,
        targetName: existing.displayName,
        detail: null,
        actorId: auth.userId,
        actorName: auth.displayName,
      },
    }).catch(() => {});

    return NextResponse.json({ message: '사용자가 삭제되었습니다.' });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '관리자 권한이 필요합니다.' }, { status: 403 });
    }
    console.error('DELETE /api/users error:', error);
    return NextResponse.json({ message: '사용자 삭제 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

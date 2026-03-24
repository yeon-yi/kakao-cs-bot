import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signToken, requireAuth } from '@/lib/auth';

// POST /api/auth — Login
export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return NextResponse.json(
        { message: '아이디와 비밀번호를 입력하세요.' },
        { status: 400 },
      );
    }

    const user = await prisma.user.findUnique({
      where: { username },
    });

    if (!user) {
      return NextResponse.json(
        { message: '아이디 또는 비밀번호가 올바르지 않습니다.' },
        { status: 401 },
      );
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { message: '아이디 또는 비밀번호가 올바르지 않습니다.' },
        { status: 401 },
      );
    }

    // 마지막 접속일시 업데이트
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const payload = {
      userId: user.id,
      username: user.username,
      role: user.role,
      branch: user.branch || '',
      displayName: user.displayName,
      mgmtTeam: user.mgmtTeam || null,
      mgmtPosition: user.mgmtPosition || null,
    };

    const token = signToken(payload);

    const response = NextResponse.json({ user: payload });
    const isSecure = process.env.NODE_ENV === 'production';
    response.cookies.set('token', token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return response;
  } catch {
    return NextResponse.json(
      { message: '로그인 처리 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}

// GET /api/auth — Session check
export async function GET(request: NextRequest) {
  try {
    const user = requireAuth(request);
    return NextResponse.json({ user });
  } catch {
    return NextResponse.json(
      { message: 'Unauthorized' },
      { status: 401 },
    );
  }
}

// DELETE /api/auth — Logout
export async function DELETE() {
  const response = NextResponse.json({ message: '로그아웃 되었습니다.' });
  response.cookies.set('token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}

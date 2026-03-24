import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

// POST /api/auth/password — Change password
export async function POST(request: NextRequest) {
  try {
    const user = requireAuth(request);

    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword) {
      return NextResponse.json(
        { message: '현재 비밀번호를 입력하세요.' },
        { status: 400 },
      );
    }

    if (!newPassword || newPassword.length < 4) {
      return NextResponse.json(
        { message: '새 비밀번호는 4자 이상이어야 합니다.' },
        { status: 400 },
      );
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
    });

    if (!dbUser) {
      return NextResponse.json(
        { message: '사용자를 찾을 수 없습니다.' },
        { status: 404 },
      );
    }

    const valid = await bcrypt.compare(currentPassword, dbUser.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { message: '현재 비밀번호가 올바르지 않습니다.' },
        { status: 401 },
      );
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.userId },
      data: { passwordHash: newHash },
    });

    return NextResponse.json({ message: '비밀번호가 변경되었습니다.' });
  } catch (err) {
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json(
        { message: 'Unauthorized' },
        { status: 401 },
      );
    }
    return NextResponse.json(
      { message: '비밀번호 변경 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = requireAuth(request);
    const { id } = await params;
    const companyId = parseInt(id);

    if (isNaN(companyId)) {
      return NextResponse.json({ message: '유효하지 않은 업체 ID입니다.' }, { status: 400 });
    }

    const existing = await prisma.userPin.findUnique({
      where: { userId_companyId: { userId: auth.userId, companyId } },
    });

    if (existing) {
      await prisma.userPin.delete({ where: { userId_companyId: { userId: auth.userId, companyId } } });
      return NextResponse.json({ pinned: false });
    } else {
      await prisma.userPin.create({ data: { userId: auth.userId, companyId } });
      return NextResponse.json({ pinned: true });
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('POST /api/companies/[id]/pin error:', error);
    return NextResponse.json({ message: '처리 실패' }, { status: 500 });
  }
}

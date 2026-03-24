import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/crawler — Latest crawl logs (admin only)
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);

    if (auth.role !== 'admin') {
      return NextResponse.json({ message: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const logs = await prisma.crawlLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json({ logs });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('GET /api/crawler error:', error);
    return NextResponse.json({ message: '크롤러 로그 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

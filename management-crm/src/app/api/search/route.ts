import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    requireAuth(request);
    const q = request.nextUrl.searchParams.get('q')?.trim() || '';
    if (q.length < 2) return NextResponse.json({ results: [] });

    const companies = await prisma.company.findMany({
      where: {
        OR: [
          { companyName: { contains: q, mode: 'insensitive' } },
          { representative: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q } },
        ],
      },
      select: { id: true, companyName: true, representative: true, branch: true },
      take: 8,
      orderBy: { companyName: 'asc' },
    });

    return NextResponse.json({ results: companies });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    return NextResponse.json({ results: [] });
  }
}

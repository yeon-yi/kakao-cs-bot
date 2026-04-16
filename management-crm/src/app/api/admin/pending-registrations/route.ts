import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// GET /api/admin/pending-registrations
// 모집플레이스 등록이 진행 중이거나 실패한 로그 목록 조회 (관리자 전용)

export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);

    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { role: true },
    });
    if (user?.role !== 'admin') {
      return NextResponse.json({ message: '관리자만 조회 가능' }, { status: 403 });
    }

    const logs = await prisma.homejeonsanLog.findMany({
      where: {
        status: 'success',
        errorMessage: { not: null },
        OR: [
          { errorMessage: { startsWith: '등록 진행 중' } },
          { errorMessage: { startsWith: '등록 실패' } },
          { errorMessage: { startsWith: '백그라운드 처리 실패' } },
          { errorMessage: { contains: '수동 등록 필요' } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const placeIds = [...new Set(logs.map(l => l.placeId).filter(Boolean))] as string[];
    const companies = placeIds.length > 0
      ? await prisma.company.findMany({
          where: { placeId: { in: placeIds } },
          select: { id: true, placeId: true, companyName: true, staffName: true, branch: true, managerName: true },
        })
      : [];
    const byPlace = new Map(companies.map(c => [c.placeId!, c]));

    const items = logs.map(log => ({
      id: log.id,
      action: log.action,
      placeId: log.placeId,
      businessName: log.businessName,
      keyword: log.keyword,
      errorMessage: log.errorMessage,
      actorName: log.actorName,
      actorBranch: log.actorBranch,
      createdAt: log.createdAt,
      company: log.placeId ? byPlace.get(log.placeId) || null : null,
      status: classifyStatus(log.errorMessage || ''),
    }));

    const summary = {
      total: items.length,
      pending: items.filter(i => i.status === 'pending').length,
      failed: items.filter(i => i.status === 'failed').length,
      manual: items.filter(i => i.status === 'manual').length,
    };

    return NextResponse.json({ summary, items });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('GET /api/admin/pending-registrations error:', error);
    return NextResponse.json({ message: '조회 실패' }, { status: 500 });
  }
}

function classifyStatus(msg: string): 'pending' | 'failed' | 'manual' {
  if (msg.startsWith('등록 진행 중')) return 'pending';
  if (msg.startsWith('등록 실패') || msg.startsWith('백그라운드 처리 실패')) return 'failed';
  return 'manual';
}

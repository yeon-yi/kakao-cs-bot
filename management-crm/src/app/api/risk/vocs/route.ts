import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireAuth } from '@/lib/auth';
import { requireRiskTeam } from '@/lib/risk-auth';
import { prisma } from '@/lib/prisma';

// GET /api/risk/vocs — VOC 피드 (전체 / 케이스별 / 회사별)
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireRiskTeam(auth);

    const { searchParams } = request.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '30')));
    const caseIdRaw = searchParams.get('caseId');
    const companyIdRaw = searchParams.get('companyId');
    const search = searchParams.get('search')?.trim() || '';

    const where: Prisma.RiskVocWhereInput = {};
    if (caseIdRaw) {
      const v = parseInt(caseIdRaw, 10);
      if (!Number.isNaN(v)) where.caseId = v;
    }
    if (companyIdRaw) {
      const v = parseInt(companyIdRaw, 10);
      if (!Number.isNaN(v)) where.companyId = v;
    }
    if (search) where.content = { contains: search, mode: 'insensitive' };

    const [total, vocs] = await Promise.all([
      prisma.riskVoc.count({ where }),
      prisma.riskVoc.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          author: { select: { id: true, displayName: true } },
          case: { select: { id: true, businessName: true, caseType: true, status: true } },
          company: { select: { id: true, companyName: true } },
        },
      }),
    ]);

    return NextResponse.json({ total, page, pageSize, vocs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    const status = msg === 'Unauthorized' ? 401 : msg === 'Forbidden' ? 403 : 500;
    return NextResponse.json({ message: msg }, { status });
  }
}

// POST /api/risk/vocs — VOC 작성 (caseId 또는 companyId 필요)
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireRiskTeam(auth);

    const body = await request.json();
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) return NextResponse.json({ message: '내용은 필수입니다.' }, { status: 400 });

    const caseId = body.caseId != null && !Number.isNaN(Number(body.caseId)) ? Number(body.caseId) : null;
    let companyId =
      body.companyId != null && !Number.isNaN(Number(body.companyId)) ? Number(body.companyId) : null;
    if (!caseId && !companyId) {
      return NextResponse.json({ message: 'caseId 또는 companyId가 필요합니다.' }, { status: 400 });
    }

    if (companyId) {
      const exists = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
      if (!exists) {
        return NextResponse.json({ message: `companyId ${companyId}에 해당하는 업체가 없습니다.` }, { status: 400 });
      }
    }

    const voc = await prisma.$transaction(async (tx) => {
      const created = await tx.riskVoc.create({
        data: {
          caseId: caseId ?? null,
          companyId: companyId ?? null,
          authorId: auth.userId,
          content,
          category: typeof body.category === 'string' ? body.category : null,
        },
        include: {
          author: { select: { id: true, displayName: true } },
        },
      });
      if (caseId) {
        await tx.riskCaseLog.create({
          data: {
            caseId,
            actorId: auth.userId,
            action: 'voc_add',
            note: content.length > 80 ? content.slice(0, 80) + '…' : content,
          },
        });
      }
      return created;
    });

    return NextResponse.json({ voc }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error';
    const status = msg === 'Unauthorized' ? 401 : msg === 'Forbidden' ? 403 : 500;
    return NextResponse.json({ message: msg }, { status });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireUpsellAuth, canViewAllCompanies, canViewCardDetails } from '@/lib/upsell-auth';

// GET /api/upsell/companies — 전지사 업체 목록 (업셀용)
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);

    const { searchParams } = request.nextUrl;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get('pageSize') || '50')));
    const search = searchParams.get('search')?.trim() || '';
    const branch = searchParams.get('branch') || '';
    const startDate = searchParams.get('startDate') || '';
    const endDate = searchParams.get('endDate') || '';
    const assigned = searchParams.get('assigned') || ''; // all, assigned, unassigned
    const excluded = searchParams.get('excluded') || ''; // all, excluded, active
    // 결제상태 필터
    const paymentStatus = searchParams.get('paymentStatus') || '';
    // 만료 임박 필터
    const expiring = searchParams.get('expiring') || '';
    // 정렬
    const sortBy = searchParams.get('sortBy') || 'paymentDate';
    const sortDir = searchParams.get('sortDir') || 'desc';

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = {};

    // 사원은 자기에게 분배된 업체만
    if (!canViewAllCompanies(auth.role)) {
      where.upsellAssignments = { some: { assignedToId: auth.userId } };
    }

    // 검색
    if (search) {
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { representative: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    // 지사 필터
    if (branch) {
      where.branch = branch;
    }

    // 날짜 필터
    if (startDate || endDate) {
      where.paymentDate = {};
      if (startDate) where.paymentDate.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.paymentDate.lte = end;
      }
    }

    // 분배 상태 필터
    if (assigned === 'mine') {
      // "내 업체": 본인에게 분배된 것만
      where.upsellAssignments = { some: { assignedToId: auth.userId } };
    } else if (canViewAllCompanies(auth.role)) {
      if (assigned === 'assigned') {
        where.upsellAssignments = { some: {} };
      } else if (assigned === 'unassigned') {
        where.upsellAssignments = { none: {} };
      }
    }
    // 제외가망 필터 — 미배분(none) 상태에서는 적용 불가
    if ((excluded === 'excluded' || excluded === 'active') && assigned !== 'unassigned') {
      const isExcludedVal = excluded === 'excluded';
      const existingSome = where.upsellAssignments?.some;
      if (existingSome && typeof existingSome === 'object') {
        where.upsellAssignments = { some: { ...existingSome, isExcluded: isExcludedVal } };
      } else {
        where.upsellAssignments = { ...where.upsellAssignments, some: { isExcluded: isExcludedVal } };
      }
    }

    // unassigned 상태에서는 some 기반 필터 적용 불가 (none과 충돌)
    const isUnassigned = assigned === 'unassigned';

    // 결제상태 필터 (product.paymentStatus)
    if (paymentStatus && !isUnassigned) {
      const existingSome = where.upsellAssignments?.some;
      if (existingSome && typeof existingSome === 'object') {
        where.upsellAssignments = { some: { ...existingSome, product: { paymentStatus } } };
      } else {
        where.upsellAssignments = { ...where.upsellAssignments, some: { ...where.upsellAssignments?.some, product: { paymentStatus } } };
      }
    }

    // 미설정 업체 필터 (배분됐지만 상품설정 안 한 업체) — paymentStatus와 동시 사용 불가
    const productStatus = searchParams.get('productStatus') || '';
    if (productStatus === 'noProduct' && !paymentStatus && !isUnassigned) {
      const existingSome = where.upsellAssignments?.some;
      if (existingSome && typeof existingSome === 'object') {
        where.upsellAssignments = { some: { ...existingSome, product: { is: null } } };
      } else {
        where.upsellAssignments = { ...where.upsellAssignments, some: { ...where.upsellAssignments?.some, product: { is: null } } };
      }
    }

    // 만료 임박 필터 (7일 이내)
    if (expiring === 'true' && !isUnassigned) {
      const sevenDaysLater = new Date();
      sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
      const productFilter = { contractEnd: { gte: new Date(), lte: sevenDaysLater } };
      const existingSome = where.upsellAssignments?.some;
      if (existingSome && typeof existingSome === 'object') {
        where.upsellAssignments = { some: { ...existingSome, product: { ...existingSome?.product, ...productFilter } } };
      } else {
        where.upsellAssignments = { ...where.upsellAssignments, some: { product: productFilter } };
      }
    }

    // 사원은 where.upsellAssignments가 이미 some: { assignedToId } 으로 제한됨

    const showCardDetails = canViewCardDetails(auth.role);

    // 동적 정렬
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let orderBy: any[] = [{ paymentDate: 'desc' }, { sourceId: 'desc' }];
    if (sortBy === 'companyName') orderBy = [{ companyName: sortDir }];
    else if (sortBy === 'paymentAmount') orderBy = [{ paymentAmount: sortDir }];
    else if (sortBy === 'paymentDate') orderBy = [{ paymentDate: sortDir }];

    const [companies, total] = await Promise.all([
      prisma.company.findMany({
        where,
        include: {
          upsellAssignments: {
            select: {
              id: true,
              isExcluded: true,
              assignedTo: { select: { id: true, displayName: true, role: true } },
              product: {
                select: {
                  id: true,
                  hasPowerlink: true,
                  powerlinkDone: true,
                  reviewType: true,
                  receiptReviewTarget: true,
                  kakaoReviewTarget: true,
                  totalReviewTarget: true,
                  receiptReviewCount: true,
                  kakaoReviewCount: true,
                  channelType: true,
                  channelDone: true,
                  upsellAmount: true,
                  kakaoMapUrl: true,
                  kakaoMapName: true,
                  exposureCount: true,
                  contractStart: true,
                  contractEnd: true,
                  paymentStatus: true,
                  hasTaxInvoice: true,
                },
              },
            },
          },
        },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.company.count({ where }),
    ]);

    // 중복 체크 (상호명+대표자) — 단일 쿼리로 처리
    const dupKeys = new Set<string>();
    if (companies.length > 0) {
      const names = [...new Set(companies.map(c => c.companyName))];
      const dupRows = await prisma.$queryRawUnsafe<Array<{ company_name: string; representative: string }>>(
        `SELECT company_name, representative FROM companies WHERE company_name = ANY($1) GROUP BY company_name, representative HAVING COUNT(*) > 1`,
        names,
      );
      for (const r of dupRows) {
        dupKeys.add(`${r.company_name}||${r.representative}`);
      }
    }

    // 사용자 핀(즐겨찾기) 조회
    const userPins = await prisma.userPin.findMany({ where: { userId: auth.userId }, select: { companyId: true } });
    const pinnedIds = new Set(userPins.map(p => p.companyId));

    // 서버사이드: 카드사는 모두에게, 결제금액은 간부급만
    const sanitized = companies.map((c) => ({
      ...c,
      cardCompany: c.cardCompany || null,
      paymentAmount: showCardDetails ? (c.paymentAmount || null) : null,
      _canViewCardDetails: showCardDetails,
      _isDuplicate: dupKeys.has(`${c.companyName}||${c.representative}`),
      _isPinned: pinnedIds.has(c.id),
    }));

    return NextResponse.json({
      companies: sanitized,
      total,
      page,
      pageSize,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('GET /api/upsell/companies error:', error);
    return NextResponse.json({ message: '업체 목록 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

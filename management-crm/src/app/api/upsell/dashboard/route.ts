import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireUpsellAuth, canViewAllCompanies } from '@/lib/upsell-auth';

// GET /api/upsell/dashboard — 업셀 대시보드 통계
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);

    const isFullView = canViewAllCompanies(auth.role);

    // 기본 통계
    const assignmentWhere = isFullView ? undefined : { assignedToId: auth.userId };
    const productWhere = isFullView ? undefined : { assignment: { assignedToId: auth.userId } };

    // 전체 업체 수: 실장/admin은 전체, 사원은 본인 분배 수
    const totalCompanies = isFullView
      ? await prisma.company.count()
      : await prisma.upsellAssignment.count({ where: { assignedToId: auth.userId } });

    const [totalAssigned, totalProducts] = await Promise.all([
      prisma.upsellAssignment.count({ where: assignmentWhere }),
      prisma.upsellProduct.count({ where: productWhere }),
    ]);

    // 상품 설정 완료율: 실제 사용자 입력이 있는 상품만 카운트
    const productsWithSettings = await prisma.upsellProduct.count({
      where: {
        ...(isFullView ? {} : { assignment: { assignedToId: auth.userId } }),
        OR: [
          { contractStart: { not: null } },
          { naverAccount: { not: null } },
          { kakaoMapPlaceId: { not: null } },
          { hasPowerlink: true },
          { channelType: { not: 'none' } },
        ],
      },
    });

    // 리뷰 통계
    const reviewStats = await prisma.kakaoMapReview.aggregate({
      where: isFullView
        ? {}
        : { product: { assignment: { assignedToId: auth.userId } } },
      _count: true,
    });

    const confirmedReviews = await prisma.kakaoMapReview.count({
      where: {
        ...(isFullView ? {} : { product: { assignment: { assignedToId: auth.userId } } }),
        isOurs: true,
      },
    });

    // 이번 달 업셀 매출
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const monthlyRevenue = await prisma.upsellProduct.aggregate({
      where: {
        ...(isFullView ? {} : { assignment: { assignedToId: auth.userId } }),
        upsellAmount: { not: null },
        OR: [
          { contractStart: { lte: monthEnd }, contractEnd: { gte: monthStart } },
          { contractStart: null, createdAt: { gte: monthStart } },
        ],
      },
      _sum: { upsellAmount: true },
    });

    // 팀원별 분배 현황 (실장/주임만)
    let memberStats: Array<{ displayName: string; role: string; count: number }> = [];
    if (isFullView) {
      const members = await prisma.user.findMany({
        where: { role: { in: ['upselling_director', 'upselling_chief', 'upselling_staff'] } },
        select: {
          displayName: true,
          role: true,
          _count: { select: { assignedUpsell: true } },
        },
        orderBy: { displayName: 'asc' },
      });
      memberStats = members.map((m) => ({
        displayName: m.displayName,
        role: m.role,
        count: m._count.assignedUpsell,
      }));
    }

    // 계약 만료 임박 (7일 이내)
    const sevenDaysLater = new Date();
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
    const expiringCount = await prisma.upsellProduct.count({
      where: {
        ...(isFullView ? {} : { assignment: { assignedToId: auth.userId } }),
        contractEnd: { gte: now, lte: sevenDaysLater },
      },
    });

    // 최근 분배 업체
    const recentAssignments = await prisma.upsellAssignment.findMany({
      where: isFullView ? {} : { assignedToId: auth.userId },
      include: {
        company: { select: { companyName: true, representative: true, paymentDate: true, branch: true } },
        assignedTo: { select: { displayName: true } },
      },
      orderBy: { assignedAt: 'desc' },
      take: 10,
    });

    // ─── 고도화: 추가 통계 ───

    // 1. 결제 현황
    const paymentStatusBase = isFullView ? {} : { assignment: { assignedToId: auth.userId } };
    const [paidCount, partialCount, unpaidCount] = await Promise.all([
      prisma.upsellProduct.count({ where: { ...paymentStatusBase, paymentStatus: 'paid' } }),
      prisma.upsellProduct.count({ where: { ...paymentStatusBase, paymentStatus: 'partial' } }),
      prisma.upsellProduct.count({ where: { ...paymentStatusBase, paymentStatus: 'unpaid' } }),
    ]);

    // 2. 월별 매출 추이 (최근 6개월)
    const monthlyTrend: Array<{ month: string; revenue: number; count: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
      const mLabel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      const [mRevenue, mCount] = await Promise.all([
        prisma.upsellProduct.aggregate({
          where: {
            ...(isFullView ? {} : { assignment: { assignedToId: auth.userId } }),
            paidAt: { gte: mStart, lte: mEnd },
          },
          _sum: { upsellAmount: true },
        }),
        prisma.upsellProduct.count({
          where: {
            ...(isFullView ? {} : { assignment: { assignedToId: auth.userId } }),
            paidAt: { gte: mStart, lte: mEnd },
          },
        }),
      ]);
      monthlyTrend.push({ month: mLabel, revenue: mRevenue._sum.upsellAmount || 0, count: mCount });
    }

    // 3. 상품 처리율 (파워링크, 리뷰, 채널)
    const allProducts = await prisma.upsellProduct.findMany({
      where: isFullView ? {} : { assignment: { assignedToId: auth.userId } },
      select: {
        hasPowerlink: true, powerlinkDone: true,
        reviewType: true, receiptReviewCount: true, receiptReviewTarget: true,
        kakaoReviewCount: true, kakaoReviewTarget: true,
        channelType: true, channelDone: true,
        paymentStatus: true,
      },
    });
    const powerlinkTotal = allProducts.filter(p => p.hasPowerlink).length;
    const powerlinkDone = allProducts.filter(p => p.hasPowerlink && p.powerlinkDone).length;
    const channelTotal = allProducts.filter(p => p.channelType !== 'none').length;
    const channelDone = allProducts.filter(p => p.channelType !== 'none' && p.channelDone).length;
    const reviewDone = allProducts.filter(p => {
      if (p.reviewType === 'receipt_only') return p.receiptReviewCount >= p.receiptReviewTarget;
      if (p.reviewType === 'kakao_only') return p.kakaoReviewCount >= p.kakaoReviewTarget;
      return (p.receiptReviewCount >= p.receiptReviewTarget) && (p.kakaoReviewCount >= p.kakaoReviewTarget);
    }).length;

    // 4. 결제완료 but 서비스 미완료 카운트
    const paidProducts = await prisma.upsellProduct.findMany({
      where: {
        paymentStatus: 'paid',
        ...(isFullView ? {} : { assignment: { assignedToId: auth.userId } }),
      },
      select: {
        hasPowerlink: true, powerlinkDone: true,
        channelType: true, channelDone: true,
        receiptReviewCount: true, receiptReviewTarget: true,
        kakaoReviewCount: true, kakaoReviewTarget: true,
        reviewType: true,
      },
    });

    const paidIncomplete = paidProducts.filter(p => {
      if (p.hasPowerlink && !p.powerlinkDone) return true;
      if (p.channelType !== 'none' && !p.channelDone) return true;
      if (p.reviewType !== 'kakao_only' && p.receiptReviewCount < p.receiptReviewTarget) return true;
      if (p.reviewType !== 'receipt_only' && p.kakaoReviewCount < p.kakaoReviewTarget) return true;
      return false;
    }).length;

    // 5. 팀원별 상세 성과 (실장/주임만)
    let memberPerformance: Array<{
      displayName: string; role: string; assignCount: number;
      paidCount: number; revenue: number; reviewDone: number;
    }> = [];
    if (isFullView) {
      const members = await prisma.user.findMany({
        where: { role: { in: ['upselling_director', 'upselling_chief', 'upselling_staff'] } },
        select: {
          displayName: true, role: true,
          assignedUpsell: {
            select: {
              product: {
                select: {
                  paymentStatus: true, upsellAmount: true,
                  reviewType: true, receiptReviewCount: true, receiptReviewTarget: true,
                  kakaoReviewCount: true, kakaoReviewTarget: true,
                },
              },
            },
          },
        },
        orderBy: { displayName: 'asc' },
      });
      memberPerformance = members.map(m => {
        const products = m.assignedUpsell.map(a => a.product).filter(Boolean) as Array<{
          paymentStatus: string; upsellAmount: number | null;
          reviewType: string; receiptReviewCount: number; receiptReviewTarget: number;
          kakaoReviewCount: number; kakaoReviewTarget: number;
        }>;
        return {
          displayName: m.displayName,
          role: m.role,
          assignCount: m.assignedUpsell.length,
          paidCount: products.filter(p => p.paymentStatus === 'paid').length,
          revenue: products.reduce((sum, p) => sum + (p.upsellAmount || 0), 0),
          reviewDone: products.filter(p => {
            if (p.reviewType === 'receipt_only') return p.receiptReviewCount >= p.receiptReviewTarget;
            if (p.reviewType === 'kakao_only') return p.kakaoReviewCount >= p.kakaoReviewTarget;
            return (p.receiptReviewCount >= p.receiptReviewTarget) && (p.kakaoReviewCount >= p.kakaoReviewTarget);
          }).length,
        };
      });
    }

    return NextResponse.json({
      stats: {
        totalCompanies,
        totalAssigned,
        totalProducts,
        productsWithSettings,
        settingRate: totalAssigned > 0 ? Math.round((productsWithSettings / totalAssigned) * 100) : 0,
        totalReviews: reviewStats._count,
        confirmedReviews,
        monthlyRevenue: monthlyRevenue._sum.upsellAmount || 0,
        expiringCount,
      },
      memberStats,
      recentAssignments,
      // 고도화 데이터
      paymentStats: { paid: paidCount, partial: partialCount, unpaid: unpaidCount },
      monthlyTrend,
      processingStats: {
        powerlink: { total: powerlinkTotal, done: powerlinkDone },
        review: { total: totalProducts, done: reviewDone },
        channel: { total: channelTotal, done: channelDone },
      },
      memberPerformance,
      paidIncomplete,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('GET /api/upsell/dashboard error:', error);
    return NextResponse.json({ message: '대시보드 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

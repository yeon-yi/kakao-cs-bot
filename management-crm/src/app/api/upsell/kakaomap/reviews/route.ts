import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireUpsellAuth, canViewAllCompanies } from '@/lib/upsell-auth';
import { notifyClients } from '@/lib/ws-notify';

/** 상품 소유권 검증 */
async function verifyProductAccess(productId: number, auth: { userId: number; role: string }) {
  const product = await prisma.upsellProduct.findUnique({
    where: { id: productId },
    include: { assignment: { select: { assignedToId: true } } },
  });
  if (!product) return null;
  // 실장/admin은 전체 접근, 나머지는 본인 분배건만
  if (!canViewAllCompanies(auth.role) && product.assignment.assignedToId !== auth.userId) {
    return null;
  }
  return product;
}

// GET /api/upsell/kakaomap/reviews?productId=N — 리뷰 목록 조회
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);

    const productId = parseInt(request.nextUrl.searchParams.get('productId') || '0');
    if (!productId) {
      return NextResponse.json({ message: '상품 ID가 필요합니다.' }, { status: 400 });
    }

    // 권한 검증
    const product = await verifyProductAccess(productId, auth);
    if (!product) {
      return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
    }

    const reviews = await prisma.kakaoMapReview.findMany({
      where: { productId },
      include: {
        confirmedBy: { select: { displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ reviews });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('GET /api/upsell/kakaomap/reviews error:', error);
    return NextResponse.json({ message: '리뷰 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// POST /api/upsell/kakaomap/reviews — 리뷰 갱신 (크롤링) 또는 수동 추가
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);

    const body = await request.json();
    const { productId, action } = body;

    if (!productId) {
      return NextResponse.json({ message: '상품 ID가 필요합니다.' }, { status: 400 });
    }

    const product = await prisma.upsellProduct.findUnique({
      where: { id: productId },
      include: { assignment: { include: { company: { select: { companyName: true } } } } },
    });

    if (!product) {
      return NextResponse.json({ message: '상품을 찾을 수 없습니다.' }, { status: 404 });
    }

    // 권한 검증: 본인 분배건이거나 실장/admin
    if (!canViewAllCompanies(auth.role) && product.assignment.assignedToId !== auth.userId) {
      return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
    }

    // 수동 리뷰 추가
    if (action === 'manual') {
      const { author, title, content, rating } = body;
      if (!author || !content) {
        return NextResponse.json({ message: '작성자와 내용은 필수입니다.' }, { status: 400 });
      }

      const review = await prisma.kakaoMapReview.create({
        data: {
          productId,
          author,
          title: title || '',
          content,
          rating: rating || 0,
          isManual: true,
          isOurs: true,
          confirmedAt: new Date(),
          confirmedById: auth.userId,
        },
      });

      notifyClients('review_updated', { companyId: product.assignment.companyId });
      return NextResponse.json({ review, message: '수동 리뷰가 추가되었습니다.' });
    }

    // 리뷰 갱신 (카카오맵 크롤링)
    if (action === 'refresh') {
      if (!product.kakaoMapPlaceId) {
        return NextResponse.json({ message: '카카오맵 장소가 설정되지 않았습니다.' }, { status: 400 });
      }

      const reviews = await fetchKakaoMapReviews(product.kakaoMapPlaceId);

      // 기존 크롤링 리뷰 중 중복 제외
      const existingReviews = await prisma.kakaoMapReview.findMany({
        where: { productId, isManual: false },
        select: { author: true, content: true },
      });
      const existingKeys = new Set(existingReviews.map((r) => `${r.author}:${r.content.slice(0, 50)}`));

      const newReviews = reviews.filter(
        (r) => !existingKeys.has(`${r.author}:${r.content.slice(0, 50)}`),
      );

      if (newReviews.length > 0) {
        await prisma.kakaoMapReview.createMany({
          data: newReviews.map((r) => ({
            productId,
            author: r.author,
            title: r.title || '',
            content: r.content,
            rating: r.rating || 0,
            isManual: false,
            fetchedAt: new Date(),
          })),
        });
      }

      // 노출 개수 업데이트 (확인된 리뷰 수)
      const confirmedCount = await prisma.kakaoMapReview.count({ where: { productId, isOurs: true } });
      const totalReviews = await prisma.kakaoMapReview.count({ where: { productId } });
      await prisma.upsellProduct.update({
        where: { id: productId },
        data: { exposureCount: confirmedCount },
      });

      await prisma.upsellLog.create({
        data: {
          userId: auth.userId,
          companyId: product.assignment.companyId,
          action: '리뷰 갱신',
          details: `${product.assignment.company.companyName}: 신규 ${newReviews.length}건 (총 ${totalReviews}건)`,
        },
      });

      return NextResponse.json({
        message: `${newReviews.length}건의 신규 리뷰가 추가되었습니다.`,
        newCount: newReviews.length,
        totalCount: totalReviews,
      });
    }

    // 리뷰 확인 체크 (우리 리뷰로 마킹)
    if (action === 'confirm') {
      const { reviewIds } = body;
      if (!reviewIds || !Array.isArray(reviewIds) || reviewIds.length === 0) {
        return NextResponse.json({ message: '확인할 리뷰를 선택하세요.' }, { status: 400 });
      }

      await prisma.kakaoMapReview.updateMany({
        where: { id: { in: reviewIds }, productId },
        data: {
          isOurs: true,
          confirmedAt: new Date(),
          confirmedById: auth.userId,
        },
      });

      // exposureCount 업데이트
      const confirmedAfter = await prisma.kakaoMapReview.count({ where: { productId, isOurs: true } });
      await prisma.upsellProduct.update({ where: { id: productId }, data: { exposureCount: confirmedAfter } });

      return NextResponse.json({ message: `${reviewIds.length}건이 확인되었습니다.` });
    }

    // 확인 해제
    if (action === 'unconfirm') {
      const { reviewIds } = body;
      if (!reviewIds || !Array.isArray(reviewIds)) {
        return NextResponse.json({ message: '리뷰 ID가 필요합니다.' }, { status: 400 });
      }

      await prisma.kakaoMapReview.updateMany({
        where: { id: { in: reviewIds }, productId },
        data: { isOurs: false, confirmedAt: null, confirmedById: null },
      });

      // exposureCount 업데이트
      const confirmedAfterUnconfirm = await prisma.kakaoMapReview.count({ where: { productId, isOurs: true } });
      await prisma.upsellProduct.update({ where: { id: productId }, data: { exposureCount: confirmedAfterUnconfirm } });

      return NextResponse.json({ message: `${reviewIds.length}건 확인이 해제되었습니다.` });
    }

    return NextResponse.json({ message: '유효하지 않은 action입니다.' }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('POST /api/upsell/kakaomap/reviews error:', error);
    return NextResponse.json({ message: '리뷰 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

/** 카카오맵 place 페이지에서 리뷰 크롤링 */
async function fetchKakaoMapReviews(placeId: string): Promise<Array<{
  author: string;
  title: string;
  content: string;
  rating: number;
}>> {
  try {
    // 카카오맵 내부 API로 리뷰 조회
    const url = `https://place.map.kakao.com/main/v/${placeId}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/javascript, */*',
        'Referer': `https://place.map.kakao.com/${placeId}`,
      },
    });

    if (!res.ok) return [];

    const data = await res.json();
    const reviews: Array<{ author: string; title: string; content: string; rating: number }> = [];

    // comment.list에서 리뷰 추출
    const commentList = data?.comment?.list || [];
    for (const item of commentList) {
      reviews.push({
        author: item.username || item.nickname || '익명',
        title: '',
        content: item.contents || '',
        rating: item.point || 0,
      });
    }

    // blogReview에서도 추출
    const blogList = data?.blogReview?.list || [];
    for (const item of blogList) {
      reviews.push({
        author: item.blogname || item.username || '블로그',
        title: item.title || '',
        content: item.contents || item.description || '',
        rating: 0,
      });
    }

    return reviews;
  } catch (e) {
    console.error('fetchKakaoMapReviews error:', e);
    return [];
  }
}

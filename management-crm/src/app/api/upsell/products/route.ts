import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireUpsellAuth } from '@/lib/upsell-auth';
import { notifyClients } from '@/lib/ws-notify';

// POST /api/upsell/products — 상품 설정 생성/수정
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);

    const body = await request.json();
    const { assignmentId, ...productData } = body;

    if (!assignmentId) {
      return NextResponse.json({ message: '분배 ID가 필요합니다.' }, { status: 400 });
    }

    // 분배 존재 확인
    const assignment = await prisma.upsellAssignment.findUnique({
      where: { id: assignmentId },
      include: { product: true, company: { select: { companyName: true } } },
    });

    if (!assignment) {
      return NextResponse.json({ message: '분배 정보를 찾을 수 없습니다.' }, { status: 404 });
    }

    // 권한 체크: 사원은 본인 분배건만, 주임/실장/admin은 전체 수정 가능
    if (auth.role === 'upselling_staff' && assignment.assignedToId !== auth.userId) {
      return NextResponse.json({ message: '본인에게 분배된 업체만 수정할 수 있습니다.' }, { status: 403 });
    }

    // 리뷰 개수 자동 조정 로직
    let receiptTarget = productData.receiptReviewTarget;
    let kakaoTarget = productData.kakaoReviewTarget;
    let totalTarget = productData.totalReviewTarget ?? 150;
    const reviewType = productData.reviewType ?? 'both';

    if (reviewType === 'receipt_only') {
      receiptTarget = totalTarget;
      kakaoTarget = 0;
    } else if (reviewType === 'kakao_only') {
      receiptTarget = 0;
      kakaoTarget = totalTarget;
    } else {
      // both: 합계가 총 개수에 맞도록
      if (receiptTarget !== undefined && kakaoTarget === undefined) {
        kakaoTarget = Math.max(0, totalTarget - receiptTarget);
      } else if (kakaoTarget !== undefined && receiptTarget === undefined) {
        receiptTarget = Math.max(0, totalTarget - kakaoTarget);
      } else if (receiptTarget !== undefined && kakaoTarget !== undefined) {
        // 둘 다 제공된 경우 합계로 totalTarget 재계산
        totalTarget = receiptTarget + kakaoTarget;
      } else {
        receiptTarget = Math.floor(totalTarget / 2);
        kakaoTarget = totalTarget - receiptTarget;
      }
    }

    const data = {
      hasPowerlink: productData.hasPowerlink ?? false,
      powerlinkAdId: productData.powerlinkAdId || null,
      powerlinkAdPassword: productData.powerlinkAdPassword || null,
      reviewType,
      receiptReviewTarget: receiptTarget ?? 75,
      kakaoReviewTarget: kakaoTarget ?? 75,
      totalReviewTarget: totalTarget,
      channelType: productData.channelType ?? 'none',
      naverAccount: productData.naverAccount || null,
      upsellAmount: productData.upsellAmount ? parseInt(productData.upsellAmount) : null,
      kakaoMapUrl: productData.kakaoMapUrl || null,
      kakaoMapPlaceId: productData.kakaoMapPlaceId || null,
      kakaoMapName: productData.kakaoMapName || null,
      // 처리 현황
      powerlinkDone: productData.powerlinkDone ?? false,
      channelDone: productData.channelDone ?? false,
      receiptReviewCount: productData.receiptReviewCount ?? 0,
      kakaoReviewCount: productData.kakaoReviewCount ?? 0,
      initialReviewCount: productData.initialReviewCount ?? 0,
      exposureCount: productData.exposureCount ?? 0,
      contractStart: productData.contractStart ? new Date(productData.contractStart) : null,
      contractEnd: productData.contractEnd ? new Date(productData.contractEnd) : null,
    };

    let product;
    if (assignment.product) {
      // 기존 상품 수정 — 변경 로그 기록
      const old = assignment.product;
      const changes: string[] = [];

      if (data.hasPowerlink !== old.hasPowerlink) changes.push(`파워링크: ${old.hasPowerlink ? 'O' : 'X'} → ${data.hasPowerlink ? 'O' : 'X'}`);
      if (data.powerlinkDone !== old.powerlinkDone) changes.push(`파워링크처리: ${old.powerlinkDone ? '완료' : '미완료'} → ${data.powerlinkDone ? '완료' : '미완료'}`);
      if (data.reviewType !== old.reviewType) changes.push(`리뷰타입: ${old.reviewType} → ${data.reviewType}`);
      if (data.totalReviewTarget !== old.totalReviewTarget) changes.push(`리뷰총개수: ${old.totalReviewTarget} → ${data.totalReviewTarget}`);
      if (data.receiptReviewCount !== old.receiptReviewCount) changes.push(`영수증리뷰: ${old.receiptReviewCount} → ${data.receiptReviewCount}`);
      if (data.kakaoReviewCount !== old.kakaoReviewCount) changes.push(`카카오리뷰: ${old.kakaoReviewCount} → ${data.kakaoReviewCount}`);
      if (data.channelType !== old.channelType) changes.push(`채널: ${old.channelType} → ${data.channelType}`);
      if (data.channelDone !== old.channelDone) changes.push(`채널처리: ${old.channelDone ? '완료' : '미완료'} → ${data.channelDone ? '완료' : '미완료'}`);
      if ((data.upsellAmount || 0) !== (old.upsellAmount || 0)) changes.push(`업셀금액: ${old.upsellAmount || 0} → ${data.upsellAmount || 0}`);

      product = await prisma.upsellProduct.update({
        where: { id: old.id },
        data,
      });

      if (changes.length > 0) {
        await prisma.upsellLog.create({
          data: {
            userId: auth.userId,
            companyId: assignment.companyId,
            action: '상품 수정',
            details: `${assignment.company.companyName}: ${changes.join(', ')}`,
          },
        });
      }
    } else {
      // 신규 생성
      product = await prisma.upsellProduct.create({
        data: {
          assignmentId,
          ...data,
        },
      });

      await prisma.upsellLog.create({
        data: {
          userId: auth.userId,
          companyId: assignment.companyId,
          action: '상품 설정',
          details: `${assignment.company.companyName} 상품 초기 설정`,
        },
      });
    }

    notifyClients('product_updated', { companyId: assignment.companyId });

    return NextResponse.json({ product });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('POST /api/upsell/products error:', error);
    return NextResponse.json({ message: '상품 설정 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireUpsellAuth, canViewAllCompanies } from '@/lib/upsell-auth';
import { notifyClients } from '@/lib/ws-notify';

// POST /api/upsell/payment — 결제 상태 업데이트
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);

    // 실장/주임/admin만 결제 관리 가능
    if (!canViewAllCompanies(auth.role)) {
      return NextResponse.json({ message: '결제 관리 권한이 없습니다.' }, { status: 403 });
    }

    const body = await request.json();
    const {
      productId,
      paymentStatus,
      paymentMethod,
      paymentCardType,
      paymentCardCompany,
      paymentCashAmount,
      paymentCardAmount,
      hasTaxInvoice,
      paymentNote,
    } = body;

    if (!productId) {
      return NextResponse.json({ message: '상품 ID가 필요합니다.' }, { status: 400 });
    }

    if (!paymentStatus || !['unpaid', 'paid', 'partial'].includes(paymentStatus)) {
      return NextResponse.json({ message: '유효한 결제 상태가 필요합니다.' }, { status: 400 });
    }

    const product = await prisma.upsellProduct.findUnique({
      where: { id: productId },
      include: {
        assignment: {
          include: { company: { select: { companyName: true } } },
        },
      },
    });

    if (!product) {
      return NextResponse.json({ message: '상품을 찾을 수 없습니다.' }, { status: 404 });
    }

    // 변경 로그 생성
    const changes: string[] = [];
    const statusLabels: Record<string, string> = { unpaid: '미결제', paid: '결제완료', partial: '부분결제' };
    const methodLabels: Record<string, string> = { card: '카드', cash: '현금', mixed: '카드+현금' };
    const cardTypeLabels: Record<string, string> = { new_card: '새카드', existing_card: '이전카드' };

    if (paymentStatus !== product.paymentStatus) {
      changes.push(`결제상태: ${statusLabels[product.paymentStatus] || product.paymentStatus} → ${statusLabels[paymentStatus]}`);
    }
    if (paymentMethod && paymentMethod !== product.paymentMethod) {
      changes.push(`결제수단: ${methodLabels[product.paymentMethod || ''] || '-'} → ${methodLabels[paymentMethod]}`);
    }
    if (hasTaxInvoice !== undefined && hasTaxInvoice !== product.hasTaxInvoice) {
      changes.push(`세금계산서: ${product.hasTaxInvoice ? 'O' : 'X'} → ${hasTaxInvoice ? 'O' : 'X'}`);
    }

    const updateData: Record<string, unknown> = {
      paymentStatus,
      paymentMethod: paymentMethod || null,
      paymentCardType: paymentCardType || null,
      paymentCardCompany: paymentCardCompany || null,
      paymentCashAmount: paymentCashAmount ? parseInt(paymentCashAmount) : null,
      paymentCardAmount: paymentCardAmount ? parseInt(paymentCardAmount) : null,
      hasTaxInvoice: Boolean(hasTaxInvoice),
      paymentNote: paymentNote || null,
    };

    // 결제완료 시 paidAt 설정
    if (paymentStatus === 'paid' && !product.paidAt) {
      updateData.paidAt = new Date();
    } else if (paymentStatus === 'unpaid') {
      updateData.paidAt = null;
    }

    const updated = await prisma.upsellProduct.update({
      where: { id: productId },
      data: updateData,
    });

    if (changes.length > 0) {
      await prisma.upsellLog.create({
        data: {
          userId: auth.userId,
          companyId: product.assignment.companyId,
          action: '결제 관리',
          details: `${product.assignment.company.companyName}: ${changes.join(', ')}`,
        },
      });
    }

    notifyClients('payment_updated', { companyId: product.assignment.companyId });

    return NextResponse.json({ product: updated });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('POST /api/upsell/payment error:', error);
    return NextResponse.json({ message: '결제 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

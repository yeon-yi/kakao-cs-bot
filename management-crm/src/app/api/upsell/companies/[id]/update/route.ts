import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireUpsellAuth } from '@/lib/upsell-auth';
import { notifyClients } from '@/lib/ws-notify';

// POST /api/upsell/companies/[id]/update — 업체 기본정보 수정 (admin + 실장)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);
    requireUpsellAuth(auth);

    // admin 또는 실장만 수정 가능
    if (auth.role !== 'admin' && auth.role !== 'upselling_director') {
      return NextResponse.json({ message: '수정 권한이 없습니다.' }, { status: 403 });
    }

    const { id } = await params;
    const companyId = parseInt(id);
    if (isNaN(companyId)) {
      return NextResponse.json({ message: '유효하지 않은 업체 ID입니다.' }, { status: 400 });
    }

    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      return NextResponse.json({ message: '업체를 찾을 수 없습니다.' }, { status: 404 });
    }

    const body = await request.json();
    const { companyName, representative, phone, staffName, managerName, branch } = body;

    const updateData: Record<string, unknown> = {};
    if (companyName !== undefined) updateData.companyName = companyName;
    if (representative !== undefined) updateData.representative = representative;
    if (phone !== undefined) updateData.phone = phone;
    if (staffName !== undefined) updateData.staffName = staffName;
    if (managerName !== undefined) updateData.managerName = managerName;
    if (branch !== undefined) updateData.branch = branch;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ message: '변경할 항목이 없습니다.' }, { status: 400 });
    }

    // 변경 로그
    const changes: string[] = [];
    if (updateData.staffName && updateData.staffName !== company.staffName) changes.push(`담당자: ${company.staffName} → ${updateData.staffName}`);
    if (updateData.managerName && updateData.managerName !== company.managerName) changes.push(`간부: ${company.managerName} → ${updateData.managerName}`);
    if (updateData.companyName && updateData.companyName !== company.companyName) changes.push(`업체명: ${company.companyName} → ${updateData.companyName}`);
    if (updateData.representative && updateData.representative !== company.representative) changes.push(`대표자: ${company.representative} → ${updateData.representative}`);
    if (updateData.phone && updateData.phone !== company.phone) changes.push(`연락처: ${company.phone} → ${updateData.phone}`);

    const updated = await prisma.company.update({
      where: { id: companyId },
      data: updateData,
    });

    if (changes.length > 0) {
      await prisma.upsellLog.create({
        data: {
          userId: auth.userId,
          companyId,
          action: '업체 정보 수정',
          details: changes.join(', '),
        },
      });
    }

    notifyClients('company_updated', { companyId });

    return NextResponse.json({ company: updated });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }
    console.error('PUT /api/upsell/companies/[id]/update error:', error);
    return NextResponse.json({ message: '업체 수정 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

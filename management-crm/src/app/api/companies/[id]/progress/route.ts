import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { notifyClients } from '@/lib/ws-notify';

// PUT /api/companies/[id]/progress — Update SolutionProgress
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);
    const { id } = await params;
    const companyId = parseInt(id);

    if (isNaN(companyId)) {
      return NextResponse.json({ message: '유효하지 않은 업체 ID입니다.' }, { status: 400 });
    }

    // Verify company exists
    const company = await prisma.company.findUnique({
      where: { id: companyId },
    });

    if (!company) {
      return NextResponse.json({ message: '업체를 찾을 수 없습니다.' }, { status: 404 });
    }

    // Staff can only update their own companies
    if (auth.role === 'staff' && company.staffName !== auth.displayName) {
      return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
    }

    // Manager can only update own branch
    if (auth.role === 'manager' && company.branch !== auth.branch) {
      return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
    }

    // Check that a setting exists (progress requires setting to exist first)
    const existingSetting = await prisma.solutionSetting.findUnique({
      where: { companyId },
    });

    if (!existingSetting) {
      return NextResponse.json(
        { message: '솔루션 설정이 먼저 필요합니다.' },
        { status: 400 },
      );
    }

    // Get existing progress for change logging
    const existing = await prisma.solutionProgress.findUnique({
      where: { companyId },
    });

    const body = await request.json();
    const updateData: Record<string, unknown> = {};

    // Only include fields that are provided in the request body
    if (body.rewardDone !== undefined) updateData.rewardDone = Boolean(body.rewardDone);
    if (body.blogCount !== undefined) updateData.blogCount = parseInt(body.blogCount) || 0;
    if (body.instaCount !== undefined) updateData.instaCount = parseInt(body.instaCount) || 0;
    if (body.homepageDone !== undefined) updateData.homepageDone = Boolean(body.homepageDone);
    if (body.videoDone !== undefined) updateData.videoDone = Boolean(body.videoDone);

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ message: '변경할 항목이 없습니다.' }, { status: 400 });
    }

    const progress = await prisma.solutionProgress.update({
      where: { companyId },
      data: updateData,
    });

    // Log changes
    const logEntries: { fieldName: string; oldValue: string | null; newValue: string | null }[] = [];

    const fields: { key: string; label: string; format: (v: unknown) => string }[] = [
      { key: 'rewardDone', label: '리워드 완료', format: formatBoolean },
      { key: 'blogCount', label: '블로그 수', format: String },
      { key: 'instaCount', label: '인스타 수', format: String },
      { key: 'homepageDone', label: '홈페이지 완료', format: formatBoolean },
      { key: 'videoDone', label: '영상 완료', format: formatBoolean },
    ];

    for (const field of fields) {
      if (updateData[field.key] === undefined) continue;

      const oldVal = existing ? (existing as Record<string, unknown>)[field.key] : null;
      const newVal = updateData[field.key];

      const oldStr = oldVal !== null && oldVal !== undefined ? field.format(oldVal) : null;
      const newStr = newVal !== null && newVal !== undefined ? field.format(newVal) : null;

      if (oldStr !== newStr) {
        logEntries.push({
          fieldName: field.label,
          oldValue: oldStr,
          newValue: newStr,
        });
      }
    }

    if (logEntries.length > 0) {
      await prisma.solutionLog.createMany({
        data: logEntries.map((entry) => ({
          companyId,
          userId: auth.userId,
          fieldName: entry.fieldName,
          oldValue: entry.oldValue,
          newValue: entry.newValue,
        })),
      });
    }

    notifyClients('company_updated', { companyId });

    return NextResponse.json({ progress });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('PUT /api/companies/[id]/progress error:', error);
    return NextResponse.json({ message: '진행상황 저장 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

function formatBoolean(v: unknown): string {
  return v ? 'O' : 'X';
}

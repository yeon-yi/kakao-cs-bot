import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { notifyClients } from '@/lib/ws-notify';

// POST /api/companies/[id]/settings — Create or update SolutionSetting
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = requireAuth(request);

    // Only admin, manager_team, manager can access
    if (!['admin', 'manager_team', 'manager'].includes(auth.role)) {
      return NextResponse.json({ message: '설정 변경 권한이 없습니다.' }, { status: 403 });
    }

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

    // Manager can only update own branch
    if (auth.role === 'manager' && company.branch !== auth.branch) {
      return NextResponse.json({ message: '접근 권한이 없습니다.' }, { status: 403 });
    }

    const body = await request.json();
    const {
      contractStart,
      contractEnd,
      isHolding,
      hasReward,
      blogTarget,
      instaTarget,
      hasHomepage,
      videoType,
    } = body;

    // Get existing setting for change logging
    const existing = await prisma.solutionSetting.findUnique({
      where: { companyId },
    });

    const settingData = {
      contractStart: contractStart ? new Date(contractStart) : null,
      contractEnd: contractEnd ? new Date(contractEnd) : null,
      isHolding: Boolean(isHolding),
      hasReward: Boolean(hasReward),
      blogTarget: parseInt(blogTarget) || 0,
      instaTarget: parseInt(instaTarget) || 0,
      hasHomepage: Boolean(hasHomepage),
      videoType: videoType || 'none',
      setById: auth.userId,
    };

    // Upsert setting
    const setting = await prisma.solutionSetting.upsert({
      where: { companyId },
      create: {
        companyId,
        ...settingData,
      },
      update: settingData,
    });

    // Log changes (compare old vs new, only log changed fields)
    const logEntries: { fieldName: string; oldValue: string | null; newValue: string | null }[] = [];

    const fields: { key: string; label: string; format?: (v: unknown) => string }[] = [
      { key: 'contractStart', label: '계약시작일', format: formatDate },
      { key: 'contractEnd', label: '계약종료일', format: formatDate },
      { key: 'isHolding', label: '홀딩', format: formatBoolean },
      { key: 'hasReward', label: '리워드', format: formatBoolean },
      { key: 'blogTarget', label: '블로그 목표', format: String },
      { key: 'instaTarget', label: '인스타 목표', format: String },
      { key: 'hasHomepage', label: '홈페이지', format: formatBoolean },
      { key: 'videoType', label: '영상타입', format: formatVideoType },
    ];

    for (const field of fields) {
      const oldVal = existing ? (existing as Record<string, unknown>)[field.key] : undefined;
      const newVal = (settingData as Record<string, unknown>)[field.key];

      const oldStr = oldVal !== undefined && oldVal !== null ? (field.format ? field.format(oldVal) : String(oldVal)) : null;
      const newStr = newVal !== undefined && newVal !== null ? (field.format ? field.format(newVal) : String(newVal)) : null;

      if (oldStr !== newStr) {
        logEntries.push({
          fieldName: field.label,
          oldValue: existing ? oldStr : null,
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

    // Create or update SolutionProgress with defaults if new
    await prisma.solutionProgress.upsert({
      where: { companyId },
      create: {
        companyId,
        rewardDone: false,
        blogCount: 0,
        instaCount: 0,
        homepageDone: false,
        videoDone: false,
      },
      update: {}, // No changes on update, keep existing progress
    });

    notifyClients('company_updated', { companyId });

    return NextResponse.json({ setting });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('POST /api/companies/[id]/settings error:', error);
    return NextResponse.json({ message: '설정 저장 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

function formatDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().split('T')[0];
  if (typeof v === 'string') return new Date(v).toISOString().split('T')[0];
  return String(v);
}

function formatBoolean(v: unknown): string {
  return v ? 'O' : 'X';
}

function formatVideoType(v: unknown): string {
  const map: Record<string, string> = { none: '없음', premium: '프리미엄', short: '숏폼' };
  return map[String(v)] ?? String(v);
}

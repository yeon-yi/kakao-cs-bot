import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const ALLOWED_ROLES = ['admin', 'manager_team', 'branch_manager', 'manager', 'upselling_director', 'upselling_chief'];

// GET /api/reports/performance?team=sales|upsell&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);

    if (!ALLOWED_ROLES.includes(auth.role)) {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }

    const { searchParams } = request.nextUrl;
    const team = searchParams.get('team') || 'sales';

    // Default to current month
    const now = new Date();
    const defaultStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const defaultEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    const startDate = searchParams.get('startDate')
      ? new Date(searchParams.get('startDate')!)
      : defaultStart;
    const endDate = searchParams.get('endDate')
      ? (() => { const d = new Date(searchParams.get('endDate')!); d.setHours(23, 59, 59, 999); return d; })()
      : defaultEnd;

    if (team === 'management') {
      if (auth.role !== 'admin' && auth.role !== 'manager_team') {
        return NextResponse.json({ message: '관리팀 리포트 접근 권한이 없습니다.' }, { status: 403 });
      }
      return await getManagementPerformance(startDate, endDate);
    }
    if (team === 'upsell') {
      return await getUpsellPerformance(auth, startDate, endDate);
    }
    return await getSalesPerformance(auth, startDate, endDate);
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('GET /api/reports/performance error:', error);
    return NextResponse.json({ message: '성과 리포트 조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

async function getSalesPerformance(auth: { role: string; branch: string; displayName: string }, startDate: Date, endDate: Date) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = { paymentDate: { gte: startDate, lte: endDate } };
  // 역할별 범위 제한
  if (auth.role === 'manager') {
    if (auth.branch) where.branch = auth.branch;
    where.managerName = auth.displayName;
  } else if (auth.role !== 'admin' && auth.role !== 'manager_team' && auth.branch) {
    where.branch = auth.branch;
  }

  const companies = await prisma.company.findMany({
    where,
    include: {
      setting: true,
      progress: true,
    },
  });

  // Group by staffName
  const staffMap = new Map<string, {
    total: number;
    completed: number;
    revenue: number;
    holdingCount: number;
  }>();

  for (const c of companies) {
    const name = c.staffName || '미지정';
    if (!staffMap.has(name)) {
      staffMap.set(name, { total: 0, completed: 0, revenue: 0, holdingCount: 0 });
    }
    const entry = staffMap.get(name)!;
    entry.total += 1;
    entry.revenue += c.paymentAmount || 0;

    if (c.setting?.isHolding) {
      entry.holdingCount += 1;
    }

    // Check if all 5 solution items are completed
    if (c.setting && c.progress) {
      const allDone = isAllDone(c.setting, c.progress);
      if (allDone) entry.completed += 1;
    }
  }

  const rows = Array.from(staffMap.entries())
    .map(([name, data]) => ({
      name,
      total: data.total,
      completed: data.completed,
      completionRate: data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0,
      revenue: data.revenue,
      holdingCount: data.holdingCount,
    }))
    .sort((a, b) => b.total - a.total);

  const summary = {
    total: rows.reduce((s, r) => s + r.total, 0),
    completed: rows.reduce((s, r) => s + r.completed, 0),
    completionRate: 0,
    revenue: rows.reduce((s, r) => s + r.revenue, 0),
    holdingCount: rows.reduce((s, r) => s + r.holdingCount, 0),
  };
  summary.completionRate = summary.total > 0 ? Math.round((summary.completed / summary.total) * 100) : 0;

  return NextResponse.json({ team: 'sales', rows, summary });
}

async function getUpsellPerformance(auth: { role: string; userId: number }, startDate: Date, endDate: Date) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: Record<string, any> = { assignedAt: { gte: startDate, lte: endDate }, isExcluded: false };
  // 사원/주임은 본인 분배건만
  if (auth.role === 'upselling_chief' || auth.role === 'upselling_staff') {
    where.assignedToId = auth.userId;
  }

  const assignments = await prisma.upsellAssignment.findMany({
    where,
    include: {
      assignedTo: { select: { displayName: true, role: true } },
      product: true,
    },
  });

  // Group by assignedTo
  const userMap = new Map<string, {
    role: string;
    assignCount: number;
    paidCount: number;
    revenue: number;
    reviewDone: number;
  }>();

  for (const a of assignments) {
    const name = a.assignedTo.displayName;
    const role = a.assignedTo.role;
    if (!userMap.has(name)) {
      userMap.set(name, { role, assignCount: 0, paidCount: 0, revenue: 0, reviewDone: 0 });
    }
    const entry = userMap.get(name)!;
    entry.assignCount += 1;

    if (a.product) {
      if (a.product.paymentStatus === 'paid') {
        entry.paidCount += 1;
        entry.revenue += a.product.upsellAmount || 0;
      }

      // Check if review targets are met
      const receiptMet = a.product.receiptReviewCount >= a.product.receiptReviewTarget;
      const kakaoMet = a.product.kakaoReviewCount >= a.product.kakaoReviewTarget;

      if (a.product.reviewType === 'receipt_only' && receiptMet) {
        entry.reviewDone += 1;
      } else if (a.product.reviewType === 'kakao_only' && kakaoMet) {
        entry.reviewDone += 1;
      } else if (a.product.reviewType === 'both' && receiptMet && kakaoMet) {
        entry.reviewDone += 1;
      }
    }
  }

  const rows = Array.from(userMap.entries())
    .map(([name, data]) => ({
      name,
      role: data.role,
      assignCount: data.assignCount,
      paidCount: data.paidCount,
      revenue: data.revenue,
      reviewDone: data.reviewDone,
    }))
    .sort((a, b) => b.assignCount - a.assignCount);

  const summary = {
    assignCount: rows.reduce((s, r) => s + r.assignCount, 0),
    paidCount: rows.reduce((s, r) => s + r.paidCount, 0),
    revenue: rows.reduce((s, r) => s + r.revenue, 0),
    reviewDone: rows.reduce((s, r) => s + r.reviewDone, 0),
  };

  return NextResponse.json({ team: 'upsell', rows, summary });
}

async function getManagementPerformance(startDate: Date, endDate: Date) {
  const bulkLogs = await prisma.solutionBulkLog.findMany({
    where: {
      createdAt: { gte: startDate, lte: endDate },
    },
    include: {
      user: {
        select: {
          displayName: true,
          role: true,
          mgmtPosition: true,
          responsibilities: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Group by user displayName
  const userMap = new Map<string, {
    displayName: string;
    role: string;
    mgmtPosition: string | null;
    responsibilities: string | null;
    totalRegistered: number;
    successCount: number;
    failCount: number;
    lastRegisteredAt: Date | null;
  }>();

  for (const log of bulkLogs) {
    const name = log.user.displayName;
    if (!userMap.has(name)) {
      userMap.set(name, {
        displayName: name,
        role: log.user.role,
        mgmtPosition: log.user.mgmtPosition,
        responsibilities: log.user.responsibilities,
        totalRegistered: 0,
        successCount: 0,
        failCount: 0,
        lastRegisteredAt: null,
      });
    }
    const entry = userMap.get(name)!;
    entry.totalRegistered += log.totalCount;
    entry.successCount += log.successCount;
    entry.failCount += log.failCount;
    if (!entry.lastRegisteredAt || log.createdAt > entry.lastRegisteredAt) {
      entry.lastRegisteredAt = log.createdAt;
    }
  }

  const rows = Array.from(userMap.values())
    .map((entry) => ({
      displayName: entry.displayName,
      role: entry.role,
      mgmtPosition: entry.mgmtPosition,
      responsibilities: entry.responsibilities,
      totalRegistered: entry.totalRegistered,
      successCount: entry.successCount,
      failCount: entry.failCount,
      lastRegisteredAt: entry.lastRegisteredAt?.toISOString() || null,
    }))
    .sort((a, b) => b.totalRegistered - a.totalRegistered);

  const summary = {
    totalRegistered: rows.reduce((s, r) => s + r.totalRegistered, 0),
    successCount: rows.reduce((s, r) => s + r.successCount, 0),
    failCount: rows.reduce((s, r) => s + r.failCount, 0),
  };

  return NextResponse.json({ team: 'management', rows, summary });
}

/** Check if all applicable solution items are done */
function isAllDone(
  setting: { hasReward: boolean; blogTarget: number; instaTarget: number; hasHomepage: boolean; videoType: string },
  progress: { rewardDone: boolean; blogCount: number; instaCount: number; homepageDone: boolean; videoDone: boolean },
): boolean {
  if (setting.hasReward && !progress.rewardDone) return false;
  if (setting.blogTarget > 0 && progress.blogCount < setting.blogTarget) return false;
  if (setting.instaTarget > 0 && progress.instaCount < setting.instaTarget) return false;
  if (setting.hasHomepage && !progress.homepageDone) return false;
  if (setting.videoType !== 'none' && !progress.videoDone) return false;
  return true;
}

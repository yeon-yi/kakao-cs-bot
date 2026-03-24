import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// ── GET /api/solutions/bulk ─────────────────────────────────────────
// action=history  → paginated bulk operation history
// action=preview  → current progress values for given companies
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (!['admin', 'manager_team'].includes(auth.role)) {
      return NextResponse.json({ message: '관리팀 권한이 필요합니다.' }, { status: 403 });
    }

    const action = request.nextUrl.searchParams.get('action') || 'preview';

    // ── History ──────────────────────────────────────────────────
    if (action === 'history') {
      const page = Math.max(1, Number(request.nextUrl.searchParams.get('page')) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get('pageSize')) || 20));
      const skip = (page - 1) * pageSize;

      const [logs, total] = await Promise.all([
        prisma.solutionBulkLog.findMany({
          skip,
          take: pageSize,
          orderBy: { createdAt: 'desc' },
          include: {
            user: { select: { id: true, displayName: true } },
          },
        }),
        prisma.solutionBulkLog.count(),
      ]);

      return NextResponse.json({
        logs: logs.map((l) => ({
          id: l.id,
          userId: l.userId,
          user: { displayName: l.user.displayName },
          type: l.type,
          totalCount: l.totalCount,
          successCount: l.successCount,
          failCount: l.failCount,
          details: l.details,
          createdAt: l.createdAt.toISOString(),
          rolledBack: l.rolledBack,
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      });
    }

    // ── Preview ──────────────────────────────────────────────────
    const names = request.nextUrl.searchParams.get('companyNames')?.split(',').filter(Boolean) || [];
    if (names.length === 0) {
      return NextResponse.json({ previews: [] });
    }

    const companies = await prisma.company.findMany({
      where: { companyName: { in: names } },
      select: {
        id: true,
        companyName: true,
        representative: true,
        progress: {
          select: {
            blogCount: true,
            instaCount: true,
            homepageDone: true,
            videoDone: true,
          },
        },
      },
    });

    return NextResponse.json({
      previews: companies.map((c) => ({
        companyName: c.companyName,
        representative: c.representative,
        blogCount: c.progress?.blogCount ?? 0,
        instaCount: c.progress?.instaCount ?? 0,
        homepageDone: c.progress?.homepageDone ?? false,
        videoDone: c.progress?.videoDone ?? false,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('GET /api/solutions/bulk error:', error);
    return NextResponse.json({ message: '조회 실패' }, { status: 500 });
  }
}

// ── POST /api/solutions/bulk — Additive bulk update ─────────────────
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (!['admin', 'manager_team'].includes(auth.role)) {
      return NextResponse.json({ message: '관리팀 권한이 필요합니다.' }, { status: 403 });
    }

    const { items, type } = await request.json();
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ message: '데이터가 없습니다.' }, { status: 400 });
    }
    if (items.length > 500) {
      return NextResponse.json({ message: '한 번에 최대 500건까지 처리 가능합니다.' }, { status: 400 });
    }

    const bulkType = type || 'all';

    interface DetailItem {
      companyName: string;
      companyId: number | null;
      blogCount?: number | null;
      instaCount?: number | null;
      homepageDone?: boolean | null;
      videoDone?: boolean | null;
      status: 'success' | 'fail';
      reason?: string;
    }

    const results: Array<{ companyName: string; status: 'success' | 'fail'; reason?: string }> = [];
    const details: DetailItem[] = [];
    let successCount = 0;
    let failCount = 0;

    for (const item of items) {
      const { companyName, representative, placeId, blogCount, instaCount, homepageDone, videoDone } = item;

      if (!companyName?.trim() && !placeId?.trim()) {
        const detail: DetailItem = { companyName: companyName || '(빈값)', companyId: null, status: 'fail', reason: '업체명 또는 고유번호가 필요합니다' };
        details.push(detail);
        results.push({ companyName: companyName || '(빈값)', status: 'fail', reason: '업체명 또는 고유번호가 필요합니다' });
        failCount++;
        continue;
      }

      // Find company — placeId 우선, 없으면 업체명+대표자
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: Record<string, any> = {};
      if (placeId?.trim()) {
        where.placeId = placeId.trim();
      } else {
        where.companyName = companyName.trim();
        if (representative?.trim()) where.representative = representative.trim();
      }

      const companies = await prisma.company.findMany({
        where,
        select: { id: true, companyName: true },
        take: 10,
        orderBy: { id: 'asc' },
      });
      // 설정이 있는 업체를 우선 선택 (동일 이름 중복 시)
      if (companies.length > 1) {
        const withSetting = await prisma.solutionSetting.findMany({
          where: { companyId: { in: companies.map(c => c.id) } },
          select: { companyId: true },
        });
        const settingIds = new Set(withSetting.map(s => s.companyId));
        const preferred = companies.filter(c => settingIds.has(c.id));
        if (preferred.length > 0) {
          companies.length = 0;
          companies.push(...preferred);
        }
      }

      if (companies.length === 0) {
        const detail: DetailItem = { companyName, companyId: null, status: 'fail', reason: '업체를 찾을 수 없습니다' };
        details.push(detail);
        results.push({ companyName, status: 'fail', reason: '업체를 찾을 수 없습니다' });
        failCount++;
        continue;
      }

      if (companies.length > 1 && !representative?.trim()) {
        const reason = `동일 업체명 ${companies.length}건 — 대표자를 입력해주세요`;
        const detail: DetailItem = { companyName, companyId: null, status: 'fail', reason };
        details.push(detail);
        results.push({ companyName, status: 'fail', reason });
        failCount++;
        continue;
      }

      const companyId = companies[0].id;

      // Check setting exists
      const setting = await prisma.solutionSetting.findUnique({ where: { companyId } });
      if (!setting) {
        const detail: DetailItem = { companyName, companyId, status: 'fail', reason: '솔루션 설정이 없습니다' };
        details.push(detail);
        results.push({ companyName, status: 'fail', reason: '솔루션 설정이 없습니다' });
        failCount++;
        continue;
      }

      // Build ADDITIVE update data
      const incrementData: Record<string, { increment: number }> = {};
      const setData: Record<string, boolean> = {};

      if (blogCount !== undefined && blogCount !== null && Number(blogCount) > 0) {
        incrementData.blogCount = { increment: Number(blogCount) };
      }
      if (instaCount !== undefined && instaCount !== null && Number(instaCount) > 0) {
        incrementData.instaCount = { increment: Number(instaCount) };
      }
      if (homepageDone !== undefined && homepageDone !== null) {
        setData.homepageDone = !!homepageDone;
      }
      if (videoDone !== undefined && videoDone !== null) {
        setData.videoDone = !!videoDone;
      }

      // Upsert progress with additive increments
      await prisma.solutionProgress.upsert({
        where: { companyId },
        create: {
          companyId,
          rewardDone: false,
          blogCount: Number(blogCount) || 0,
          instaCount: Number(instaCount) || 0,
          homepageDone: !!homepageDone,
          videoDone: !!videoDone,
        },
        update: { ...incrementData, ...setData },
      });

      const detail: DetailItem = {
        companyName,
        companyId,
        blogCount: (blogCount !== undefined && blogCount !== null && Number(blogCount) > 0) ? Number(blogCount) : null,
        instaCount: (instaCount !== undefined && instaCount !== null && Number(instaCount) > 0) ? Number(instaCount) : null,
        homepageDone: (homepageDone !== undefined && homepageDone !== null) ? !!homepageDone : null,
        videoDone: (videoDone !== undefined && videoDone !== null) ? !!videoDone : null,
        status: 'success',
      };
      details.push(detail);
      results.push({ companyName, status: 'success' });
      successCount++;
    }

    // Save bulk log
    const log = await prisma.solutionBulkLog.create({
      data: {
        userId: auth.userId,
        type: bulkType,
        totalCount: items.length,
        successCount,
        failCount,
        details: JSON.stringify(details),
      },
    });

    return NextResponse.json({ results, successCount, failCount, logId: log.id });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('POST /api/solutions/bulk error:', error);
    return NextResponse.json({ message: '일괄 등록 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// ── PUT /api/solutions/bulk — Rollback a bulk operation ─────────────
export async function PUT(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (!['admin', 'manager_team'].includes(auth.role)) {
      return NextResponse.json({ message: '관리팀 권한이 필요합니다.' }, { status: 403 });
    }

    const { logId } = await request.json();
    if (!logId) {
      return NextResponse.json({ message: 'logId가 필요합니다.' }, { status: 400 });
    }

    const log = await prisma.solutionBulkLog.findUnique({ where: { id: Number(logId) } });
    if (!log) {
      return NextResponse.json({ message: '해당 이력을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (log.rolledBack) {
      return NextResponse.json({ message: '이미 롤백된 이력입니다.' }, { status: 400 });
    }

    interface DetailItem {
      companyName: string;
      companyId: number | null;
      blogCount?: number | null;
      instaCount?: number | null;
      homepageDone?: boolean | null;
      videoDone?: boolean | null;
      status: string;
      reason?: string;
    }

    let details: DetailItem[];
    try {
      details = JSON.parse(log.details);
    } catch {
      return NextResponse.json({ message: '이력 상세 데이터를 파싱할 수 없습니다.' }, { status: 500 });
    }
    const successItems = details.filter((d) => d.status === 'success' && d.companyId);

    let rollbackSuccess = 0;
    let rollbackFail = 0;
    const rollbackResults: Array<{ companyName: string; status: 'success' | 'fail'; reason?: string }> = [];

    for (const item of successItems) {
      try {
        const progress = await prisma.solutionProgress.findUnique({ where: { companyId: item.companyId! } });
        if (!progress) {
          rollbackResults.push({ companyName: item.companyName, status: 'fail', reason: '진행 데이터를 찾을 수 없습니다' });
          rollbackFail++;
          continue;
        }

        const blogDec = Math.min(item.blogCount ? Number(item.blogCount) : 0, progress.blogCount);
        const instaDec = Math.min(item.instaCount ? Number(item.instaCount) : 0, progress.instaCount);

        // Note: boolean fields (homepageDone, videoDone) cannot be meaningfully rolled back
        // since we don't track the previous value. Only numeric increments are reversed.

        if (blogDec > 0 || instaDec > 0) {
          await prisma.solutionProgress.update({
            where: { companyId: item.companyId! },
            data: {
              ...(blogDec > 0 ? { blogCount: { decrement: blogDec } } : {}),
              ...(instaDec > 0 ? { instaCount: { decrement: instaDec } } : {}),
            },
          });
        }

        rollbackResults.push({ companyName: item.companyName, status: 'success', reason: '롤백 완료' });
        rollbackSuccess++;
      } catch (err) {
        console.error(`Rollback failed for ${item.companyName}:`, err);
        rollbackResults.push({ companyName: item.companyName, status: 'fail', reason: '롤백 중 오류 발생' });
        rollbackFail++;
      }
    }

    // Mark log as rolled back only if ALL items succeeded
    if (rollbackFail === 0) {
      await prisma.solutionBulkLog.update({
        where: { id: Number(logId) },
        data: { rolledBack: true },
      });
    }

    return NextResponse.json({
      results: rollbackResults,
      successCount: rollbackSuccess,
      failCount: rollbackFail,
      logId: Number(logId),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('PUT /api/solutions/bulk error:', error);
    return NextResponse.json({ message: '롤백 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// ── PATCH /api/solutions/bulk — Edit a single item from a bulk log ──
export async function PATCH(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (!['admin', 'manager_team'].includes(auth.role)) {
      return NextResponse.json({ message: '관리팀 권한이 필요합니다.' }, { status: 403 });
    }

    const { logId, companyName, field, oldValue, newValue } = await request.json();
    if (!logId || !companyName || !field) {
      return NextResponse.json({ message: 'logId, companyName, field가 필요합니다.' }, { status: 400 });
    }

    if (!['blogCount', 'instaCount'].includes(field)) {
      return NextResponse.json({ message: '수정 가능한 필드: blogCount, instaCount' }, { status: 400 });
    }

    const log = await prisma.solutionBulkLog.findUnique({ where: { id: Number(logId) } });
    if (!log) {
      return NextResponse.json({ message: '해당 이력을 찾을 수 없습니다.' }, { status: 404 });
    }
    if (log.rolledBack) {
      return NextResponse.json({ message: '롤백된 이력은 수정할 수 없습니다.' }, { status: 400 });
    }

    interface DetailItem {
      companyName: string;
      companyId: number | null;
      blogCount?: number | null;
      instaCount?: number | null;
      homepageDone?: boolean | null;
      videoDone?: boolean | null;
      status: string;
      reason?: string;
    }

    let details: DetailItem[];
    try {
      details = JSON.parse(log.details);
    } catch {
      return NextResponse.json({ message: '이력 상세 데이터를 파싱할 수 없습니다.' }, { status: 500 });
    }
    const itemIndex = details.findIndex(
      (d) => d.companyName === companyName && d.status === 'success' && d.companyId,
    );

    if (itemIndex === -1) {
      return NextResponse.json({ message: '해당 항목을 찾을 수 없습니다.' }, { status: 404 });
    }

    const item = details[itemIndex];
    const diff = Number(newValue) - Number(oldValue);

    if (diff === 0) {
      return NextResponse.json({ message: '변경 사항이 없습니다.' }, { status: 400 });
    }

    // Prevent the progress value from going below 0
    const progress = await prisma.solutionProgress.findUnique({ where: { companyId: item.companyId! } });
    if (!progress) {
      return NextResponse.json({ message: '진행 데이터를 찾을 수 없습니다.' }, { status: 404 });
    }

    const currentVal = (progress as Record<string, unknown>)[field] as number ?? 0;
    const resultVal = currentVal + diff;
    if (resultVal < 0) {
      return NextResponse.json({ message: `${field} 값이 0 미만이 될 수 없습니다. (현재: ${currentVal}, 변경량: ${diff})` }, { status: 400 });
    }

    // Apply difference to the actual progress
    const updateData: Record<string, { increment: number }> = {};
    updateData[field] = { increment: diff };

    await prisma.solutionProgress.update({
      where: { companyId: item.companyId! },
      data: updateData,
    });

    // Update the log details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (details[itemIndex] as any)[field] = Number(newValue);

    await prisma.solutionBulkLog.update({
      where: { id: Number(logId) },
      data: { details: JSON.stringify(details) },
    });

    return NextResponse.json({
      message: '수정 완료',
      companyName,
      field,
      oldValue: Number(oldValue),
      newValue: Number(newValue),
      diff,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('PATCH /api/solutions/bulk error:', error);
    return NextResponse.json({ message: '수정 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import * as XLSX from 'xlsx';

/** Excel 날짜 시리얼 넘버를 YYYY-MM-DD 문자열로 변환 */
function parseExcelDate(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  const raw = String(cell).trim();
  // 이미 YYYY-MM-DD 형식이면 그대로 반환
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) return raw;
  // YYYY/MM/DD 또는 YYYY.MM.DD
  if (/^\d{4}[/.]\d{1,2}[/.]\d{1,2}$/.test(raw)) return raw.replace(/[/.]/g, '-');
  // Excel 시리얼 넘버 (숫자, 보통 40000~50000 범위)
  const num = Number(raw);
  if (!isNaN(num) && num > 30000 && num < 60000) {
    // Excel epoch: 1899-12-30
    const d = new Date(Date.UTC(1899, 11, 30 + Math.round(num)));
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return raw;
}

/** Excel 셀에서 placeId 추출 (숫자 과학적 표기법, 소수점 등 처리) */
function parsePlaceId(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  const raw = String(cell).trim();
  // 이미 숫자문자열이면 그대로 반환 (정밀도 손실 방지)
  if (/^\d+$/.test(raw)) return raw;
  // 과학적 표기법 등 → 안전한 범위에서만 변환
  const num = Number(raw);
  if (!isNaN(num) && isFinite(num) && num > 0 && Number.isSafeInteger(Math.round(num))) {
    return Math.round(num).toString();
  }
  return raw;
}
import {
  registerKeyword,
  registerReport,
  searchKeywords,
  checkReport,
  fetchReportStats,
  deleteKeyword,
  findRowIds,
  registerPost,
  getReportFormData,
  updateReportFields,
  uploadImage,
  isPostAlreadyRegistered,
} from '@/lib/homejeonsan';
import { updateIsCompleted, updateStep } from '@/lib/solution-utils';

/**
 * 홈전산 등록 성공 시 SolutionProgress 자동 반영
 * placeId로 Company를 찾아서 progress를 upsert
 */
async function syncProgress(
  placeId: string,
  update: { instaIncrement?: number; blogIncrement?: number; homepageDone?: boolean; videoDone?: boolean; seoDone?: boolean },
) {
  try {
    const company = await prisma.company.findFirst({
      where: { placeId },
      select: { id: true, setting: { select: { id: true } } },
      orderBy: { paymentDate: 'desc' }, // 동일 placeId 중 최신 업체
    });
    if (!company?.setting) return; // 설정 없으면 무시

    const cid = company.id;
    const blogInc = update.blogIncrement || 0;
    const instaInc = update.instaIncrement || 0;
    const hpDone = update.homepageDone || false;
    const vidDone = update.videoDone || false;
    const seoDn = update.seoDone || false;

    // 원자적 upsert (레이스컨디션 방지)
    await prisma.$executeRaw`
      INSERT INTO solution_progress (company_id, blog_count, insta_count, homepage_done, video_done, seo_done, reward_done, is_completed, updated_at)
      VALUES (${cid}, ${blogInc}, ${instaInc}, ${hpDone}, ${vidDone}, ${seoDn}, false, false, NOW())
      ON CONFLICT (company_id) DO UPDATE SET
        blog_count = solution_progress.blog_count + ${blogInc},
        insta_count = solution_progress.insta_count + ${instaInc},
        homepage_done = solution_progress.homepage_done OR ${hpDone},
        video_done = solution_progress.video_done OR ${vidDone},
        seo_done = solution_progress.seo_done OR ${seoDn},
        updated_at = NOW()
    `;
    await updateIsCompleted(cid);
  } catch (e) {
    // 진행 현황 동기화 실패해도 본 작업은 성공 처리
    console.error(`syncProgress failed for placeId=${placeId}:`, e);
  }
}

// GET /api/homejeonsan — search_place, logs
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    const { searchParams } = request.nextUrl;
    const action = searchParams.get('action') || '';

    if (action === 'debug_form') {
      const { debugKeywordFormFields } = await import('@/lib/homejeonsan');
      const result = await debugKeywordFormFields();
      return NextResponse.json(result);
    }

    if (action === 'search_place') {
      const placeNumber = searchParams.get('placeNumber')?.trim() || '';
      if (!placeNumber) return NextResponse.json({ error: '검색어를 입력해주세요.' }, { status: 400 });

      // 숫자만으로 구성 → 플레이스번호, 그 외 → 상호명 검색
      const isPlaceId = /^\d+$/.test(placeNumber);
      const searchType = isPlaceId ? 'place_number' as const : 'business_name' as const;

      const kwResult = await searchKeywords(placeNumber, searchType);

      // 상호명 검색 시 리포트 체크는 플레이스번호일 때만
      let reportExists = false;
      let reportContract: string | null = null;
      if (isPlaceId) {
        const rpResult = await checkReport(placeNumber);
        reportExists = rpResult.exists;
        reportContract = rpResult.contractPeriod || null;
      }

      // 외부(모집플레이스)가 진실의 원천 — 로컬 로그 fallback 제거
      // (리포트를 수동 삭제한 경우 과거 로그가 남아있어도 exists=true로 오판하던 버그 방지)

      return NextResponse.json({
        keywordCount: kwResult.total,
        keywords: kwResult.keywords,
        reportExists,
        reportContract,
      });
    }

    if (action === 'report_stats') {
      const placeNumber = searchParams.get('placeNumber')?.trim() || '';
      if (!placeNumber) return NextResponse.json({ error: '플레이스번호를 입력해주세요.' }, { status: 400 });

      const stats = await fetchReportStats(placeNumber);
      // 외부(모집플레이스)가 진실의 원천 — 로컬 로그 fallback 제거
      return NextResponse.json(stats);
    }

    // 리포트 폼 데이터 조회 (홈페이지/영상/SEO 조회용)
    if (action === 'report_form_data') {
      const placeNumber = searchParams.get('placeNumber')?.trim() || '';
      if (!placeNumber) return NextResponse.json({ error: '플레이스번호를 입력해주세요.' }, { status: 400 });

      const { data, error } = await getReportFormData(placeNumber);
      if (!data) return NextResponse.json({ error: error || '조회 실패' }, { status: 404 });

      return NextResponse.json({
        reportId: data.reportId,
        placeNumber: data.placeNumber,
        homepageUrl: data.homepageUrl,
        promotionUrl: data.promotionUrl,
        befLeftFileUrl: data.befLeftFileUrl,
        befRightFileUrl: data.befRightFileUrl,
        aftLeftFileUrl: data.aftLeftFileUrl,
        aftRightFileUrl: data.aftRightFileUrl,
      });
    }

    // 게시물(블로그/인스타) 링크 조회
    if (action === 'fetch_posts') {
      const placeNumber = searchParams.get('placeNumber')?.trim() || '';
      if (!placeNumber) return NextResponse.json({ error: '플레이스번호를 입력해주세요.' }, { status: 400 });

      const stats = await fetchReportStats(placeNumber);
      if (!stats.exists) return NextResponse.json({ error: '리포트가 존재하지 않습니다.' }, { status: 404 });

      return NextResponse.json({
        blogCount: stats.blogCount,
        instaCount: stats.instaCount,
        lastBlogDate: stats.lastBlogDate,
        lastInstaDate: stats.lastInstaDate,
        posts: stats.posts,
      });
    }

    if (action === 'logs') {
      const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
      const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get('pageSize') || '20', 10)));
      const startDate = searchParams.get('startDate') || '';
      const endDate = searchParams.get('endDate') || '';
      const actorName = searchParams.get('actorName') || '';
      const branch = searchParams.get('branch') || '';
      const statusFilter = searchParams.get('status') || '';

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: Record<string, any> = {};
      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate);
        if (endDate) { const end = new Date(endDate); end.setHours(23, 59, 59, 999); where.createdAt.lte = end; }
      }
      if (actorName) where.actorName = { contains: actorName, mode: 'insensitive' };
      if (branch) where.actorBranch = branch;
      if (statusFilter === 'success') where.status = 'success';
      else if (statusFilter === 'failed') where.status = { not: 'success' };

      // 팀 필터 (management = 관리팀 등록, sales = 영업자 등록)
      const teamFilter = searchParams.get('team') || '';
      if (teamFilter === 'management') {
        // 관리팀: actorId가 admin 또는 manager_team인 유저
        const mgmtUsers = await prisma.user.findMany({
          where: { role: { in: ['admin', 'manager_team'] } },
          select: { id: true },
        });
        where.actorId = { in: mgmtUsers.map(u => u.id) };
      } else if (teamFilter === 'sales') {
        // 영업자: 관리팀이 아닌 유저
        const mgmtUsers = await prisma.user.findMany({
          where: { role: { in: ['admin', 'manager_team'] } },
          select: { id: true },
        });
        where.actorId = { notIn: mgmtUsers.map(u => u.id) };
      }

      const typeFilter = searchParams.get('type') || '';
      if (typeFilter) {
        const actionMap: Record<string, string[]> = {
          keyword: ['register'],
          report: ['register_report'],
          blog: ['register_blog'],
          insta: ['register_insta'],
          homepage: ['update_homepage'],
          video: ['update_video'],
          seo: ['update_seo'],
        };
        if (actionMap[typeFilter]) where.action = { in: actionMap[typeFilter] };
      }

      const [logs, total, successCount, failCount, warningCount] = await Promise.all([
        prisma.homejeonsanLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.homejeonsanLog.count({ where }),
        prisma.homejeonsanLog.count({ where: { ...where, status: 'success', errorMessage: null } }),
        prisma.homejeonsanLog.count({ where: { ...where, status: { not: 'success' } } }),
        prisma.homejeonsanLog.count({ where: { ...where, status: 'success', errorMessage: { not: null } } }),
      ]);

      return NextResponse.json({
        total,
        successCount,
        failCount,
        warningCount,
        page,
        pageSize,
        logs: logs.map((l) => ({
          id: l.id,
          status: l.status === 'success' ? 'success' : 'fail',
          createdAt: l.createdAt?.toISOString() || '',
          companyName: l.businessName || '',
          keyword: l.keyword || '',
          placeId: l.placeId || '',
          message: '',
          errorMessage: l.errorMessage || '',
          actorName: l.actorName || '',
          actorBranch: l.actorBranch || '',
          type: (() => {
            switch (l.action) {
              case 'register_report': return 'report';
              case 'register_blog': return 'blog';
              case 'register_insta': return 'insta';
              case 'update_homepage': return 'homepage';
              case 'update_video': return 'video';
              case 'update_seo': return 'seo';
              default: return 'keyword';
            }
          })(),
        })),
      });
    }

    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('GET /api/homejeonsan error:', error);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

// POST /api/homejeonsan — register, register_report, delete_keyword
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);

    // 홈전산 등록: 영업팀(staff, manager, branch_manager) + 관리팀 + 관리자
    if (!['admin', 'manager_team', 'branch_manager', 'manager', 'staff', 'renewal_director', 'renewal_chief', 'renewal_staff'].includes(auth.role)) {
      return NextResponse.json({ message: '권한이 없습니다.' }, { status: 403 });
    }

    const contentType = request.headers.get('content-type') || '';

    // Handle FormData (bulk) — 일괄 작업은 관리팀/관리자만
    if (contentType.includes('multipart/form-data')) {
      if (!['admin', 'manager_team'].includes(auth.role)) {
        return NextResponse.json({ message: '일괄 등록은 관리팀 권한이 필요합니다.' }, { status: 403 });
      }
      const formData = await request.formData();
      const action = formData.get('action') as string;

      if (action === 'bulk_register') {
        // 키워드 일괄 등록 (스트리밍): 헤더 기반 컬럼 매핑
        const file = formData.get('file') as File;
        if (!file) return NextResponse.json({ error: '파일을 선택해주세요.' }, { status: 400 });

        const buffer = Buffer.from(await file.arrayBuffer());
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        if (rows.length < 2) return NextResponse.json({ error: '데이터가 없습니다.' }, { status: 400 });

        // 헤더 기반 컬럼 매핑 (컬럼 순서에 무관하게 동작)
        const HEADER_MAP: Record<string, string> = {
          '상호명': 'businessName', '업체명': 'businessName', '상호': 'businessName',
          '키워드': 'keyword',
          '고유번호': 'placeId', '플레이스번호': 'placeId', '플레이스 번호': 'placeId',
          '카테고리': 'category',
          '영업자': 'staffName', '담당자': 'staffName', '영업담당자': 'staffName',
          '정상/선광고': 'adType', '선광고or정상': 'adType', '광고유형': 'adType', '선광고/정상': 'adType',
        };
        const headerRow = rows[0].map(h => h?.toString().trim());
        const colMap: Record<string, number> = {};
        for (let i = 0; i < headerRow.length; i++) {
          const field = HEADER_MAP[headerRow[i]];
          if (field && !(field in colMap)) colMap[field] = i;
        }
        // 필수 헤더 없으면 위치 기반 폴백
        if (!('businessName' in colMap) || !('keyword' in colMap) || !('placeId' in colMap)) {
          colMap.businessName = 0;
          colMap.keyword = 1;
          colMap.placeId = 2;
          colMap.category = 3;
          colMap.staffName = 4;
          colMap.adType = 5;
        }

        const dataRows = rows.slice(1).filter(r => r[colMap.businessName ?? 0]?.toString().trim());
        if (dataRows.length === 0) return NextResponse.json({ error: '유효한 데이터가 없습니다.' }, { status: 400 });
        if (dataRows.length > 1000) return NextResponse.json({ error: '한 번에 최대 1000건까지 처리 가능합니다.' }, { status: 400 });

        // 총 키워드 수 미리 계산
        const kwIdx = colMap.keyword ?? 1;
        let totalKeywords = 0;
        for (const row of dataRows) {
          const keyword = row[kwIdx]?.toString().trim();
          if (keyword) {
            totalKeywords += keyword.split(',').map((k: string) => k.trim()).filter(Boolean).length;
          } else {
            totalKeywords++;
          }
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          async start(controller) {
            const send = (data: Record<string, unknown>) => {
              controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
            };

            let successCount = 0;
            let failCount = 0;
            let skipCount = 0;
            let processed = 0;
            const deletedKeys = new Set<string>();

            send({ type: 'start', total: totalKeywords });

            for (const row of dataRows) {
              const businessName = row[colMap.businessName ?? 0]?.toString().trim();
              const keyword = row[colMap.keyword ?? 1]?.toString().trim();
              const placeId = row[colMap.placeId ?? 2]?.toString().trim();
              const category = (colMap.category != null ? row[colMap.category]?.toString().trim() : '') || '기타';
              const staffName = (colMap.staffName != null ? row[colMap.staffName]?.toString().trim() : '') || auth.displayName;
              const adType = (colMap.adType != null ? row[colMap.adType]?.toString().trim() : '') || '정상';

              if (!businessName || !keyword || !placeId) {
                processed++;
                failCount++;
                send({ type: 'progress', processed, total: totalKeywords, businessName: businessName || '(빈값)', keyword: keyword || '', success: false, message: '필수값 누락' });
                await prisma.homejeonsanLog.create({
                  data: {
                    action: 'register', placeId: placeId || null, businessName: businessName || '(빈값)',
                    keyword: keyword || null, category: null, staffName: null,
                    status: 'failed', errorMessage: '필수값 누락 (상호명/키워드/고유번호)',
                    actorId: auth.userId, actorName: auth.displayName, actorBranch: auth.branch || null,
                  },
                }).catch(() => {});
                continue;
              }

              const keywords = keyword.split(',').map((k: string) => k.trim()).filter(Boolean);
              for (const kw of keywords) {
                const dupKey = `${placeId}::${kw}`;

                if (!deletedKeys.has(dupKey)) {
                  deletedKeys.add(dupKey);
                  const rowIds = await findRowIds(placeId, kw);
                  if (rowIds.length > 0) {
                    console.log(`[bulk-register] Deleting duplicate keyword "${kw}" for ${placeId} (${rowIds.length}건)`);
                    for (const rowId of rowIds) {
                      await deleteKeyword(rowId);
                      await new Promise(r => setTimeout(r, 150));
                    }
                    skipCount += rowIds.length;
                  }
                }

                await new Promise(r => setTimeout(r, 200));

                let result = await registerKeyword({ businessName, placeId, keyword: kw, category, staffName, adType });

                if (!result.success && (result.message?.includes('오류발생') || result.message?.includes('Internal Server Error'))) {
                  await new Promise(r => setTimeout(r, 1000));
                  result = await registerKeyword({ businessName, placeId, keyword: kw, category, staffName, adType });
                }

                processed++;
                if (result.success) {
                  successCount++;
                } else {
                  failCount++;
                }

                send({ type: 'progress', processed, total: totalKeywords, businessName, keyword: kw, success: result.success, message: result.message });

                await prisma.homejeonsanLog.create({
                  data: {
                    action: 'register',
                    placeId, businessName, keyword: kw, category, staffName,
                    status: result.success ? 'success' : 'failed',
                    errorMessage: result.success ? null : result.message,
                    actorId: auth.userId, actorName: auth.displayName, actorBranch: auth.branch || null,
                  },
                });
              }
            }

            const parts = [`${successCount}건 등록`];
            if (skipCount > 0) parts.push(`중복 ${skipCount}건 삭제 후 재등록`);
            if (failCount > 0) parts.push(`${failCount}건 실패`);

            send({
              type: 'done',
              success: successCount > 0,
              message: `${dataRows.length}건 중 ${parts.join(', ')}`,
              count: successCount,
              failCount,
              skipCount,
            });

            controller.close();
          },
        });

        return new Response(stream, {
          headers: {
            'Content-Type': 'application/x-ndjson',
            'Transfer-Encoding': 'chunked',
            'Cache-Control': 'no-cache',
          },
        });
      }

      if (action === 'bulk_register_report') {
        // 리포트 일괄 등록: 플레이스번호, 연락처1, 연락처2, 계약시작일, 개월수
        const file = formData.get('file') as File;
        if (!file) return NextResponse.json({ error: '파일을 선택해주세요.' }, { status: 400 });

        const buffer = Buffer.from(await file.arrayBuffer());
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        if (rows.length < 2) return NextResponse.json({ error: '데이터가 없습니다.' }, { status: 400 });

        const dataRows = rows.slice(1).filter(r => r[0]?.toString().trim());
        if (dataRows.length === 0) return NextResponse.json({ error: '유효한 데이터가 없습니다.' }, { status: 400 });
        if (dataRows.length > 1000) return NextResponse.json({ error: '한 번에 최대 1000건까지 처리 가능합니다.' }, { status: 400 });

        let successCount = 0;
        let failCount = 0;
        let skipCount = 0;
        const results: Array<{ placeId: string; success: boolean; message: string; skipped?: boolean }> = [];

        for (const row of dataRows) {
          const placeId = parsePlaceId(row[0]);
          const phone1 = row[1]?.toString().trim();
          const phone2 = row[2]?.toString().trim() || '';
          const contractStart = parseExcelDate(row[3]);
          const months = parseInt(row[4]?.toString().trim()) || 6;

          if (!placeId || !phone1 || !contractStart) {
            results.push({ placeId: placeId || '(빈값)', success: false, message: '필수값 누락' });
            failCount++;
            continue;
          }

          // 중복 체크: 리포트 이미 존재하는지 확인
          const existing = await checkReport(placeId);
          if (existing.exists) {
            results.push({ placeId, success: true, message: `이미 등록됨 (${existing.contractPeriod || '기간 정보 없음'}) — 건너뜀`, skipped: true });
            skipCount++;
            continue;
          }

          // 외부 API 과부하 방지: 요청 간 딜레이
          await new Promise(r => setTimeout(r, 300));

          let result = await registerReport({ placeId, phone1, phone2, contractStart, months });

          // Internal Server Error 시 1회 재시도 (1초 대기)
          if (!result.success && (result.message?.includes('Internal Server Error') || result.message?.includes('오류발생'))) {
            await new Promise(r => setTimeout(r, 1000));
            result = await registerReport({ placeId, phone1, phone2, contractStart, months });
          }

          results.push({ placeId, success: result.success, message: result.message });

          await prisma.homejeonsanLog.create({
            data: {
              action: 'register_report', placeId,
              businessName: null, keyword: null, category: null, staffName: null,
              status: result.success ? 'success' : 'failed',
              errorMessage: result.success ? null : result.message,
              actorId: auth.userId, actorName: auth.displayName, actorBranch: auth.branch || null,
            },
          });

          if (result.success) {
            successCount++;
            // 리포트 등록 성공 시 placeId-Company 연동 확인용 (progress 필드 없으나 향후 확장 대비)
          } else { failCount++; }
        }

        const parts = [`${successCount}건 등록`];
        if (skipCount > 0) parts.push(`${skipCount}건 이미 등록 (건너뜀)`);
        if (failCount > 0) parts.push(`${failCount}건 실패`);

        return NextResponse.json({
          success: successCount > 0 || skipCount > 0,
          message: `${dataRows.length}건 중 ${parts.join(', ')}`,
          count: successCount,
          skipCount,
          results,
        });
      }

      // -- 인스타 일괄 등록 (엑셀: 고유번호, 업체명, 인스타링크) --
      if (action === 'bulk_register_insta') {
        const file = formData.get('file') as File;
        if (!file) return NextResponse.json({ error: '파일을 선택해주세요.' }, { status: 400 });

        const buffer = Buffer.from(await file.arrayBuffer());
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        if (rows.length < 2) return NextResponse.json({ error: '데이터가 없습니다.' }, { status: 400 });
        const allDataRows = rows.slice(1).filter(r => r.some(cell => cell?.toString().trim()));
        if (allDataRows.length === 0) return NextResponse.json({ error: '유효한 데이터가 없습니다.' }, { status: 400 });
        if (allDataRows.length > 1000) return NextResponse.json({ error: '한 번에 최대 1000건까지 처리 가능합니다.' }, { status: 400 });

        let successCount = 0;
        let failCount = 0;
        const results: Array<{ placeId: string; companyName: string; link: string; success: boolean; message: string }> = [];

        for (const row of allDataRows) {
          const placeId = parsePlaceId(row[0]);
          const companyName = row[1]?.toString().trim() || '';
          const link = row[2]?.toString().trim();

          if (!placeId || !link) {
            const reason = !placeId ? '고유번호 누락' : '링크 누락';
            results.push({ placeId: placeId || '(빈값)', companyName, link: link || '', success: false, message: reason });
            failCount++;
            continue;
          }

          await new Promise(r => setTimeout(r, 300));

          // 중복 등록 방지: 이미 같은 링크가 등록돼 있으면 skip (success로 처리하되 증분 카운트 X)
          const alreadyExists = await isPostAlreadyRegistered(placeId, link);
          if (alreadyExists) {
            results.push({ placeId, companyName, link, success: true, message: '이미 등록됨 (중복 스킵)' });
            await prisma.homejeonsanLog.create({
              data: {
                action: 'register_insta', placeId, businessName: companyName || null, keyword: link,
                category: null, staffName: null,
                status: 'success',
                errorMessage: '이미 등록됨 (중복 스킵)',
                actorId: auth.userId, actorName: auth.displayName, actorBranch: auth.branch || null,
              },
            });
            successCount++;
            continue;
          }

          let result = await registerPost({ placeNumber: placeId, type: '2', title: companyName || link, link });
          if (!result.success && (result.message?.includes('Internal Server Error') || result.message?.includes('오류발생'))) {
            await new Promise(r => setTimeout(r, 1000));
            result = await registerPost({ placeNumber: placeId, type: '2', title: companyName || link, link });
          }
          results.push({ placeId, companyName, link, success: result.success, message: result.message });

          await prisma.homejeonsanLog.create({
            data: {
              action: 'register_insta', placeId, businessName: companyName || null, keyword: link,
              category: null, staffName: null,
              status: result.success ? 'success' : 'failed',
              errorMessage: result.success ? null : result.message,
              actorId: auth.userId, actorName: auth.displayName, actorBranch: auth.branch || null,
            },
          });

          if (result.success) {
            successCount++;
            await syncProgress(placeId, { instaIncrement: 1 });
          } else { failCount++; }
        }

        const failDetails = results.filter(r => !r.success).map(r => `${r.companyName || r.placeId}: ${r.message}`);
        const failSummary = failDetails.length > 0 ? `\n실패 사유: ${failDetails.join(', ')}` : '';
        return NextResponse.json({ success: successCount > 0, message: `${allDataRows.length}건 중 ${successCount}건 성공, ${failCount}건 실패${failSummary}`, count: successCount, results });
      }

      // -- 블로그(체험단) 일괄 등록 (엑셀: 고유번호, 업체명, 블로그링크) --
      if (action === 'bulk_register_blog') {
        const file = formData.get('file') as File;
        if (!file) return NextResponse.json({ error: '파일을 선택해주세요.' }, { status: 400 });

        const buffer = Buffer.from(await file.arrayBuffer());
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        if (rows.length < 2) return NextResponse.json({ error: '데이터가 없습니다.' }, { status: 400 });
        const allDataRows = rows.slice(1).filter(r => r.some(cell => cell?.toString().trim()));
        if (allDataRows.length === 0) return NextResponse.json({ error: '유효한 데이터가 없습니다.' }, { status: 400 });
        if (allDataRows.length > 1000) return NextResponse.json({ error: '한 번에 최대 1000건까지 처리 가능합니다.' }, { status: 400 });

        let successCount = 0;
        let failCount = 0;
        const results: Array<{ placeId: string; companyName: string; link: string; success: boolean; message: string }> = [];

        for (const row of allDataRows) {
          const placeId = parsePlaceId(row[0]);
          const companyName = row[1]?.toString().trim() || '';
          const link = row[2]?.toString().trim();

          if (!placeId || !link) {
            const reason = !placeId ? '고유번호 누락' : '링크 누락';
            results.push({ placeId: placeId || '(빈값)', companyName, link: link || '', success: false, message: reason });
            failCount++;
            continue;
          }

          await new Promise(r => setTimeout(r, 300));

          // 중복 등록 방지
          const alreadyExists = await isPostAlreadyRegistered(placeId, link);
          if (alreadyExists) {
            results.push({ placeId, companyName, link, success: true, message: '이미 등록됨 (중복 스킵)' });
            await prisma.homejeonsanLog.create({
              data: {
                action: 'register_blog', placeId, businessName: companyName || null, keyword: link,
                category: null, staffName: null,
                status: 'success',
                errorMessage: '이미 등록됨 (중복 스킵)',
                actorId: auth.userId, actorName: auth.displayName, actorBranch: auth.branch || null,
              },
            });
            successCount++;
            continue;
          }

          let result = await registerPost({ placeNumber: placeId, type: '1', title: companyName || link, link });
          if (!result.success && (result.message?.includes('Internal Server Error') || result.message?.includes('오류발생'))) {
            await new Promise(r => setTimeout(r, 1000));
            result = await registerPost({ placeNumber: placeId, type: '1', title: companyName || link, link });
          }
          results.push({ placeId, companyName, link, success: result.success, message: result.message });

          await prisma.homejeonsanLog.create({
            data: {
              action: 'register_blog', placeId, businessName: companyName || null, keyword: link,
              category: null, staffName: null,
              status: result.success ? 'success' : 'failed',
              errorMessage: result.success ? null : result.message,
              actorId: auth.userId, actorName: auth.displayName, actorBranch: auth.branch || null,
            },
          });

          if (result.success) {
            successCount++;
            await syncProgress(placeId, { blogIncrement: 1 });
          } else { failCount++; }
        }

        const failDetails = results.filter(r => !r.success).map(r => `${r.companyName || r.placeId}: ${r.message}`);
        const failSummary = failDetails.length > 0 ? `\n실패 사유: ${failDetails.join(', ')}` : '';
        return NextResponse.json({ success: successCount > 0, message: `${allDataRows.length}건 중 ${successCount}건 성공, ${failCount}건 실패${failSummary}`, count: successCount, results });
      }

      // -- 홈페이지/영상 일괄 수정 (엑셀: 고유번호, 업체명, URL) --
      if (action === 'bulk_update_homepage' || action === 'bulk_update_video') {
        const file = formData.get('file') as File;
        if (!file) return NextResponse.json({ error: '파일을 선택해주세요.' }, { status: 400 });

        const isHomepage = action === 'bulk_update_homepage';
        const fieldName = isHomepage ? 'homepageUrl' : 'promotionUrl';
        const logAction = isHomepage ? 'update_homepage' : 'update_video';

        const buffer = Buffer.from(await file.arrayBuffer());
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        if (rows.length < 2) return NextResponse.json({ error: '데이터가 없습니다.' }, { status: 400 });
        const allDataRows = rows.slice(1).filter(r => r.some(cell => cell?.toString().trim()));
        if (allDataRows.length === 0) return NextResponse.json({ error: '유효한 데이터가 없습니다.' }, { status: 400 });
        if (allDataRows.length > 1000) return NextResponse.json({ error: '한 번에 최대 1000건까지 처리 가능합니다.' }, { status: 400 });

        let successCount = 0;
        let failCount = 0;
        const results: Array<{ placeId: string; companyName: string; url: string; success: boolean; message: string }> = [];

        for (const row of allDataRows) {
          const placeId = parsePlaceId(row[0]);
          const companyName = row[1]?.toString().trim() || '';
          const url = row[2]?.toString().trim();

          if (!placeId || !url) {
            const reason = !placeId ? '고유번호 누락' : 'URL 누락';
            results.push({ placeId: placeId || '(빈값)', companyName, url: url || '', success: false, message: reason });
            failCount++;
            continue;
          }

          await new Promise(r => setTimeout(r, 300));
          let result = await updateReportFields(placeId, { [fieldName]: url });
          if (!result.success && (result.message?.includes('Internal Server Error') || result.message?.includes('오류발생'))) {
            await new Promise(r => setTimeout(r, 1000));
            result = await updateReportFields(placeId, { [fieldName]: url });
          }
          results.push({ placeId, companyName, url, success: result.success, message: result.message });

          await prisma.homejeonsanLog.create({
            data: {
              action: logAction, placeId, businessName: companyName || null, keyword: url,
              category: null, staffName: null,
              status: result.success ? 'success' : 'failed',
              errorMessage: result.success ? null : result.message,
              actorId: auth.userId, actorName: auth.displayName, actorBranch: auth.branch || null,
            },
          });

          if (result.success) {
            successCount++;
            await syncProgress(placeId, isHomepage ? { homepageDone: true } : { videoDone: true });
          } else { failCount++; }
        }

        const failDetails = results.filter(r => !r.success).map(r => `${r.companyName || r.placeId}: ${r.message}`);
        const failSummary = failDetails.length > 0 ? `\n실패 사유: ${failDetails.join(', ')}` : '';
        return NextResponse.json({ success: successCount > 0, message: `${allDataRows.length}건 중 ${successCount}건 성공, ${failCount}건 실패${failSummary}`, count: successCount, results });
      }

      // -- SEO 이미지 업로드 (단일 이미지 → CloudFront URL 반환) --
      if (action === 'upload_seo_image') {
        const file = formData.get('file') as File;
        const imageType = formData.get('imageType') as string; // befLeft, befRight, aftLeft, aftRight
        const seoPlaceId = formData.get('placeId') as string || '';
        if (!file || !imageType) return NextResponse.json({ error: '파일과 이미지 타입을 지정해주세요.' }, { status: 400 });

        const typeMap: Record<string, string> = {
          befLeft: 'place_bef_left_seo_전',
          befRight: 'place_bef_right_seo_전전',
          aftLeft: 'place_aft_left_seo_후',
          aftRight: 'place_aft_right_seo_후후',
        };
        const prefix = typeMap[imageType];
        if (!prefix) return NextResponse.json({ error: '잘못된 이미지 타입입니다.' }, { status: 400 });

        const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
        const allowedExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
        if (!allowedExts.includes(ext)) {
          return NextResponse.json({ error: '이미지 파일만 업로드 가능합니다 (jpg, png, gif, webp)' }, { status: 400 });
        }
        const newFileName = `${prefix}_${seoPlaceId}${ext}`;

        const buffer = Buffer.from(await file.arrayBuffer());
        const result = await uploadImage(buffer, newFileName, 'SEO');

        if (result.success) {
          return NextResponse.json({ success: true, fileUrl: result.fileUrl });
        }
        return NextResponse.json({ success: false, error: result.error || '업로드 실패' }, { status: 400 });
      }

      // -- 서버 스크린샷 → CloudFront 업로드 (캡쳐한 이미지를 SEO용으로 업로드) --
      if (action === 'upload_server_screenshot') {
        const placeId = formData.get('placeId') as string;
        const ssType = formData.get('ssType') as string; // 전, 전전, 후, 후후
        const imageType = formData.get('imageType') as string; // befLeft, befRight, aftLeft, aftRight
        if (!placeId || !ssType || !imageType) {
          return NextResponse.json({ error: 'placeId, ssType, imageType 필요' }, { status: 400 });
        }
        const CRAWLER_URL = process.env.CRAWLER_SCREENSHOT_URL || 'http://crawler:4000';
        const crawlerApiKey = process.env.CRAWLER_API_KEY || '';
        const imgUrl = `${CRAWLER_URL}/screenshot/image?placeId=${encodeURIComponent(placeId)}&type=${encodeURIComponent(ssType)}`;
        console.log(`[upload_server_screenshot] Fetching: ${imgUrl}`);
        const imgRes = await fetch(imgUrl, { headers: crawlerApiKey ? { 'X-API-Key': crawlerApiKey } : {} });
        if (!imgRes.ok) {
          console.error(`[upload_server_screenshot] Image fetch failed: ${imgRes.status}`);
          return NextResponse.json({ error: `스크린샷을 찾을 수 없습니다. (${imgRes.status})` }, { status: 404 });
        }
        let buffer = Buffer.from(await imgRes.arrayBuffer());
        console.log(`[upload_server_screenshot] Image size: ${buffer.length} bytes`);
        if (buffer.length < 100) {
          return NextResponse.json({ error: '스크린샷 파일이 비어있습니다.' }, { status: 400 });
        }
        // 500KB 초과 시 JPEG로 변환하여 크기 축소 (sharp 미사용 — canvas 대안)
        // 서버에서 sharp 없으므로 원본 크기 그대로 업로드 시도, 실패 시 작은 버전 시도
        const typeMap: Record<string, string> = { befLeft: 'place_bef_left_seo_전', befRight: 'place_bef_right_seo_전전', aftLeft: 'place_aft_left_seo_후', aftRight: 'place_aft_right_seo_후후' };
        const prefix = `${typeMap[imageType] || imageType}_${placeId}`;
        let ext = 'png';
        // 1MB 초과 시 크롤러의 리사이즈 API 사용
        if (buffer.length > 1024 * 1024) {
          try {
            const resizeRes = await fetch(`${CRAWLER_URL}/screenshot/resize?placeId=${encodeURIComponent(placeId)}&type=${encodeURIComponent(ssType)}&maxWidth=800&quality=80`, { headers: crawlerApiKey ? { 'X-API-Key': crawlerApiKey } : {} });
            if (resizeRes.ok) {
              const resized = Buffer.from(await resizeRes.arrayBuffer());
              if (resized.length > 100 && resized.length < buffer.length) {
                console.log(`[upload_server_screenshot] Resized: ${buffer.length} → ${resized.length} bytes`);
                buffer = resized;
                ext = 'jpg';
              }
            }
          } catch { /* fallback to original */ }
        }
        console.log(`[upload_server_screenshot] Uploading ${buffer.length} bytes as ${ext}...`);
        const result = await uploadImage(buffer, `${prefix}.${ext}`, 'SEO');
        console.log(`[upload_server_screenshot] Upload result:`, result.success, result.error || '', result.fileUrl || '');
        if (result.success) return NextResponse.json({ success: true, fileUrl: result.fileUrl });
        return NextResponse.json({ success: false, error: `업로드 실패: ${result.error || '알 수 없는 오류'}` }, { status: 400 });
      }

      // -- SEO 일괄 등록 (엑셀: 고유번호, 업체명, 전_URL, 전전_URL, 후_URL, 후후_URL) --
      if (action === 'bulk_update_seo') {
        const file = formData.get('file') as File;
        if (!file) return NextResponse.json({ error: '파일을 선택해주세요.' }, { status: 400 });

        const buffer = Buffer.from(await file.arrayBuffer());
        const wb = XLSX.read(buffer, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        if (rows.length < 2) return NextResponse.json({ error: '데이터가 없습니다.' }, { status: 400 });
        const dataRows = rows.slice(1).filter(r => r[0]?.toString().trim());
        if (dataRows.length === 0) return NextResponse.json({ error: '유효한 데이터가 없습니다.' }, { status: 400 });
        if (dataRows.length > 1000) return NextResponse.json({ error: '한 번에 최대 1000건까지 처리 가능합니다.' }, { status: 400 });

        let successCount = 0;
        let failCount = 0;
        const results: Array<{ placeId: string; companyName: string; success: boolean; message: string }> = [];

        for (const row of dataRows) {
          const placeId = parsePlaceId(row[0]);
          const companyName = row[1]?.toString().trim() || '';
          const befLeft = row[2]?.toString().trim() || '';
          const befRight = row[3]?.toString().trim() || '';
          const aftLeft = row[4]?.toString().trim() || '';
          const aftRight = row[5]?.toString().trim() || '';

          if (!placeId) {
            results.push({ placeId: '(빈값)', companyName, success: false, message: '필수값 누락' });
            failCount++;
            continue;
          }

          const fields: Record<string, string> = {};
          if (befLeft) fields.befLeftFileUrl = befLeft;
          if (befRight) fields.befRightFileUrl = befRight;
          if (aftLeft) fields.aftLeftFileUrl = aftLeft;
          if (aftRight) fields.aftRightFileUrl = aftRight;

          if (Object.keys(fields).length === 0) {
            results.push({ placeId, companyName, success: false, message: 'URL이 없습니다' });
            failCount++;
            continue;
          }

          await new Promise(r => setTimeout(r, 300));
          let result = await updateReportFields(placeId, fields);
          if (!result.success && (result.message?.includes('Internal Server Error') || result.message?.includes('오류발생'))) {
            await new Promise(r => setTimeout(r, 1000));
            result = await updateReportFields(placeId, fields);
          }
          results.push({ placeId, companyName, success: result.success, message: result.message });

          await prisma.homejeonsanLog.create({
            data: {
              action: 'update_seo', placeId, businessName: companyName || null,
              keyword: Object.values(fields).filter(Boolean).join(', ').substring(0, 255),
              category: null, staffName: null,
              status: result.success ? 'success' : 'failed',
              errorMessage: result.success ? null : result.message,
              actorId: auth.userId, actorName: auth.displayName, actorBranch: auth.branch || null,
            },
          });

          if (result.success) {
            successCount++;
            await syncProgress(placeId, { seoDone: true });
          } else { failCount++; }
        }

        return NextResponse.json({ success: successCount > 0, message: `${dataRows.length}건 중 ${successCount}건 성공, ${failCount}건 실패`, count: successCount, results });
      }

      return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
    }

    // Handle JSON
    const body = await request.json();
    const { action } = body;

    if (action === 'register') {
      const businessName = body.companyName || body.businessName;
      const { keyword, placeId, category, salesperson, staffName: bodyStaffName, adType } = body;
      if (!businessName || !keyword || !placeId) {
        return NextResponse.json({ error: '상호명, 키워드, 플레이스번호를 모두 입력해주세요.' }, { status: 400 });
      }

      // Split comma-separated keywords
      const keywords = keyword.split(',').map((k: string) => k.trim()).filter(Boolean);
      const results: Array<{ keyword: string; success: boolean; message: string }> = [];
      let successCount = 0;

      // 기존 키워드 조회 (중복 방지)
      let existingKeywords = new Set<string>();
      try {
        const existing = await searchKeywords(placeId);
        existingKeywords = new Set(existing.keywords.map((k: { keyword: string }) => k.keyword));
      } catch { /* 조회 실패 시 중복 체크 없이 진행 */ }

      for (const kw of keywords) {
        if (existingKeywords.has(kw)) {
          results.push({ keyword: kw, success: true, message: '이미 등록된 키워드 (건너뜀)' });
          continue;
        }

        let result = await registerKeyword({
          businessName,
          placeId,
          keyword: kw,
          category: category || '기타',
          staffName: bodyStaffName || salesperson || auth.displayName,
          adType: adType || '정상',
        });

        // 외부 API 일시적 오류 시 1회 재시도
        if (!result.success && result.message?.includes('오류발생')) {
          await new Promise(r => setTimeout(r, 500));
          result = await registerKeyword({ businessName, placeId, keyword: kw, category: category || '기타', staffName: bodyStaffName || salesperson || auth.displayName, adType: adType || '정상' });
        }

        results.push({ keyword: kw, success: result.success, message: result.message });

        // Log
        await prisma.homejeonsanLog.create({
          data: {
            action: 'register',
            placeId,
            businessName,
            keyword: kw,
            category: category || '기타',
            staffName: bodyStaffName || salesperson || auth.displayName,
            status: result.success ? 'success' : 'failed',
            errorMessage: result.success ? null : result.message,
            actorId: auth.userId,
            actorName: auth.displayName,
            actorBranch: auth.branch || null,
          },
        });

        if (result.success) successCount++;
      }

      // step 갱신 (placeId → company)
      if (successCount > 0) {
        const comp = await prisma.company.findFirst({ where: { placeId }, select: { id: true } });
        if (comp) await updateStep(comp.id).catch(() => {});
      }

      if (successCount === keywords.length) {
        return NextResponse.json({ success: true, message: `${successCount}건 등록 완료`, results });
      }
      return NextResponse.json({ success: successCount > 0, message: `${keywords.length}건 중 ${successCount}건 성공`, results });
    }

    if (action === 'register_report') {
      const { placeId, phone1, contact1, contractStart, months } = body;
      const phone = phone1 || contact1;
      if (!placeId || !phone || !contractStart || !months) {
        return NextResponse.json({ error: '필수 항목을 모두 입력해주세요.' }, { status: 400 });
      }

      const result = await registerReport({
        placeId,
        phone1: phone,
        phone2: body.phone2 || body.contact2 || '',
        contractStart,
        months: parseInt(String(months)) || 6,
      });

      await prisma.homejeonsanLog.create({
        data: {
          action: 'register_report',
          placeId,
          businessName: null,
          keyword: null,
          category: null,
          staffName: null,
          status: result.success ? 'success' : 'failed',
          errorMessage: result.success ? null : result.message,
          actorId: auth.userId,
          actorName: auth.displayName,
          actorBranch: auth.branch || null,
        },
      });

      if (result.success) {
        // step 갱신 (placeId → company)
        const comp = await prisma.company.findFirst({ where: { placeId }, select: { id: true } });
        if (comp) await updateStep(comp.id).catch(() => {});

        // 리포트 등록 성공 → 플레이스 스크린샷 자동 캡처 (백그라운드)
        const crawlerUrl = process.env.CRAWLER_API_URL || 'http://crawler:4000';
        const crawlerKey = process.env.CRAWLER_API_KEY || '';
        fetch(`${crawlerUrl}/screenshot?placeId=${encodeURIComponent(placeId)}`, { headers: crawlerKey ? { 'X-API-Key': crawlerKey } : {} })
          .then(r => r.ok ? r.json() : null)
          .then(d => { if (d?.success) console.log(`[auto-screenshot] ${placeId}: captured`); })
          .catch(() => { /* 캡처 실패해도 무시 */ });
        return NextResponse.json({ success: true, message: result.message });
      }
      return NextResponse.json({ success: false, error: result.message }, { status: 400 });
    }

    if (action === 'delete_keyword') {
      const { placeId, keyword: kwToDelete, keywords: kwsToDelete } = body;
      if (!placeId) {
        return NextResponse.json({ error: '플레이스번호가 필요합니다.' }, { status: 400 });
      }

      // 일괄 삭제: keywords 배열이 있으면 각각 삭제
      const targetKeywords: string[] = kwsToDelete?.length ? kwsToDelete : kwToDelete ? [kwToDelete] : [];

      if (targetKeywords.length === 0) {
        return NextResponse.json({ error: '삭제할 키워드를 지정해주세요.' }, { status: 400 });
      }

      let deleted = 0;
      let lastError = '';

      for (const kw of targetKeywords) {
        const rowIds = await findRowIds(placeId, kw);
        if (rowIds.length === 0) continue;
        // 단건 삭제: 정확히 1건만 삭제
        const result = await deleteKeyword(rowIds[0]);
        if (result.success) {
          deleted++;
        } else {
          lastError = result.message;
        }
        if (targetKeywords.length > 1) await new Promise(r => setTimeout(r, 300));
      }

      // Log
      await prisma.homejeonsanLog.create({
        data: {
          action: 'delete_keyword',
          placeId,
          businessName: null,
          keyword: targetKeywords.join(', '),
          category: null,
          staffName: null,
          status: deleted > 0 ? 'success' : 'failed',
          errorMessage: deleted > 0 ? null : lastError,
          actorId: auth.userId,
          actorName: auth.displayName,
          actorBranch: auth.branch || null,
        },
      });

      if (deleted > 0) {
        return NextResponse.json({ success: true, message: `${deleted}건 삭제 완료` });
      }
      return NextResponse.json({ success: false, error: lastError || '삭제 실패' }, { status: 400 });
    }

    // -- 인스타 단건 등록 --
    if (action === 'register_insta') {
      const { placeId, link, title, postDate } = body;
      if (!placeId || !link) {
        return NextResponse.json({ error: '플레이스번호와 인스타 링크를 입력해주세요.' }, { status: 400 });
      }

      const result = await registerPost({
        placeNumber: placeId,
        type: '2',
        title: title || link,
        link,
        postDate,
      });

      await prisma.homejeonsanLog.create({
        data: {
          action: 'register_insta',
          placeId,
          businessName: body.companyName || null,
          keyword: link,
          category: null,
          staffName: null,
          status: result.success ? 'success' : 'failed',
          errorMessage: result.success ? null : result.message,
          actorId: auth.userId,
          actorName: auth.displayName,
          actorBranch: auth.branch || null,
        },
      });

      if (result.success) {
        await syncProgress(placeId, { instaIncrement: 1 });
        return NextResponse.json({ success: true, message: result.message });
      }
      return NextResponse.json({ success: false, error: result.message }, { status: 400 });
    }

    // -- 블로그(체험단/기자단) 단건 등록 --
    if (action === 'register_blog') {
      const { placeId, link, title, postDate } = body;
      if (!placeId || !link) {
        return NextResponse.json({ error: '플레이스번호와 블로그 링크를 입력해주세요.' }, { status: 400 });
      }

      const result = await registerPost({
        placeNumber: placeId,
        type: '1', // 블로그체험단
        title: title || link,
        link,
        postDate,
      });

      await prisma.homejeonsanLog.create({
        data: {
          action: 'register_blog',
          placeId,
          businessName: body.companyName || null,
          keyword: link,
          category: null,
          staffName: null,
          status: result.success ? 'success' : 'failed',
          errorMessage: result.success ? null : result.message,
          actorId: auth.userId,
          actorName: auth.displayName,
          actorBranch: auth.branch || null,
        },
      });

      if (result.success) {
        await syncProgress(placeId, { blogIncrement: 1 });
        return NextResponse.json({ success: true, message: result.message });
      }
      return NextResponse.json({ success: false, error: result.message }, { status: 400 });
    }

    // -- 홈페이지 URL 수정 --
    if (action === 'update_homepage') {
      const { placeId, homepageUrl } = body;
      if (!placeId || !homepageUrl) {
        return NextResponse.json({ error: '플레이스번호와 홈페이지 URL을 입력해주세요.' }, { status: 400 });
      }

      const result = await updateReportFields(placeId, { homepageUrl });

      await prisma.homejeonsanLog.create({
        data: {
          action: 'update_homepage',
          placeId,
          businessName: body.companyName || null,
          keyword: homepageUrl,
          category: null,
          staffName: null,
          status: result.success ? 'success' : 'failed',
          errorMessage: result.success ? null : result.message,
          actorId: auth.userId,
          actorName: auth.displayName,
          actorBranch: auth.branch || null,
        },
      });

      if (result.success) {
        await syncProgress(placeId, { homepageDone: true });
        return NextResponse.json({ success: true, message: result.message });
      }
      return NextResponse.json({ success: false, error: result.message }, { status: 400 });
    }

    // -- 영상 URL 수정 --
    if (action === 'update_video') {
      const { placeId, promotionUrl } = body;
      if (!placeId || !promotionUrl) {
        return NextResponse.json({ error: '플레이스번호와 영상 URL을 입력해주세요.' }, { status: 400 });
      }

      const result = await updateReportFields(placeId, { promotionUrl });

      await prisma.homejeonsanLog.create({
        data: {
          action: 'update_video',
          placeId,
          businessName: body.companyName || null,
          keyword: promotionUrl,
          category: null,
          staffName: null,
          status: result.success ? 'success' : 'failed',
          errorMessage: result.success ? null : result.message,
          actorId: auth.userId,
          actorName: auth.displayName,
          actorBranch: auth.branch || null,
        },
      });

      if (result.success) {
        await syncProgress(placeId, { videoDone: true });
        return NextResponse.json({ success: true, message: result.message });
      }
      return NextResponse.json({ success: false, error: result.message }, { status: 400 });
    }

    // -- SEO 이미지 URL 수정 --
    if (action === 'update_seo') {
      const { placeId, befLeftFileUrl, befRightFileUrl, aftLeftFileUrl, aftRightFileUrl } = body;
      if (!placeId) {
        return NextResponse.json({ error: '플레이스번호를 입력해주세요.' }, { status: 400 });
      }

      // 빈 문자열은 무시 (기존 이미지 실수로 삭제 방지)
      const fields: Record<string, string> = {};
      if (befLeftFileUrl) fields.befLeftFileUrl = befLeftFileUrl;
      if (befRightFileUrl) fields.befRightFileUrl = befRightFileUrl;
      if (aftLeftFileUrl) fields.aftLeftFileUrl = aftLeftFileUrl;
      if (aftRightFileUrl) fields.aftRightFileUrl = aftRightFileUrl;

      if (Object.keys(fields).length === 0) {
        return NextResponse.json({ error: '수정할 이미지 URL이 없습니다.' }, { status: 400 });
      }

      const result = await updateReportFields(placeId, fields);

      await prisma.homejeonsanLog.create({
        data: {
          action: 'update_seo',
          placeId,
          businessName: body.companyName || null,
          keyword: Object.values(fields).filter(Boolean).join(', ').substring(0, 255),
          category: null,
          staffName: null,
          status: result.success ? 'success' : 'failed',
          errorMessage: result.success ? null : result.message,
          actorId: auth.userId,
          actorName: auth.displayName,
          actorBranch: auth.branch || null,
        },
      });

      if (result.success) {
        await syncProgress(placeId, { seoDone: true });
        return NextResponse.json({ success: true, message: result.message });
      }
      return NextResponse.json({ success: false, error: result.message }, { status: 400 });
    }

    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('POST /api/homejeonsan error:', error);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

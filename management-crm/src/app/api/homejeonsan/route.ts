import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  registerKeyword,
  registerReport,
  searchKeywords,
  checkReport,
  deleteKeyword,
  findRowIds,
} from '@/lib/homejeonsan';

// GET /api/homejeonsan — search_place, logs
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    const { searchParams } = request.nextUrl;
    const action = searchParams.get('action') || '';

    if (action === 'search_place') {
      const placeNumber = searchParams.get('placeNumber')?.trim() || '';
      if (!placeNumber) return NextResponse.json({ error: '플레이스번호를 입력해주세요.' }, { status: 400 });

      const [kwResult, rpResult] = await Promise.all([
        searchKeywords(placeNumber),
        checkReport(placeNumber),
      ]);

      return NextResponse.json({
        keywordCount: kwResult.total,
        keywords: kwResult.keywords,
        reportExists: rpResult.exists,
        reportContract: rpResult.contractPeriod || null,
      });
    }

    if (action === 'logs') {
      const logs = await prisma.homejeonsanLog.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
      });

      return NextResponse.json({
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
          type: l.action === 'register_report' ? 'report' : 'keyword',
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

    const contentType = request.headers.get('content-type') || '';

    // Handle FormData (bulk)
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const action = formData.get('action') as string;

      if (action === 'bulk_register' || action === 'bulk_register_report') {
        // Excel bulk support - requires xlsx parsing (not implementing fully here)
        return NextResponse.json({ error: '일괄 등록은 준비 중입니다.' }, { status: 400 });
      }

      return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
    }

    // Handle JSON
    const body = await request.json();
    const { action } = body;

    if (action === 'register') {
      const { companyName: businessName, keyword, placeId, category, salesperson, adType } = body;
      if (!businessName || !keyword || !placeId) {
        return NextResponse.json({ error: '상호명, 키워드, 플레이스번호를 모두 입력해주세요.' }, { status: 400 });
      }

      // Split comma-separated keywords
      const keywords = keyword.split(',').map((k: string) => k.trim()).filter(Boolean);
      const results: Array<{ keyword: string; success: boolean; message: string }> = [];
      let successCount = 0;

      for (const kw of keywords) {
        const result = await registerKeyword({
          businessName,
          placeId,
          keyword: kw,
          category: category || '기타',
          staffName: salesperson || auth.displayName,
          adType: adType || '정상',
        });

        results.push({ keyword: kw, success: result.success, message: result.message });

        // Log
        await prisma.homejeonsanLog.create({
          data: {
            action: 'register',
            placeId,
            businessName,
            keyword: kw,
            category: category || '기타',
            staffName: salesperson || auth.displayName,
            status: result.success ? 'success' : 'failed',
            errorMessage: result.success ? null : result.message,
            actorId: auth.userId,
            actorName: auth.displayName,
            actorBranch: auth.branch || null,
          },
        });

        if (result.success) successCount++;
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
        return NextResponse.json({ success: true, message: result.message });
      }
      return NextResponse.json({ success: false, error: result.message }, { status: 400 });
    }

    if (action === 'delete_keyword') {
      const { placeId, keyword: kwToDelete } = body;
      if (!placeId) {
        return NextResponse.json({ error: '플레이스번호가 필요합니다.' }, { status: 400 });
      }

      // Find the row IDs matching the placeId + keyword
      const rowIds = await findRowIds(placeId, kwToDelete || undefined);
      if (rowIds.length === 0) {
        return NextResponse.json({ success: false, error: '삭제할 키워드를 찾을 수 없습니다.' }, { status: 404 });
      }

      let deleted = 0;
      let lastError = '';
      for (const rowId of rowIds) {
        const result = await deleteKeyword(rowId);
        if (result.success) {
          deleted++;
        } else {
          lastError = result.message;
        }
      }

      // Log
      await prisma.homejeonsanLog.create({
        data: {
          action: 'delete_keyword',
          placeId,
          businessName: null,
          keyword: kwToDelete || null,
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

    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('POST /api/homejeonsan error:', error);
    return NextResponse.json({ error: '서버 오류가 발생했습니다.' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { login } from '@/lib/homejeonsan';

/** DB에서 홈전산 설정 로드 → process.env에 동기화 */
async function syncFromDb() {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: ['HOMEJEONSAN_ID', 'HOMEJEONSAN_PW', 'HOMEJEONSAN_PW2'] } },
  });
  for (const r of rows) {
    process.env[r.key] = r.value;
  }
}

// GET /api/settings/homejeonsan — 현재 설정 조회
export async function GET(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth.role !== 'admin') {
      return NextResponse.json({ message: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    await syncFromDb();

    return NextResponse.json({
      id: process.env.HOMEJEONSAN_ID || '(미설정)',
      pwSet: !!process.env.HOMEJEONSAN_PW,
      pw2Set: !!process.env.HOMEJEONSAN_PW2,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    return NextResponse.json({ message: '조회 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

// POST /api/settings/homejeonsan — 연결 테스트 / 저장
export async function POST(request: NextRequest) {
  try {
    const auth = requireAuth(request);
    if (auth.role !== 'admin') {
      return NextResponse.json({ message: '관리자 권한이 필요합니다.' }, { status: 403 });
    }

    const body = await request.json();
    const { action } = body;

    if (action === 'test') {
      await syncFromDb();
      const result = await login();
      if (result && result.ok) {
        return NextResponse.json({ ok: true, message: '모집플레이스 연결 성공' });
      }
      return NextResponse.json({ ok: false, message: result?.error || '로그인 실패 — 아이디/비밀번호를 확인하세요.' });
    }

    if (action === 'update') {
      const { hjId, hjPw, hjPw2 } = body;
      if (!hjId || !hjPw || !hjPw2) {
        return NextResponse.json({ message: '모든 필드를 입력해주세요.' }, { status: 400 });
      }

      // DB에 영속 저장
      await Promise.all([
        prisma.systemSetting.upsert({ where: { key: 'HOMEJEONSAN_ID' }, create: { key: 'HOMEJEONSAN_ID', value: hjId }, update: { value: hjId } }),
        prisma.systemSetting.upsert({ where: { key: 'HOMEJEONSAN_PW' }, create: { key: 'HOMEJEONSAN_PW', value: hjPw }, update: { value: hjPw } }),
        prisma.systemSetting.upsert({ where: { key: 'HOMEJEONSAN_PW2' }, create: { key: 'HOMEJEONSAN_PW2', value: hjPw2 }, update: { value: hjPw2 } }),
      ]);

      // 런타임에도 반영
      process.env.HOMEJEONSAN_ID = hjId;
      process.env.HOMEJEONSAN_PW = hjPw;
      process.env.HOMEJEONSAN_PW2 = hjPw2;

      // 연결 테스트
      const result = await login();
      if (result && result.ok) {
        return NextResponse.json({ ok: true, message: '계정 정보가 저장되고 연결이 확인되었습니다.' });
      }
      return NextResponse.json({ ok: false, message: result?.error || '저장했으나 연결 실패 — 정보를 다시 확인하세요.' });
    }

    return NextResponse.json({ message: '잘못된 요청입니다.' }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ message: '인증이 필요합니다.' }, { status: 401 });
    }
    console.error('POST /api/settings/homejeonsan error:', error);
    return NextResponse.json({ message: '처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}

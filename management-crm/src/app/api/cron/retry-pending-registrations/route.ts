import { NextResponse } from 'next/server';
import { verifyCronKey } from '@/lib/notification-sender';
import { retryPendingRegistrations } from '@/lib/retry-pending-registrations';

// POST /api/cron/retry-pending-registrations — 10분마다 호출
// 5분 이상 미완료된 모집플레이스 등록(advance-step 백그라운드 유실분)을 재시도한다.

export async function POST(request: Request) {
  if (!verifyCronKey(request)) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const results = await retryPendingRegistrations();
    return NextResponse.json({ ok: true, results });
  } catch (error) {
    console.error('POST /api/cron/retry-pending-registrations error:', error);
    return NextResponse.json({ message: '재시도 실패', error: String(error) }, { status: 500 });
  }
}

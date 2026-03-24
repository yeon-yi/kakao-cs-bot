// WebSocket 서버에 이벤트 브로드캐스트 알림 전송
// Next.js API route에서 데이터 변경 후 호출

export type WSEventType =
  | 'company_updated'
  | 'assignment_changed'
  | 'product_updated'
  | 'review_updated'
  | 'payment_updated'
  | 'distribution_changed';

export function notifyClients(type: WSEventType, data: Record<string, unknown> = {}) {
  const url = process.env.WS_NOTIFY_URL;
  if (!url) return; // ws 서버 미설정 시 무시

  // fire-and-forget — 응답 안 기다림
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-WS-Secret': process.env.WS_NOTIFY_SECRET || '',
    },
    body: JSON.stringify({ type, ...data }),
  }).catch(() => {
    // ws 서버 다운이어도 API 동작에 영향 없음
  });
}

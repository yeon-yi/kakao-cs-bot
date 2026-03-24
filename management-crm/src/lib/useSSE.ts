'use client';

import { useEffect, useRef, useMemo } from 'react';

export type SSEEventType =
  | 'company_updated'
  | 'assignment_changed'
  | 'product_updated'
  | 'review_updated'
  | 'payment_updated'
  | 'distribution_changed';

// --- 전역 WebSocket 싱글턴 ---
let ws: WebSocket | null = null;
let listeners: Array<{ handler: () => void }> = [];
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let retryCount = 0;
let dead = false; // true면 더 이상 연결 시도 안 함 → 폴링만

const MAX_RETRIES = 3;

function getWsUrl() {
  if (typeof window === 'undefined') return '';
  const loc = window.location;
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}/ws`;
}

function connectWs() {
  if (dead) return;
  if (ws && ws.readyState <= 1) return; // CONNECTING or OPEN

  const url = getWsUrl();
  if (!url) return;

  try {
    ws = new WebSocket(url);
  } catch {
    markDead();
    return;
  }

  ws.onopen = () => { retryCount = 0; };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'connected') return;
      // 모든 리스너에 알림 (이벤트 타입 필터링 없이 — 어차피 refresh)
      listeners.forEach(l => { try { l.handler(); } catch { /* */ } });
    } catch { /* */ }
  };

  ws.onclose = () => {
    ws = null;
    if (!dead && listeners.length > 0) scheduleReconnect();
  };

  ws.onerror = () => {
    // onerror 후에 onclose가 자동 호출됨 — 여기서는 아무것도 안 함
  };
}

function scheduleReconnect() {
  if (dead || reconnectTimer) return;
  retryCount++;
  if (retryCount > MAX_RETRIES) {
    markDead();
    return;
  }
  const delay = 3000 * Math.pow(2, retryCount - 1); // 3s, 6s, 12s
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWs();
  }, delay);
}

function markDead() {
  dead = true;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  ws?.close();
  ws = null;
}

function addListener(handler: () => void) {
  listeners.push({ handler });
  if (!dead) connectWs();
}

function removeListener(handler: () => void) {
  listeners = listeners.filter(l => l.handler !== handler);
  if (listeners.length === 0) {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    ws?.close();
    ws = null;
    retryCount = 0;
    // dead는 리셋하지 않음 — 한번 실패한 서버는 다시 시도 안 함
  }
}

/**
 * 실시간 데이터 새로고침 훅
 * - WebSocket 연결 성공 시: 서버 이벤트마다 즉시 refresh
 * - WebSocket 실패 시: 15초 폴링으로 자동 폴백
 */
export function useSSERefresh(
  _events: SSEEventType[],
  refreshFn: () => void,
  enabled = true,
) {
  const refreshRef = useRef(refreshFn);
  refreshRef.current = refreshFn;

  // 안정적 핸들러 (절대 바뀌지 않음)
  const stableHandler = useMemo(() => {
    return () => { refreshRef.current(); };
  }, []);

  // WebSocket 연결
  useEffect(() => {
    if (!enabled) return;
    addListener(stableHandler);
    return () => removeListener(stableHandler);
  }, [enabled, stableHandler]);

  // 폴링 폴백 (WebSocket 실패 시에도 동작)
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      refreshRef.current();
    }, 15000);
    return () => clearInterval(timer);
  }, [enabled]);
}

// 하위 호환
export function useSSE(
  _events: SSEEventType[],
  _handler: () => void,
  _enabled = true,
) {
  // no-op
}

import { describe, it, expect, beforeEach, vi } from 'vitest';

// rate-limit 모듈을 직접 테스트하기 위해 내부 로직 재현
// (Hono 미들웨어 형태이므로 핵심 로직만 단위 테스트)

describe('Rate Limiter', () => {
  let store: Map<string, { count: number; resetAt: number }>;

  beforeEach(() => {
    store = new Map();
  });

  function checkRateLimit(
    key: string,
    windowMs: number,
    maxRequests: number,
  ): { allowed: boolean; remaining: number; retryAfter?: number } {
    const now = Date.now();
    let entry = store.get(key);

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;
    const remaining = Math.max(0, maxRequests - entry.count);

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      return { allowed: false, remaining: 0, retryAfter };
    }

    return { allowed: true, remaining };
  }

  it('허용 범위 내 요청은 통과해야 한다', () => {
    const result = checkRateLimit('192.168.1.1:/api', 60000, 5);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  it('최대 요청 수에 도달하면 차단해야 한다', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit('192.168.1.1:/api', 60000, 5);
    }
    const result = checkRateLimit('192.168.1.1:/api', 60000, 5);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('다른 IP는 독립적으로 제한해야 한다', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit('192.168.1.1:/api', 60000, 5);
    }
    const blocked = checkRateLimit('192.168.1.1:/api', 60000, 5);
    const allowed = checkRateLimit('192.168.1.2:/api', 60000, 5);

    expect(blocked.allowed).toBe(false);
    expect(allowed.allowed).toBe(true);
  });

  it('윈도우 만료 후 카운터가 리셋되어야 한다', () => {
    const key = '192.168.1.1:/api';
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, 100, 5);
    }
    const blocked = checkRateLimit(key, 100, 5);
    expect(blocked.allowed).toBe(false);

    // 윈도우 강제 만료
    const entry = store.get(key)!;
    entry.resetAt = Date.now() - 1;

    const allowed = checkRateLimit(key, 100, 5);
    expect(allowed.allowed).toBe(true);
    expect(allowed.remaining).toBe(4);
  });

  it('다른 경로는 독립적으로 제한해야 한다', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit('192.168.1.1:/login', 60000, 5);
    }
    const blockedLogin = checkRateLimit('192.168.1.1:/login', 60000, 5);
    const allowedApi = checkRateLimit('192.168.1.1:/api', 60000, 5);

    expect(blockedLogin.allowed).toBe(false);
    expect(allowedApi.allowed).toBe(true);
  });
});

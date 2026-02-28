import type { MiddlewareHandler } from 'hono';
import { createLogger } from '@kakao-cs-bot/config';

const logger = createLogger('api:rate-limit');

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

const store = new Map<string, RateLimitEntry>();

// 5분마다 만료된 항목 정리
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now >= entry.resetAt) store.delete(key);
  }
}, 5 * 60 * 1000).unref();

function getClientIp(req: Request, headerName?: string): string {
  if (headerName) {
    const header = req.headers.get(headerName);
    if (header) return header.split(',')[0].trim();
  }
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}

export function rateLimiter(config: RateLimitConfig): MiddlewareHandler {
  return async (c, next) => {
    const ip = getClientIp(c.req.raw);
    const key = `${ip}:${c.req.path}`;
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + config.windowMs };
      store.set(key, entry);
    }

    entry.count++;

    const remaining = Math.max(0, config.maxRequests - entry.count);
    c.header('X-RateLimit-Limit', String(config.maxRequests));
    c.header('X-RateLimit-Remaining', String(remaining));
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > config.maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      logger.warn('Rate limit exceeded', { ip, path: c.req.path, count: entry.count });
      c.header('Retry-After', String(retryAfter));
      return c.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }, 429);
    }

    await next();
  };
}

// 로그인: 5분간 5회
export const loginLimiter = rateLimiter({ windowMs: 5 * 60 * 1000, maxRequests: 5 });

// 일반 API: 1분간 60회
export const apiLimiter = rateLimiter({ windowMs: 60 * 1000, maxRequests: 60 });

// Webhook: 1분간 30회
export const webhookLimiter = rateLimiter({ windowMs: 60 * 1000, maxRequests: 30 });

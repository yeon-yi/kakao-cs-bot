import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trpcServer } from '@hono/trpc-server';
import { loadEnv, createLogger, AppError } from '@kakao-cs-bot/config';
import { getPool } from '@kakao-cs-bot/database';
import { appRouter } from './routers';
import { createContext } from './context';
import { webhookApp, disconnectRedis, disconnectResponseCache } from './webhook';
import { randomUUID } from 'crypto';
import { setRequestContext, getRequestId } from '@kakao-cs-bot/config';
import Redis from 'ioredis';

const env = loadEnv();
const logger = createLogger('api:server');

const app = new Hono();

// ===================== requestId 미들웨어 =====================
app.use('*', async (c, next) => {
  const requestId = c.req.header('X-Request-Id') || randomUUID();
  setRequestContext(requestId);
  c.header('X-Request-Id', requestId);
  await next();
});

// ===================== CORS Whitelist =====================
const allowedOrigins = env.CORS_ORIGIN
  ? env.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean)
  : ['http://localhost:3001'];

app.use('*', cors({
  origin: (origin) => {
    if (env.NODE_ENV === 'development') return origin || allowedOrigins[0];
    if (!origin) return allowedOrigins[0];
    return allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  },
  credentials: true,
}));

// ===================== Health Check (DB + Redis) =====================
app.get('/health', async (c) => {
  let dbStatus = 'ok';
  let redisStatus = 'ok';

  try {
    await getPool().query('SELECT 1');
  } catch {
    dbStatus = 'error';
  }

  try {
    const redis = new Redis(env.REDIS_URL, { lazyConnect: true, connectTimeout: 2000 });
    await redis.ping();
    await redis.quit();
  } catch {
    redisStatus = 'error';
  }

  const healthy = dbStatus === 'ok' && redisStatus === 'ok';
  return c.json(
    { status: healthy ? 'healthy' : 'degraded', db: dbStatus, redis: redisStatus, uptime: process.uptime() },
    healthy ? 200 : 503
  );
});

app.get('/ready', (c) => c.json({ status: 'ready' }));

// ===================== 에러 핸들링 =====================
app.onError((err, c) => {
  const requestId = getRequestId();
  if (err instanceof AppError) {
    logger.warn('AppError', { code: err.code, message: err.message, statusCode: err.statusCode, requestId });
    return c.json({ error: err.message, code: err.code, requestId }, err.statusCode as any);
  }
  logger.error('Unhandled error', { error: String(err), stack: (err as Error).stack, requestId });
  return c.json({ error: 'Internal server error', requestId }, 500);
});

// ===================== APK 다운로드 =====================
app.get('/download/apk', async (c) => {
  const fs = await import('fs');
  const apkPath = '/app/public/csbot.apk';
  if (!fs.existsSync(apkPath)) {
    return c.json({ error: 'APK not found' }, 404);
  }
  const buffer = fs.readFileSync(apkPath);
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="csbot.apk"',
      'Content-Length': String(buffer.length),
    },
  });
});

// ===================== 라우트 =====================
app.route('/webhook', webhookApp);

app.use('/trpc/*', trpcServer({
  router: appRouter,
  createContext,
}));

// ===================== 서버 시작 + Graceful Shutdown =====================
const port = env.API_PORT;

const server = serve({ fetch: app.fetch, port }, () => {
  logger.info(`API server listening on http://localhost:${port}`);
});

let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info(`${signal} received, starting graceful shutdown...`);

  // 강제 종료 타이머 (10초)
  const forceTimer = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
  forceTimer.unref();

  try {
    // 1. HTTP 서버 종료 (새 연결 거부, 기존 완료 대기)
    await new Promise<void>((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
    });
    logger.info('HTTP server closed');

    // 2. Webhook Redis 연결 종료
    await disconnectRedis();
    await disconnectResponseCache();
    logger.info('Redis connections closed');

    // 3. DB 풀 종료
    await getPool().end();
    logger.info('Database pool closed');

    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (e) {
    logger.error('Shutdown error', { error: String(e) });
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trpcServer } from '@hono/trpc-server';
import { loadEnv } from '@kakao-cs-bot/config';
import { createLogger } from '@kakao-cs-bot/config';
import { appRouter } from './routers';
import { createContext } from './context';
import { webhookApp } from './webhook';

const env = loadEnv();
const logger = createLogger('api:server');

const app = new Hono();

// CORS
app.use('*', cors({
  origin: (origin) => origin || '*',
  credentials: true,
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/ready', (c) => c.json({ status: 'ready' }));

// APK 다운로드 (인증 불필요)
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

// Webhook (봇 앱 → API, tRPC 외부)
app.route('/webhook', webhookApp);

// tRPC
app.use('/trpc/*', trpcServer({
  router: appRouter,
  createContext,
}));

const port = env.API_PORT;

serve({ fetch: app.fetch, port }, () => {
  logger.info(`API server listening on http://localhost:${port}`);
});

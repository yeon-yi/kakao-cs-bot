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
app.get('/health', (c) => c.json({ status: 'ok', version: 'v2-embed-fix', timestamp: new Date().toISOString() }));
app.get('/ready', (c) => c.json({ status: 'ready' }));

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

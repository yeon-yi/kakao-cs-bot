import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { trpcServer } from '@hono/trpc-server';
import { loadEnv } from '@kakao-cs-bot/config';
import { createLogger } from '@kakao-cs-bot/config';
import { appRouter } from './routers';
import { createContext } from './context';

const env = loadEnv();
const logger = createLogger('api:server');

const app = new Hono();

// CORS
app.use('*', cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.get('/ready', (c) => c.json({ status: 'ready' }));

// tRPC
app.use('/trpc/*', trpcServer({
  router: appRouter,
  createContext,
}));

const port = env.API_PORT;

serve({ fetch: app.fetch, port }, () => {
  logger.info(`API server listening on http://localhost:${port}`);
});

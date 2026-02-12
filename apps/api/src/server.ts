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

// Diagnostic: 임베딩 검색 디버그
app.get('/debug/search', async (c) => {
  try {
    const { embedder } = await import('@kakao-cs-bot/ai');
    const { KnowledgeRepository } = await import('@kakao-cs-bot/database');

    const question = c.req.query('q') || '블로그 기자단이 뭔가요?';
    const embedding = await embedder.embed(question);

    // Method 1: 새 repository 인스턴스
    const repo = new KnowledgeRepository();
    const repoResults = await repo.search(embedding, question, { limit: 2 });

    // Method 2: webhook의 기존 인스턴스 사용
    const { webhookKnowledgeSearch } = await import('./webhook');
    const webhookResults = await webhookKnowledgeSearch(embedding, question);

    // search 메서드 소스 확인
    const searchSrc = repo.search.toString().slice(0, 200);

    return c.json({
      question,
      embeddingLength: embedding.length,
      newRepoResults: repoResults.map((r: any) => ({ q: r.question, sim: r.similarity })),
      webhookRepoResults: webhookResults.map((r: any) => ({ q: r.question, sim: r.similarity })),
      searchMethodSrc: searchSrc,
    });
  } catch (err: any) {
    return c.json({ error: err.message, stack: err.stack?.split('\n').slice(0, 3) }, 500);
  }
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

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
    const { createClient } = await import('@supabase/supabase-js');

    const question = c.req.query('q') || '블로그 기자단이 뭔가요?';
    const embedding = await embedder.embed(question);

    // Method 1: 기존 repository (JSON.stringify 적용)
    const repo = new KnowledgeRepository();
    const repoResults = await repo.search(embedding, question, { limit: 2 });

    // Method 2: untyped client with JSON.stringify
    const raw = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const { data: rawResults } = await raw.rpc('search_knowledge', {
      query_embedding: JSON.stringify(embedding),
      query_text: question,
      p_limit: 2,
    });

    // Method 3: untyped client with raw array
    const { data: arrResults } = await raw.rpc('search_knowledge', {
      query_embedding: embedding as any,
      query_text: question,
      p_limit: 2,
    });

    return c.json({
      question,
      embeddingLength: embedding.length,
      embeddingFirst3: embedding.slice(0, 3),
      repoResults: repoResults.map((r: any) => ({ q: r.question, sim: r.similarity })),
      rawStringResults: rawResults?.map((r: any) => ({ q: r.question, sim: r.similarity })),
      rawArrayResults: arrResults?.map((r: any) => ({ q: r.question, sim: r.similarity })),
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
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

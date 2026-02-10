import { router } from '../trpc';
import { knowledgeRouter } from './knowledge';
import { contextRouter } from './context';
import { identityRouter } from './identity';
import { promptsRouter } from './prompts';
import { configRouter } from './config';
import { analyticsRouter } from './analytics';
import { authRouter } from './auth';
import { uploadRouter } from './upload';

export const appRouter = router({
  knowledge: knowledgeRouter,
  context: contextRouter,
  identity: identityRouter,
  prompts: promptsRouter,
  config: configRouter,
  analytics: analyticsRouter,
  auth: authRouter,
  upload: uploadRouter,
});

export type AppRouter = typeof appRouter;

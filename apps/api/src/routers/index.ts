import { router } from '../trpc';
import { knowledgeRouter } from './knowledge';
import { contextRouter } from './context';
import { identityRouter } from './identity';
import { promptsRouter } from './prompts';
import { configRouter } from './config';
import { analyticsRouter } from './analytics';
import { authRouter } from './auth';
import { uploadRouter } from './upload';
import { settingsRouter } from './settings';
import { escalationRouter } from './escalation';
import { proactiveRouter } from './proactive';
import { staffRouter } from './staff';
import { conversationsRouter } from './conversations';
import { uncertaintyRouter } from './uncertainty';
import { devicesRouter } from './devices';

export const appRouter = router({
  knowledge: knowledgeRouter,
  context: contextRouter,
  identity: identityRouter,
  prompts: promptsRouter,
  config: configRouter,
  analytics: analyticsRouter,
  auth: authRouter,
  upload: uploadRouter,
  settings: settingsRouter,
  escalation: escalationRouter,
  proactive: proactiveRouter,
  staff: staffRouter,
  conversations: conversationsRouter,
  uncertainty: uncertaintyRouter,
  devices: devicesRouter,
});

export type AppRouter = typeof appRouter;

import { z } from 'zod';
import Redis from 'ioredis';
import { router, protectedProcedure } from '../trpc';
import { EscalationRepository, KnowledgeRepository, getSupabaseAdmin } from '@kakao-cs-bot/database';
import { embedder } from '@kakao-cs-bot/ai';
import { getEnv, createLogger } from '@kakao-cs-bot/config';

const logger = createLogger('api:escalation');
const escalationRepo = new EscalationRepository();
const knowledgeRepo = new KnowledgeRepository();

let redis: Redis | null = null;
function getRedis() {
  if (!redis) redis = new Redis(getEnv().REDIS_URL);
  return redis;
}

const statusEnum = z.enum(['pending', 'assigned', 'answered', 'learned', 'dismissed']);

const assigneesRouter = router({
  list: protectedProcedure.query(async () => {
    return escalationRepo.getAssignees();
  }),

  set: protectedProcedure
    .input(z.object({
      category: z.string().min(1),
      staffId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const result = await escalationRepo.setAssignee(input.category, input.staffId);
      return { success: true, data: result };
    }),

  remove: protectedProcedure
    .input(z.object({ category: z.string() }))
    .mutation(async ({ input }) => {
      await escalationRepo.removeAssignee(input.category);
      return { success: true };
    }),
});

export const escalationRouter = router({
  list: protectedProcedure
    .input(z.object({
      status: statusEnum.optional(),
      category: z.string().optional(),
      offset: z.number().default(0),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      return escalationRepo.list(input);
    }),

  get: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const escalation = await escalationRepo.getById(input.id);
      if (!escalation) throw new Error('Escalation not found');
      return escalation;
    }),

  answer: protectedProcedure
    .input(z.object({
      id: z.number(),
      answer: z.string().min(5),
      category: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // 1. Update escalation with answer
      const escalation = await escalationRepo.getById(input.id);
      if (!escalation) throw new Error('Escalation not found');

      await escalationRepo.answer(input.id, input.answer, ctx.userId || 'admin');

      // 2. Auto-learn: add to knowledge base as Tier 1
      const embedding = await embedder.embed(escalation.user_message);

      // Check for duplicates
      const existing = await knowledgeRepo.search(embedding, escalation.user_message, { limit: 1 });
      let knowledgeId: string;

      if (existing.length > 0 && existing[0].similarity > 0.95) {
        // Update existing knowledge
        await knowledgeRepo.update(existing[0].id, { answer: input.answer });
        knowledgeId = existing[0].id;
      } else {
        // Create new knowledge
        const knowledge = await knowledgeRepo.add({
          question: escalation.user_message,
          answer: input.answer,
          category: input.category || escalation.category || '일반',
          tier: 1,
          taught_by: ctx.userId || 'admin',
          tags: ['에스컬레이션', '피드백'],
          embedding: embedding as any,
        });
        knowledgeId = knowledge.id;
      }

      // 3. Mark as learned
      await escalationRepo.markLearned(input.id, knowledgeId);

      // 4. Publish event for bot to auto-reply in Kakao
      try {
        await getRedis().publish('escalation:answered', JSON.stringify({
          escalationId: escalation.id,
          roomId: escalation.room_id,
          userName: escalation.user_name,
          question: escalation.user_message,
          answer: input.answer,
        }));
        await escalationRepo.markReplied(input.id);
      } catch (err) {
        logger.warn('Failed to publish escalation reply event', { error: String(err) });
      }

      logger.info('Escalation answered and learned', { id: input.id, knowledgeId });
      return { success: true, knowledgeId };
    }),

  dismiss: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await escalationRepo.dismiss(input.id);
      return { success: true };
    }),

  pendingCount: protectedProcedure.query(async () => {
    const count = await escalationRepo.pendingCount();
    return { count };
  }),

  assignees: assigneesRouter,

  // Staff list for assignee selection
  staffList: protectedProcedure.query(async () => {
    const db = getSupabaseAdmin();
    const { data, error } = await db.from('company_staff').select('id, real_name, department, kakao_name').eq('is_active', true).order('real_name');
    if (error) throw error;
    return data ?? [];
  }),
});

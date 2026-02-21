import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { UncertaintyRepository, KnowledgeRepository } from '@kakao-cs-bot/database';
import { embedder } from '@kakao-cs-bot/ai';

const uncertaintyRepo = new UncertaintyRepository();
const knowledgeRepo = new KnowledgeRepository();

export const uncertaintyRouter = router({
  list: protectedProcedure
    .input(z.object({
      status: z.enum(['open', 'addressed', 'dismissed']).optional(),
      category: z.string().min(1).optional(),
      offset: z.number().default(0),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      return uncertaintyRepo.list(input);
    }),

  stats: protectedProcedure.query(async () => {
    return uncertaintyRepo.getStats();
  }),

  trending: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      return uncertaintyRepo.trending(input.limit);
    }),

  openCount: protectedProcedure.query(async () => {
    const count = await uncertaintyRepo.openCount();
    return { count };
  }),

  // 불확실 주제에 대해 바로 답변 등록 (지식 추가 + 주제 해결)
  resolve: protectedProcedure
    .input(z.object({
      id: z.number(),
      question: z.string().min(3),
      answer: z.string().min(5),
      category: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // 주제 존재/상태 사전 검증
      const topic = await uncertaintyRepo.list({ status: 'open', offset: 0, limit: 1 });
      // getById로 직접 확인
      const existing = await uncertaintyRepo.getById(input.id);
      if (!existing) throw new Error('주제를 찾을 수 없습니다');
      if (existing.status !== 'open') throw new Error('이미 처리된 주제입니다');

      const embedding = await embedder.embed(input.question);
      const knowledge = await knowledgeRepo.add({
        question: input.question,
        answer: input.answer,
        category: input.category || '일반',
        tier: 1,
        taught_by: ctx.userId || 'admin',
        tags: ['불확실해결'],
        embedding: embedding as any,
      });

      await uncertaintyRepo.resolve(input.id, knowledge.id);
      return { success: true, knowledgeId: knowledge.id };
    }),

  dismiss: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await uncertaintyRepo.dismiss(input.id);
      return { success: true };
    }),
});

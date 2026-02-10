import { z } from 'zod';
import { router, publicProcedure, protectedProcedure } from '../trpc';
import { KnowledgeRepository } from '@kakao-cs-bot/database';
import { embedder } from '@kakao-cs-bot/ai';
import { createLogger } from '@kakao-cs-bot/config';

const logger = createLogger('api:knowledge');
const knowledgeRepo = new KnowledgeRepository();

export const knowledgeRouter = router({
  search: publicProcedure
    .input(z.object({
      question: z.string().min(1),
      tier: z.number().min(1).max(3).optional(),
      category: z.string().optional(),
      limit: z.number().min(1).max(20).default(5),
    }))
    .query(async ({ input }) => {
      const start = Date.now();
      const embedding = await embedder.embed(input.question);
      const results = await knowledgeRepo.search(embedding, input.question, {
        tier: input.tier,
        category: input.category,
        limit: input.limit,
      });

      // Increment usage counts
      for (const result of results) {
        await knowledgeRepo.incrementUsage(result.id).catch(() => {});
      }

      return {
        results,
        totalFound: results.length,
        searchTime: Date.now() - start,
      };
    }),

  get: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const knowledge = await knowledgeRepo.getById(input.id);
      if (!knowledge) throw new Error('Knowledge not found');
      return knowledge;
    }),

  list: protectedProcedure
    .input(z.object({
      tier: z.number().optional(),
      category: z.string().optional(),
      offset: z.number().default(0),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      return knowledgeRepo.list(input);
    }),

  add: protectedProcedure
    .input(z.object({
      question: z.string().min(5).max(500),
      answer: z.string().min(10).max(2000),
      category: z.string().min(1),
      tier: z.number().min(1).max(3).default(2),
      taughtBy: z.string().optional(),
      tags: z.array(z.string()).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Generate embedding
      const embedding = await embedder.embed(input.question);

      // Check for duplicates (similarity > 0.95)
      const existing = await knowledgeRepo.search(embedding, input.question, { limit: 1 });
      if (existing.length > 0 && existing[0].similarity > 0.95) {
        throw new Error(`유사한 질문이 이미 존재합니다: "${existing[0].question}"`);
      }

      const result = await knowledgeRepo.add({
        question: input.question,
        answer: input.answer,
        category: input.category,
        tier: input.tier,
        taught_by: input.taughtBy || ctx.userId || undefined,
        tags: input.tags || null,
        notes: input.notes || null,
        embedding: embedding as any,
      });

      logger.info('Knowledge added', { id: result.id, category: input.category });
      return { success: true, id: result.id, message: '지식이 추가되었습니다' };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      question: z.string().min(5).max(500).optional(),
      answer: z.string().min(10).max(2000).optional(),
      category: z.string().optional(),
      tier: z.number().min(1).max(3).optional(),
      tags: z.array(z.string()).optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...updates } = input;
      const updateData: Record<string, unknown> = {};

      if (updates.question) {
        updateData.question = updates.question;
        updateData.embedding = await embedder.embed(updates.question);
      }
      if (updates.answer) updateData.answer = updates.answer;
      if (updates.category) updateData.category = updates.category;
      if (updates.tier) updateData.tier = updates.tier;
      if (updates.tags) updateData.tags = updates.tags;
      if (updates.notes !== undefined) updateData.notes = updates.notes;

      const result = await knowledgeRepo.update(id, updateData as any);
      return { success: true, id: result.id, message: '지식이 수정되었습니다' };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await knowledgeRepo.delete(input.id);
      return { success: true, message: '지식이 삭제되었습니다' };
    }),
});

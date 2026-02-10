import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { PromptRepository } from '@kakao-cs-bot/database';

const promptRepo = new PromptRepository();

export const promptsRouter = router({
  get: protectedProcedure
    .input(z.object({ name: z.string() }))
    .query(async ({ input }) => {
      const prompt = await promptRepo.get(input.name);
      if (!prompt) throw new Error(`Prompt not found: ${input.name}`);
      return prompt;
    }),

  list: protectedProcedure
    .query(async () => {
      return promptRepo.list();
    }),

  update: protectedProcedure
    .input(z.object({
      name: z.string(),
      template: z.string().min(1),
      reason: z.string().min(1),
      changedBy: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await promptRepo.update(
        input.name,
        input.template,
        input.reason,
        input.changedBy || ctx.userId || 'system',
      );
      return { success: true, newVersion: result?.version, message: '프롬프트가 업데이트되었습니다' };
    }),
});

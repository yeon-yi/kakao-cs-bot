import { z } from 'zod';
import { router, protectedProcedure } from '../trpc';
import { PromptRepository, query as dbQuery } from '@kakao-cs-bot/database';

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

  // 프롬프트 변경 내역 조회
  history: protectedProcedure
    .input(z.object({
      name: z.string(),
      limit: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ input }) => {
      const prompt = await promptRepo.get(input.name);
      if (!prompt) throw new Error(`Prompt not found: ${input.name}`);

      const history = await dbQuery(
        `SELECT ph.*, pt.name as template_name
         FROM prompt_history ph
         JOIN prompt_templates pt ON pt.id = ph.template_id
         WHERE pt.name = $1
         ORDER BY ph.created_at DESC
         LIMIT $2`,
        [input.name, input.limit]
      );

      return {
        current: prompt,
        history,
      };
    }),
});

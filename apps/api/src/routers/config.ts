import { z } from 'zod';
import { router, protectedProcedure, adminProcedure } from '../trpc';
import { ConfigRepository } from '@kakao-cs-bot/database';

const configRepo = new ConfigRepository();

export const configRouter = router({
  get: protectedProcedure
    .input(z.object({ key: z.string() }))
    .query(async ({ input }) => {
      const config = await configRepo.get(input.key);
      if (!config) throw new Error(`Config not found: ${input.key}`);
      return config;
    }),

  list: protectedProcedure
    .input(z.object({ category: z.string().optional() }).optional())
    .query(async ({ input }) => {
      return configRepo.list(input?.category);
    }),

  update: adminProcedure
    .input(z.object({
      key: z.string(),
      value: z.any(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await configRepo.set(input.key, input.value, ctx.userId);
      return { success: true, message: '설정이 업데이트되었습니다' };
    }),
});

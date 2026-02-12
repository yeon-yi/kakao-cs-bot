import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { router, publicProcedure } from '../trpc';
import { getEnv } from '@kakao-cs-bot/config';
import { TRPCError } from '@trpc/server';

export const authRouter = router({
  login: publicProcedure
    .input(z.object({
      username: z.string(),
      password: z.string(),
    }))
    .mutation(async ({ input }) => {
      const env = getEnv();
      if (input.username !== 'admin' || input.password !== env.ADMIN_PASSWORD) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '아이디 또는 비밀번호가 올바르지 않습니다' });
      }

      const token = jwt.sign(
        { sub: input.username, role: 'admin' },
        env.JWT_SECRET,
        { expiresIn: '30d' },
      );

      return { token, user: { id: input.username, role: 'admin' as const } };
    }),

  autoLogin: publicProcedure
    .input(z.object({ key: z.string() }))
    .mutation(async ({ input }) => {
      if (input.key !== getEnv().ADMIN_AUTO_LOGIN_KEY) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '잘못된 키입니다' });
      }

      const token = jwt.sign(
        { sub: 'admin', role: 'admin' },
        getEnv().JWT_SECRET,
        { expiresIn: '30d' },
      );

      return { token, user: { id: 'admin', role: 'admin' as const } };
    }),

  me: publicProcedure
    .query(async ({ ctx }) => {
      if (!ctx.userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      return { id: ctx.userId, role: ctx.role };
    }),
});

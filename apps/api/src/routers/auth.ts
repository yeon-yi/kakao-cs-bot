import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { router, publicProcedure } from '../trpc';
import { getEnv } from '@kakao-cs-bot/config';
import { TRPCError } from '@trpc/server';

// Simple auth for admin dashboard
// In production, integrate with NextAuth or proper auth provider
const ADMIN_USERS: Record<string, string> = {
  admin: 'admin123!', // Change in production
};

export const authRouter = router({
  login: publicProcedure
    .input(z.object({
      username: z.string(),
      password: z.string(),
    }))
    .mutation(async ({ input }) => {
      const validPassword = ADMIN_USERS[input.username];
      if (!validPassword || validPassword !== input.password) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '아이디 또는 비밀번호가 올바르지 않습니다' });
      }

      const token = jwt.sign(
        { sub: input.username, role: 'admin' },
        getEnv().JWT_SECRET,
        { expiresIn: '24h' },
      );

      return { token, user: { id: input.username, role: 'admin' as const } };
    }),

  me: publicProcedure
    .query(async ({ ctx }) => {
      if (!ctx.userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      return { id: ctx.userId, role: ctx.role };
    }),
});

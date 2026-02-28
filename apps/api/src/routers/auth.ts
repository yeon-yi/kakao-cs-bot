import { z } from 'zod';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { router, publicProcedure } from '../trpc';
import { getEnv, createLogger } from '@kakao-cs-bot/config';
import { TRPCError } from '@trpc/server';
import { ConfigRepository } from '@kakao-cs-bot/database';

const configRepo = new ConfigRepository();
const logger = createLogger('api:auth');
const BCRYPT_ROUNDS = 12;

async function getAdminPasswordHash(): Promise<string> {
  const env = getEnv();
  let storedPassword = env.ADMIN_PASSWORD;

  try {
    const dbPassword = await configRepo.get('admin.password');
    if (dbPassword?.value) storedPassword = String(dbPassword.value);
  } catch {}

  // bcrypt hash는 $2b$ 또는 $2a$로 시작
  if (storedPassword.startsWith('$2b$') || storedPassword.startsWith('$2a$')) {
    return storedPassword;
  }

  // 평문이면 해싱 후 DB에 저장 (자동 마이그레이션)
  const hash = await bcrypt.hash(storedPassword, BCRYPT_ROUNDS);
  try {
    await configRepo.set('admin.password', hash);
    logger.info('Admin password migrated to bcrypt hash');
  } catch {
    logger.warn('Failed to save hashed password to DB');
  }
  return hash;
}

function generateTokens(userId: string, role: 'admin' | 'user', secret: string) {
  const accessToken = jwt.sign(
    { sub: userId, role, type: 'access' },
    secret,
    { expiresIn: '8h' },
  );
  const refreshToken = jwt.sign(
    { sub: userId, role, type: 'refresh' },
    secret,
    { expiresIn: '30d' },
  );
  return { accessToken, refreshToken };
}

export const authRouter = router({
  login: publicProcedure
    .input(z.object({
      username: z.string(),
      password: z.string(),
    }))
    .mutation(async ({ input }) => {
      const env = getEnv();

      if (input.username !== 'admin') {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '아이디 또는 비밀번호가 올바르지 않습니다' });
      }

      const hash = await getAdminPasswordHash();
      const isValid = await bcrypt.compare(input.password, hash);
      if (!isValid) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '아이디 또는 비밀번호가 올바르지 않습니다' });
      }

      const { accessToken, refreshToken } = generateTokens(input.username, 'admin', env.JWT_SECRET);
      return { token: accessToken, refreshToken, user: { id: input.username, role: 'admin' as const } };
    }),

  autoLogin: publicProcedure
    .input(z.object({ key: z.string() }))
    .mutation(async ({ input }) => {
      if (input.key !== getEnv().ADMIN_AUTO_LOGIN_KEY) {
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '잘못된 키입니다' });
      }

      const { accessToken, refreshToken } = generateTokens('admin', 'admin', getEnv().JWT_SECRET);
      return { token: accessToken, refreshToken, user: { id: 'admin', role: 'admin' as const } };
    }),

  refresh: publicProcedure
    .input(z.object({ refreshToken: z.string() }))
    .mutation(async ({ input }) => {
      const env = getEnv();
      try {
        const decoded = jwt.verify(input.refreshToken, env.JWT_SECRET) as {
          sub: string; role: 'admin' | 'user'; type: string;
        };
        if (decoded.type !== 'refresh') {
          throw new TRPCError({ code: 'UNAUTHORIZED', message: '유효하지 않은 토큰입니다' });
        }
        const { accessToken, refreshToken } = generateTokens(decoded.sub, decoded.role, env.JWT_SECRET);
        return { token: accessToken, refreshToken, user: { id: decoded.sub, role: decoded.role } };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({ code: 'UNAUTHORIZED', message: '토큰이 만료되었습니다. 다시 로그인해주세요.' });
      }
    }),

  me: publicProcedure
    .query(async ({ ctx }) => {
      if (!ctx.userId) {
        throw new TRPCError({ code: 'UNAUTHORIZED' });
      }
      return { id: ctx.userId, role: ctx.role };
    }),
});

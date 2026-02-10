import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch';
import jwt from 'jsonwebtoken';
import { getEnv } from '@kakao-cs-bot/config';

export interface Context {
  userId: string | null;
  role: 'admin' | 'user' | null;
  [key: string]: unknown;
}

export async function createContext(opts: FetchCreateContextFnOptions): Promise<Context> {
  const authHeader = opts.req.headers.get('authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return { userId: null, role: null };
  }

  try {
    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, getEnv().JWT_SECRET) as { sub: string; role: 'admin' | 'user' };
    return { userId: decoded.sub, role: decoded.role };
  } catch {
    return { userId: null, role: null };
  }
}

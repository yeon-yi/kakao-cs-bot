import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '@kakao-cs-bot/api/src/routers';

export const trpc: ReturnType<typeof createTRPCReact<AppRouter>> = createTRPCReact<AppRouter>();

export function getBaseUrl() {
  if (typeof window !== 'undefined') return '';
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
}

export function getTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${getBaseUrl()}/trpc`,
        transformer: superjson,
        headers() {
          const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
          return token ? { authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}

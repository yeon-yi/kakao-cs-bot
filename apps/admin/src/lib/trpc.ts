import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '@kakao-cs-bot/api/src/routers';

export const trpc: ReturnType<typeof createTRPCReact<AppRouter>> = createTRPCReact<AppRouter>();

export function getBaseUrl() {
  // 브라우저: 상대경로 사용 (nginx 프록시가 /trpc/ → API로 라우팅)
  if (typeof window !== 'undefined') return '';
  // 서버사이드: 직접 API 호출
  return process.env.API_URL || 'http://localhost:3000';
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

'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import { trpc, getTrpcClient } from '@/lib/trpc';

function handleAuthError(error: unknown) {
  if (
    typeof window !== 'undefined' &&
    error &&
    typeof error === 'object' &&
    'data' in error &&
    (error as any).data?.code === 'UNAUTHORIZED'
  ) {
    localStorage.removeItem('token');
    if (window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    queryCache: new QueryCache({
      onError: handleAuthError,
    }),
    mutationCache: new MutationCache({
      onError: handleAuthError,
    }),
    defaultOptions: {
      queries: {
        staleTime: 5000,
        retry: (failureCount, error) => {
          if ((error as any)?.data?.code === 'UNAUTHORIZED') return false;
          return failureCount < 3;
        },
      },
    },
  }));
  const [trpcClient] = useState(() => getTrpcClient());

  return (
    <QueryClientProvider client={queryClient}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        {children}
      </trpc.Provider>
    </QueryClientProvider>
  );
}

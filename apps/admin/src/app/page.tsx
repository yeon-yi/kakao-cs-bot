'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { trpc } from '@/lib/trpc';

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [checking, setChecking] = useState(true);

  const autoLoginMutation = trpc.auth.autoLogin.useMutation({
    onSuccess: (data) => {
      localStorage.setItem('token', data.token);
      window.history.replaceState({}, '', '/');
      router.push('/dashboard');
    },
    onError: () => {
      router.push('/login');
    },
  });

  useEffect(() => {
    const key = searchParams.get('key');

    if (key) {
      autoLoginMutation.mutate({ key });
      return;
    }

    const token = localStorage.getItem('token');
    if (token) {
      router.push('/dashboard');
    } else {
      router.push('/login');
    }
    setChecking(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-lg text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return null;
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center">
        <div className="text-lg text-muted-foreground">Loading...</div>
      </div>
    }>
      <HomeContent />
    </Suspense>
  );
}

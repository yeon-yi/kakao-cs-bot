'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: (data) => {
      localStorage.setItem('token', data.token);
      router.push('/dashboard');
    },
    onError: (err) => setError(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    loginMutation.mutate({ username, password });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-lg font-bold text-white shadow-lg shadow-blue-600/25">
            CS
          </div>
          <h1 className="text-xl font-semibold text-zinc-900">CS Bot Admin</h1>
          <p className="mt-1 text-sm text-zinc-500">관리자 대시보드에 로그인하세요</p>
        </div>

        <div className="rounded-2xl border border-zinc-200/60 bg-white p-6 shadow-xl shadow-zinc-200/40">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-700">아이디</label>
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
                placeholder="admin"
                required
                autoComplete="username"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-zinc-700">비밀번호</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.currentTarget.value)}
                required
                autoComplete="current-password"
              />
            </div>

            <Button type="submit" disabled={loginMutation.isPending} className="w-full">
              {loginMutation.isPending ? '로그인 중...' : '로그인'}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-zinc-400">
          KakaoTalk CS Bot Administration
        </p>
      </div>
    </div>
  );
}

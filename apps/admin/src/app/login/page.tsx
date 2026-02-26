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
    <div className="flex min-h-screen">
      {/* Left Brand Area */}
      <div className="hidden lg:flex lg:w-[480px] flex-col justify-between bg-[hsl(var(--sidebar-bg))] px-12 py-10">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-[22px] font-bold text-white tracking-tight">OpenPLAT</span>
          </div>
        </div>

        <div>
          <h2 className="text-[28px] font-bold text-white leading-snug tracking-tight">
            고객 응대<br />자동화 플랫폼
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-slate-400">
            카카오톡 기반 CS 자동 응답 시스템을 관리하고,<br />
            AI 학습 현황을 모니터링하세요.
          </p>
          <div className="mt-8 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[hsl(var(--sidebar-hover))]">
                <svg className="h-3.5 w-3.5 text-[hsl(var(--sidebar-active))]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-sm text-slate-300">실시간 대화 모니터링</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[hsl(var(--sidebar-hover))]">
                <svg className="h-3.5 w-3.5 text-[hsl(var(--sidebar-active))]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-sm text-slate-300">AI 지식 베이스 관리</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[hsl(var(--sidebar-hover))]">
                <svg className="h-3.5 w-3.5 text-[hsl(var(--sidebar-active))]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-sm text-slate-300">에스컬레이션 자동 분류</span>
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-600">
          &copy; 2026 (주)모집 관리팀. All rights reserved.
        </p>
      </div>

      {/* Right Login Area */}
      <div className="flex flex-1 flex-col items-center justify-center bg-[hsl(var(--background))] px-6">
        <div className="w-full max-w-[360px]">
          {/* Mobile brand (shown only on small screens) */}
          <div className="mb-8 lg:hidden">
            <span className="text-xl font-bold text-[hsl(var(--foreground))] tracking-tight">OpenPLAT</span>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">고객 응대 자동화 플랫폼</p>
          </div>

          <div className="mb-6">
            <h1 className="text-lg font-semibold text-[hsl(var(--foreground))]">로그인</h1>
            <p className="mt-1 text-sm text-[hsl(var(--muted))]">관리자 계정으로 로그인하세요</p>
          </div>

          <div className="rounded-lg border border-[hsl(var(--border))] bg-white p-6 shadow-sm">
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-md bg-red-50 px-3 py-2.5 text-sm text-red-600 border border-red-100">
                  {error}
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-sm font-medium text-[hsl(var(--foreground))]">
                  아이디
                </label>
                <Input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.currentTarget.value)}
                  placeholder="사용자 아이디 입력"
                  required
                  autoComplete="username"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-[hsl(var(--foreground))]">
                  비밀번호
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                  placeholder="비밀번호 입력"
                  required
                  autoComplete="current-password"
                />
              </div>

              <Button type="submit" disabled={loginMutation.isPending} className="w-full">
                {loginMutation.isPending ? '로그인 중...' : '로그인'}
              </Button>
            </form>
          </div>

          <p className="mt-6 text-center text-xs text-[hsl(var(--muted))]">
            &copy; 2026 (주)모집 관리팀. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}

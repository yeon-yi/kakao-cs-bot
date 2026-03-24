'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
/* eslint-disable @next/next/no-img-element */

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || '로그인에 실패했습니다.');
        return;
      }

      // 역할별 리다이렉트
      const role = data.user?.role || '';
      if (['upselling_director', 'upselling_chief', 'upselling_staff'].includes(role)) {
        router.push('/upsell/dashboard');
      } else {
        router.push('/dashboard');
      }
    } catch {
      setError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh md:min-h-screen">
      {/* Left Panel - Branding (PC only) */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[540px] flex-col justify-between relative overflow-hidden"
        style={{ backgroundColor: '#0f172a' }}>
        {/* Geometric pattern overlay */}
        <div className="absolute inset-0 opacity-[0.04]">
          <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
                <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#ffffff" strokeWidth="0.5" />
              </pattern>
              <pattern id="diag" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 0 40 L 40 0" fill="none" stroke="#ffffff" strokeWidth="0.3" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
            <rect width="100%" height="100%" fill="url(#diag)" />
          </svg>
        </div>

        {/* Gradient accent line at left edge */}
        <div className="absolute left-0 top-0 bottom-0 w-[3px]"
          style={{ background: 'linear-gradient(to bottom, #2563eb, #1e40af, #1e3a5f)' }} />

        {/* Top: Logo and branding */}
        <div className="relative z-10 px-12 pt-14">
          {/* Logo mark */}
          <div className="flex items-center gap-3 mb-2">
            <img
              src="/favicon.png"
              alt="플랫폼"
              width={36}
              height={36}
              style={{ borderRadius: '8px' }}
            />
          </div>
        </div>

        {/* Center: Main text */}
        <div className="relative z-10 px-12 flex-1 flex flex-col justify-center -mt-10">
          <div className="mb-6">
            <img
              src="/logo-white.png"
              alt="PLATFORM"
              width={200}
              height={35}
              style={{ objectFit: 'contain' }}
            />
          </div>
          <h1 className="text-white text-[2rem] font-bold leading-tight tracking-tight mb-3"
            style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}>
            관리 CRM
          </h1>
          <p className="text-[#64748b] text-[15px] leading-relaxed mb-8">
            업체 관리 시스템
          </p>

          {/* Divider */}
          <div className="w-12 h-[2px] mb-8" style={{ backgroundColor: '#1e3a5f' }} />

          <p className="text-[#475569] text-[13px] leading-6 max-w-[320px]">
            업체 정보, 영업 현황, 거래처 관리를<br />
            통합 환경에서 효율적으로 운영합니다.
          </p>
        </div>

        {/* Bottom: Footer */}
        <div className="relative z-10 px-12 pb-10">
          <div className="border-t border-white/[0.06] pt-6">
            <p className="text-[#334155] text-xs">
              &copy; (주)모집 플랫폼 관리팀
            </p>
          </div>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="flex-1 flex items-center justify-center bg-[#f8fafc] md:bg-white px-5 sm:px-8 md:px-12 py-8 md:py-0">
        <div className="w-full max-w-[380px]">
          {/* Mobile branding (visible only on small screens) */}
          <div className="lg:hidden mb-8 md:mb-10">
            <div className="flex flex-col items-center md:items-start gap-3 md:flex-row md:gap-2.5 mb-3 md:mb-6">
              <img
                src="/favicon.png"
                alt="플랫폼"
                width={44}
                height={44}
                className="md:w-7 md:h-7"
                style={{ borderRadius: '12px' }}
              />
              <span className="text-[#0f172a] text-xl md:text-lg font-bold tracking-tight">
                관리 CRM
              </span>
            </div>
            <p className="text-[#94a3b8] text-[13px] text-center md:text-left">
              업체 관리 시스템
            </p>
          </div>

          {/* Form header */}
          <div className="mb-6 md:mb-8">
            <h2 className="text-[#0f172a] text-xl md:text-[22px] font-semibold tracking-tight mb-1 md:mb-1.5">
              로그인
            </h2>
            <p className="text-[#94a3b8] text-[13px] md:text-sm">
              계정 정보를 입력하여 로그인하세요.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4 md:space-y-5">
            {/* Username */}
            <div>
              <label
                htmlFor="username"
                className="block text-[#334155] text-sm md:text-[13px] font-medium mb-2 md:mb-1.5"
              >
                아이디
              </label>
              <input
                id="username"
                type="text"
                required
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="사용자 아이디를 입력하세요"
                className="w-full h-12 md:h-11 px-4 md:px-3.5 text-[16px] md:text-[14px] text-[#0f172a] placeholder:text-[#cbd5e1]
                  border border-[#e2e8f0] bg-white rounded-lg md:rounded
                  outline-none transition-colors duration-150
                  focus:border-[#2563eb] focus:ring-2 md:focus:ring-1 focus:ring-[#2563eb]/20"
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="password"
                className="block text-[#334155] text-sm md:text-[13px] font-medium mb-2 md:mb-1.5"
              >
                비밀번호
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호를 입력하세요"
                className="w-full h-12 md:h-11 px-4 md:px-3.5 text-[16px] md:text-[14px] text-[#0f172a] placeholder:text-[#cbd5e1]
                  border border-[#e2e8f0] bg-white rounded-lg md:rounded
                  outline-none transition-colors duration-150
                  focus:border-[#2563eb] focus:ring-2 md:focus:ring-1 focus:ring-[#2563eb]/20"
              />
            </div>

            {/* Error message */}
            {error && (
              <div className="flex items-start gap-2.5 md:gap-2 py-3 md:py-2.5 px-3.5 md:px-3 bg-[#fef2f2] border border-[#fecaca] rounded-lg md:rounded">
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none"
                  xmlns="http://www.w3.org/2000/svg" className="shrink-0 mt-0.5 md:w-4 md:h-4">
                  <circle cx="8" cy="8" r="7" stroke="#dc2626" strokeWidth="1.5" />
                  <path d="M8 4.5V8.5" stroke="#dc2626" strokeWidth="1.5" strokeLinecap="square" />
                  <rect x="7.25" y="10" width="1.5" height="1.5" fill="#dc2626" />
                </svg>
                <p className="text-[#dc2626] text-sm md:text-[13px] leading-5">{error}</p>
              </div>
            )}

            {/* Submit button */}
            <div className="pt-1 md:pt-0">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-[52px] md:h-11 text-white text-[15px] md:text-[14px] font-semibold md:font-medium tracking-wide
                  rounded-xl md:rounded
                  transition-colors duration-150
                  disabled:opacity-50 disabled:cursor-not-allowed
                  cursor-pointer active:scale-[0.98] md:active:scale-100"
                style={{
                  backgroundColor: isLoading ? '#93c5fd' : '#2563eb',
                }}
                onMouseEnter={(e) => {
                  if (!isLoading) (e.target as HTMLButtonElement).style.backgroundColor = '#1d4ed8';
                }}
                onMouseLeave={(e) => {
                  if (!isLoading) (e.target as HTMLButtonElement).style.backgroundColor = '#2563eb';
                }}
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2.5 md:gap-2">
                    <svg className="animate-spin h-5 w-5 md:h-4 md:w-4" viewBox="0 0 24 24" fill="none"
                      xmlns="http://www.w3.org/2000/svg">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"
                        strokeLinecap="round" className="opacity-25" />
                      <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3"
                        strokeLinecap="round" />
                    </svg>
                    로그인 중...
                  </span>
                ) : (
                  '로그인'
                )}
              </button>
            </div>
          </form>

          {/* Footer note */}
          <div className="mt-8 md:mt-10 pt-5 md:pt-6 border-t border-[#f1f5f9]">
            <p className="text-[#94a3b8] text-xs leading-5 text-center md:text-left">
              계정 관련 문의는 시스템 관리자에게 연락하세요.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

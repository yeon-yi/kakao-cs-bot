'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dashboard', label: '대시보드', icon: '📊' },
  { href: '/dashboard/analytics', label: '분석', icon: '📈' },
  { href: '/knowledge', label: '지식 관리', icon: '📚' },
  { href: '/knowledge/add', label: '지식 추가', icon: '➕' },
  { href: '/conversations', label: '대화 이력', icon: '💬' },
  { href: '/identity', label: '신원 관리', icon: '👤' },
  { href: '/config/prompts', label: '프롬프트', icon: '📝' },
  { href: '/config/general', label: '설정', icon: '⚙️' },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = () => {
    localStorage.removeItem('token');
    router.push('/login');
  };

  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-card">
      <div className="border-b p-4">
        <h2 className="text-lg font-bold">CS Bot Admin</h2>
        <p className="text-xs text-muted-foreground">KakaoTalk AI 챗봇</p>
      </div>

      <nav className="flex-1 overflow-y-auto p-2">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
              pathname === item.href
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <span>{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="border-t p-2">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          🚪 로그아웃
        </button>
      </div>
    </aside>
  );
}

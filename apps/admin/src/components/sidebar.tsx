'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';

const navItems = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/dashboard/analytics', label: 'Analytics' },
  { href: '/knowledge', label: 'Knowledge Base', divider: true },
  { href: '/knowledge/add', label: 'Add Knowledge' },
  { href: '/knowledge/upload', label: 'File Import' },
  { href: '/knowledge/chat', label: 'Chat Training' },
  { href: '/knowledge/feedback', label: 'Escalations', badge: true },
  { href: '/conversations', label: 'Conversations', divider: true },
  { href: '/identity', label: 'Identity' },
  { href: '/config/prompts', label: 'Prompts' },
  { href: '/config/assignees', label: 'Assignees' },
  { href: '/config/general', label: 'Settings' },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const { data: pendingData } = trpc.escalation.pendingCount.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const handleLogout = () => {
    localStorage.removeItem('token');
    router.push('/login');
  };

  return (
    <aside className="flex h-screen w-60 flex-col border-r bg-zinc-950 text-zinc-300">
      <div className="border-b border-zinc-800 px-5 py-5">
        <h2 className="text-base font-semibold tracking-tight text-white">CS Bot</h2>
        <p className="text-[11px] text-zinc-500 mt-0.5">Admin Console</p>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-3">
        {navItems.map((item) => (
          <div key={item.href}>
            {'divider' in item && item.divider && (
              <div className="my-2 border-t border-zinc-800" />
            )}
            <Link
              href={item.href}
              className={cn(
                'flex items-center justify-between rounded px-3 py-1.5 text-[13px] transition-colors',
                pathname === item.href
                  ? 'bg-zinc-800 text-white font-medium'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200',
              )}
            >
              <span>{item.label}</span>
              {'badge' in item && item.badge && pendingData && pendingData.count > 0 && (
                <span className="ml-2 px-1.5 py-0.5 text-[10px] font-medium bg-red-500 text-white rounded-full leading-none">
                  {pendingData.count}
                </span>
              )}
            </Link>
          </div>
        ))}
      </nav>

      <div className="border-t border-zinc-800 p-3">
        <button
          onClick={handleLogout}
          className="block w-full rounded px-3 py-1.5 text-left text-[13px] text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300 transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}

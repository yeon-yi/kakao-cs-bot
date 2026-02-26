'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import {
  LayoutDashboard, BarChart3, BookOpen, PlusCircle, Upload, MessageSquare,
  AlertCircle, MessagesSquare, UserCheck, Bell, FileText, Users,
  UserCog, Settings, LogOut, AlertTriangle, Smartphone, Download,
  GraduationCap,
} from 'lucide-react';

const navSections = [
  {
    items: [
      { href: '/dashboard', label: '대시보드', icon: LayoutDashboard },
      { href: '/dashboard/analytics', label: '분석', icon: BarChart3 },
      { href: '/dashboard/devices', label: '연결 기기', icon: Smartphone, badge: 'devices' as const },
      { href: '/dashboard/download', label: '앱 다운로드', icon: Download },
    ],
  },
  {
    title: '지식 관리',
    items: [
      { href: '/knowledge', label: '지식 목록', icon: BookOpen },
      { href: '/knowledge/add', label: '지식 추가', icon: PlusCircle },
      { href: '/knowledge/upload', label: '파일 업로드', icon: Upload },
      { href: '/knowledge/chat', label: '대화형 학습', icon: MessageSquare },
      { href: '/knowledge/learn', label: '대화 학습', icon: GraduationCap },
      { href: '/knowledge/feedback', label: '에스컬레이션', icon: AlertCircle, badge: true as const },
      { href: '/knowledge/uncertainty', label: '불확실 주제', icon: AlertTriangle, badge: 'uncertainty' as const },
    ],
  },
  {
    title: '운영',
    items: [
      { href: '/conversations', label: '대화 이력', icon: MessagesSquare },
      { href: '/identity', label: '신원 확인', icon: UserCheck },
      { href: '/config/proactive', label: '자동 인사/차단', icon: Bell },
    ],
  },
  {
    title: '설정',
    items: [
      { href: '/config/prompts', label: '프롬프트', icon: FileText },
      { href: '/config/staff', label: '직원 관리', icon: Users },
      { href: '/config/assignees', label: '담당자 배정', icon: UserCog },
      { href: '/config/general', label: '일반 설정', icon: Settings },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  const { data: pendingData } = trpc.escalation.pendingCount.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const { data: uncertaintyData } = trpc.uncertainty.openCount.useQuery(undefined, {
    refetchInterval: 60000,
  });
  const { data: deviceSummary } = trpc.devices.summary.useQuery(undefined, {
    refetchInterval: 15000,
  });

  const handleLogout = () => {
    localStorage.removeItem('token');
    router.push('/login');
  };

  return (
    <aside className="flex h-screen w-[216px] flex-col bg-[hsl(var(--sidebar-bg))] text-[hsl(var(--sidebar-text))] select-none">
      {/* Logo */}
      <div className="px-5 py-4 border-b border-white/[0.06]">
        <p className="text-[15px] font-bold text-white tracking-tight leading-none">OpenPLAT</p>
        <p className="text-[10px] text-slate-500 mt-1">CS Management</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-2 py-3">
        {navSections.map((section, si) => (
          <div key={si} className={si > 0 ? 'mt-4' : ''}>
            {section.title && (
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                {section.title}
              </p>
            )}
            <div className="space-y-px">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'));
                const hasBadge = 'badge' in item && item.badge === true && pendingData && pendingData.count > 0;
                const hasUncertaintyBadge = 'badge' in item && item.badge === 'uncertainty' && uncertaintyData && uncertaintyData.count > 0;
                const hasDeviceBadge = 'badge' in item && item.badge === 'devices' && deviceSummary;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'relative flex items-center gap-2.5 rounded-md px-3 py-[7px] text-[13px] transition-colors',
                      isActive
                        ? 'text-white bg-[hsl(var(--sidebar-hover))]'
                        : 'hover:bg-[hsl(var(--sidebar-hover))] hover:text-slate-200',
                    )}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-r-sm bg-[hsl(var(--sidebar-active))]" />
                    )}
                    <Icon size={15} className={isActive ? 'text-[hsl(var(--sidebar-active))]' : 'text-slate-500'} />
                    <span className="flex-1">{item.label}</span>
                    {hasBadge && (
                      <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white leading-none">
                        {pendingData.count}
                      </span>
                    )}
                    {hasUncertaintyBadge && (
                      <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white leading-none">
                        {uncertaintyData.count}
                      </span>
                    )}
                    {hasDeviceBadge && (
                      <span className={cn(
                        'flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white leading-none',
                        deviceSummary.error > 0 ? 'bg-red-500' : deviceSummary.online > 0 ? 'bg-emerald-500' : 'bg-zinc-500'
                      )}>
                        {deviceSummary.online}/{deviceSummary.total}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Logout */}
      <div className="border-t border-white/[0.06] p-2">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-[7px] text-[13px] text-slate-500 transition-colors hover:bg-[hsl(var(--sidebar-hover))] hover:text-slate-300"
        >
          <LogOut size={15} />
          <span>로그아웃</span>
        </button>
      </div>
    </aside>
  );
}

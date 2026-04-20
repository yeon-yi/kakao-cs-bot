'use client';

import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title: string;
  value: string | number;
  unit?: string;
  icon: LucideIcon;
  sub?: string;
  alert?: boolean;
  warn?: boolean;
  onClick?: () => void;
}

export function StatCard({ title, value, unit, icon: Icon, sub, alert, warn, onClick }: StatCardProps) {
  const bar = alert ? 'bg-red-500' : warn ? 'bg-amber-500' : null;
  const border = alert ? 'border-red-300' : 'border-[hsl(var(--border))]';
  const iconColor = alert ? 'text-red-500' : warn ? 'text-amber-500' : 'text-[hsl(var(--muted-foreground))]';

  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={cn(
        'relative overflow-hidden rounded-lg border bg-white p-4 shadow-sm text-left w-full',
        border,
        onClick && 'hover:shadow-md transition-shadow cursor-pointer',
      )}
    >
      {bar && <div className={cn('absolute left-0 top-0 bottom-0 w-[3px]', bar)} />}
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[hsl(var(--muted-foreground))] truncate">{title}</p>
          <p className="mt-1.5 text-2xl font-bold text-[hsl(var(--foreground))] tracking-tight">
            {typeof value === 'number' ? value.toLocaleString() : value}
            {unit && <span className="ml-1 text-xs font-normal text-[hsl(var(--muted-foreground))]">{unit}</span>}
          </p>
          {sub && <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">{sub}</p>}
        </div>
        <Icon size={16} className={cn('shrink-0 mt-0.5', iconColor)} />
      </div>
    </Comp>
  );
}

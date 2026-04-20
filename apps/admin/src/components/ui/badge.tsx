import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const variants = {
  default: 'bg-slate-100 text-slate-600',
  secondary: 'bg-slate-100 text-slate-600',
  primary: 'bg-blue-50 text-blue-700',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  destructive: 'bg-red-50 text-red-700',
  purple: 'bg-violet-50 text-violet-700',
  outline: 'border border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] bg-white',
} as const;

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: keyof typeof variants;
}

export function Badge({ variant = 'default', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium leading-tight',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

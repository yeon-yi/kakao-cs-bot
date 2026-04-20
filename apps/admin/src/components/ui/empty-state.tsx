import { type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center py-16 text-[hsl(var(--muted-foreground))]', className)}>
      <Icon size={28} className="mb-3 text-zinc-300" />
      <p className="text-sm font-medium text-[hsl(var(--foreground))]">{title}</p>
      {description && <p className="mt-1 text-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

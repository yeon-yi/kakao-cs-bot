'use client';

import { cn } from '@/lib/utils';

interface TabItem {
  value: string;
  label: string;
  count?: number;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function Tabs({ items, value, onChange, className }: TabsProps) {
  return (
    <div className={cn('flex items-center gap-1 border-b border-[hsl(var(--border))]', className)}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={cn(
              'relative px-3 py-2 text-sm transition-colors -mb-px border-b-2',
              active
                ? 'border-[hsl(var(--primary))] text-[hsl(var(--foreground))] font-semibold'
                : 'border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]',
            )}
          >
            <span>{item.label}</span>
            {typeof item.count === 'number' && (
              <span className="ml-1.5 inline-flex items-center rounded-full bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

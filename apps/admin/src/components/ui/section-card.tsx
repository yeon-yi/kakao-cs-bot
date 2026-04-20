import { cn } from '@/lib/utils';

interface SectionCardProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}

export function SectionCard({ title, description, action, className, bodyClassName, children }: SectionCardProps) {
  return (
    <section className={cn('rounded-lg border border-[hsl(var(--border))] bg-white shadow-sm', className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-4 border-b border-[hsl(var(--border))] px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-[hsl(var(--foreground))]">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

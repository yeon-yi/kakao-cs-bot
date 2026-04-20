'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DrawerSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  widthClass?: string;
}

export function DrawerSheet({ open, onClose, title, description, footer, children, widthClass = 'w-[440px]' }: DrawerSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <aside className={cn('absolute right-0 top-0 h-full bg-white shadow-xl flex flex-col', widthClass)}>
        <header className="flex items-start justify-between gap-3 border-b border-[hsl(var(--border))] px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-[hsl(var(--foreground))]">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{description}</p>}
          </div>
          <button onClick={onClose} className="rounded p-1 text-[hsl(var(--muted-foreground))] hover:bg-zinc-100" aria-label="닫기">
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto scrollbar-thin p-4">{children}</div>
        {footer && <footer className="border-t border-[hsl(var(--border))] px-4 py-3">{footer}</footer>}
      </aside>
    </div>
  );
}

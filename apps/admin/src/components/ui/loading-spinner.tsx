import { cn } from '@/lib/utils';

interface LoadingSpinnerProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  fullPage?: boolean;
}

export function LoadingSpinner({ className, size = 'md', fullPage }: LoadingSpinnerProps) {
  const sizeClass = size === 'sm' ? 'h-4 w-4 border-[1.5px]' : size === 'lg' ? 'h-10 w-10 border-[3px]' : 'h-8 w-8 border-2';
  const spinner = (
    <div className={cn('animate-spin rounded-full border-blue-600 border-t-transparent', sizeClass, className)} />
  );
  if (fullPage) {
    return <div className="flex items-center justify-center py-20">{spinner}</div>;
  }
  return spinner;
}

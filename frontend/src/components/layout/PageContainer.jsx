import { cn } from '@/lib/utils';

export function PageContainer({ children, className }) {
  return <div className={cn('flex flex-col gap-page', className)}>{children}</div>;
}

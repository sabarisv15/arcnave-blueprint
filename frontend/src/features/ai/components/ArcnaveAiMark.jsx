import { cn } from '@/lib/utils';

// ARCNAVE AI's own mark — an 8-point starburst, generic UI motif (not
// a reproduction of any third party's logo asset), rendered in the
// existing --gold token so it reads as ARCNAVE on the workspace's dark
// surface, the same accent already used for the send button etc.
export function ArcnaveAiMark({ className, size = 20 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cn('text-primary', className)}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 0c.6 3.6 1.9 6.2 4 8.3 2.1 2.1 4.7 3.4 8 4-3.3.6-5.9 1.9-8 4-2.1 2.1-3.4 4.7-4 8-.6-3.3-1.9-5.9-4-8-2.1-2.1-4.7-3.4-8-4 3.3-.6 5.9-1.9 8-4 2.1-2.1 3.4-4.7 4-8Z" />
    </svg>
  );
}

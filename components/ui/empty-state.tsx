// Not in the @bb shadcn registry (upstream dropped its own EmptyState/PageBody/
// Spinner extras — "write your own"), so this is a minimal hand-rolled version.
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export interface EmptyStateProps {
  message: ReactNode;
  icon?: ReactNode;
  className?: string;
}

function EmptyState({ message, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground",
        className,
      )}
    >
      {icon}
      <p>{message}</p>
    </div>
  );
}

export { EmptyState };

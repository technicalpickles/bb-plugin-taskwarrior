// Not in the @bb shadcn registry (registry.json excludes it deliberately),
// so this is hand-rolled to match Badge's shape/tokens with the extra
// "emphasis" variant and rounded-full shape the design calls for.
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

const pillVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "border-transparent bg-foreground text-background",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground",
        emphasis: "border-transparent bg-primary text-primary-foreground",
        outline: "border-border text-foreground",
      },
      size: {
        default: "text-xs",
        sm: "px-1.5 py-0 text-[11px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface PillProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pillVariants> {}

function Pill({ className, variant, size, ...props }: PillProps) {
  return (
    <span className={cn(pillVariants({ variant, size }), className)} {...props} />
  );
}

export { Pill, pillVariants };

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-white shadow",
        success:
          "border-transparent bg-success text-white shadow",
        warning:
          "border-transparent bg-warning text-foreground shadow",
        accent:
          "border-transparent bg-accent text-accent-foreground shadow",
        outline:
          "text-foreground border-border",
      },
      size: {
        sm: "px-2 py-0.5 text-[10px]",
        default: "px-2.5 py-0.5 text-xs",
        lg: "px-3 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  icon?: React.ReactNode;
  dot?: boolean;
  dotColor?: string;
}

function Badge({
  className,
  variant,
  size,
  icon,
  dot,
  dotColor,
  children,
  ...props
}: BadgeProps) {
  return (
    <div
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    >
      {dot && (
        <span
          className={cn(
            "size-1.5 rounded-full",
            dotColor || "bg-current"
          )}
          style={dotColor ? { backgroundColor: dotColor } : undefined}
        />
      )}
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </div>
  );
}

export { Badge, badgeVariants };

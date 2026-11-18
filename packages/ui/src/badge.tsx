import type { ComponentProps } from "@solidjs/web";
import { splitProps } from "./lib/solid";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./lib/cn";

const badgeVariants = cva(
  "inline-flex h-[20px] shrink-0 items-center gap-1 rounded-[5px] border px-1.5 text-[11px] font-[520] tracking-[-0.004em] whitespace-nowrap [&_svg:not([class*='size-'])]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border bg-card text-muted-foreground",
        subtle: "border-transparent bg-hover text-muted-foreground",
        success: "border-transparent bg-success/10 text-success",
        warning: "border-transparent bg-warning/10 text-warning",
        destructive: "border-transparent bg-destructive/10 text-destructive",
        info: "border-transparent bg-info/10 text-info",
        brand: "border-transparent bg-brand-muted text-brand",
      },
    },
    defaultVariants: { variant: "outline" },
  },
);

export type BadgeProps = ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    /** Draws a coloured dot before the label. */
    dot?: "success" | "warning" | "destructive" | "info" | "neutral";
  };

const dotColour: Record<NonNullable<BadgeProps["dot"]>, string> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
  neutral: "bg-muted-foreground",
};

function Badge(props: BadgeProps) {
  const [local, others] = splitProps(props, ["class", "variant", "dot", "children"]);

  return (
    <span
      data-slot="badge"
      class={cn(badgeVariants({ variant: local.variant }), local.class)}
      {...others}
    >
      {local.dot ? (
        <span
          aria-hidden="true"
          class={cn("size-1.5 shrink-0 rounded-full", dotColour[local.dot])}
        />
      ) : null}
      {local.children}
    </span>
  );
}

export { Badge, badgeVariants };

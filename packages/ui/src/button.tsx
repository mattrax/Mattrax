import { Dynamic, type ComponentProps, type JSX } from "@solidjs/web";
import { splitProps } from "./lib/solid";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "./lib/cn";
import { Spinner } from "./spinner";

/**
 * The one action component.
 *
 * Near-black is the primary action; grey hovers and hairlines do the rest.
 * `as="a"` keeps links looking and behaving like buttons without nesting a
 * button inside an anchor.
 */
const buttonVariants = cva(
  [
    "group/button group relative inline-flex shrink-0 select-none items-center justify-center gap-1.5",
    "whitespace-nowrap rounded-md border border-transparent font-[500] tracking-[-0.006em]",
    "outline-none transition-[background-color,border-color,color,box-shadow,transform,opacity]",
    "duration-[var(--duration-hover)] ease-swift focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30",
    "disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 data-pending:!opacity-100 data-pending:cursor-progress",
    "motion-safe:active:scale-[0.985] disabled:motion-safe:active:scale-100 aria-disabled:motion-safe:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_1px_1px_rgb(24_24_22/0.08)] hover:bg-primary/90",
        outline:
          "border-border bg-card text-foreground shadow-[0_1px_1px_rgb(24_24_22/0.03)] hover:border-border-strong hover:bg-hover",
        secondary: "bg-secondary text-secondary-foreground hover:bg-active",
        ghost: "text-muted-foreground hover:bg-hover hover:text-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        link: "h-auto border-0 bg-transparent px-0 text-brand underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3 text-[13px] [&_svg:not([class*='size-'])]:size-4",
        xs: "h-6 gap-1 rounded-[6px] px-2 text-[11.5px] [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-7 gap-1.5 rounded-[7px] px-2.5 text-[12px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 px-4 text-[13.5px] [&_svg:not([class*='size-'])]:size-4",
        icon: "size-8 p-0 [&_svg:not([class*='size-'])]:size-4",
        "icon-xs": "size-6 rounded-[6px] p-0 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7 rounded-[7px] p-0 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-9 p-0 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type ButtonOwnProps = VariantProps<typeof buttonVariants> & {
  /** Render as an anchor. Any other value renders a button. */
  as?: "button" | "a";
  /** Shows a spinner and marks the button busy. */
  pending?: boolean;
  class?: string;
  children?: JSX.Element;
};

export type ButtonProps = ButtonOwnProps &
  Omit<ComponentProps<"button">, "class" | "children"> &
  Omit<ComponentProps<"a">, "class" | "children">;

function Button(props: ButtonProps) {
  const [local, others] = splitProps(props, [
    "variant",
    "size",
    "as",
    "pending",
    "class",
    "children",
    "disabled",
    "aria-busy",
  ]);

  const busy = () => local.pending === true;

  return (
    <Dynamic
      component={local.as === "a" ? "a" : "button"}
      data-slot="button"
      data-size={local.size ?? "default"}
      data-pending={busy() ? "" : undefined}
      class={cn(buttonVariants({ variant: local.variant, size: local.size }), local.class)}
      disabled={local.as === "a" ? undefined : local.disabled || busy()}
      aria-busy={busy() ? "true" : local["aria-busy"]}
      {...others}
    >
      {busy() ? <Spinner class="size-3.5" /> : null}
      {local.children}
    </Dynamic>
  );
}

export { Button, buttonVariants };

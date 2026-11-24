import type { JSX } from "@solidjs/web";
import { cn } from "~/lib/utils";

/**
 * Status badges use the tone colour itself on a tinted fill. Using a
 * `*-foreground` token here would invert in dark mode (those tokens are the
 * text colour for a solid fill), which made success labels unreadable.
 */
const tones = {
  neutral: "border-border bg-surface text-muted-foreground",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
} as const;

export type StatusTone = keyof typeof tones;

export function StatusChip(props: {
  tone: StatusTone;
  children: JSX.Element;
  class?: string;
  capitalize?: boolean;
}) {
  return (
    <span
      class={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        props.capitalize && "capitalize",
        tones[props.tone],
        props.class,
      )}
    >
      <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {props.children}
    </span>
  );
}

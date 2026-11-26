import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { CircleAlert } from "~/components/ui/icons";
import { cn } from "~/lib/utils";

/**
 * The one way a settings section says it still needs setup: a quiet inset card
 * with a warning mark, what is missing, and the action that fixes it. Avoid
 * stacking a separate status badge and callout above it.
 */
export default function SetupNotice(props: {
  title: string;
  description: JSX.Element;
  icon?: JSX.Element;
  action?: JSX.Element;
  children?: JSX.Element;
  class?: string;
}) {
  return (
    <div
      data-slot="setup-notice"
      class={cn("rounded-lg border border-border bg-surface/40", props.class)}
    >
      <div class="flex items-start gap-3 p-3.5">
        <span class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-warning/25 bg-warning/[0.08] text-warning [&_svg]:size-4">
          {props.icon ?? <CircleAlert />}
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-xs font-medium leading-5 text-foreground">{props.title}</p>
          <div class="mt-1 text-xs leading-5 text-muted-foreground">{props.description}</div>
          <Show when={props.action}>
            <div class="mt-3 flex flex-wrap items-center gap-2">{props.action}</div>
          </Show>
          <Show when={props.children}>
            <div class="mt-3">{props.children}</div>
          </Show>
        </div>
      </div>
    </div>
  );
}

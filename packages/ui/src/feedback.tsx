import type { ComponentProps, JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import { splitProps } from "./lib/solid";
import { cn } from "./lib/cn";
import { ChevronRight } from "./icons";

type Crumb = { label: string; href?: string };

/** Breadcrumbs that sit above a page title. `current` is not a link. */
function Breadcrumb(props: { items: Crumb[]; class?: string }) {
  const [local] = splitProps(props, ["items", "class"]);

  return (
    <nav aria-label="Breadcrumb" class={cn("min-w-0", local.class)}>
      <ol class="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        <For each={local.items}>
          {(item, index) => (
            <li class="flex min-w-0 items-center gap-1">
              <Show when={index() > 0}>
                <ChevronRight class="size-3 shrink-0 text-subtle-foreground/70" />
              </Show>
              <Show
                when={item.href}
                fallback={<span class="truncate text-foreground">{item.label}</span>}
              >
                {(href) => (
                  <a
                    href={href()}
                    class="truncate outline-none transition-colors hover:text-foreground focus-visible:text-foreground"
                  >
                    {item.label}
                  </a>
                )}
              </Show>
            </li>
          )}
        </For>
      </ol>
    </nav>
  );
}

/** A shared empty state: icon, one-line explanation and an optional action. */
function EmptyState(props: {
  icon?: JSX.Element;
  title: string;
  description?: JSX.Element;
  action?: JSX.Element;
  class?: string;
}) {
  return (
    <div
      data-slot="empty-state"
      class={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong bg-card px-6 py-10 text-center",
        props.class,
      )}
    >
      <Show when={props.icon}>
        <div class="mb-1 flex size-9 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground [&_svg]:size-4">
          {props.icon}
        </div>
      </Show>
      <div class="text-xs font-medium text-foreground">{props.title}</div>
      <Show when={props.description}>
        <div class="max-w-sm text-xs leading-5 text-muted-foreground">{props.description}</div>
      </Show>
      <Show when={props.action}>
        <div class="mt-2">{props.action}</div>
      </Show>
    </div>
  );
}

type AlertTone = "info" | "success" | "warning" | "destructive" | "neutral";

const alertTone: Record<AlertTone, string> = {
  info: "border-info/25 bg-info/[0.06] text-info",
  success: "border-success/25 bg-success/[0.06] text-success",
  warning: "border-warning/25 bg-warning/[0.07] text-warning",
  destructive: "border-destructive/25 bg-destructive/[0.06] text-destructive",
  neutral: "border-border bg-surface text-muted-foreground",
};

/** An inline message. Use the tone for the meaning, not the decoration. */
function Alert(
  props: Omit<ComponentProps<"div">, "style"> & {
    tone?: AlertTone;
    icon?: JSX.Element;
    title?: string;
    action?: JSX.Element;
  },
) {
  const [local, others] = splitProps(props, [
    "class",
    "tone",
    "icon",
    "title",
    "action",
    "children",
  ]);

  return (
    <div
      role="alert"
      data-slot="alert"
      class={cn(
        "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs leading-5",
        alertTone[local.tone ?? "neutral"],
        local.class,
      )}
      {...others}
    >
      <Show when={local.icon}>
        <span class="mt-px shrink-0 [&_svg]:size-4">{local.icon}</span>
      </Show>
      <div class="min-w-0 flex-1">
        <Show when={local.title}>
          <div class="font-semibold">{local.title}</div>
        </Show>
        <div class={cn(local.title && "mt-0.5", "text-foreground/80")}>{local.children}</div>
      </div>
      <Show when={local.action}>
        <div class="shrink-0">{local.action}</div>
      </Show>
    </div>
  );
}

export { Alert, Breadcrumb, EmptyState, type AlertTone };

import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { CheckCircle2, CircleAlert, Laptop, MonitorSmartphone, Smartphone, TabletSmartphone } from "~/components/ui/icons";
import { errorMessage } from "~/lib/errors";
import { cn } from "~/lib/utils";

/** The standard page frame: comfortable gutters, a compact masthead and a
 * column that stays readable on ultrawide displays. */
export function Page(props: { children: JSX.Element; class?: string; wide?: boolean }) {
  return (
    <div
      class={cn(
        "mx-auto flex w-full flex-1 flex-col gap-5 px-4 py-5 sm:gap-6 sm:px-6 sm:py-6 lg:px-8 lg:py-8",
        props.wide ? "max-w-none" : "max-w-[1180px]",
        props.class,
      )}
    >
      {props.children}
    </div>
  );
}

export function PageHeader(props: {
  title: string;
  description?: string;
  actions?: JSX.Element;
  eyebrow?: string;
  meta?: JSX.Element;
}) {
  return (
    <div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div class="min-w-0">
        <Show when={props.eyebrow}>
          <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {props.eyebrow}
          </p>
        </Show>
        <h1 class="truncate text-[22px] font-semibold leading-tight tracking-[-0.02em] text-foreground sm:text-[26px]">
          {props.title}
        </h1>
        <Show when={props.description}>
          <p class="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
            {props.description}
          </p>
        </Show>
        <Show when={props.meta}>
          <div class="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {props.meta}
          </div>
        </Show>
      </div>
      <Show when={props.actions}>
        <div class="flex shrink-0 flex-wrap items-center gap-2">{props.actions}</div>
      </Show>
    </div>
  );
}

/** A bordered surface used for every content block on the dashboard. */
export function Panel(props: {
  children: JSX.Element;
  class?: string;
  header?: JSX.Element;
  title?: string;
  description?: string;
  actions?: JSX.Element;
  flush?: boolean;
}) {
  return (
    <section
      class={cn(
        "relative overflow-hidden rounded-xl border border-white/[0.07] bg-card shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_12px_32px_-24px_rgba(0,0,0,0.9)]",
        props.class,
      )}
    >
      <Show when={props.header ?? props.title}>
        <div class="flex flex-wrap items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-3.5 sm:px-5">
          <Show
            when={props.header}
            fallback={
              <div class="min-w-0">
                <h2 class="text-[13px] font-semibold tracking-[-0.01em] text-foreground">
                  {props.title}
                </h2>
                <Show when={props.description}>
                  <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {props.description}
                  </p>
                </Show>
              </div>
            }
          >
            {props.header}
          </Show>
          <Show when={props.actions}>
            <div class="flex shrink-0 items-center gap-2">{props.actions}</div>
          </Show>
        </div>
      </Show>
      <div class={props.flush ? "" : "p-4 sm:p-5"}>{props.children}</div>
    </section>
  );
}

export function StatCard(props: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  onClick?: () => void;
  icon?: (props: { class?: string }) => JSX.Element;
  tone?: "default" | "success" | "warning" | "danger" | "brand";
  class?: string;
}) {
  const toneClass = () =>
    ({
      default: "text-foreground",
      success: "text-success",
      warning: "text-warning",
      danger: "text-destructive",
      brand: "text-brand",
    })[props.tone ?? "default"];

  const content = (
    <>
      <div class="flex items-center justify-between gap-2">
        <p class="truncate text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {props.label}
        </p>
        <Show when={props.icon}>
          {(icon) => (
            <span class="text-muted-foreground/60">
              {icon()({ class: "size-3.5" })}
            </span>
          )}
        </Show>
      </div>
      <p class={cn("mt-2 text-[26px] font-semibold leading-none tracking-[-0.03em]", toneClass())}>
        {props.value}
      </p>
      <Show when={props.hint}>
        <p class="mt-1.5 truncate text-[11px] text-muted-foreground/80">{props.hint}</p>
      </Show>
    </>
  );

  const classes = cn(
    "group flex min-w-0 flex-col rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5 text-left transition-all duration-200",
    (props.href ?? props.onClick) &&
      "hover:border-white/[0.12] hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
    props.class,
  );

  return (
    <Show
      when={props.href}
      fallback={
        <button type="button" class={classes} onClick={() => props.onClick?.()}>
          {content}
        </button>
      }
    >
      {(href) => (
        <a href={href()} class={classes}>
          {content}
        </a>
      )}
    </Show>
  );
}

export function EmptyState(props: {
  title: string;
  description: string;
  action?: JSX.Element;
  icon?: (props: { class?: string }) => JSX.Element;
}) {
  return (
    <div class="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.09] bg-white/[0.012] px-6 py-10 text-center">
      <div class="mb-3.5 flex size-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.035] text-muted-foreground">
        <Show when={props.icon} fallback={<CircleAlert class="size-4.5" />}>
          {(icon) => icon()({ class: "size-4.5" })}
        </Show>
      </div>
      <h2 class="text-[13.5px] font-semibold text-foreground">{props.title}</h2>
      <p class="mt-1 max-w-sm text-[12.5px] leading-relaxed text-muted-foreground">
        {props.description}
      </p>
      <Show when={props.action}>
        <div class="mt-4">{props.action}</div>
      </Show>
    </div>
  );
}

export function DataTable<T>(props: {
  rows: T[] | undefined;
  columns: Array<{ header: string; class?: string; cell: (row: T) => JSX.Element }>;
  empty: JSX.Element;
}) {
  return (
    <Show when={(props.rows?.length ?? 0) > 0} fallback={props.empty}>
      <div class="overflow-hidden rounded-xl border border-white/[0.07] bg-card">
        <table class="w-full text-[13px]">
          <thead class="border-b border-white/[0.06] bg-white/[0.02] text-left text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <tr>
              <For each={props.columns}>
                {(col) => <th class={cn("px-4 py-2.5 font-medium", col.class)}>{col.header}</th>}
              </For>
            </tr>
          </thead>
          <tbody class="divide-y divide-white/[0.05]">
            <For each={props.rows}>
              {(row) => (
                <tr class="transition-colors hover:bg-white/[0.025]">
                  <For each={props.columns}>
                    {(col) => (
                      <td class={cn("px-4 py-3 align-middle", col.class)}>{col.cell(row)}</td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </Show>
  );
}

export function Field(props: { label: string; children: JSX.Element; hint?: string }) {
  return (
    <label class="grid gap-1.5 text-sm">
      <span class="text-[12.5px] font-medium text-foreground/90">{props.label}</span>
      {props.children}
      <Show when={props.hint}>
        <span class="text-[11px] leading-relaxed text-muted-foreground">{props.hint}</span>
      </Show>
    </label>
  );
}

export function ErrorText(props: { error: unknown }) {
  return (
    <Show when={props.error}>
      <p role="alert" class="text-sm text-destructive">
        {errorMessage(props.error)}
      </p>
    </Show>
  );
}

/** A query failure with an optional retry, used by list and detail pages. */
export function QueryError(props: { error: unknown; onRetry?: () => void; class?: string }) {
  return (
    <Show when={props.error}>
      <div
        class={cn(
          "rounded-xl border border-destructive/25 bg-destructive/[0.07] p-4",
          props.class,
        )}
      >
        <div class="flex items-start gap-2.5">
          <CircleAlert class="mt-px size-4 shrink-0 text-destructive" />
          <div class="min-w-0">
            <p role="alert" class="text-[13px] text-foreground">
              {errorMessage(props.error)}
            </p>
            <Show when={props.onRetry}>
              <Button size="sm" variant="outline" class="mt-3" onClick={() => props.onRetry?.()}>
                Try again
              </Button>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
}

export function LinkButton(props: {
  href: string;
  children: JSX.Element;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "xs";
}) {
  return (
    <Button as="a" href={props.href} variant={props.variant ?? "default"} size={props.size}>
      {props.children}
    </Button>
  );
}

const statusStyles: Record<string, string> = {
  enrolled: "border-success/25 bg-success/10 text-success-foreground",
  enrolling: "border-brand/30 bg-brand/10 text-brand",
  unenrolling: "border-warning/25 bg-warning/10 text-warning-foreground",
  unenrolled: "border-white/[0.08] bg-white/[0.03] text-muted-foreground",
};

export function DeviceStatusBadge(props: { status: string }) {
  return (
    <span
      class={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
        statusStyles[props.status] ?? statusStyles.unenrolled,
      )}
    >
      <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {props.status}
    </span>
  );
}

const healthStyles: Record<string, { class: string; label: string }> = {
  healthy: { class: "border-success/25 bg-success/10 text-success-foreground", label: "Healthy" },
  attention: {
    class: "border-warning/25 bg-warning/10 text-warning-foreground",
    label: "Attention",
  },
  critical: { class: "border-destructive/25 bg-destructive/10 text-destructive", label: "Critical" },
  unknown: {
    class: "border-white/[0.08] bg-white/[0.03] text-muted-foreground",
    label: "Unknown",
  },
};

/** Health/compliance rollup derived by the backend. */
export function DeviceHealthBadge(props: { level: string }) {
  const style = () => healthStyles[props.level] ?? healthStyles.unknown!;
  return (
    <span
      class={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        style().class,
      )}
    >
      <Show
        when={props.level === "healthy"}
        fallback={<CircleAlert class="size-3" aria-hidden="true" />}
      >
        <CheckCircle2 class="size-3" aria-hidden="true" />
      </Show>
      {style().label}
    </span>
  );
}

export function PlatformBadge(props: { proto: string }) {
  const icon = () =>
    props.proto === "apple" ? (
      <Laptop class="size-3" />
    ) : props.proto === "win" ? (
      <MonitorSmartphone class="size-3" />
    ) : props.proto === "android" ? (
      <Smartphone class="size-3" />
    ) : (
      <TabletSmartphone class="size-3" />
    );
  const label = () =>
    props.proto === "apple"
      ? "Apple"
      : props.proto === "win"
        ? "Windows"
        : props.proto === "android"
          ? "Android"
          : props.proto;
  return (
    <Badge variant="outline" class="gap-1.5 text-muted-foreground">
      {icon()}
      {label()}
    </Badge>
  );
}

export function formatDate(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function relativeTime(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

import { useLocation } from "@solidjs/router";
import { Match } from "effect";
import { createMemo, createSignal, createUniqueId, For, onSettled, Show } from "solid-js";
import { deriveDevicePresence } from "@mattrax/enterprise-domain/client";
import type { JSX } from "@solidjs/web";
import {
  Card,
  EmptyState as UIEmptyState,
  Page as UIPage,
  PageActions,
  PageDescription,
  PageHeader as UIPageHeader,
  PageHeaderBody,
  PageTitle,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@mattrax/ui";
import { Badge } from "~/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "~/components/ui/breadcrumb";
import { Button } from "~/components/ui/button";
import {
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Laptop,
  MonitorSmartphone,
  Smartphone,
  TabletSmartphone,
} from "~/components/ui/icons";
import { Skeleton } from "~/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { buildBreadcrumbs } from "~/lib/breadcrumbs";
import { errorPresentation, raisedFailure } from "~/lib/errors";
import { cn } from "~/lib/utils";

/** The standard page frame: compact gutters and a column that stays readable
 * on ultrawide displays. The shell's top bar already names the section, so
 * pages start with their own masthead rather than another breadcrumb row. */
export function Page(props: { children: JSX.Element; class?: string; wide?: boolean }) {
  return (
    <UIPage wide={props.wide} class={cn("page-enter gap-5 px-4 py-4 sm:px-6 sm:py-5", props.class)}>
      {props.children}
    </UIPage>
  );
}

/**
 * The single breadcrumb row shared by every page header.
 *
 * The trail comes from the route (`buildBreadcrumbs`) and is hidden on section
 * landing pages. On narrow screens the middle crumbs collapse to an ellipsis
 * so the trail never wraps to a second row.
 */
export function PageBreadcrumbs(props: {
  title?: string;
  resourceName?: string;
  section?: string;
  class?: string;
}) {
  const location = useLocation();

  const trail = createMemo(() =>
    buildBreadcrumbs({
      pathname: location.pathname,
      title: props.title,
      resourceName: props.resourceName,
      section: props.section,
    }),
  );

  return (
    <Show when={trail().length > 0}>
      <Breadcrumb class={cn("mb-2", props.class)}>
        <BreadcrumbList class="flex-nowrap! overflow-hidden">
          <For each={trail()} keyed={(crumb) => crumb.href}>
            {(crumb, index) => {
              const total = () => trail().length;
              const isLast = () => index() === total() - 1;
              const isMiddle = () => total() > 2 && index() > 0 && !isLast();
              // The visible mobile row is first + ellipsis + last, so the
              // separator before the middle group is owned by the ellipsis.
              const separatorHidden = () => total() > 2 && index() === 1;

              return (
                <>
                  <Show when={index() > 0}>
                    <BreadcrumbSeparator
                      class={cn((separatorHidden() || isMiddle()) && "hidden sm:inline-flex")}
                    >
                      <ChevronRight />
                    </BreadcrumbSeparator>
                  </Show>
                  <BreadcrumbItem class={cn(isMiddle() && "hidden sm:inline-flex")}>
                    <Show
                      when={isLast()}
                      fallback={
                        <BreadcrumbLink href={crumb().href}>{crumb().label}</BreadcrumbLink>
                      }
                    >
                      <BreadcrumbPage class="truncate">{crumb().label}</BreadcrumbPage>
                    </Show>
                  </BreadcrumbItem>
                  <Show when={total() > 2 && index() === 0}>
                    <BreadcrumbSeparator class="sm:hidden">
                      <ChevronRight />
                    </BreadcrumbSeparator>
                    <BreadcrumbItem class="sm:hidden">
                      <BreadcrumbEllipsis />
                    </BreadcrumbItem>
                  </Show>
                </>
              );
            }}
          </For>
        </BreadcrumbList>
      </Breadcrumb>
    </Show>
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
    <UIPageHeader class="gap-3 border-0 pb-0 sm:items-center">
      <PageHeaderBody>
        <Show when={props.eyebrow}>
          <div class="label-caps mb-1.5">{props.eyebrow}</div>
        </Show>
        <PageTitle class="text-[21px] font-[560] tracking-[-0.026em]">{props.title}</PageTitle>
        <Show when={props.description}>
          <PageDescription class="mt-1 max-w-2xl text-[12.5px] leading-5">
            {props.description}
          </PageDescription>
        </Show>
        <Show when={props.meta}>
          <div class="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            {props.meta}
          </div>
        </Show>
      </PageHeaderBody>
      <Show when={props.actions}>
        <PageActions>{props.actions}</PageActions>
      </Show>
    </UIPageHeader>
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
  // A region only becomes a landmark when it has an accessible name. The
  // generated id keeps that name attached to *this* panel's heading.
  const headingId = createUniqueId();
  const titleId = () => (props.title ? `${headingId}-title` : undefined);

  return (
    <Card
      role={props.title ? "region" : undefined}
      aria-labelledby={titleId()}
      class={cn("relative overflow-hidden", props.class)}
    >
      <Show when={props.header ?? props.title}>
        <div class="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3.5">
          <Show
            when={props.header}
            fallback={
              <div class="min-w-0 flex-1 basis-0">
                <h2
                  id={titleId()}
                  class="text-[14px] font-[560] leading-5 tracking-[-0.012em] text-foreground"
                >
                  {props.title}
                </h2>
                <Show when={props.description}>
                  <p class="mt-1 text-[12.5px] leading-5 text-muted-foreground">
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
      <div class={props.flush ? "" : "p-4"}>{props.children}</div>
    </Card>
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
        <div class="label-caps truncate">{props.label}</div>
        <Show when={props.icon}>
          {(icon) => <span class="text-subtle-foreground">{icon()({ class: "size-3.5" })}</span>}
        </Show>
      </div>
      <div class="mt-1.5 flex items-baseline gap-2">
        <span
          data-numeric
          class={cn("text-[19px] font-[560] leading-none tracking-[-0.025em]", toneClass())}
        >
          {props.value}
        </span>
      </div>
      <Show when={props.hint}>
        <p class="mt-1 truncate text-[11.5px] text-muted-foreground">{props.hint}</p>
      </Show>
    </>
  );

  const classes = cn(
    "group flex min-w-0 flex-col rounded-xl border border-border bg-card p-3.5 text-left shadow-card",
    (props.href ?? props.onClick) &&
      "pressable hover:border-border-strong hover:shadow-popover focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30",
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
    <UIEmptyState
      class="min-h-0 rounded-xl py-9"
      icon={
        <Show when={props.icon} fallback={<CircleAlert class="size-4" />}>
          {(icon) => icon()({ class: "size-4" })}
        </Show>
      }
      title={props.title}
      description={props.description}
      action={props.action}
    />
  );
}

/** Row-shaped placeholders for panels whose table is still loading. */
export function SkeletonRows(props: { rows?: number; class?: string }) {
  return (
    <div class={cn("space-y-1.5", props.class)} aria-hidden="true">
      <For each={Array.from({ length: props.rows ?? 4 }, (_, index) => index)}>
        {() => <Skeleton class="h-11 rounded-lg bg-surface" />}
      </For>
    </div>
  );
}

/** The shared cold-load fallback: one panel of rows, never a literal "Loading". */
export function PageSkeleton(props: { rows?: number }) {
  return (
    <Panel>
      <SkeletonRows rows={props.rows ?? 6} />
    </Panel>
  );
}

export function DataTable<T>(props: {
  rows: T[] | undefined;
  columns: Array<{ header: string; class?: string; cell: (row: T) => JSX.Element }>;
  empty: JSX.Element;
  /** Names the table for screen readers; defaults to the visible column headers. */
  caption?: string;
}) {
  const caption = () =>
    props.caption ?? `Table: ${props.columns.map((column) => column.header).join(", ")}`;

  return (
    <Show when={(props.rows?.length ?? 0) > 0} fallback={props.empty}>
      <Table containerClass="page-enter" class="text-[12.5px]">
        <TableCaption class="sr-only">{caption()}</TableCaption>
        <TableHeader>
          <TableRow class="bg-surface hover:bg-surface">
            <For each={props.columns}>
              {(col) => (
                <TableHead scope="col" class={col.class}>
                  {col.header}
                </TableHead>
              )}
            </For>
          </TableRow>
        </TableHeader>
        <TableBody>
          <For each={props.rows}>
            {(row) => (
              <TableRow>
                <For each={props.columns}>
                  {(col) => (
                    <TableCell class={cn("text-muted-foreground", col.class)}>
                      {col.cell(row)}
                    </TableCell>
                  )}
                </For>
              </TableRow>
            )}
          </For>
        </TableBody>
      </Table>
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
  const presentation = () => errorPresentation(raisedFailure(props.error));
  const showTitle = () => !["validation", "server"].includes(presentation().variant);

  return (
    <Show when={props.error}>
      <p role="alert" aria-live="polite" class="text-sm text-destructive">
        <Show when={showTitle()}>
          <span class="font-medium">{presentation().title}. </span>
        </Show>
        {presentation().message}
      </p>
    </Show>
  );
}

/** A query failure with an optional retry, used by list and detail pages. */
export function QueryError(props: { error: unknown; onRetry?: () => void; class?: string }) {
  const presentation = () => errorPresentation(raisedFailure(props.error));

  return (
    <Show when={props.error}>
      <div
        role="alert"
        aria-live="polite"
        class={cn("rounded-lg border border-destructive/25 bg-destructive/[0.07] p-4", props.class)}
      >
        <div class="flex items-start gap-2.5">
          <CircleAlert class="mt-px size-4 shrink-0 text-destructive" />
          <div class="min-w-0">
            <p class="text-[13px] font-medium text-foreground">{presentation().title}</p>
            <p class="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
              {presentation().message}
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <Show when={props.onRetry}>
                <Button size="sm" variant="outline" onClick={() => props.onRetry?.()}>
                  Try again
                </Button>
              </Show>
              <Show when={presentation().variant === "auth"}>
                <Button as="a" href="/login" size="sm" variant="outline">
                  Sign in again
                </Button>
              </Show>
            </div>
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

const statusStyles = new Map<string, string>([
  ["enrolled", "border-success/25 bg-success/10 text-success-foreground"],
  ["enrolling", "border-brand/30 bg-brand/10 text-brand"],
  ["unenrolling", "border-warning/25 bg-warning/10 text-warning-foreground"],
  ["unenrolled", "border-border bg-surface text-muted-foreground"],
]);

const statusStyle = (status: string) =>
  statusStyles.get(status) ?? statusStyles.get("unenrolled") ?? "";

export function DeviceStatusBadge(props: { status: string }) {
  return (
    <span
      class={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
        statusStyle(props.status),
      )}
    >
      <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {props.status}
    </span>
  );
}

/**
 * Presence clock.
 *
 * Online/offline is derived from check-in recency, so it changes with time even
 * without new data. One shared signal (and one 30-second timer) keeps every
 * badge on a page in step without giving each row its own interval. Hooks only
 * run while a page component is mounted.
 */
export const PRESENCE_TICK_MS = 30_000;

const [presenceNow, setPresenceNow] = createSignal(Date.now());

let presenceSubscribers = 0;

let presenceTimer: ReturnType<typeof setInterval> | undefined;

export const usePresenceNow = () => {
  onSettled(() => {
    presenceSubscribers += 1;

    if (presenceTimer === undefined)
      presenceTimer = setInterval(() => setPresenceNow(Date.now()), PRESENCE_TICK_MS);

    return () => {
      presenceSubscribers = Math.max(0, presenceSubscribers - 1);

      if (presenceSubscribers === 0 && presenceTimer !== undefined) {
        clearInterval(presenceTimer);
        presenceTimer = undefined;
      }
    };
  });

  return presenceNow;
};

/** Presence for a row, using the shared clock. */
export const devicePresence = (
  device: { readonly status?: string | null; readonly lastSeenAt?: string | null },
  nowMs: number,
) =>
  deriveDevicePresence({
    status: device.status,
    lastSeenAt: device.lastSeenAt,
    now: new Date(nowMs),
  });

/** Online/offline chip; silent and untinted when the device is offline. */
export function DevicePresenceBadge(props: {
  status?: string | null;
  lastSeenAt?: string | null;
  now: number;
  class?: string;
}) {
  const online = () => devicePresence(props, props.now).online;

  return (
    <span
      class={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        online()
          ? "border-success/25 bg-success/10 text-success-foreground"
          : "border-border bg-surface text-muted-foreground",
        props.class,
      )}
      title={
        online() ? "Checked in within the last 15 minutes" : "No check-in in the last 15 minutes"
      }
    >
      <span
        class={cn("size-1.5 rounded-full", online() ? "bg-success" : "bg-muted-foreground/50")}
        aria-hidden="true"
      />
      {online() ? "Online" : "Offline"}
    </span>
  );
}

/** A compact dot for table cells that already show the last-seen time. */
export function PresenceDot(props: { online: boolean; class?: string }) {
  return (
    <span
      class={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        props.online ? "bg-success" : "bg-muted-foreground/40",
        props.class,
      )}
      role="img"
      aria-label={props.online ? "Online" : "Offline"}
    />
  );
}

const healthStyles = new Map<string, { class: string; label: string }>([
  [
    "healthy",
    { class: "border-success/25 bg-success/10 text-success-foreground", label: "Healthy" },
  ],
  [
    "attention",
    { class: "border-warning/25 bg-warning/10 text-warning-foreground", label: "Attention" },
  ],
  ["missing", { class: "border-info/25 bg-info/10 text-info", label: "MIA" }],
  [
    "critical",
    { class: "border-destructive/25 bg-destructive/10 text-destructive", label: "Critical" },
  ],
  ["unknown", { class: "border-border bg-surface text-muted-foreground", label: "Unknown" }],
]);

const healthStyle = (level: string) =>
  healthStyles.get(level) ?? healthStyles.get("unknown") ?? { class: "", label: level };

type HealthReason = { code: string; label: string; severity: string };

/**
 * Health/compliance rollup derived by the backend.
 *
 * With `reasons`, the badge becomes a tooltip trigger that lists what dragged
 * the device out of `healthy`; the list is also the trigger's accessible name,
 * so the information is not hover-only.
 */
export function DeviceHealthBadge(props: { level: string; reasons?: ReadonlyArray<HealthReason> }) {
  const style = () => healthStyle(props.level);
  const reasons = () => props.reasons ?? [];

  const badge = () => (
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

  return (
    <Show when={reasons().length > 0} fallback={badge()}>
      <Tooltip>
        <TooltipTrigger
          as="span"
          tabindex={0}
          class="inline-flex cursor-default rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          aria-label={`Health ${style().label}. ${reasons()
            .map((reason) => reason.label)
            .join("; ")}`}
        >
          {badge()}
        </TooltipTrigger>
        <TooltipContent>
          <p class="text-[11px] font-medium">
            Why {style().label === "MIA" ? "MIA" : style().label.toLowerCase()}
          </p>
          <ul class="mt-1 space-y-0.5 text-[11.5px]">
            <For each={reasons()}>{(reason) => <li>{reason.label}</li>}</For>
          </ul>
        </TooltipContent>
      </Tooltip>
    </Show>
  );
}

export function PlatformBadge(props: { proto: string }) {
  const icon = () =>
    Match.value(props.proto).pipe(
      Match.when("apple", () => <Laptop class="size-3" />),
      Match.when("win", () => <MonitorSmartphone class="size-3" />),
      Match.when("android", () => <Smartphone class="size-3" />),
      Match.orElse(() => <TabletSmartphone class="size-3" />),
    );

  const label = () =>
    Match.value(props.proto).pipe(
      Match.when("apple", () => "Apple"),
      Match.when("win", () => "Windows"),
      Match.when("android", () => "Android"),
      Match.orElse((proto) => proto),
    );

  return (
    <Badge variant="outline" class="gap-1.5 text-muted-foreground">
      {icon()}
      {label()}
    </Badge>
  );
}

const formatTimestamp = (value: string | null | undefined, timeZone?: string) => {
  if (!value) return "Unknown";
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    ...(timeZone ? { timeZone } : {}),
  });
};

export function formatDate(value?: string | null) {
  return formatTimestamp(value);
}

/**
 * The device timestamps the search can match (enrollment and last seen) are
 * stored and searched in UTC. Rendering them in UTC means the day and clock
 * time a reader sees are the ones they can type into search (`2026-11-10`,
 * `4 Nov 2026`, `05:06`), even when the browser is in another time zone.
 */
export function formatDeviceDate(value?: string | null) {
  return formatTimestamp(value, "UTC");
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

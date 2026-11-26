import type { ComponentProps } from "@solidjs/web";
import { splitProps } from "./lib/solid";
import { cn } from "./lib/cn";

/**
 * A page masthead: optional breadcrumb above, title and supporting line, with
 * actions aligned to the right. Used by every dashboard route so the title
 * always sits on the same baseline.
 */
function PageHeader(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div
      data-slot="page-header"
      class={cn(
        "flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between",
        local.class,
      )}
      {...others}
    />
  );
}

function PageHeaderBody(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);

  return <div class={cn("min-w-0", local.class)} {...others} />;
}

function PageTitle(props: ComponentProps<"h1">) {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <h1
      data-slot="page-title"
      class={cn(
        "min-w-0 max-w-full text-xl font-semibold leading-tight tracking-tight text-balance wrap-anywhere",
        local.class,
      )}
      {...others}
    >
      {local.children}
    </h1>
  );
}

function PageDescription(props: ComponentProps<"p">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <p
      data-slot="page-description"
      class={cn("mt-1.5 max-w-2xl text-xs leading-5 text-muted-foreground", local.class)}
      {...others}
    />
  );
}

function PageActions(props: ComponentProps<"div">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <div
      data-slot="page-actions"
      class={cn("flex shrink-0 flex-wrap items-center gap-2", local.class)}
      {...others}
    />
  );
}

/** The standard dashboard content column: a readable max width and gutters. */
function Page(props: ComponentProps<"div"> & { wide?: boolean }) {
  const [local, others] = splitProps(props, ["class", "wide"]);

  return (
    <div
      data-slot="page"
      class={cn(
        "mx-auto flex w-full flex-col gap-5 px-5 py-5 sm:px-7 sm:py-6",
        local.wide ? "max-w-none" : "max-w-390",
        local.class,
      )}
      {...others}
    />
  );
}

const trendArrow = { up: "↑", down: "↓", flat: "→" } as const;

/** A compact metric: label, value, and an optional delta or hint. */
function Stat(props: {
  label: string;
  value: string | number;
  hint?: string;
  trend?: { value: string; direction: "up" | "down" | "flat" };
  class?: string;
}) {
  const [local] = splitProps(props, ["label", "value", "hint", "trend", "class"]);

  return (
    <div data-slot="stat" class={cn("min-w-0", local.class)}>
      <div class="text-xs font-semibold uppercase tracking-wider text-muted-foreground truncate">{local.label}</div>
      <div class="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span data-numeric class="text-lg font-semibold leading-none tracking-tight">
          {local.value}
        </span>
        {local.trend ? (
          <span
            class={cn(
              "inline-flex items-center gap-0.5 text-xs font-medium",
              local.trend.direction === "up" && "text-success",
              local.trend.direction === "down" && "text-destructive",
              local.trend.direction === "flat" && "text-muted-foreground",
            )}
          >
            {trendArrow[local.trend.direction]}
            {local.trend.value}
          </span>
        ) : null}
      </div>
      {local.hint ? (
        <div class="mt-1 truncate text-xs text-muted-foreground">{local.hint}</div>
      ) : null}
    </div>
  );
}

export { Page, PageActions, PageDescription, PageHeader, PageHeaderBody, PageTitle, Stat };

import { splitProps } from "~/lib/solid";
import type { ComponentProps } from "@solidjs/web";
import { ChevronRight, Ellipsis } from "~/components/ui/icons";
import { cn } from "~/lib/utils";

type BreadcrumbProps = ComponentProps<"nav">;

function Breadcrumb(props: BreadcrumbProps) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <nav
      aria-label="breadcrumb"
      data-slot="breadcrumb"
      class={cn("min-w-0 text-xs text-muted-foreground", local.class)}
      {...others}
    />
  );
}

function BreadcrumbList(props: ComponentProps<"ol">) {
  const [local, others] = splitProps(props, ["class"]);

  return <ol class={cn("flex flex-wrap items-center gap-1", local.class)} {...others} />;
}

function BreadcrumbItem(props: ComponentProps<"li">) {
  const [local, others] = splitProps(props, ["class"]);

  return <li class={cn("inline-flex min-w-0 items-center gap-1", local.class)} {...others} />;
}

function BreadcrumbLink(props: ComponentProps<"a">) {
  const [local, others] = splitProps(props, ["class", "href", "children"]);

  return (
    <a
      href={local.href ?? "#"}
      class={cn(
        "truncate rounded-sm outline-none transition-colors hover:text-foreground focus-visible:text-foreground",
        local.class,
      )}
      {...others}
    >
      {local.children}
    </a>
  );
}

function BreadcrumbPage(props: ComponentProps<"span">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <span aria-current="page" class={cn("truncate text-foreground", local.class)} {...others} />
  );
}

function BreadcrumbSeparator(props: ComponentProps<"span">) {
  const [local, others] = splitProps(props, ["class", "children"]);

  return (
    <span
      role="presentation"
      aria-hidden="true"
      class={cn("flex shrink-0 items-center text-subtle-foreground/70", local.class)}
      {...others}
    >
      {local.children ?? <ChevronRight class="size-3" />}
    </span>
  );
}

function BreadcrumbEllipsis(props: ComponentProps<"span">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <span
      role="presentation"
      aria-hidden="true"
      class={cn("flex size-5 items-center justify-center", local.class)}
      {...others}
    >
      <Ellipsis class="size-3.5" />
      <span class="sr-only">More</span>
    </span>
  );
}

export {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
};

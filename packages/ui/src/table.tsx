import type { ComponentProps } from "@solidjs/web";
import { splitProps } from "./lib/solid";
import { cn } from "./lib/cn";

/**
 * Table primitives for the dense fleet lists.
 *
 * Rows are 36px by default, headers are tracked caps, and the last row keeps
 * its divider so the table reads as one object rather than a floating stack.
 */
function Table(props: ComponentProps<"table"> & { containerClass?: string }) {
  const [local, others] = splitProps(props, ["class", "containerClass"]);

  return (
    <div
      data-slot="table-container"
      class={cn(
        "relative w-full overflow-x-auto rounded-xl border border-border bg-card",
        local.containerClass,
      )}
    >
      <table
        data-slot="table"
        class={cn("w-full caption-bottom border-collapse text-[12.5px]", local.class)}
        {...others}
      />
    </div>
  );
}

function TableHeader(props: ComponentProps<"thead">) {
  const [local, others] = splitProps(props, ["class"]);

  return <thead class={cn("[&_tr]:border-b [&_tr]:border-border", local.class)} {...others} />;
}

function TableBody(props: ComponentProps<"tbody">) {
  const [local, others] = splitProps(props, ["class"]);

  return <tbody class={cn("[&_tr:last-child]:border-0", local.class)} {...others} />;
}

function TableRow(props: ComponentProps<"tr">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <tr
      class={cn(
        "border-b border-border transition-colors duration-[var(--duration-hover)] hover:bg-surface data-selected:bg-surface",
        local.class,
      )}
      {...others}
    />
  );
}

function TableHead(props: ComponentProps<"th">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <th
      class={cn(
        "label-caps h-8 whitespace-nowrap px-3 text-left align-middle first:pl-4 last:pr-4",
        local.class,
      )}
      {...others}
    />
  );
}

function TableCell(props: ComponentProps<"td">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <td
      class={cn("h-9 whitespace-nowrap px-3 align-middle first:pl-4 last:pr-4", local.class)}
      {...others}
    />
  );
}

function TableCaption(props: ComponentProps<"caption">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <caption class={cn("mt-3 text-[11.5px] text-muted-foreground", local.class)} {...others} />
  );
}

export { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow };

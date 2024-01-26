import { JSX, ParentProps } from "solid-js";
import { cn } from "~/utils";

export const Table = (
  props: ParentProps<JSX.HTMLAttributes<HTMLTableElement>>
) => (
  <div class="relative w-full overflow-auto">
    <table
      class={cn("w-full caption-bottom text-sm", props.class)}
      {...props}
    />
  </div>
);

export const TableHeader = (
  props: ParentProps<JSX.HTMLAttributes<HTMLTableSectionElement>>
) => <thead class={cn("[&_tr]:border-b", props.class)} {...props} />;

export const TableBody = (
  props: ParentProps<JSX.HTMLAttributes<HTMLTableSectionElement>>
) => <tbody class={cn("[&_tr:last-child]:border-0", props.class)} {...props} />;

export const TableFooter = (
  props: ParentProps<JSX.HTMLAttributes<HTMLTableSectionElement>>
) => (
  <tfoot
    class={cn(
      "border-t bg-slate-100/50 font-medium [&>tr]:last:border-b-0 dark:bg-slate-800/50",
      props.class
    )}
    {...props}
  />
);

export const TableRow = (
  props: ParentProps<JSX.HTMLAttributes<HTMLTableRowElement>>
) => (
  <tr
    class={cn(
      "border-b transition-colors hover:bg-slate-100/50 data-[state=selected]:bg-slate-100 dark:hover:bg-slate-800/50 dark:data-[state=selected]:bg-slate-800",
      props.class
    )}
    {...props}
  />
);

export const TableHead = (
  props: ParentProps<JSX.HTMLAttributes<HTMLTableCellElement>>
) => (
  <th
    class={cn(
      "h-12 px-4 text-left align-middle font-medium text-slate-500 [&:has([role=checkbox])]:pr-0 dark:text-slate-400",
      props.class
    )}
    {...props}
  />
);

export const TableCell = (
  props: ParentProps<JSX.HTMLAttributes<HTMLTableCellElement>>
) => (
  <td
    class={cn("p-4 align-middle [&:has([role=checkbox])]:pr-0", props.class)}
    {...props}
  />
);

export const TableCaption = (
  props: ParentProps<JSX.HTMLAttributes<HTMLTableCaptionElement>>
) => (
  <caption
    class={cn("mt-4 text-sm text-slate-500 dark:text-slate-400", props.class)}
    {...(props as any)}
  />
);

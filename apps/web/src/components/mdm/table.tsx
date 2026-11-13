import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button, buttonVariants } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ChevronsUpDown, Search as SearchIcon } from "~/components/ui/icons";
import { cn } from "~/lib/utils";
import { QueryError } from "./common";

export type MdmColumn<T> = {
  id: string;
  header: string;
  class?: string;
  cell: (row: T) => JSX.Element;
  sort?: (row: T) => string | number | undefined | null;
  /** Server-side sort key when it differs from the column id. */
  sortId?: string;
  search?: (row: T) => string | undefined | null;
  /** Columns hidden by default can be enabled from the column picker. */
  defaultHidden?: boolean;
};

type SortState = { id: string; dir: "asc" | "desc" } | null;
export type MdmSortState = SortState;

function readVisibility(key: string | undefined): Record<string, boolean> {
  if (!key || typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(`mattrax:table:${key}:columns`) ?? "{}");
  } catch {
    return {};
  }
}

export function MdmTable<T extends { id: string; name?: string }>(props: {
  rows: readonly T[] | undefined;
  columns: MdmColumn<T>[];
  empty: JSX.Element;
  actions?: (selected: T[], clear: () => void) => JSX.Element;
  /** Persist column visibility under this key. */
  storageKey?: string;
  /** Navigate when a row is clicked (links/buttons inside the row still win). */
  onRowClick?: (row: T) => void;
  loading?: boolean;
  error?: unknown;
  searchPlaceholder?: string;
  /**
   * `server` disables the built-in client-side filtering/sorting so the parent
   * can drive both through the API using the controlled props below.
   */
  mode?: "client" | "server";
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  sortValue?: MdmSortState;
  onSortChange?: (value: MdmSortState) => void;
  /** Extra controls rendered below the search row (filters, export, …). */
  toolbar?: JSX.Element;
  /** Rendered below the table (pagination, range summary, …). */
  footer?: JSX.Element;
  /** Total number of rows on the server; enables the "showing x of y" label. */
  total?: number;
  /** Accessible name for the table. */
  caption?: string;
}) {
  const [selected, setSelected] = createSignal<Record<string, true>>({});
  const [internalSearch, setInternalSearch] = createSignal("");
  const [internalSort, setInternalSort] = createSignal<SortState>(null);
  const [hidden, setHidden] = createSignal<Record<string, boolean>>(
    readVisibility(props.storageKey),
  );
  let searchInput: HTMLInputElement | undefined;

  const serverMode = () => props.mode === "server";
  const search = () => (serverMode() ? (props.searchValue ?? "") : internalSearch());
  const setSearch = (value: string) => {
    if (serverMode()) props.onSearchChange?.(value);
    else setInternalSearch(value);
  };
  const sort = () => (serverMode() ? (props.sortValue ?? null) : internalSort());
  const setSort = (value: SortState) => {
    if (serverMode()) props.onSortChange?.(value);
    else setInternalSort(value);
  };

  const visibleColumns = createMemo(() =>
    props.columns.filter(
      (column) => !hidden()[column.id] && (hidden()[column.id] === false || !column.defaultHidden),
    ),
  );

  const rows = createMemo(() => {
    if (serverMode()) return [...(props.rows ?? [])];
    const term = search().trim().toLowerCase();
    let result = [...(props.rows ?? [])];
    if (term)
      result = result.filter(
        (row) =>
          props.columns.some((col) =>
            (col.search?.(row) ?? String(col.sort?.(row) ?? "")).toLowerCase().includes(term),
          ) || row.name?.toLowerCase().includes(term),
      );
    const current = sort();
    if (current) {
      const col = props.columns.find((item) => item.id === current.id);
      result.sort(
        (a, b) =>
          String(col?.sort?.(a) ?? "").localeCompare(String(col?.sort?.(b) ?? ""), undefined, {
            numeric: true,
          }) * (current.dir === "asc" ? 1 : -1),
      );
    }
    return result;
  });

  /**
   * Selection is scoped to the visible row set. When a filter, page or search
   * changes the visible ids, ids that are no longer on screen must not linger
   * in the action bar. Re-ordering the same ids keeps the selection.
   */
  createEffect(
    () =>
      rows()
        .map((row) => row.id)
        .sort()
        .join("\u0000"),
    () => {
      setSelected({});
    },
  );

  const selectedRows = createMemo(() => rows().filter((row) => selected()[row.id]));
  const allSelected = () => rows().length > 0 && selectedRows().length === rows().length;
  let selectAllRef: HTMLInputElement | undefined;
  createEffect(
    () => [selectedRows().length, allSelected()] as const,
    ([count, all]) => {
      if (selectAllRef) selectAllRef.indeterminate = count > 0 && !all;
    },
  );
  const clear = () => setSelected({});
  const toggleAll = () =>
    setSelected(
      allSelected()
        ? {}
        : (Object.fromEntries(rows().map((row) => [row.id, true])) as Record<string, true>),
    );
  const toggleSort = (id: string) =>
    setSort(
      sort()?.id !== id ? { id, dir: "asc" } : sort()?.dir === "asc" ? { id, dir: "desc" } : null,
    );
  const toggleRow = (row: T, checked: boolean) => {
    setSelected((value) => {
      const next = { ...value };
      if (checked) next[row.id] = true;
      else delete next[row.id];
      return next;
    });
  };
  const toggleColumn = (id: string, visible: boolean) => {
    setHidden((value) => {
      const next = { ...value, [id]: !visible };
      if (props.storageKey && typeof localStorage !== "undefined")
        localStorage.setItem(`mattrax:table:${props.storageKey}:columns`, JSON.stringify(next));
      return next;
    });
  };
  const actions = () => props.actions?.(selectedRows(), clear);
  const sortIndicator = (column: MdmColumn<T>) => {
    const value = sort();
    if (value?.id !== (column.sortId ?? column.id)) return "";
    return value.dir === "asc" ? " ↑" : " ↓";
  };

  return (
    <div class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2.5">
        <div class="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md">
          <div class="relative min-w-0 flex-1">
            <SearchIcon class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInput}
              placeholder={props.searchPlaceholder ?? "Search…"}
              aria-label="Search table"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              class="h-8 w-full pl-8! text-[12.5px]"
            />
          </div>
          <Show when={search()}>
            <Button variant="ghost" size="xs" onClick={() => setSearch("")}>
              Clear
            </Button>
          </Show>
        </div>
        <div class="flex items-center gap-2">
          <span class="hidden text-[11px] tabular-nums text-muted-foreground sm:inline">
            {props.total !== undefined
              ? `${props.rows?.length ?? 0} of ${props.total}`
              : rows().length === (props.rows?.length ?? 0)
                ? `${rows().length} rows`
                : `${rows().length} of ${props.rows?.length ?? 0}`}
          </span>
          <details class="group/columns relative">
            <summary
              class={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "list-none gap-1.5 focus-visible:ring-2 focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden",
              )}
              aria-label="Choose visible columns"
            >
              <ChevronsUpDown class="size-3.5" />
              <span class="hidden sm:inline">Columns</span>
            </summary>
            <div class="absolute right-0 z-50 mt-1 w-52 rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl shadow-black/50">
              <div class="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Visible columns
              </div>
              <div class="my-1 h-px bg-border" />
              <For each={props.columns}>
                {(column) => (
                  <label class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] hover:bg-white/[0.05]">
                    <input
                      type="checkbox"
                      class="size-3.5 accent-[var(--brand)]"
                      checked={!hidden()[column.id] && !column.defaultHidden}
                      onChange={(event) =>
                        toggleColumn(column.id, event.currentTarget.checked)
                      }
                    />
                    {column.header}
                  </label>
                )}
              </For>
            </div>
          </details>
        </div>
      </div>

      <Show when={props.toolbar}>{props.toolbar}</Show>

      <Show when={props.error}>
        <QueryError error={props.error} />
      </Show>
      <Show when={!props.error && props.loading}>
        <div class="overflow-hidden rounded-xl border border-white/[0.07] bg-card">
          <div class="space-y-1.5 p-3">
            <For each={[0, 1, 2, 3, 4]}>
              {() => <div class="h-11 animate-pulse rounded-lg bg-white/[0.035]" />}
            </For>
          </div>
        </div>
      </Show>
      <Show
        when={!props.error && !props.loading && rows().length > 0}
        fallback={!props.error && !props.loading ? props.empty : undefined}
      >
        <div class="relative">
          <div class="overflow-x-auto rounded-xl border border-white/[0.07] bg-card shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
          <table class="w-full text-[13px]">
            <caption class="sr-only">{props.caption ?? "Data table"}</caption>
            <thead class="border-b border-white/[0.07] bg-white/[0.02] text-left text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
              <tr>
                <th scope="col" class="w-10 px-3 py-2.5 sm:px-4">
                  <input
                    ref={(el) => (selectAllRef = el)}
                    type="checkbox"
                    class="size-4 accent-[var(--brand)]"
                    checked={allSelected()}
                    onChange={toggleAll}
                    aria-label="Select all rows"
                  />
                </th>
                <For each={visibleColumns()}>
                  {(col) => (
                    <th
                      scope="col"
                      aria-sort={
                        sort()?.id === (col.sortId ?? col.id)
                          ? sort()!.dir === "asc"
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                      class={cn("whitespace-nowrap px-3 py-2.5 font-medium sm:px-4", col.class)}
                    >
                      <Show when={col.sort} fallback={col.header}>
                        <button
                          type="button"
                          class="min-h-6 uppercase tracking-[0.12em] transition-colors hover:text-foreground"
                          onClick={() => toggleSort(col.sortId ?? col.id)}
                        >
                          {col.header}
                          <span aria-hidden="true">{sortIndicator(col)}</span>
                        </button>
                      </Show>
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody class="divide-y divide-white/[0.055]">
              <For each={rows()}>
                {(row) => (
                  <tr
                    class={cn(
                      "transition-colors hover:bg-white/[0.028]",
                      props.onRowClick && "cursor-pointer",
                      selected()[row.id] && "bg-brand/[0.06]",
                    )}
                    tabindex={props.onRowClick ? "0" : undefined}
                    onClick={(event) => {
                      if (!props.onRowClick) return;
                      const target = event.target as HTMLElement;
                      if (target.closest("a,button,input,select,textarea")) return;
                      props.onRowClick(row);
                    }}
                    onKeyDown={(event) => {
                      if (!props.onRowClick) return;
                      const target = event.target as HTMLElement;
                      if (target.closest("a,button,input,select,textarea")) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        props.onRowClick(row);
                      }
                    }}
                  >
                    <td class="px-3 py-3 sm:px-4">
                      <input
                        type="checkbox"
                        class="size-4 accent-[var(--brand)]"
                        checked={!!selected()[row.id]}
                        onChange={(e) => toggleRow(row, e.currentTarget.checked)}
                        aria-label={`Select ${row.name ?? row.id}`}
                      />
                    </td>
                    <For each={visibleColumns()}>
                      {(col) => (
                        <td class={cn("px-3 py-3 align-middle sm:px-4", col.class)}>
                          {col.cell(row)}
                        </td>
                      )}
                    </For>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
          </div>
          <span
            class="pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-xl bg-gradient-to-l from-card to-transparent sm:hidden"
            aria-hidden="true"
          />
        </div>
      </Show>

      <Show when={props.footer}>{props.footer}</Show>

      <Show when={selectedRows().length > 0 && actions()}>
        <div class="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-xl border border-white/[0.1] bg-popover/95 px-4 py-2.5 shadow-2xl shadow-black/60 backdrop-blur-xl">
          <span class="text-[12.5px] font-medium">{selectedRows().length} selected</span>
          {actions()}
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
        </div>
      </Show>
    </div>
  );
}

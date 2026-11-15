import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button, buttonVariants } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuPortal,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
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
  /**
   * Whether the table offers bulk selection. Read-only roles still see every
   * row but get no checkboxes or selection action bar.
   */
  selectable?: boolean;
  /** Persist column visibility under this key. */
  storageKey?: string;
  /**
   * When set, the row becomes a pointer target for navigation. Keyboard users
   * follow the link rendered in the name cell, so the row itself is neither
   * focusable nor a second tab stop.
   */
  rowHref?: (row: T) => string;
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

  const serverMode = () => props.mode === "server";
  const selectable = () => props.selectable ?? true;
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

  const isColumnVisible = (column: MdmColumn<T>) =>
    hidden()[column.id] === false || (!hidden()[column.id] && !column.defaultHidden);

  const visibleColumns = createMemo(() => props.columns.filter(isColumnVisible));

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

  // Turning bulk actions off must also drop any selection made before the
  // permission changed (for example after switching roles in another tab).
  createEffect(
    () => selectable(),
    (enabled) => {
      if (!enabled) setSelected({});
    },
  );
  let selectAllRef: HTMLInputElement | undefined;
  createEffect(
    () => [selectedRows().length, allSelected()] as const,
    ([count, all]) => {
      if (selectAllRef) selectAllRef.indeterminate = count > 0 && !all;
    },
  );
  const clear = () => setSelected({});

  const toggleAll = () => {
    if (allSelected()) {
      setSelected({});

      return;
    }

    const next: Record<string, true> = {};

    for (const row of rows()) next[row.id] = true;

    setSelected(next);
  };

  const toggleSort = (id: string) => {
    const current = sort();

    if (!current || current.id !== id) {
      setSort({ id, dir: "asc" });

      return;
    }

    setSort(current.dir === "asc" ? { id, dir: "desc" } : null);
  };

  const toggleRow = (row: T, checked: boolean) => {
    const next = { ...selected() };

    if (checked) next[row.id] = true;
    else delete next[row.id];

    setSelected(next);
  };

  const toggleColumn = (id: string, visible: boolean) => {
    setHidden((value) => {
      const next = { ...value, [id]: !visible };

      if (props.storageKey && typeof localStorage !== "undefined")
        localStorage.setItem(`mattrax:table:${props.storageKey}:columns`, JSON.stringify(next));

      return next;
    });
  };

  const selectedCount = () => Object.keys(selected()).length;

  createEffect(
    () => selectedCount(),
    (count) => {
      if (count > 0) setStatusText(`${count} selected`);
    },
  );

  /**
   * Row counts are announced once they settle. Client-side filtering fires on
   * every keystroke, so a debounce keeps the live region from narrating each
   * character typed into the search box.
   */
  const [statusText, setStatusText] = createSignal("");
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(statusTimer));
  createEffect(
    () => ({ loading: Boolean(props.loading), count: rows().length, term: search().trim() }),
    (state) => {
      clearTimeout(statusTimer);

      if (state.loading) {
        setStatusText("Loading rows…");

        return;
      }

      statusTimer = setTimeout(() => {
        if (state.count === 0) {
          setStatusText(state.term ? `No matches for ${state.term}` : "No rows to show");

          return;
        }

        setStatusText(`${state.count} ${state.count === 1 ? "row" : "rows"} shown`);
      }, 350);
    },
  );

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
                ? `${rows().length} ${rows().length === 1 ? "row" : "rows"}`
                : `${rows().length} of ${props.rows?.length ?? 0}`}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              class={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
              aria-label="Choose visible columns"
            >
              <ChevronsUpDown class="size-3.5" />
              <span class="hidden sm:inline">Columns</span>
            </DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent class="w-52 rounded-lg border border-white/[0.09] bg-[#232326] p-0.5 text-popover-foreground shadow-[0_8px_24px_rgba(0,0,0,.45),0_2px_6px_rgba(0,0,0,.3),inset_0_0_0_1px_rgba(255,255,255,.02)]">
                <For each={props.columns}>
                  {(column) => (
                    <DropdownMenuCheckboxItem
                      class="flex h-7 cursor-pointer items-center gap-2 rounded-md pl-7 pr-2 text-[12.5px] data-highlighted:bg-white/[0.06]"
                      checked={isColumnVisible(column)}
                      closeOnSelect={false}
                      onChange={(checked) => toggleColumn(column.id, checked)}
                    >
                      {column.header}
                    </DropdownMenuCheckboxItem>
                  )}
                </For>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenu>
        </div>
      </div>

      <p role="status" aria-live="polite" aria-atomic="true" class="sr-only">
        {statusText()}
      </p>

      {props.toolbar}

      <Show when={props.error}>
        <QueryError error={props.error} />
      </Show>
      <Show when={!props.error && props.loading}>
        <div class="overflow-hidden rounded-lg border border-white/[0.08] bg-card">
          <div class="space-y-1.5 p-3">
            <For each={[0, 1, 2, 3, 4]}>
              {() => <div class="h-11 animate-pulse rounded-lg bg-white/[0.035]" />}
            </For>
          </div>
        </div>
      </Show>
      <Show
        when={!props.error && !props.loading && rows().length > 0}
        fallback={
          !props.error && !props.loading ? (
            search().trim() ? (
              <div class="flex min-h-56 flex-col items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.012] px-6 py-10 text-center">
                <p class="text-[13.5px] font-semibold text-foreground">
                  No matches for “{search().trim()}”
                </p>
                <p class="mt-1 text-[12.5px] text-muted-foreground">
                  Try a different name or clear the search.
                </p>
                <Button variant="outline" size="sm" class="mt-4" onClick={() => setSearch("")}>
                  Clear search
                </Button>
              </div>
            ) : (
              props.empty
            )
          ) : undefined
        }
      >
        <div class="relative" aria-busy={props.loading ? "true" : undefined}>
          <div class="page-enter overflow-x-auto rounded-lg border border-white/[0.07] bg-card shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
            <p class="border-b border-white/[0.06] px-3 py-2 text-[11px] text-muted-foreground sm:hidden">
              Swipe the table sideways to see more columns.
            </p>
            <table class="w-full text-[13px]">
              <caption class="sr-only">{props.caption ?? "Data table"}</caption>
              <thead class="border-b border-white/[0.07] bg-white/[0.015] text-left text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground/90">
                <tr>
                  <Show when={selectable()}>
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
                  </Show>
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
                  {(row) => {
                    return (
                      <tr
                        class={cn(
                          "relative transition-[background-color,box-shadow] duration-150 ease-swift hover:bg-white/[0.028]",
                          selected()[row.id] &&
                            "bg-brand/[0.06] shadow-[inset_2px_0_0_var(--brand)]",
                        )}
                      >
                        <Show when={selectable()}>
                          <td class="relative z-10 px-3 py-3 sm:px-4">
                            <input
                              type="checkbox"
                              class="size-4 accent-[var(--brand)]"
                              checked={!!selected()[row.id]}
                              onChange={(e) => toggleRow(row, e.currentTarget.checked)}
                              aria-label={`Select ${row.name ?? row.id}`}
                            />
                          </td>
                        </Show>
                        <For each={visibleColumns()}>
                          {(col) => (
                            <td class={cn("px-3 py-3 align-middle sm:px-4", col.class)}>
                              {col.cell(row)}
                            </td>
                          )}
                        </For>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </div>
          <span
            class="pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-lg bg-gradient-to-l from-card to-transparent sm:hidden"
            aria-hidden="true"
          />
        </div>
      </Show>

      <Show when={props.footer}>{props.footer}</Show>

      <Show when={selectable() && selectedCount() > 0 && props.actions}>
        <div
          role="group"
          aria-label="Bulk actions"
          class="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-lg border border-white/[0.1] bg-popover/95 px-4 py-2.5 shadow-2xl shadow-black/60 backdrop-blur-xl"
        >
          <span class="text-[12.5px] font-medium">{selectedCount()} selected</span>
          {props.actions?.(selectedRows(), clear)}
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
        </div>
      </Show>
    </div>
  );
}

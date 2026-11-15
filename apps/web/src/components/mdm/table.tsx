import { createEffect, createMemo, createSignal, For, onCleanup, onSettled, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import type { JSX } from "@solidjs/web";
import { Button, buttonVariants } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { ChevronsUpDown, RefreshCw, Search as SearchIcon } from "~/components/ui/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
import { announce } from "~/components/toast";
import { chord, sequence, useCommands } from "~/lib/commands";
import { shouldOfferAllMatching } from "~/lib/table-selection";
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

/** Extra state handed to the bulk bar when the whole filtered set is selected. */
export type MdmBulkSelection = {
  allMatching: boolean;
  total: number;
  setAllMatching: (value: boolean) => void;
};

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
  /**
   * Bulk action bar contents. `select` replaces the current selection with the
   * given row ids, which lets an action keep the rows that failed selected.
   */
  actions?: (
    selected: T[],
    clear: () => void,
    select: (ids: readonly string[]) => void,
    selection: MdmBulkSelection,
  ) => JSX.Element;
  /**
   * Whether the table offers bulk selection. Read-only roles still see every
   * row but get no checkboxes or selection action bar.
   */
  selectable?: boolean;
  /**
   * Controlled selection for pickers whose checkboxes represent membership
   * (group devices and policies) rather than a transient bulk selection. The
   * parent owns the set, so ids that are not on the current page are kept.
   */
  selectedIds?: () => ReadonlySet<string>;
  onSelectedChange?: (ids: ReadonlySet<string>) => void;
  /** Persist column visibility under this key. */
  storageKey?: string;
  /**
   * When set, the row becomes a pointer target for navigation. Keyboard users
   * follow the link rendered in the name cell, so the row itself is neither
   * focusable nor a second tab stop.
   */
  rowHref?: (row: T) => string;
  loading?: boolean;
  /**
   * A background refetch is in flight while the previous rows stay visible.
   * The body dims, the toolbar shows a "Refreshing…" pill and the table reports
   * `aria-busy`, so a filter change never looks like a settled empty result.
   */
  isFetching?: boolean;
  /** Reloads the current page; adds a Refresh button and an `R` shortcut. */
  onRefresh?: () => void;
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
  /**
   * Changes whenever the parent's filter changes. A different value clears the
   * selection (and an all-matching choice) even if the page happens to contain
   * the same ids. Controlled membership tables ignore it.
   */
  selectionKey?: string;
  /** Accessible name for the table. */
  caption?: string;
}) {
  const [selected, setSelected] = createSignal<Record<string, true>>({});
  const [allMatching, setAllMatching] = createSignal(false);
  const [internalSearch, setInternalSearch] = createSignal("");
  const [internalSort, setInternalSort] = createSignal<SortState>(null);
  const [activeRow, setActiveRow] = createSignal(-1);
  const [tableFocused, setTableFocused] = createSignal(false);
  // The server cannot see the platform; keep the SSR hint stable ("CtrlF")
  // and switch to the Mac glyph after hydration so both trees match.
  const [modKey, setModKey] = createSignal("Ctrl");

  const [hidden, setHidden] = createSignal<Record<string, boolean>>(
    readVisibility(props.storageKey),
  );

  const navigate = useNavigate();
  let searchRef: HTMLDivElement | undefined;
  let tableRef: HTMLTableElement | undefined;
  const rowRefs: Array<HTMLTableRowElement | undefined> = [];

  const serverMode = () => props.mode === "server";
  const selectable = () => props.selectable ?? true;

  /** Client tables can still hand search to the parent (to reuse its filter). */
  const parentSearch = () =>
    !serverMode() && props.searchValue !== undefined && props.onSearchChange !== undefined;

  const controlled = () => props.selectedIds !== undefined && props.onSelectedChange !== undefined;

  const isSelected = (id: string) =>
    controlled() ? (props.selectedIds?.()?.has(id) ?? false) : Boolean(selected()[id]);

  const search = () =>
    serverMode() || parentSearch() ? (props.searchValue ?? "") : internalSearch();

  const setSearch = (value: string) => {
    if (serverMode() || parentSearch()) props.onSearchChange?.(value);
    else setInternalSearch(value);
  };

  const sort = () => (serverMode() ? (props.sortValue ?? null) : internalSort());

  const setSort = (value: SortState) => {
    if (serverMode()) props.onSortChange?.(value);
    else setInternalSort(value);
  };

  const isColumnVisible = (column: MdmColumn<T>) =>
    hidden()[column.id] === false || (!hidden()[column.id] && !column.defaultHidden);

  /** Visibility for a candidate map, used before the map is committed. */
  const visibleIn = (state: Record<string, boolean>, column: MdmColumn<T>) =>
    state[column.id] === false || (!state[column.id] && !column.defaultHidden);

  const visibleColumns = createMemo(() => props.columns.filter(isColumnVisible));

  const sortColumnId = (column: MdmColumn<T>) => column.sortId ?? column.id;

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
      const col = props.columns.find((item) => sortColumnId(item) === current.id);
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
   * in the action bar, and an "all matching" selection no longer describes the
   * rows the operator is looking at. Re-ordering the same ids keeps both.
   */
  createEffect(
    () =>
      rows()
        .map((row) => row.id)
        .sort()
        .join("\u0000"),
    () => {
      setAllMatching(false);

      if (!controlled()) setSelected({});
    },
  );

  createEffect(
    () => props.selectionKey,
    (key, previous) => {
      if (previous === undefined || key === previous || controlled()) return;
      setSelected({});
      setAllMatching(false);
    },
  );

  const selectedRows = createMemo(() => rows().filter((row) => isSelected(row.id)));
  const allSelected = () => rows().length > 0 && selectedRows().length === rows().length;

  // Keep exactly one row in the tab order, and never leave it pointing past
  // the end after a filter or page change.
  createEffect(
    () => rows().length,
    (length) => {
      if (length === 0) setActiveRow(-1);
      else if (activeRow() < 0 || activeRow() >= length) setActiveRow(0);
    },
  );

  // Turning bulk actions off must also drop any selection made before the
  // permission changed (for example after switching roles in another tab).
  createEffect(
    () => selectable(),
    (enabled) => {
      if (!enabled && !controlled()) {
        setSelected({});
        setAllMatching(false);
      }
    },
  );
  let selectAllRef: HTMLInputElement | undefined;
  createEffect(
    () => [selectedRows().length, allSelected(), allMatching()] as const,
    ([count, all]) => {
      if (selectAllRef) selectAllRef.indeterminate = count > 0 && !all;
    },
  );

  const setControlled = (ids: ReadonlySet<string>) => props.onSelectedChange?.(ids);

  const clear = () => {
    setAllMatching(false);

    if (controlled()) setControlled(new Set());
    else setSelected({});
  };

  /**
   * Replace the selection with rows that are still on screen. Ids that are no
   * longer in the current page are dropped so the action bar can never count a
   * row the operator cannot see.
   */
  const select = (ids: readonly string[]) => {
    const available = new Set(rows().map((row) => row.id));
    const next = new Set([...ids].filter((id) => available.has(id)));

    setAllMatching(false);

    if (controlled()) setControlled(next);
    else setSelected(Object.fromEntries([...next].map((id) => [id, true] as const)));
  };

  onSettled(() => {
    if (/(Mac|iPhone|iPad|iPod)/i.test(navigator.userAgent)) setModKey("⌘");
  });

  const focusSearch = () => {
    const input = searchRef?.querySelector("input");

    input?.focus({ preventScroll: true });
    input?.select();
  };

  // Keyboard focus stays on a single row so the table is one tab stop, the
  // roving-tabindex pattern.

  const moveRow = (event: KeyboardEvent, index: number, row: T) => {
    if (!props.rowHref || event.defaultPrevented || event.isComposing) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();

      const next = Math.max(
        0,
        Math.min(rows().length - 1, index + (event.key === "ArrowDown" ? 1 : -1)),
      );

      setActiveRow(next);
      rowRefs[next]?.focus();

      return;
    }

    if (event.key === "Enter" && props.rowHref) {
      event.preventDefault();
      navigate(props.rowHref(row));
    }
  };

  const onTableKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing) return;

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      if (!selectable()) return;
      event.preventDefault();
      toggleAll();

      return;
    }
  };

  /**
   * Escape is captured at the window so a primitive's dismissable layer cannot
   * swallow it first. Inside the search it clears the query; elsewhere in the
   * table it also drops the selection. Focus outside the table is untouched.
   */
  onSettled(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;

      const target = event.target;
      const inSearch = target instanceof Node && Boolean(searchRef?.contains(target));

      if (!inSearch && !(target instanceof Node && tableRef?.contains(target))) return;

      if (!search() && selectedCount() === 0) return;

      event.preventDefault();
      event.stopPropagation();

      if (inSearch) setSearch("");
      else {
        setSearch("");
        clear();
      }
    };

    window.addEventListener("keydown", onEscape, true);

    return () => window.removeEventListener("keydown", onEscape, true);
  });

  // `R` refreshes the list, matching the legacy dashboard and the Refresh
  // button rendered next to the column picker. The search and selection
  // shortcuts are registered here so they appear in Cmd+K, not only in the
  // field's tooltip.
  useCommands(() => [
    ...(props.onRefresh
      ? [
          {
            id: "table-refresh",
            title: "Refresh list",
            subtitle: "Reload the rows from the server",
            group: "This page",
            shortcut: sequence("r"),
            enabled: () => !props.loading && !props.isFetching,
            run: () => props.onRefresh?.(),
          },
        ]
      : []),
    {
      id: "table-focus-search",
      title: "Search this list",
      subtitle: "Focus the table search; Escape clears it",
      group: "This page",
      shortcut: sequence("/"),
      run: focusSearch,
    },
    {
      id: "table-focus-search-mod",
      title: "Search this list",
      subtitle: "Same as pressing / in the table",
      group: "This page",
      shortcut: chord("f", { mod: true }),
      run: focusSearch,
    },
    {
      id: "table-clear",
      title: "Clear search and selection",
      subtitle: "Reset the table's search and checked rows",
      group: "This page",
      shortcut: chord("Escape"),
      enabled: () => Boolean(search()) || selectedCount() > 0,
      run: () => {
        setSearch("");
        clear();
      },
    },
    {
      id: "table-select-all",
      title: "Select all rows on this page",
      subtitle: "Toggle the table's checkbox column",
      group: "This page",
      shortcut: chord("a", { mod: true }),
      enabled: () => selectable() && rows().length > 0 && tableFocused(),
      run: () => toggleAll(),
    },
  ]);

  const toggleAll = () => {
    if (allMatching()) {
      clear();

      return;
    }

    if (controlled()) {
      const next = new Set(props.selectedIds?.() ?? []);
      const ids = rows().map((row) => row.id);

      if (allSelected()) for (const id of ids) next.delete(id);
      else for (const id of ids) next.add(id);
      setControlled(next);

      return;
    }

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
    if (controlled()) {
      const next = new Set(props.selectedIds?.() ?? []);

      if (checked) next.add(row.id);
      else next.delete(row.id);
      setControlled(next);

      return;
    }

    // Narrowing an all-matching selection starts a new, explicit selection
    // from the rows on screen so the count always describes what is ticked.
    if (allMatching()) {
      const next: Record<string, true> = {};

      for (const visible of rows()) if (isSelected(visible.id)) next[visible.id] = true;

      if (checked) next[row.id] = true;
      else delete next[row.id];
      setAllMatching(false);
      setSelected(next);

      return;
    }

    const next = { ...selected() };

    if (checked) next[row.id] = true;
    else delete next[row.id];

    setSelected(next);
  };

  /** Persist a visibility map and drop any sort whose column just disappeared. */
  const applyVisibility = (next: Record<string, boolean>) => {
    setHidden(next);

    if (props.storageKey && typeof localStorage !== "undefined")
      localStorage.setItem(`mattrax:table:${props.storageKey}:columns`, JSON.stringify(next));

    const current = sort();

    if (!current) return;
    const column = props.columns.find((item) => sortColumnId(item) === current.id);

    // An ordering whose column is hidden has no visible cause, so clear it.
    if (!column || !visibleIn(next, column)) setSort(null);
  };

  const showAllColumns = () =>
    applyVisibility(Object.fromEntries(props.columns.map((column) => [column.id, false])));

  /** Back to the columns' declared defaults (`defaultHidden` stays hidden). */
  const resetColumns = () => applyVisibility({});

  const toggleColumn = (column: MdmColumn<T>, visible: boolean) => {
    // The checkbox is disabled in this state; the guard also covers keyboard
    // activation and a stale picker after another tab changed the storage.
    if (!visible && visibleColumns().length === 1 && isColumnVisible(column)) {
      announce("Keep at least one column visible.");

      return;
    }

    applyVisibility({ ...hidden(), [column.id]: !visible });
  };

  const selectedCount = () =>
    allMatching()
      ? (props.total ?? selectedRows().length)
      : controlled()
        ? (props.selectedIds?.()?.size ?? 0)
        : Object.keys(selected()).length;

  const showSelectAllMatching = () =>
    shouldOfferAllMatching({
      controlled: controlled(),
      allMatching: allMatching(),
      allSelected: allSelected(),
      visible: rows().length,
      total: props.total,
    });

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

    if (value?.id !== sortColumnId(column)) return "";

    return value.dir === "asc" ? " ↑" : " ↓";
  };

  return (
    <div class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2.5">
        <div class="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md">
          <div
            ref={(element) => {
              searchRef = element;
            }}
            class="relative min-w-0 flex-1"
          >
            <SearchIcon class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={props.searchPlaceholder ?? "Search…"}
              aria-label="Search table"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              class="h-8 w-full pl-8! pr-14 text-[12.5px]"
            />
            <Tooltip>
              <TooltipTrigger
                as="span"
                tabindex={0}
                aria-label="Search shortcuts"
                class="absolute right-2 top-1/2 hidden -translate-y-1/2 cursor-default rounded border border-border bg-surface px-1.5 py-0.5 font-sans text-[10px] leading-none text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:inline"
              >
                {modKey()}F
              </TooltipTrigger>
              <TooltipContent>
                <p class="text-[11px] font-medium">Search this list</p>
                <p class="mt-0.5 text-[11px]">
                  / or {modKey()}F focuses the field. Escape clears it.
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
          <Show when={search()}>
            <Button variant="ghost" size="xs" onClick={() => setSearch("")}>
              Clear
            </Button>
          </Show>
        </div>
        <div class="flex items-center gap-2">
          <Show when={props.isFetching && !props.loading}>
            <span class="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
              <RefreshCw
                class="size-3 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              Refreshing…
            </span>
          </Show>
          <span class="hidden text-[11px] tabular-nums text-muted-foreground sm:inline">
            {props.total !== undefined
              ? `${props.rows?.length ?? 0} of ${props.total}`
              : rows().length === (props.rows?.length ?? 0)
                ? `${rows().length} ${rows().length === 1 ? "row" : "rows"}`
                : `${rows().length} of ${props.rows?.length ?? 0}`}
          </span>
          <Show when={props.onRefresh}>
            <Button
              variant="outline"
              size="sm"
              class="gap-1.5"
              aria-label="Refresh list"
              disabled={props.loading || props.isFetching}
              onClick={() => props.onRefresh?.()}
            >
              <RefreshCw
                class={cn(
                  "size-3.5",
                  props.isFetching && "animate-spin motion-reduce:animate-none",
                )}
                aria-hidden="true"
              />
              <span class="hidden sm:inline">Refresh</span>
            </Button>
          </Show>
          <Tooltip>
            <TooltipTrigger as="span" class="inline-flex">
              <DropdownMenu>
                <DropdownMenuTrigger
                  class={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
                  aria-label="Choose visible columns"
                >
                  <ChevronsUpDown class="size-3.5" />
                  <span class="hidden sm:inline">Columns</span>
                </DropdownMenuTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuContent class="w-52 rounded-lg border border-border bg-popover p-0.5 text-popover-foreground shadow-[var(--shadow-popover)]">
                    <For each={props.columns}>
                      {(column) => {
                        const lastVisible = () =>
                          isColumnVisible(column) && visibleColumns().length === 1;

                        return (
                          <DropdownMenuCheckboxItem
                            class="flex h-7 cursor-pointer items-center gap-2 rounded-md pl-7 pr-2 text-[12.5px] data-highlighted:bg-hover"
                            checked={isColumnVisible(column)}
                            closeOnSelect={false}
                            disabled={lastVisible()}
                            title={
                              lastVisible() ? "At least one column must stay visible" : undefined
                            }
                            onChange={(checked) => toggleColumn(column, checked)}
                          >
                            {column.header}
                          </DropdownMenuCheckboxItem>
                        );
                      }}
                    </For>
                    <DropdownMenuSeparator class="mx-1 my-1 h-px bg-border" />
                    <DropdownMenuItem
                      class="flex h-7 cursor-pointer items-center rounded-md px-2 text-[12.5px] outline-none data-highlighted:bg-hover"
                      onSelect={resetColumns}
                    >
                      Reset columns
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      class="flex h-7 cursor-pointer items-center rounded-md px-2 text-[12.5px] outline-none data-highlighted:bg-hover"
                      onSelect={showAllColumns}
                    >
                      Show all
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenuPortal>
              </DropdownMenu>
            </TooltipTrigger>
            <TooltipContent>
              <p class="text-[11px] font-medium">Columns and keyboard</p>
              <p class="mt-0.5 text-[11px]">
                Choose visible columns. In the table, ↑/↓ move between rows, Enter opens one and{" "}
                {modKey()}A selects the page.
              </p>
            </TooltipContent>
          </Tooltip>
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
        <div class="overflow-hidden rounded-lg border border-border bg-card">
          <div class="space-y-1.5 p-3">
            <For each={[0, 1, 2, 3, 4]}>
              {() => <div class="h-11 animate-pulse rounded-lg bg-surface" />}
            </For>
          </div>
        </div>
      </Show>
      <Show
        when={!props.error && !props.loading && rows().length > 0}
        fallback={
          !props.error && !props.loading ? (
            search().trim() ? (
              <div class="flex min-h-56 flex-col items-center justify-center rounded-lg border border-border bg-surface px-6 py-10 text-center">
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
        <div class="relative" aria-busy={props.loading || props.isFetching ? "true" : undefined}>
          <div class="page-enter overflow-x-auto rounded-lg border border-border bg-card shadow-[var(--card-highlight)]">
            <p class="border-b border-border px-3 py-2 text-[11px] text-muted-foreground sm:hidden">
              Swipe the table sideways to see more columns.
            </p>
            {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Rows carry the roving tabindex; the table delegates their arrow/Enter keys. */}
            <table
              ref={(element) => {
                tableRef = element;
              }}
              class="w-full text-[13px]"
              onKeyDown={onTableKeyDown}
              onFocusIn={() => {
                setTableFocused(true);
              }}
              onFocusOut={(event) => {
                if (
                  !tableRef?.contains(
                    event.relatedTarget instanceof Node ? event.relatedTarget : null,
                  )
                )
                  setTableFocused(false);
              }}
            >
              <caption class="sr-only">{props.caption ?? "Data table"}</caption>
              <thead class="border-b border-border bg-surface text-left text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground/90">
                <tr>
                  <Show when={selectable()}>
                    <th scope="col" class="w-10 px-3 py-2.5 sm:px-4">
                      <input
                        ref={(el) => (selectAllRef = el)}
                        type="checkbox"
                        class="size-4 accent-[var(--brand-solid)]"
                        checked={allSelected()}
                        onChange={toggleAll}
                        aria-label={
                          allMatching()
                            ? `Deselect all ${props.total ?? 0} matching rows`
                            : `Select all ${rows().length} rows on this page`
                        }
                      />
                    </th>
                  </Show>
                  <For each={visibleColumns()}>
                    {(col) => (
                      <th
                        scope="col"
                        aria-sort={
                          sort()?.id === sortColumnId(col)
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
                            onClick={() => toggleSort(sortColumnId(col))}
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
              <tbody
                class={cn(
                  "divide-y divide-border transition-[opacity,filter] duration-150 ease-swift",
                  props.isFetching && "opacity-60 saturate-0",
                )}
              >
                <For each={rows()}>
                  {(row, index) => {
                    const rowIndex = () => index();

                    return (
                      <tr
                        ref={(element) => {
                          rowRefs[rowIndex()] = element;
                        }}
                        tabindex={props.rowHref ? (activeRow() === rowIndex() ? 0 : -1) : undefined}
                        onFocus={() => setActiveRow(rowIndex())}
                        onKeyDown={(event) => moveRow(event, rowIndex(), row)}
                        class={cn(
                          "relative outline-none transition-[background-color,box-shadow] duration-150 ease-swift hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
                          isSelected(row.id) &&
                            "bg-brand/[0.06] shadow-[inset_2px_0_0_var(--brand)]",
                        )}
                      >
                        <Show when={selectable()}>
                          <td class="relative z-10 px-3 py-3 sm:px-4">
                            <input
                              type="checkbox"
                              class="size-4 accent-[var(--brand-solid)]"
                              checked={isSelected(row.id)}
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
          class="fixed bottom-5 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-lg border border-border bg-popover/95 px-4 py-2.5 shadow-2xl backdrop-blur-xl"
        >
          <span class="text-[12.5px] font-medium">
            {allMatching()
              ? `${props.total ?? selectedCount()} matching rows`
              : `${selectedCount()} selected`}
          </span>
          <Show when={showSelectAllMatching()}>
            <Button variant="link" size="sm" onClick={() => setAllMatching(true)}>
              Select all {props.total} matching this filter
            </Button>
          </Show>
          {props.actions?.(selectedRows(), clear, select, {
            allMatching: allMatching(),
            total: props.total ?? selectedRows().length,
            setAllMatching,
          })}
          <Button variant="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
        </div>
      </Show>
    </div>
  );
}

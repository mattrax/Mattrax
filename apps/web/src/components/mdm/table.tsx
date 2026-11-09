import { createMemo, createSignal, For, onSettled, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { Button } from "~/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { ChevronsUpDown } from "~/components/ui/icons";
import { cn } from "~/lib/utils";

export type MdmColumn<T> = {
  id: string;
  header: string;
  class?: string;
  cell: (row: T) => JSX.Element;
  sort?: (row: T) => string | number | undefined | null;
  search?: (row: T) => string | undefined | null;
  /** Columns hidden by default can be enabled from the column picker. */
  defaultHidden?: boolean;
};

type SortState = { id: string; dir: "asc" | "desc" } | null;

function readVisibility(key: string | undefined): Record<string, boolean> {
  if (!key || typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(`mattrax:table:${key}:columns`) ?? "{}");
  } catch {
    return {};
  }
}

export function MdmTable<T extends { id: string; name?: string }>(props: {
  rows: T[] | undefined;
  columns: MdmColumn<T>[];
  empty: JSX.Element;
  actions?: (selected: T[], clear: () => void) => JSX.Element;
  /** Persist column visibility under this key. */
  storageKey?: string;
  /** Navigate when a row is clicked (links/buttons inside the row still win). */
  onRowClick?: (row: T) => void;
  loading?: boolean;
  searchPlaceholder?: string;
}) {
  const [selected, setSelected] = createSignal<Record<string, true>>({});
  const [search, setSearch] = createSignal("");
  const [sort, setSort] = createSignal<SortState>(null);
  const [hidden, setHidden] = createSignal<Record<string, boolean>>(
    readVisibility(props.storageKey),
  );
  let searchInput: HTMLInputElement | undefined;

  // Cmd/Ctrl+F focuses the table search, matching the production UI.
  onSettled(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchInput?.focus();
        searchInput?.select();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const visibleColumns = createMemo(() =>
    props.columns.filter(
      (column) => !hidden()[column.id] && (hidden()[column.id] === false || !column.defaultHidden),
    ),
  );

  const rows = createMemo(() => {
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

  const selectedRows = createMemo(() => rows().filter((row) => selected()[row.id]));
  const allSelected = () => rows().length > 0 && selectedRows().length === rows().length;
  const clear = () => setSelected({});
  const toggleAll = () =>
    setSelected(
      allSelected()
        ? {}
        : (Object.fromEntries(rows().map((row) => [row.id, true])) as Record<string, true>),
    );
  const toggleSort = (id: string) =>
    setSort((value) =>
      value?.id !== id ? { id, dir: "asc" } : value.dir === "asc" ? { id, dir: "desc" } : null,
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
  const sortIndicator = (id: string) => {
    const value = sort();
    if (value?.id !== id) return "";
    return value.dir === "asc" ? " ↑" : " ↓";
  };

  return (
    <div class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <Input
            ref={searchInput}
            placeholder={props.searchPlaceholder ?? "Search… (⌘F)"}
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            class="max-w-xs"
          />
          <Show when={search()}>
            <Button variant="ghost" size="sm" onClick={() => setSearch("")}>
              Clear
            </Button>
          </Show>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-sm text-muted-foreground">
            {rows().length === (props.rows?.length ?? 0)
              ? `${rows().length} rows`
              : `${rows().length} of ${props.rows?.length ?? 0}`}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger class="inline-flex">
              <Button variant="outline" size="sm">
                <ChevronsUpDown class="size-4" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent class="w-52 rounded-xl border bg-white p-1 shadow-lg">
              <DropdownMenuLabel class="px-2 py-1 text-xs text-muted-foreground">
                Visible columns
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <For each={props.columns}>
                {(column) => (
                  <DropdownMenuCheckboxItem
                    checked={!hidden()[column.id] && !column.defaultHidden}
                    onChange={(value) => toggleColumn(column.id, value)}
                    class="rounded-md px-2 py-1.5 text-sm"
                  >
                    {column.header}
                  </DropdownMenuCheckboxItem>
                )}
              </For>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Show when={props.loading}>
        <div class="overflow-hidden rounded-xl border bg-card">
          <div class="space-y-2 p-4">
            <For each={[0, 1, 2, 3]}>
              {() => <div class="h-10 animate-pulse rounded-lg bg-muted/60" />}
            </For>
          </div>
        </div>
      </Show>
      <Show
        when={!props.loading && rows().length > 0}
        fallback={!props.loading ? props.empty : undefined}
      >
        <div class="overflow-hidden rounded-xl border bg-card">
          <table class="w-full text-sm">
            <thead class="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th class="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected()}
                    onChange={toggleAll}
                    aria-label="Select all rows"
                  />
                </th>
                <For each={visibleColumns()}>
                  {(col) => (
                    <th class={cn("px-4 py-3", col.class)}>
                      <button
                        type="button"
                        class={cn("uppercase tracking-wide", col.sort && "hover:text-stone-900")}
                        onClick={() => col.sort && toggleSort(col.id)}
                      >
                        {col.header}
                        {sortIndicator(col.id)}
                      </button>
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <tbody class="divide-y">
              <For each={rows()}>
                {(row) => (
                  <tr
                    class={cn(
                      "hover:bg-muted/25",
                      props.onRowClick && "cursor-pointer",
                      selected()[row.id] && "bg-muted/40",
                    )}
                    onClick={(event) => {
                      if (!props.onRowClick) return;
                      const target = event.target as HTMLElement;
                      if (target.closest("a,button,input,select,textarea")) return;
                      props.onRowClick(row);
                    }}
                  >
                    <td class="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={!!selected()[row.id]}
                        onChange={(e) => toggleRow(row, e.currentTarget.checked)}
                        aria-label={`Select ${row.name ?? row.id}`}
                      />
                    </td>
                    <For each={visibleColumns()}>
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

      <Show when={selectedRows().length > 0 && actions()}>
        <div class="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border bg-white px-4 py-3 shadow-xl">
          <span class="text-sm font-medium">{selectedRows().length} selected</span>
          {actions()}
          <Button variant="ghost" onClick={clear}>
            Clear
          </Button>
        </div>
      </Show>
    </div>
  );
}

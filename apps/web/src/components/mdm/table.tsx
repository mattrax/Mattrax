import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { cn } from "~/lib/utils";

export type MdmColumn<T> = { id: string; header: string; class?: string; cell: (row: T) => JSX.Element; sort?: (row: T) => string | number | undefined | null; search?: (row: T) => string | undefined | null };

export function MdmTable<T extends { id: string; name?: string }>(props: { rows: T[] | undefined; columns: MdmColumn<T>[]; empty: JSX.Element; actions?: (selected: T[], clear: () => void) => JSX.Element }) {
  const [selected, setSelected] = createSignal<Record<string, true>>({});
  const [search, setSearch] = createSignal("");
  const [sort, setSort] = createSignal<{ id: string; dir: "asc" | "desc" } | null>(null);
  const rows = createMemo(() => {
    const term = search().trim().toLowerCase();
    let result = [...(props.rows ?? [])];
    if (term) result = result.filter((row) => props.columns.some((col) => (col.search?.(row) ?? String(col.sort?.(row) ?? "")).toLowerCase().includes(term)) || row.name?.toLowerCase().includes(term));
    const current = sort();
    if (current) {
      const col = props.columns.find((item) => item.id === current.id);
      result.sort((a, b) => String(col?.sort?.(a) ?? "").localeCompare(String(col?.sort?.(b) ?? ""), undefined, { numeric: true }) * (current.dir === "asc" ? 1 : -1));
    }
    return result;
  });
  const selectedRows = createMemo(() => rows().filter((row) => selected()[row.id]));
  const allSelected = () => rows().length > 0 && selectedRows().length === rows().length;
  const clear = () => setSelected({});
  const toggleAll = () => setSelected(allSelected() ? {} : Object.fromEntries(rows().map((row) => [row.id, true])) as Record<string, true>);
  const toggleSort = (id: string) => setSort((value) => value?.id === id ? { id, dir: value.dir === "asc" ? "desc" : "asc" } : { id, dir: "asc" });
  const toggleRow = (row: T, checked: boolean) => {
    setSelected((value) => {
      const next = { ...value };
      if (checked) next[row.id] = true;
      else delete next[row.id];
      return next;
    });
  };
  const actions = () => props.actions?.(selectedRows(), clear);

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between gap-3">
        <Input placeholder="Search..." value={search()} onInput={(e) => setSearch(e.currentTarget.value)} class="max-w-xs" />
        <p class="text-sm text-muted-foreground">{rows().length} rows</p>
      </div>

      <Show when={rows().length > 0} fallback={props.empty}>
        <div class="overflow-hidden rounded-xl border bg-card">
          <table class="w-full text-sm">
            <thead class="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th class="w-10 px-4 py-3"><input type="checkbox" checked={allSelected()} onChange={toggleAll} /></th>
                <For each={props.columns}>{(col) => (
                  <th class={cn("px-4 py-3", col.class)}>
                    <button type="button" class="uppercase tracking-wide" onClick={() => col.sort && toggleSort(col.id)}>{col.header}</button>
                  </th>
                )}</For>
              </tr>
            </thead>
            <tbody class="divide-y">
              <For each={rows()}>{(row) => (
                <tr class="hover:bg-muted/25">
                  <td class="px-4 py-3"><input type="checkbox" checked={!!selected()[row.id]} onChange={(e) => toggleRow(row, e.currentTarget.checked)} /></td>
                  <For each={props.columns}>{(col) => <td class={cn("px-4 py-3 align-middle", col.class)}>{col.cell(row)}</td>}</For>
                </tr>
              )}</For>
            </tbody>
          </table>
        </div>
      </Show>

      <Show when={selectedRows().length > 0 && actions()}>
        <div class="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border bg-white px-4 py-3 shadow-xl">
          <span class="text-sm font-medium">{selectedRows().length} selected</span>
          {actions()}
          <Button variant="ghost" onClick={clear}>Clear</Button>
        </div>
      </Show>
    </div>
  );
}

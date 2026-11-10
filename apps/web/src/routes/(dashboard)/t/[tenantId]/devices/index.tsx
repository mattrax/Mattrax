import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import {
  DeviceStatusBadge,
  EmptyState,
  ErrorText,
  formatDate,
  LinkButton,
  PageHeader,
  PlatformBadge,
} from "~/components/mdm/common";
import { EntityActions } from "~/components/mdm/entity-actions";
import { MdmTable, type MdmSortState } from "~/components/mdm/table";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  enterprise,
  enterpriseKeys,
  type DeviceHealthFilter,
  type DeviceRow,
} from "~/lib/enterprise";
import {
  DEVICE_IMPORT_MAX_ROWS,
  parseDeviceImportCsv,
  toDeviceImportPayload,
  type DeviceImportParseResult,
} from "~/lib/device-import";

const PAGE_SIZE = 50;

const FILTER_PARAM_KEYS = [
  "q",
  "status",
  "proto",
  "groupId",
  "staleDays",
  "health",
  "push",
  "sort",
  "direction",
] as const;
/** `setSearchParams` merges, so every known key must be sent (empty deletes). */
const emptyFilterParams = () =>
  Object.fromEntries(FILTER_PARAM_KEYS.map((key) => [key, ""])) as Record<string, string>;

const selectClass = "h-9 rounded-lg border bg-white px-3 text-sm text-stone-800";

/** Search rows carry group names; the base `DeviceRow` type does not. */
const rowGroups = (row: DeviceRow) =>
  (row as DeviceRow & { groups?: ReadonlyArray<{ name: string }> }).groups ?? [];

export default function DevicesPage() {
  const params = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const initialStatus = (): DeviceRow["status"] | "" => {
    const value = param(searchParams.status);
    return value === "enrolling" ||
      value === "enrolled" ||
      value === "unenrolling" ||
      value === "unenrolled"
      ? value
      : "";
  };
  const initialProto = (): DeviceRow["proto"] | "" => {
    const value = param(searchParams.proto);
    return value === "apple" || value === "win" || value === "android" ? value : "";
  };
  const initialStale = (): "" | "7" | "30" | "90" => {
    const value = param(searchParams.staleDays);
    return value === "7" || value === "30" || value === "90" ? value : "";
  };
  const initialHealth = (): DeviceHealthFilter | "" => {
    const value = param(searchParams.health);
    return value === "healthy" ||
      value === "attention" ||
      value === "critical" ||
      value === "unknown" ||
      value === "stale"
      ? value
      : "";
  };
  const initialPush = (): "failing" | "invalid" | "" => {
    const value = param(searchParams.push);
    return value === "failing" || value === "invalid" ? value : "";
  };
  const initialSort = (): MdmSortState => {
    const value = param(searchParams.sort);
    const dir = param(searchParams.direction) === "desc" ? "desc" : "asc";
    return {
      id: value === "lastSeenAt" || value === "enrolledAt" || value === "status" ? value : "name",
      dir,
    };
  };

  const [q, setQ] = createSignal(param(searchParams.q) ?? "");
  const [debouncedQ, setDebouncedQ] = createSignal(param(searchParams.q) ?? "");
  const [status, setStatus] = createSignal<DeviceRow["status"] | "">(initialStatus());
  const [proto, setProto] = createSignal<DeviceRow["proto"] | "">(initialProto());
  const [groupId, setGroupId] = createSignal(param(searchParams.groupId) ?? "");
  const [staleDays, setStaleDays] = createSignal<"" | "7" | "30" | "90">(initialStale());
  const [health, setHealth] = createSignal<DeviceHealthFilter | "">(initialHealth());
  const [push, setPush] = createSignal<"failing" | "invalid" | "">(initialPush());
  const [sort, setSort] = createSignal<MdmSortState>(initialSort());
  const [page, setPage] = createSignal(0);
  const [exporting, setExporting] = createSignal(false);
  const [exportError, setExportError] = createSignal<unknown>();
  const [exportTruncated, setExportTruncated] = createSignal(false);

  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = createSignal(param(searchParams.import) === "1");
  const [importFileName, setImportFileName] = createSignal("");
  const [importParsed, setImportParsed] = createSignal<DeviceImportParseResult | null>(null);
  const [importResult, setImportResult] = createSignal<{
    created: number;
    updated: number;
    failed: number;
    results: ReadonlyArray<{ serial: string; status: string; error?: string | null }>;
  } | null>(null);
  const [importing, setImporting] = createSignal(false);
  const [importError, setImportError] = createSignal<unknown>();
  let importFileInput: HTMLInputElement | undefined;

  const resetImport = () => {
    setImportFileName("");
    setImportParsed(null);
    setImportResult(null);
    setImportError(undefined);
    if (importFileInput) importFileInput.value = "";
  };
  const openImport = () => {
    resetImport();
    setImportOpen(true);
  };
  const closeImport = () => {
    setImportOpen(false);
    if (param(searchParams.import) === "1") setSearchParams({ import: "" }, { replace: true });
  };
  const chooseImportFile = () => importFileInput?.click();
  const readImportFile = async (file: File | undefined) => {
    resetImport();
    if (!file) return;
    setImportFileName(file.name);
    try {
      setImportParsed(parseDeviceImportCsv(await file.text()));
    } catch (error) {
      setImportError(error);
    }
  };
  const runImport = async () => {
    const parsed = importParsed();
    if (!parsed || parsed.issues.length > 0 || parsed.rows.length === 0) return;
    setImporting(true);
    setImportError(undefined);
    try {
      const result = await enterprise.importDevicePreRegistrations(
        params.tenantId,
        toDeviceImportPayload(parsed.rows),
      );
      setImportResult(result);
      await queryClient.invalidateQueries({
        queryKey: enterpriseKeys.devicePreRegistrations(params.tenantId),
      });
      await queryClient.invalidateQueries({
        queryKey: enterpriseKeys.deviceSearch(params.tenantId),
      });
    } catch (error) {
      setImportError(error);
    } finally {
      setImporting(false);
    }
  };
  const downloadImportTemplate = () => {
    const csv =
      "serial,name,asset_tag,group,notes\r\nC02EXAMPLE001,Alice's MacBook,AT-1001,Staff,Assigned at intake\r\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "device-pre-registrations.csv";
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  // Debounce typing so the search endpoint is not hit on every keystroke.
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(settleTimer));
  createEffect(
    () => q(),
    (value) => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        setDebouncedQ(value);
        setPage(0);
      }, 250);
    },
  );

  // Mirror the active filters into the URL so reload, back/forward and shared
  // links reproduce the same view. `replace` avoids a history entry per change.
  // Skip the initial run: the signals were seeded from the URL, so rewriting it
  // would start a redundant navigation (and delay other settled work).
  let urlInitialised = false;
  createEffect(
    () => ({
      q: debouncedQ(),
      status: status(),
      proto: proto(),
      groupId: groupId(),
      staleDays: staleDays(),
      health: health(),
      push: push(),
      sort: sort()?.id ?? "name",
      direction: sort()?.dir ?? "asc",
    }),
    (state) => {
      if (!urlInitialised) {
        urlInitialised = true;
        return;
      }
      const next = emptyFilterParams();
      if (state.q) next.q = state.q;
      if (state.status) next.status = state.status;
      if (state.proto) next.proto = state.proto;
      if (state.groupId) next.groupId = state.groupId;
      if (state.staleDays) next.staleDays = state.staleDays;
      if (state.health) next.health = state.health;
      if (state.push) next.push = state.push;
      if (state.sort && state.sort !== "name") next.sort = state.sort;
      if (state.direction === "desc") next.direction = state.direction;
      setSearchParams(next, { replace: true });
    },
  );

  // Keep the controls in sync when the URL changes from back/forward or a link.
  // Only the parsed URL is tracked here: local control signals must never be
  // read in the same reactive scope, or every keystroke would be mistaken for a
  // URL change and reverted to the last debounced value.
  const urlFilters = createMemo(() => ({
    q: param(searchParams.q) ?? "",
    status: initialStatus(),
    proto: initialProto(),
    groupId: param(searchParams.groupId) ?? "",
    staleDays: initialStale(),
    health: initialHealth(),
    push: initialPush(),
    sort: initialSort(),
  }));
  createEffect(
    urlFilters,
    (filters) => {
      // Reads of the controls are deliberately untracked: this effect must run
      // only when the URL changes, not on every keystroke. Reading them inside
      // the compute function would recreate the original feedback loop.
      const local = untrack(() => ({
        q: q(),
        status: status(),
        proto: proto(),
        groupId: groupId(),
        staleDays: staleDays(),
        health: health(),
        push: push(),
        sort: sort(),
      }));
      if (filters.q !== local.q) {
        setQ(filters.q);
        setDebouncedQ(filters.q);
        setPage(0);
      }
      if (filters.status !== local.status) setStatus(filters.status);
      if (filters.proto !== local.proto) setProto(filters.proto);
      if (filters.groupId !== local.groupId) setGroupId(filters.groupId);
      if (filters.staleDays !== local.staleDays) setStaleDays(filters.staleDays);
      if (filters.health !== local.health) setHealth(filters.health);
      if (filters.push !== local.push) setPush(filters.push);
      if (
        local.sort?.id !== filters.sort?.id ||
        (local.sort?.dir ?? "asc") !== (filters.sort?.dir ?? "asc")
      )
        setSort(filters.sort ?? { id: "name", dir: "asc" });
    },
    { defer: true },
  );

  const filters = () => ({
    q: debouncedQ() || undefined,
    status: status() || undefined,
    proto: proto() || undefined,
    groupId: groupId() || undefined,
    staleDays: staleDays() ? Number(staleDays()) : undefined,
    health: health() || undefined,
    push: push() || undefined,
    sort: (sort()?.id ?? "name") as "name" | "lastSeenAt" | "enrolledAt" | "status",
    direction: sort()?.dir ?? ("asc" as const),
  });

  const devices = useQuery(() => ({
    queryKey: enterpriseKeys.deviceSearch(params.tenantId, {
      ...filters(),
      limit: PAGE_SIZE,
      offset: page() * PAGE_SIZE,
    }),
    queryFn: () =>
      enterprise.searchDevices(params.tenantId, {
        ...filters(),
        limit: PAGE_SIZE,
        offset: page() * PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  }));

  const groups = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "group"),
    queryFn: () => enterprise.list(params.tenantId, "group"),
  }));

  const total = () => devices.data?.total ?? 0;
  const pageCount = () => Math.max(1, Math.ceil(total() / PAGE_SIZE));
  // Deleting the last row of the final page should not leave the user stranded.
  createEffect(
    () => ({ total: total(), page: page() }),
    ({ total, page }) => {
      const last = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
      if (page > last) setPage(last);
    },
  );
  const hasFilters = () =>
    Boolean(debouncedQ() || status() || proto() || groupId() || staleDays() || health() || push());
  const clearFilters = () => {
    setQ("");
    setDebouncedQ("");
    setStatus("");
    setProto("");
    setGroupId("");
    setStaleDays("");
    setHealth("");
    setPush("");
    setSort({ id: "name", dir: "asc" });
    setPage(0);
    // Write immediately as well as through the mirror effect so clearing is
    // reflected even if a signal happened to already hold an empty value.
    setSearchParams(emptyFilterParams(), { replace: true });
  };

  const exportCsv = async () => {
    setExporting(true);
    setExportError(undefined);
    setExportTruncated(false);
    try {
      // Use the raw response rather than the typed client so the
      // `X-Export-Truncated` header can drive an in-page notice.
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters()))
        if (value !== undefined) query.set(key, String(value));
      const search = query.toString();
      const suffix = search ? `?${search}` : "";
      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(params.tenantId ?? "")}/devices/export${suffix}`,
        { credentials: "include" },
      );
      if (!response.ok)
        throw new Error((await response.text()) || `Export failed (${response.status})`);
      const csv = await response.text();
      setExportTruncated(response.headers.get("X-Export-Truncated") === "true");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `devices-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Devices"
        description="Inventory, sync, and retire enrolled Apple, Windows, and Android devices."
        actions={
          <>
            <Button variant="outline" onClick={openImport}>
              Import CSV
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={exporting()}>
              {exporting() ? "Exporting…" : "Export CSV"}
            </Button>
            <LinkButton href={`/t/${params.tenantId}/settings/enrollment`} variant="outline">
              Enroll device
            </LinkButton>
          </>
        }
      />
      <Show when={exportError()}>
        <ErrorText error={exportError()} />
      </Show>
      <Show when={exportTruncated()}>
        <div
          role="status"
          class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <span>
            The export reached the {10_000}-row limit and was truncated. Narrow the filters to
            export the rest.
          </span>
          <Button variant="ghost" size="sm" onClick={() => setExportTruncated(false)}>
            Dismiss
          </Button>
        </div>
      </Show>
      <MdmTable<DeviceRow>
        mode="server"
        rows={devices.data?.devices}
        total={devices.data?.total}
        loading={devices.isPending}
        error={devices.error}
        storageKey="devices"
        onRowClick={(row) => navigate(`/t/${params.tenantId}/devices/${row.id}`)}
        searchValue={q()}
        onSearchChange={setQ}
        sortValue={sort()}
        onSortChange={(value) => {
          setSort(value);
          setPage(0);
        }}
        searchPlaceholder="Search name, serial, model, asset tag… (⌘F)"
        toolbar={
          <div class="flex flex-wrap items-center gap-2">
            <select
              class={selectClass}
              aria-label="Filter by status"
              value={status()}
              onChange={(event) => {
                setStatus(event.currentTarget.value as DeviceRow["status"] | "");
                setPage(0);
              }}
            >
              <option value="">Any status</option>
              <option value="enrolling">Enrolling</option>
              <option value="enrolled">Enrolled</option>
              <option value="unenrolling">Unenrolling</option>
              <option value="unenrolled">Unenrolled</option>
            </select>
            <select
              class={selectClass}
              aria-label="Filter by platform"
              value={proto()}
              onChange={(event) => {
                setProto(event.currentTarget.value as DeviceRow["proto"] | "");
                setPage(0);
              }}
            >
              <option value="">Any platform</option>
              <option value="apple">Apple</option>
              <option value="win">Windows</option>
              <option value="android">Android</option>
            </select>
            <select
              class={selectClass}
              aria-label="Filter by group"
              value={groupId()}
              onChange={(event) => {
                setGroupId(event.currentTarget.value);
                setPage(0);
              }}
            >
              <option value="" selected={!groupId()}>
                Any group
              </option>
              {groups.data?.rows.map((group) => (
                <option value={group.id} selected={group.id === groupId()}>
                  {group.name}
                </option>
              ))}
            </select>
            <select
              class={selectClass}
              aria-label="Filter by health"
              value={health()}
              onChange={(event) => {
                setHealth(event.currentTarget.value as DeviceHealthFilter | "");
                setPage(0);
              }}
            >
              <option value="">Any health</option>
              <option value="healthy">Healthy</option>
              <option value="attention">Attention</option>
              <option value="critical">Critical</option>
              <option value="stale">Stale (7d)</option>
              <option value="unknown">Unknown</option>
            </select>
            <select
              class={selectClass}
              aria-label="Filter by push delivery"
              value={push()}
              onChange={(event) => {
                setPush(event.currentTarget.value as "failing" | "invalid" | "");
                setPage(0);
              }}
            >
              <option value="">Any push state</option>
              <option value="failing">Push failing</option>
              <option value="invalid">Invalid token</option>
            </select>
            <select
              class={selectClass}
              aria-label="Filter by last seen"
              value={staleDays()}
              onChange={(event) => {
                setStaleDays(event.currentTarget.value as "" | "7" | "30" | "90");
                setPage(0);
              }}
            >
              <option value="">Seen any time</option>
              <option value="7">Not seen in 7 days</option>
              <option value="30">Not seen in 30 days</option>
              <option value="90">Not seen in 90 days</option>
            </select>
            <select
              class={selectClass}
              aria-label="Sort devices"
              value={sort()?.id ?? "name"}
              onChange={(event) => {
                setSort({ id: event.currentTarget.value, dir: sort()?.dir ?? "asc" });
                setPage(0);
              }}
            >
              <option value="name">Sort: name</option>
              <option value="lastSeenAt">Sort: last seen</option>
              <option value="enrolledAt">Sort: enrolled</option>
              <option value="status">Sort: status</option>
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSort({ id: sort()?.id ?? "name", dir: sort()?.dir === "desc" ? "asc" : "desc" });
                setPage(0);
              }}
            >
              {sort()?.dir === "desc" ? "Descending" : "Ascending"}
            </Button>
            <Show when={hasFilters()}>
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </Show>
          </div>
        }
        footer={
          <div class="flex flex-wrap items-center justify-between gap-3">
            <span class="text-sm text-muted-foreground">
              Page {page() + 1} of {pageCount()}
            </span>
            <div class="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page() === 0}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={(page() + 1) * PAGE_SIZE >= total()}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        }
        actions={(selected, clear) => (
          <EntityActions entity="device" selected={selected} clear={clear} />
        )}
        empty={
          <EmptyState
            title={hasFilters() ? "No matching devices" : "No devices"}
            description={
              hasFilters()
                ? "No devices match the current filters. Clear them or try a different search."
                : "Devices will appear here after users enroll through this tenant's enrollment URL."
            }
            action={
              hasFilters() ? (
                <Button variant="outline" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        }
        columns={[
          {
            id: "name",
            header: "Name",
            sort: (row) => row.name,
            search: (row) => row.name,
            cell: (row) => (
              <a
                class="font-medium text-stone-950 hover:underline"
                href={`/t/${params.tenantId}/devices/${row.id}`}
              >
                {row.name}
              </a>
            ),
          },
          {
            id: "status",
            header: "Status",
            sort: (row) => row.status,
            cell: (row) => <DeviceStatusBadge status={row.status} />,
          },
          {
            id: "platform",
            header: "Platform",
            cell: (row) => <PlatformBadge proto={row.proto} />,
          },
          {
            id: "serial",
            header: "Serial",
            search: (row) => row.serial,
            cell: (row) => row.serial ?? "Unknown",
          },
          {
            id: "model",
            header: "Model",
            search: (row) => row.model,
            cell: (row) => row.model ?? "Unknown",
          },
          {
            id: "assetTag",
            header: "Asset tag",
            search: (row) => row.assetTag,
            cell: (row) => row.assetTag ?? "—",
            defaultHidden: true,
          },
          {
            id: "groups",
            header: "Groups",
            cell: (row) => {
              const groups = rowGroups(row);
              return groups.length > 0 ? groups.map((group) => group.name).join(", ") : "—";
            },
            defaultHidden: true,
          },
          {
            id: "lastSeen",
            header: "Last seen",
            sort: (row) => row.lastSeenAt,
            sortId: "lastSeenAt",
            cell: (row) => formatDate(row.lastSeenAt),
          },
        ]}
      />

      <input
        ref={importFileInput}
        type="file"
        accept=".csv,text/csv"
        class="hidden"
        onChange={(event) => void readImportFile(event.currentTarget.files?.[0])}
      />

      <Dialog open={importOpen()} onOpenChange={(open) => !open && closeImport()}>
        <DialogContent class="max-h-[85vh] max-w-2xl overflow-y-auto rounded-xl bg-white p-6">
          <DialogHeader>
            <DialogTitle>Import pre-registered devices</DialogTitle>
            <DialogDescription>
              Columns: <span class="font-mono">serial,name,asset_tag,group,notes</span>. A device is
              matched by serial when it enrolls, then these details are applied automatically.
            </DialogDescription>
          </DialogHeader>

          <Show when={!importResult()}>
            <div class="space-y-4">
              <div class="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={chooseImportFile}>
                  {importFileName() ? "Choose another CSV" : "Choose CSV"}
                </Button>
                <Button variant="ghost" size="sm" onClick={downloadImportTemplate}>
                  Download template
                </Button>
                <Show when={importFileName()}>
                  <span class="text-xs text-muted-foreground">{importFileName()}</span>
                </Show>
              </div>

              <Show when={importParsed()}>
                {(parsed) => (
                  <div class="space-y-4">
                    <div class="flex flex-wrap items-center gap-2 text-sm">
                      <strong>{parsed().rows.length}</strong>{" "}
                      <span class="text-muted-foreground">
                        row{parsed().rows.length === 1 ? "" : "s"} ready
                      </span>
                      <Show when={parsed().issues.length > 0}>
                        <span class="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                          {parsed().issues.length} issue
                          {parsed().issues.length === 1 ? "" : "s"}
                        </span>
                      </Show>
                      <span class="ml-auto text-xs text-muted-foreground">
                        Limit {DEVICE_IMPORT_MAX_ROWS.toLocaleString()} rows
                      </span>
                    </div>

                    <Show when={parsed().issues.length > 0}>
                      <ul class="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        <For each={parsed().issues.slice(0, 100)}>
                          {(issue) => (
                            <li>
                              Row {issue.row}: {issue.message}
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>

                    <Show when={parsed().rows.length > 0}>
                      <div class="max-h-64 overflow-auto rounded-lg border">
                        <table class="w-full text-left text-sm">
                          <thead class="sticky top-0 bg-stone-50 text-xs uppercase text-stone-500">
                            <tr>
                              <th class="px-3 py-2">Serial</th>
                              <th class="px-3 py-2">Name</th>
                              <th class="px-3 py-2">Asset tag</th>
                              <th class="px-3 py-2">Group</th>
                              <th class="px-3 py-2">Notes</th>
                            </tr>
                          </thead>
                          <tbody class="divide-y">
                            <For each={parsed().rows.slice(0, 20)}>
                              {(row) => (
                                <tr>
                                  <td class="px-3 py-2 font-mono text-xs">{row.serial}</td>
                                  <td class="px-3 py-2">{row.name ?? "—"}</td>
                                  <td class="px-3 py-2">{row.assetTag ?? "—"}</td>
                                  <td class="px-3 py-2">{row.groupName ?? "—"}</td>
                                  <td class="px-3 py-2 text-muted-foreground">
                                    {row.notes ?? "—"}
                                  </td>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                      </div>
                      <Show when={parsed().rows.length > 20}>
                        <p class="text-xs text-muted-foreground">
                          Showing the first 20 rows. All {parsed().rows.length} rows will be
                          imported.
                        </p>
                      </Show>
                    </Show>
                  </div>
                )}
              </Show>

              <ErrorText error={importError()} />
              <DialogFooter>
                <Button variant="outline" onClick={closeImport}>
                  Cancel
                </Button>
                <Button
                  disabled={
                    importing() ||
                    !importParsed() ||
                    (importParsed()?.issues.length ?? 1) > 0 ||
                    (importParsed()?.rows.length ?? 0) === 0
                  }
                  onClick={() => void runImport()}
                >
                  {importing()
                    ? "Importing…"
                    : `Import ${importParsed()?.rows.length ?? 0} device${
                        (importParsed()?.rows.length ?? 0) === 1 ? "" : "s"
                      }`}
                </Button>
              </DialogFooter>
            </div>
          </Show>

          <Show when={importResult()}>
            {(result) => (
              <div class="space-y-4">
                <div class="grid grid-cols-3 gap-2 text-center">
                  <div class="rounded-lg border bg-green-50 p-3">
                    <div class="text-2xl font-semibold text-green-700">{result().created}</div>
                    <div class="text-xs text-green-700">Created</div>
                  </div>
                  <div class="rounded-lg border bg-stone-50 p-3">
                    <div class="text-2xl font-semibold text-stone-700">{result().updated}</div>
                    <div class="text-xs text-stone-700">Updated</div>
                  </div>
                  <div class="rounded-lg border bg-red-50 p-3">
                    <div class="text-2xl font-semibold text-red-700">{result().failed}</div>
                    <div class="text-xs text-red-700">Failed</div>
                  </div>
                </div>
                <Show when={result().failed > 0}>
                  <ul class="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <For each={result().results.filter((row) => row.status === "error")}>
                      {(row) => (
                        <li>
                          <span class="font-mono text-xs">{row.serial}</span>:{" "}
                          {row.error ?? "Failed"}
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
                <p class="text-sm text-muted-foreground">
                  Pre-registrations are applied when the matching device enrolls. You can review
                  them in Enrollment settings.
                </p>
                <DialogFooter>
                  <Button variant="outline" onClick={resetImport}>
                    Import another
                  </Button>
                  <Button onClick={closeImport}>Done</Button>
                </DialogFooter>
              </div>
            )}
          </Show>
        </DialogContent>
      </Dialog>
    </div>
  );
}

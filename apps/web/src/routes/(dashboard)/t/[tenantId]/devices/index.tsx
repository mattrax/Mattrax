import { useNavigate, useParams, useSearchParams } from "@solidjs/router";
import { keepPreviousData, useQuery } from "@tanstack/solid-query";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";
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
  enterprise,
  enterpriseKeys,
  type DeviceHealthFilter,
  type DeviceRow,
} from "~/lib/enterprise";

const PAGE_SIZE = 50;

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

  const [q, setQ] = createSignal(param(searchParams.q) ?? "");
  const [debouncedQ, setDebouncedQ] = createSignal(param(searchParams.q) ?? "");
  const [status, setStatus] = createSignal<DeviceRow["status"] | "">(initialStatus());
  const [proto, setProto] = createSignal<DeviceRow["proto"] | "">(initialProto());
  const [groupId, setGroupId] = createSignal(param(searchParams.groupId) ?? "");
  const [staleDays, setStaleDays] = createSignal<"" | "7" | "30" | "90">(initialStale());
  const [health, setHealth] = createSignal<DeviceHealthFilter | "">(initialHealth());
  const [sort, setSort] = createSignal<MdmSortState>({ id: "name", dir: "asc" });
  const [page, setPage] = createSignal(0);
  const [exporting, setExporting] = createSignal(false);
  const [exportError, setExportError] = createSignal<unknown>();

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
    }),
    (state) => {
      if (!urlInitialised) {
        urlInitialised = true;
        return;
      }
      const next: Record<string, string> = {};
      if (state.q) next.q = state.q;
      if (state.status) next.status = state.status;
      if (state.proto) next.proto = state.proto;
      if (state.groupId) next.groupId = state.groupId;
      if (state.staleDays) next.staleDays = state.staleDays;
      if (state.health) next.health = state.health;
      setSearchParams(next, { replace: true });
    },
  );
  // Keep the controls in sync when the URL changes from back/forward or a link.
  // Comparisons happen in the tracking scope; the effect only writes signals.
  createEffect(
    () => {
      const urlQ = param(searchParams.q) ?? "";
      const urlStatus = initialStatus();
      const urlProto = initialProto();
      const urlGroup = param(searchParams.groupId) ?? "";
      const urlStale = initialStale();
      const urlHealth = initialHealth();
      return {
        q: urlQ,
        qChanged: urlQ !== q(),
        status: urlStatus,
        statusChanged: urlStatus !== status(),
        proto: urlProto,
        protoChanged: urlProto !== proto(),
        groupId: urlGroup,
        groupChanged: urlGroup !== groupId(),
        staleDays: urlStale,
        staleChanged: urlStale !== staleDays(),
        health: urlHealth,
        healthChanged: urlHealth !== health(),
      };
    },
    (state) => {
      if (state.qChanged) {
        setQ(state.q);
        setDebouncedQ(state.q);
      }
      if (state.statusChanged) setStatus(state.status);
      if (state.protoChanged) setProto(state.proto);
      if (state.groupChanged) setGroupId(state.groupId);
      if (state.staleChanged) setStaleDays(state.staleDays);
      if (state.healthChanged) setHealth(state.health);
    },
  );

  const filters = () => ({
    q: debouncedQ() || undefined,
    status: status() || undefined,
    proto: proto() || undefined,
    groupId: groupId() || undefined,
    staleDays: staleDays() ? Number(staleDays()) : undefined,
    health: health() || undefined,
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
    Boolean(debouncedQ() || status() || proto() || groupId() || staleDays() || health());
  const clearFilters = () => {
    setQ("");
    setDebouncedQ("");
    setStatus("");
    setProto("");
    setGroupId("");
    setStaleDays("");
    setHealth("");
    setPage(0);
    // Write immediately as well as through the mirror effect so clearing is
    // reflected even if a signal happened to already hold an empty value.
    setSearchParams({}, { replace: true });
  };

  const exportCsv = async () => {
    setExporting(true);
    setExportError(undefined);
    try {
      const csv = await enterprise.exportDevices(params.tenantId, filters());
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
              <option value="">Any group</option>
              {groups.data?.rows.map((group) => (
                <option value={group.id}>{group.name}</option>
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
    </div>
  );
}

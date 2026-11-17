import { useParams, useSearchParams } from "@solidjs/router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { Option, Schema } from "effect";
import {
  ErrorText,
  formatDeviceDate,
  LinkButton,
  Page,
  PageHeader,
  PlatformBadge,
  QueryError,
} from "~/components/mdm/common";
import { DeviceQueryBuilder } from "~/components/dashboard/query-builder";
import { EntityActions } from "~/components/mdm/entity-actions";
import { MdmTable, type MdmSortState } from "~/components/mdm/table";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Badge, EmptyState, NativeSelect } from "@mattrax/ui";
import { Laptop } from "~/components/ui/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/components/ui/tooltip";
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
  formatDeviceQueryText,
  parseDeviceQueryText,
  type DeviceHealthFilter,
  type DeviceQuery,
  type DeviceRow,
} from "~/lib/enterprise";
import {
  DEVICE_IMPORT_MAX_ROWS,
  parseDeviceImportCsv,
  toDeviceImportPayload,
  type DeviceImportParseResult,
} from "~/lib/device-import";
import { healthRank } from "~/lib/device-health";
import { readDeviceSearchParams, routes } from "~/lib/routes";
import { errorPresentation, raisedFailure } from "~/lib/errors";
import { collectAllMatching } from "~/lib/bulk-selection";
import { useCan } from "~/lib/permissions";
import { downloadBlob } from "~/lib/download";
import { resolveTenantId } from "~/lib/tenant";

const PAGE_SIZE = 50;

/**
 * Turn an HTTP failure into a friendly message. Tagged API failures are
 * normalised by `errorPresentation`; anything else keeps the status fallback
 * instead of surfacing a raw response body.
 */
const responseFailure = async (response: Response, fallback: string) => {
  const text = await response.text().catch(() => "");
  let body: Schema.Json | undefined = text;

  try {
    body = text
      ? Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(JSON.parse(text)))
      : undefined;
  } catch {
    // Plain-text error bodies are replaced by the status fallback below.
  }

  const presentation = errorPresentation(raisedFailure(body), fallback);

  return new Error(presentation.tag ? presentation.message : fallback);
};

const FILTER_PARAM_KEYS = [
  "q",
  "status",
  "proto",
  "groupId",
  "staleDays",
  "health",
  "push",
  "attributeKey",
  "attributeValue",
  "sort",
  "direction",
  "query",
] as const;

/** `setSearchParams` merges, so every known key must be sent (empty deletes). */
const emptyFilterParams = () => Object.fromEntries(FILTER_PARAM_KEYS.map((key) => [key, ""]));

const summaryTones = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
  brand: "text-brand",
} as const;

/** Compact filter controls: one quiet row above the table, not a form. */
const filterClass = "h-7 min-w-[7rem] text-[12px] text-muted-foreground";

type HealthReason = { code: string; label: string; severity: string };

const statusMeta = {
  enrolled: { variant: "success", dot: "success" },
  enrolling: { variant: "brand", dot: "info" },
  unenrolling: { variant: "warning", dot: "warning" },
  unenrolled: { variant: "outline", dot: "neutral" },
} as const;

const healthMeta = {
  healthy: { variant: "success", dot: "success", label: "Healthy" },
  attention: { variant: "warning", dot: "warning", label: "Attention" },
  critical: { variant: "destructive", dot: "destructive", label: "Critical" },
  unknown: { variant: "outline", dot: "neutral", label: "Unknown" },
} as const;

const isStatus = (value: string): value is keyof typeof statusMeta => value in statusMeta;

const isHealthLevel = (value: string): value is keyof typeof healthMeta => value in healthMeta;

/** Status is the only thing that earns colour in a row. */
function DeviceStatusTag(props: { status: string }) {
  const meta = () => (isStatus(props.status) ? statusMeta[props.status] : statusMeta.unenrolled);

  return (
    <Badge variant={meta().variant} dot={meta().dot} class="capitalize">
      {props.status}
    </Badge>
  );
}

function DeviceHealthTag(props: { level: string; reasons?: ReadonlyArray<HealthReason> }) {
  const meta = () => (isHealthLevel(props.level) ? healthMeta[props.level] : healthMeta.unknown);

  const badge = () => (
    <Badge variant={meta().variant} dot={meta().dot}>
      {meta().label}
    </Badge>
  );

  return (
    <Show when={(props.reasons ?? []).length > 0} fallback={badge()}>
      <Tooltip>
        <TooltipTrigger
          as="span"
          tabindex={0}
          class="inline-flex cursor-default rounded-[5px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          aria-label={`Health ${meta().label}. ${(props.reasons ?? [])
            .map((reason) => reason.label)
            .join("; ")}`}
        >
          {badge()}
        </TooltipTrigger>
        <TooltipContent>
          <p class="text-[11px] font-medium">Why {meta().label.toLowerCase()}</p>
          <ul class="mt-1 space-y-0.5 text-[11.5px]">
            <For each={props.reasons ?? []}>{(reason) => <li>{reason.label}</li>}</For>
          </ul>
        </TooltipContent>
      </Tooltip>
    </Show>
  );
}

/** A single hairline-divided strip keeps the fleet counters compact enough to
 * sit above the table without competing with it. */
function FleetSummary(props: {
  items: ReadonlyArray<{
    label: string;
    value: string | number;
    hint: string;
    tone?: keyof typeof summaryTones;
  }>;
}) {
  return (
    <div class="hidden overflow-hidden rounded-xl border border-border bg-card shadow-card sm:grid sm:grid-cols-4 sm:divide-x sm:divide-border">
      <For each={props.items}>
        {(item) => (
          <div class="min-w-0 px-4 py-3">
            <p class="label-caps truncate">{item.label}</p>
            <p
              class={`mt-1.5 text-[17px] font-[560] leading-none tracking-[-0.025em] tabular-nums ${
                summaryTones[item.tone ?? "default"]
              }`}
            >
              {item.value}
            </p>
            <p class="mt-1.5 truncate text-[11px] text-muted-foreground">{item.hint}</p>
          </div>
        )}
      </For>
    </div>
  );
}

const RowGroups = Schema.Struct({
  groups: Schema.optional(Schema.Array(Schema.Struct({ name: Schema.String }))),
});

const decodeRowGroups = Schema.decodeUnknownOption(RowGroups);

/** Search rows carry group names; the base `DeviceRow` type does not. */
const rowGroups = (row: DeviceRow) => Option.getOrUndefined(decodeRowGroups(row))?.groups ?? [];

export default function DevicesPage() {
  const params = useParams();
  const { can, canAny } = useCan();
  const [searchParams, setSearchParams] = useSearchParams();

  const search = () => readDeviceSearchParams(searchParams);

  const initialStatus = (): DeviceRow["status"] | "" => search().status ?? "";

  const initialProto = (): DeviceRow["proto"] | "" => search().proto ?? "";

  const initialStale = (): "" | "7" | "30" | "90" => search().staleDays ?? "";

  const initialHealth = (): DeviceHealthFilter | "" => search().health ?? "";

  const initialPush = (): "failing" | "invalid" | "" => search().push ?? "";

  const initialSort = (): MdmSortState => ({
    id: search().sort ?? "name",
    dir: search().direction ?? "asc",
  });

  const [q, setQ] = createSignal(search().q ?? "");
  const [debouncedQ, setDebouncedQ] = createSignal(search().q ?? "");
  const [status, setStatus] = createSignal<DeviceRow["status"] | "">(initialStatus());
  const [proto, setProto] = createSignal<DeviceRow["proto"] | "">(initialProto());
  const [groupId, setGroupId] = createSignal(search().groupId ?? "");
  const [staleDays, setStaleDays] = createSignal<"" | "7" | "30" | "90">(initialStale());
  const [health, setHealth] = createSignal<DeviceHealthFilter | "">(initialHealth());
  const [push, setPush] = createSignal<"failing" | "invalid" | "">(initialPush());
  const [attributeKey, setAttributeKey] = createSignal(search().attributeKey ?? "");
  const [attributeValue, setAttributeValue] = createSignal(search().attributeValue ?? "");
  const [sort, setSort] = createSignal<MdmSortState>(initialSort());

  const [deviceQuery, setDeviceQuery] = createSignal<DeviceQuery | null>(
    parseDeviceQueryText(search().query),
  );

  const [queryOpen, setQueryOpen] = createSignal(false);
  const [page, setPage] = createSignal(0);
  const [exporting, setExporting] = createSignal(false);
  const [exportError, setExportError] = createSignal<unknown>();
  const [exportTruncated, setExportTruncated] = createSignal(false);

  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = createSignal(false);
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

    if (search().import === "1") setSearchParams({ import: "" }, { replace: true });
  };

  const chooseImportFile = () => importFileInput?.click();

  // `?import=1` is a convenience link from enrollment settings. Honour it only
  // for roles that may import; otherwise leave the read surface untouched.
  createEffect(
    () => ({ requested: search().import === "1", writable: can("devices.write") }),
    ({ requested, writable }) => {
      if (!writable) {
        setImportOpen(false);

        return;
      }

      if (requested) setImportOpen(true);
    },
  );

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

    downloadBlob(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
      "device-pre-registrations.csv",
    );
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
  let urlWriteTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(urlWriteTimer));
  createEffect(
    () => ({
      q: debouncedQ(),
      status: status(),
      proto: proto(),
      groupId: groupId(),
      staleDays: staleDays(),
      health: health(),
      push: push(),
      attributeKey: attributeKey(),
      attributeValue: attributeValue(),
      sort: sort()?.id ?? "name",
      direction: sort()?.dir ?? "asc",
      query: formatDeviceQueryText(deviceQuery()),
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

      if (state.attributeKey) next.attributeKey = state.attributeKey;

      if (state.attributeValue) next.attributeValue = state.attributeValue;

      if (state.sort && state.sort !== "name") next.sort = state.sort;

      if (state.direction === "desc") next.direction = state.direction;

      if (state.query) next.query = state.query;

      // Coalesce rapid control changes into one router write. Every
      // `setSearchParams` is a navigation, and a burst of them trips the
      // router's redirect guard.
      clearTimeout(urlWriteTimer);
      urlWriteTimer = setTimeout(() => setSearchParams(next, { replace: true }), 150);
    },
  );

  // Keep the controls in sync when the URL changes from back/forward or a link.
  // Only the parsed URL is tracked here: local control signals must never be
  // read in the same reactive scope, or every keystroke would be mistaken for a
  // URL change and reverted to the last debounced value.
  const urlFilters = createMemo(() => ({
    q: search().q ?? "",
    status: initialStatus(),
    proto: initialProto(),
    groupId: search().groupId ?? "",
    staleDays: initialStale(),
    health: initialHealth(),
    push: initialPush(),
    attributeKey: search().attributeKey ?? "",
    attributeValue: search().attributeValue ?? "",
    sort: initialSort(),
    query: search().query ?? "",
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
        attributeKey: attributeKey(),
        attributeValue: attributeValue(),
        sort: sort(),
        deviceQuery: deviceQuery(),
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

      if (filters.attributeKey !== local.attributeKey) {
        setAttributeKey(filters.attributeKey);
        setPage(0);
      }

      if (filters.attributeValue !== local.attributeValue) {
        setAttributeValue(filters.attributeValue);
        setPage(0);
      }

      if (
        local.sort?.id !== filters.sort?.id ||
        (local.sort?.dir ?? "asc") !== (filters.sort?.dir ?? "asc")
      )
        setSort(filters.sort ?? { id: "name", dir: "asc" });
      const nextQuery = parseDeviceQueryText(filters.query);

      if (formatDeviceQueryText(nextQuery) !== formatDeviceQueryText(local.deviceQuery)) {
        setDeviceQuery(nextQuery);
        setPage(0);
      }
    },
    { defer: true },
  );

  const sortField = (): "name" | "lastSeenAt" | "enrolledAt" | "status" | "health" => {
    const id = sort()?.id;

    return id === "lastSeenAt" || id === "enrolledAt" || id === "status" || id === "health"
      ? id
      : "name";
  };

  const filters = () => ({
    q: debouncedQ() || undefined,
    status: status() || undefined,
    proto: proto() || undefined,
    groupId: groupId() || undefined,
    staleDays: staleDays() ? Number(staleDays()) : undefined,
    health: health() || undefined,
    push: push() || undefined,
    attributes:
      attributeKey() && attributeValue()
        ? JSON.stringify({ [attributeKey()]: attributeValue() })
        : undefined,
    query: formatDeviceQueryText(deviceQuery()) || undefined,
    sort: sortField(),
    direction: sort()?.dir ?? "asc",
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
    placeholderData: { rows: [] },
  }));

  const attributeDefinitions = useQuery(() => ({
    queryKey: enterpriseKeys.attributes(params.tenantId),
    queryFn: () => enterprise.listAttributes(params.tenantId),
    placeholderData: { rows: [] },
  }));

  /** One table column per visible custom attribute. */
  const attributeColumns = () =>
    (attributeDefinitions.data?.rows ?? [])
      .filter((definition) => definition.visibility === "visible")
      .map((definition) => ({
        id: `attribute:${definition.key}`,
        header: definition.label,
        search: (row: DeviceRow) => row.attributes?.[definition.key],
        cell: (row: DeviceRow) => {
          const value = row.attributes?.[definition.key];

          if (value === undefined || value === "") return "—";

          if (definition.type === "boolean") return value === "true" ? "Yes" : "No";

          return value;
        },
      }));

  const total = () => devices.data?.total ?? 0;
  const pageCount = () => Math.max(1, Math.ceil(total() / PAGE_SIZE));

  /**
   * Resolve every device the active filter matches. The table's "select all
   * matching" option hands the bulk bar this list; each id is still authorised
   * by the API when the action runs.
   */
  const resolveAllDevices = () =>
    collectAllMatching(async (offset, limit) => {
      const result = await enterprise.searchDevices(params.tenantId, {
        ...filters(),
        limit,
        offset,
      });

      return {
        rows: result.devices.map((device) => ({ id: device.id, name: device.name })),
        total: result.total,
      };
    });

  // Deleting the last row of the final page should not leave the user stranded.
  createEffect(
    () => ({ total: total(), page: page() }),
    ({ total, page }) => {
      const last = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

      if (page > last) setPage(last);
    },
  );

  const hasFilters = () =>
    Boolean(
      debouncedQ() ||
      status() ||
      proto() ||
      groupId() ||
      staleDays() ||
      health() ||
      push() ||
      attributeKey() ||
      deviceQuery(),
    );

  const clearFilters = () => {
    setQ("");
    setDebouncedQ("");
    setStatus("");
    setProto("");
    setGroupId("");
    setStaleDays("");
    setHealth("");
    setPush("");
    setAttributeKey("");
    setAttributeValue("");
    setDeviceQuery(null);
    setSort({ id: "name", dir: "asc" });
    setPage(0);
    // Write immediately as well as through the mirror effect so clearing is
    // reflected even if a signal happened to already hold an empty value.
    setSearchParams(emptyFilterParams(), { replace: true });
  };

  // Cheap fleet signals derived from the rows already on screen. Nothing here
  // issues another request; the totals come from the existing search response.
  const fleet = () => {
    const rows = devices.data?.devices ?? [];

    const stale = rows.filter((row) => {
      const seen = row.lastSeenAt ? new Date(row.lastSeenAt).getTime() : Number.NaN;

      return Number.isFinite(seen) && Date.now() - seen > 7 * 24 * 60 * 60 * 1000;
    }).length;

    return [
      {
        label: "Devices",
        value: total(),
        hint: hasFilters() ? "Matching current filters" : "In this tenant",
      },
      {
        label: "Enrolled",
        value: rows.filter((row) => row.status === "enrolled").length,
        hint: `of ${rows.length} on this page`,
        tone: rows.some((row) => row.status === "enrolled")
          ? ("success" as const)
          : ("default" as const),
      },
      {
        label: "Stale 7d",
        value: stale,
        hint: "No check-in for 7 days",
        tone: stale > 0 ? ("warning" as const) : ("default" as const),
      },
      {
        label: "No asset tag",
        value: rows.filter((row) => !row.assetTag).length,
        hint: "Unlabelled in inventory",
      },
    ];
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
        `/api/v1/tenants/${encodeURIComponent(resolveTenantId(params.tenantId) ?? "")}/devices/export${suffix}`,
        { credentials: "include" },
      );

      if (!response.ok) throw await responseFailure(response, `Export failed (${response.status})`);
      const csv = await response.text();
      setExportTruncated(response.headers.get("X-Export-Truncated") === "true");
      downloadBlob(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
        `devices-${new Date().toISOString().slice(0, 10)}.csv`,
      );
    } catch (error) {
      setExportError(error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Page>
      <PageHeader
        title="Devices"
        description="Inventory, sync, and retire enrolled Apple, Windows, and Android devices."
        actions={
          <>
            <div class="flex items-center divide-x divide-border overflow-hidden rounded-md border border-border bg-card">
              <Show when={can("devices.write")}>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 rounded-none px-2.5 text-[12px]"
                  onClick={openImport}
                >
                  Import CSV
                </Button>
              </Show>
              <Button
                variant="ghost"
                size="sm"
                class="h-7 rounded-none px-2.5 text-[12px]"
                onClick={exportCsv}
                disabled={exporting()}
              >
                {exporting() ? "Exporting…" : "Export CSV"}
              </Button>
            </div>
            <Show when={can("enrollment.write") && (total() > 0 || hasFilters())}>
              <Button
                as="a"
                href={routes.tenant(params.tenantId).settingsTab("enrollment")}
                size="sm"
              >
                Enroll device
              </Button>
            </Show>
          </>
        }
      />

      <FleetSummary items={fleet()} />

      <QueryError error={groups.error} onRetry={() => void groups.refetch()} />

      <Show when={exportError()}>
        <ErrorText error={exportError()} />
      </Show>
      <Show when={exportTruncated()}>
        <div
          role="status"
          class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/25 bg-warning/[0.07] px-3.5 py-2.5 text-[12.5px] text-warning-foreground"
        >
          <span>
            The export reached the {10_000}-row limit and was truncated. Narrow the filters to
            export the rest.
          </span>
          <Button
            variant="ghost"
            size="xs"
            class="text-warning-foreground hover:bg-warning/10"
            onClick={() => setExportTruncated(false)}
          >
            Dismiss
          </Button>
        </div>
      </Show>
      <MdmTable<DeviceRow>
        mode="server"
        rows={devices.data?.devices}
        selectable={canAny(["devices.command", "devices.write", "groups.write"])}
        total={devices.data?.total}
        selectionKey={JSON.stringify(filters())}
        loading={devices.isPending}
        isFetching={devices.isFetching}
        onRefresh={() => void devices.refetch()}
        error={devices.error}
        storageKey="devices"
        rowHref={(row) => routes.tenant(params.tenantId).device(row.id)}
        searchValue={q()}
        onSearchChange={setQ}
        sortValue={sort()}
        onSortChange={(value) => {
          setSort(value);
          setPage(0);
        }}
        searchPlaceholder="Search name, serial, model, platform, group, notes…"
        toolbar={
          <div class="flex flex-wrap items-center gap-1.5">
            <NativeSelect
              class={filterClass}
              aria-label="Filter by status"
              value={status()}
              onChange={(event) => {
                const value = event.currentTarget.value;

                const status = Option.getOrUndefined(
                  Schema.decodeUnknownOption(
                    Schema.Literals(["enrolling", "enrolled", "unenrolling", "unenrolled"]),
                  )(value),
                );

                setStatus(status ?? "");
                setPage(0);
              }}
            >
              <option value="">Any status</option>
              <option value="enrolling">Enrolling</option>
              <option value="enrolled">Enrolled</option>
              <option value="unenrolling">Unenrolling</option>
              <option value="unenrolled">Unenrolled</option>
            </NativeSelect>
            <NativeSelect
              class={filterClass}
              aria-label="Filter by platform"
              value={proto()}
              onChange={(event) => {
                const value = event.currentTarget.value;

                const proto = Option.getOrUndefined(
                  Schema.decodeUnknownOption(Schema.Literals(["apple", "win", "android"]))(value),
                );

                setProto(proto ?? "");
                setPage(0);
              }}
            >
              <option value="">Any platform</option>
              <option value="apple">Apple</option>
              <option value="win">Windows</option>
              <option value="android">Android</option>
            </NativeSelect>
            <NativeSelect
              class={filterClass}
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
            </NativeSelect>
            <NativeSelect
              class={filterClass}
              aria-label="Filter by health"
              value={health()}
              onChange={(event) => {
                const value = event.currentTarget.value;

                const health = Option.getOrUndefined(
                  Schema.decodeUnknownOption(
                    Schema.Literals(["healthy", "attention", "critical", "unknown", "stale"]),
                  )(value),
                );

                setHealth(health ?? "");
                setPage(0);
              }}
            >
              <option value="">Any health</option>
              <option value="healthy">Healthy</option>
              <option value="attention">Attention</option>
              <option value="critical">Critical</option>
              <option value="stale">Stale (7d)</option>
              <option value="unknown">Unknown</option>
            </NativeSelect>
            <NativeSelect
              class={filterClass}
              aria-label="Filter by push delivery"
              value={push()}
              onChange={(event) => {
                const value = event.currentTarget.value;

                const push = Option.getOrUndefined(
                  Schema.decodeUnknownOption(Schema.Literals(["failing", "invalid"]))(value),
                );

                setPush(push ?? "");
                setPage(0);
              }}
            >
              <option value="">Any push state</option>
              <option value="failing">Push failing</option>
              <option value="invalid">Invalid token</option>
            </NativeSelect>
            <NativeSelect
              class={filterClass}
              aria-label="Filter by attribute"
              value={attributeKey()}
              onChange={(event) => {
                setAttributeKey(event.currentTarget.value);
                setAttributeValue("");
                setPage(0);
              }}
            >
              <option value="">Any attribute</option>
              <For
                each={(attributeDefinitions.data?.rows ?? []).filter(
                  (definition) => definition.visibility === "visible",
                )}
              >
                {(definition) => <option value={definition.key}>{definition.label}</option>}
              </For>
            </NativeSelect>
            <Show when={attributeKey()}>
              {(() => {
                const definition = () =>
                  (attributeDefinitions.data?.rows ?? []).find(
                    (candidate) => candidate.key === attributeKey(),
                  );

                return (
                  <Show
                    when={definition()?.type === "select" || definition()?.type === "boolean"}
                    fallback={
                      <Input
                        class="h-7 w-36 text-[12px]"
                        aria-label="Attribute value"
                        placeholder="Attribute value"
                        value={attributeValue()}
                        onInput={(event) => setAttributeValue(event.currentTarget.value)}
                        onChange={() => setPage(0)}
                      />
                    }
                  >
                    <NativeSelect
                      class={filterClass}
                      aria-label="Attribute value"
                      value={attributeValue()}
                      onChange={(event) => {
                        setAttributeValue(event.currentTarget.value);
                        setPage(0);
                      }}
                    >
                      <option value="">Any value</option>
                      <For
                        each={
                          definition()?.type === "boolean"
                            ? ["true", "false"]
                            : (definition()?.options ?? [])
                        }
                      >
                        {(option) => (
                          <option value={option}>
                            {definition()?.type === "boolean"
                              ? option === "true"
                                ? "Yes"
                                : "No"
                              : option}
                          </option>
                        )}
                      </For>
                    </NativeSelect>
                  </Show>
                );
              })()}
            </Show>
            <NativeSelect
              class={filterClass}
              aria-label="Filter by last seen"
              value={staleDays()}
              onChange={(event) => {
                const value = event.currentTarget.value;

                const staleDays = Option.getOrUndefined(
                  Schema.decodeUnknownOption(Schema.Literals(["7", "30", "90"]))(value),
                );

                setStaleDays(staleDays ?? "");
                setPage(0);
              }}
            >
              <option value="">Seen any time</option>
              <option value="7">Not seen in 7 days</option>
              <option value="30">Not seen in 30 days</option>
              <option value="90">Not seen in 90 days</option>
            </NativeSelect>
            <div class="flex flex-wrap items-center gap-1">
              <NativeSelect
                class={filterClass}
                aria-label="Sort devices"
                value={sort()?.id ?? "name"}
                onChange={(event) => {
                  setSort({ id: event.currentTarget.value, dir: sort()?.dir ?? "asc" });
                  setPage(0);
                }}
              >
                <option value="name">Sort: name</option>
                <option value="health">Sort: health</option>
                <option value="lastSeenAt">Sort: last seen</option>
                <option value="enrolledAt">Sort: enrolled</option>
                <option value="status">Sort: status</option>
              </NativeSelect>
              <Button
                variant="ghost"
                size="xs"
                class="shrink-0 text-muted-foreground"
                onClick={() => {
                  setSort({
                    id: sort()?.id ?? "name",
                    dir: sort()?.dir === "desc" ? "asc" : "desc",
                  });
                  setPage(0);
                }}
              >
                {sort()?.dir === "desc" ? "Descending" : "Ascending"}
              </Button>
              <Show when={hasFilters()}>
                <Button variant="ghost" size="xs" class="shrink-0" onClick={clearFilters}>
                  Clear filters
                </Button>
              </Show>
              <Button
                variant="ghost"
                size="xs"
                class="ml-auto shrink-0 text-muted-foreground"
                aria-expanded={queryOpen() ? "true" : "false"}
                onClick={() => setQueryOpen((value) => !value)}
              >
                Advanced query
                <Show when={deviceQuery()?.all?.length}>
                  <Badge variant="subtle" class="tabular-nums">
                    {deviceQuery()!.all!.length}
                  </Badge>
                </Show>
              </Button>
              <Show when={deviceQuery()}>
                <Button
                  variant="ghost"
                  size="xs"
                  class="shrink-0"
                  onClick={() => {
                    setDeviceQuery(null);
                    setPage(0);
                  }}
                >
                  Clear query
                </Button>
              </Show>
            </div>
            <Show when={queryOpen()}>
              <div class="mt-1 w-full rounded-lg border border-border bg-card p-3">
                <DeviceQueryBuilder
                  compact
                  query={deviceQuery()}
                  onChange={(query) => {
                    setDeviceQuery(query);
                    setPage(0);
                  }}
                />
                <p class="mt-2 text-[10.5px] text-muted-foreground">
                  The URL reproduces this filtered view.
                </p>
              </div>
            </Show>
          </div>
        }
        footer={
          <div
            class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-2 shadow-card"
            aria-busy={devices.isFetching ? "true" : undefined}
          >
            <span
              role="status"
              aria-live="polite"
              class="text-[12px] tabular-nums text-muted-foreground"
            >
              Page {page() + 1} of {pageCount()}
              <Show when={total() > 0}>
                <span class="text-muted-foreground">
                  {" "}
                  · {total().toLocaleString()} device{total() === 1 ? "" : "s"}
                </span>
              </Show>
            </span>
            <div class="flex items-center gap-1.5">
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
        actions={(selected, clear, select, selection) => (
          <EntityActions
            entity="device"
            selected={selected}
            clear={clear}
            select={select}
            allMatching={selection.allMatching}
            total={selection.total}
            resolveAll={resolveAllDevices}
          />
        )}
        empty={
          <EmptyState
            icon={<Laptop />}
            title={hasFilters() ? "No matching devices" : "No devices"}
            description={
              hasFilters()
                ? "No devices match the current filters. Clear them or try a different search."
                : "Devices will appear here after users enroll through this tenant's enrollment URL."
            }
            action={
              hasFilters() ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Show when={can("enrollment.write")}>
                  <LinkButton
                    href={routes.tenant(params.tenantId).settingsTab("enrollment")}
                    size="sm"
                  >
                    Enroll device
                  </LinkButton>
                </Show>
              )
            }
          />
        }
        columns={[
          ...attributeColumns(),
          {
            id: "name",
            header: "Name",
            sort: (row) => row.name,
            search: (row) => row.name,
            cell: (row) => (
              <a
                class="font-[540] text-foreground decoration-border underline-offset-2 hover:underline"
                href={routes.tenant(params.tenantId).device(row.id)}
              >
                {row.name}
              </a>
            ),
          },
          {
            id: "status",
            header: "Status",
            sort: (row) => row.status,
            cell: (row) => <DeviceStatusTag status={row.status} />,
          },
          {
            id: "health",
            header: "Health",
            // The API sorts this column (health is derived, not stored); the
            // local comparator keeps the same worst-first order if a row set is
            // ever sorted on the client.
            sort: (row) => healthRank(row.health?.level),
            sortId: "health",
            cell: (row) => (
              <DeviceHealthTag
                level={row.health?.level ?? "unknown"}
                reasons={row.health?.reasons}
              />
            ),
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
            cell: (row) => (
              <span class="font-mono text-[11.5px] text-muted-foreground">
                {row.serial ?? "Unknown"}
              </span>
            ),
          },
          {
            id: "model",
            header: "Model",
            search: (row) => row.model,
            cell: (row) => <span class="text-muted-foreground">{row.model ?? "Unknown"}</span>,
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

              if (groups.length === 0) return "—";
              const names = groups.map((group) => group.name).join(", ");

              return (
                <Tooltip>
                  <TooltipTrigger
                    type="button"
                    class="inline-flex items-center rounded-md text-[12.5px] text-muted-foreground underline decoration-border decoration-dotted underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    aria-label={`${groups.length} group${groups.length === 1 ? "" : "s"}: ${names}`}
                  >
                    {groups.length} group{groups.length === 1 ? "" : "s"}
                  </TooltipTrigger>
                  <TooltipContent>
                    <p class="text-[11px] font-medium">Groups</p>
                    <ul class="mt-1 space-y-0.5 text-[11.5px]">
                      <For each={groups}>{(group) => <li>{group.name}</li>}</For>
                    </ul>
                  </TooltipContent>
                </Tooltip>
              );
            },
            defaultHidden: true,
          },
          {
            id: "notes",
            header: "Notes",
            search: (row) => row.notes,
            cell: (row) =>
              row.notes ? (
                <span class="line-clamp-2 whitespace-pre-line text-muted-foreground">
                  {row.notes}
                </span>
              ) : (
                "—"
              ),
            defaultHidden: true,
          },
          {
            id: "lastSeen",
            header: "Last seen",
            sort: (row) => row.lastSeenAt,
            sortId: "lastSeenAt",
            class: "text-right",
            cell: (row) => (
              <span class="tabular-nums text-muted-foreground">
                {formatDeviceDate(row.lastSeenAt)}
              </span>
            ),
          },
        ]}
      />

      <input
        ref={(element) => {
          importFileInput = element;
        }}
        type="file"
        accept=".csv,text/csv"
        class="hidden"
        onChange={(event) => void readImportFile(event.currentTarget.files?.[0])}
      />

      <Dialog open={importOpen()} onOpenChange={(open) => !open && closeImport()}>
        <DialogContent class="max-h-[85vh] max-w-2xl overflow-y-auto">
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
                  <span class="min-w-0 truncate text-xs text-muted-foreground">
                    {importFileName()}
                  </span>
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
                        <span class="rounded-full border border-destructive/25 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                          {parsed().issues.length} issue
                          {parsed().issues.length === 1 ? "" : "s"}
                        </span>
                      </Show>
                      <span class="ml-auto text-xs text-muted-foreground">
                        Limit {DEVICE_IMPORT_MAX_ROWS.toLocaleString()} rows
                      </span>
                    </div>

                    <Show when={parsed().issues.length > 0}>
                      <ul class="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-destructive/25 bg-destructive/[0.07] p-3 text-sm text-destructive">
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
                      <div class="max-h-64 overflow-auto rounded-lg border border-border">
                        <table class="w-full text-left text-[12.5px]">
                          <thead class="sticky top-0 z-10 border-b border-border bg-popover text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                            <tr>
                              <th class="px-3 py-2 font-medium">Serial</th>
                              <th class="px-3 py-2 font-medium">Name</th>
                              <th class="px-3 py-2 font-medium">Asset tag</th>
                              <th class="px-3 py-2 font-medium">Group</th>
                              <th class="px-3 py-2 font-medium">Notes</th>
                            </tr>
                          </thead>
                          <tbody class="divide-y divide-border">
                            <For each={parsed().rows.slice(0, 20)}>
                              {(row) => (
                                <tr class="hover:bg-hover">
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
                  <div class="rounded-lg border border-success/25 bg-success/10 p-3">
                    <div class="text-2xl font-semibold text-success-foreground">
                      {result().created}
                    </div>
                    <div class="text-[11px] text-success-foreground">Created</div>
                  </div>
                  <div class="rounded-lg border border-border bg-surface p-3">
                    <div class="text-2xl font-semibold text-foreground">{result().updated}</div>
                    <div class="text-[11px] text-muted-foreground">Updated</div>
                  </div>
                  <div class="rounded-lg border border-destructive/25 bg-destructive/10 p-3">
                    <div class="text-2xl font-semibold text-destructive">{result().failed}</div>
                    <div class="text-[11px] text-destructive">Failed</div>
                  </div>
                </div>
                <Show when={result().failed > 0}>
                  <ul class="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-destructive/25 bg-destructive/[0.07] p-3 text-sm text-destructive">
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
    </Page>
  );
}

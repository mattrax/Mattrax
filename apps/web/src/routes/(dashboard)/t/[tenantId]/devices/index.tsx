import { useParams, useSearchParams } from "@solidjs/router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import { Match, Option, Schema } from "effect";
import {
  devicePresence,
  ErrorText,
  formatDeviceDate,
  LinkButton,
  Page,
  PageHeader,
  PlatformBadge,
  PlatformMark,
  PresenceDot,
  QueryError,
  relativeTime,
  usePresenceNow,
} from "~/components/mdm/common";
import { DeviceQueryBuilder } from "~/components/dashboard/query-builder";
import { EntityHoverCard } from "~/components/entity-hover-card";
import { EntityActions } from "~/components/mdm/entity-actions";
import { MdmTable } from "~/components/mdm/table";
import type { MdmColumn, MdmSortState } from "~/components/mdm/table";
import { Button } from "~/components/ui/button";
import { Badge, EmptyState, FilterBar } from "@mattrax/ui";
import type { FilterCondition, FilterField } from "@mattrax/ui";
import {
  Activity,
  BookOpen,
  Calendar,
  Clock,
  HardDrive,
  KeyRound,
  Laptop,
  Monitor,
  MonitorSmartphone,
  Package,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  UsersRound,
  Wifi,
  X,
} from "~/components/ui/icons";
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
  enterpriseQueries,
  formatDeviceQueryText,
  parseDeviceQueryText,
} from "~/lib/enterprise";
import type { DeviceHealthFilter, DeviceQuery, DeviceRow } from "~/lib/enterprise";
import {
  DEVICE_IMPORT_MAX_ROWS,
  parseDeviceImportCsv,
  toDeviceImportPayload,
} from "~/lib/device-import";
import type { DeviceImportParseResult } from "~/lib/device-import";
import { healthRank } from "~/lib/device-health";
import { OsVersionTag } from "~/components/software-update-badge";
import { decodeSoftwareUpdate } from "~/lib/software-updates";
import { readDeviceSearchParams, routes } from "~/lib/routes";
import { errorPresentation, raisedFailure } from "~/lib/errors";
import { collectAllMatching } from "~/lib/bulk-selection";
import { useCan } from "~/lib/permissions";
import { downloadBlob } from "~/lib/download";
import { deviceFilterConditions, staleDaysValue } from "~/lib/device-view-query";
import { resolveTenantId } from "~/lib/tenant";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";

const DEFAULT_PAGE_SIZE = 50;

const MAX_PAGE_SIZE = 200;

/** The unfiltered first page, matching the page's default key exactly. */
const defaultDeviceSearch = {
  limit: DEFAULT_PAGE_SIZE,
  offset: 0,
  sort: "name" as const,
  direction: "asc" as const,
};

/** Search parameters that make the destination key differ from the default page. */
const deviceListOverrides = [
  "q",
  "status",
  "proto",
  "staleDays",
  "health",
  "push",
  "lostMode",
  "localAccount",
  "setup",
  "notSeenSince",
  "activation",
  "groupId",
  "attributeKey",
  "attributeValue",
  "query",
  "import",
  "sort",
  "direction",
  "page",
  "columns",
  "pageSize",
  "view",
] as const;

export const route = {
  preload: ({
    params,
    location,
    intent,
  }: {
    params: { tenantId?: string };
    location: { query: Record<string, string | string[] | undefined> };
    intent: string;
  }) => {
    const tenantId = params.tenantId;

    if (intent === "initial" || !tenantId) return;

    // A link can carry a filter (`?health=missing`). Warming the unfiltered
    // page would fetch 50 devices the destination never reads, so only the
    // shared lookup data is preloaded in that case.
    const filtered = deviceListOverrides.some((key) => {
      const value = location.query[key];

      return value !== undefined && value !== "" && !(Array.isArray(value) && value.length === 0);
    });

    return preloadPage([
      ...(filtered
        ? []
        : [
            () =>
              queryClient.ensureQueryData({
                queryKey: enterpriseKeys.deviceSearch(tenantId, defaultDeviceSearch),
                queryFn: () => enterprise.searchDevices(tenantId, defaultDeviceSearch),
              }),
          ]),
      () => queryClient.ensureQueryData(enterpriseQueries.list(tenantId, "group")),
      () =>
        queryClient.ensureQueryData({
          queryKey: enterpriseKeys.attributes(tenantId),
          queryFn: () => enterprise.listAttributes(tenantId),
        }),
    ]);
  },
};

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
  "lostMode",
  "localAccount",
  "setup",
  "notSeenSince",
  "activation",
  "attributeKey",
  "attributeValue",
  "sort",
  "direction",
  "query",
  "page",
  "columns",
  "pageSize",
  "view",
] as const;

/** `setSearchParams` merges, so every known key must be sent (empty deletes). */
const emptyFilterParams = () => Object.fromEntries(FILTER_PARAM_KEYS.map((key) => [key, ""]));

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
  missing: { variant: "info", dot: "info", label: "MIA" },
  critical: { variant: "destructive", dot: "destructive", label: "Critical" },
  unknown: { variant: "outline", dot: "neutral", label: "Unknown" },
} as const;

type DeviceActivationStatus = "activated" | "not-activated" | "unknown";

type DeviceActivationFilter = DeviceActivationStatus | "";

type LocalAccountFilter = "without-secure-token" | "not-seen-30-days" | "";

const activationMeta = {
  activated: { variant: "success", dot: "success", label: "Activated" },
  "not-activated": { variant: "warning", dot: "warning", label: "Not activated" },
  unknown: { variant: "outline", dot: "neutral", label: "Unknown" },
} as const;

const isActivationStatus = (value: string): value is DeviceActivationStatus =>
  value === "activated" || value === "not-activated" || value === "unknown";

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
          <p class="text-[11px] font-medium">
            Why {meta().label === "MIA" ? "MIA" : meta().label.toLowerCase()}
          </p>
          <ul class="mt-1 space-y-0.5 text-[11.5px]">
            <For each={props.reasons ?? []}>{(reason) => <li>{reason.label}</li>}</For>
          </ul>
        </TooltipContent>
      </Tooltip>
    </Show>
  );
}

/** Windows activation, when mattraxd has reported it. */
function DeviceActivationTag(props: { status?: string | null }) {
  const meta = () =>
    props.status && isActivationStatus(props.status) ? activationMeta[props.status] : null;

  return (
    <Show when={meta()} fallback={<span class="text-muted-foreground">—</span>}>
      {(value) => (
        <Badge variant={value().variant} dot={value().dot}>
          {value().label}
        </Badge>
      )}
    </Show>
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
  // One clock for every row; presence flips to offline with time, not only
  // when a new query arrives.
  const presenceNow = usePresenceNow();

  const search = () => readDeviceSearchParams(searchParams);

  const initialStatus = (): DeviceRow["status"] | "" => search().status ?? "";

  const initialProto = (): DeviceRow["proto"] | "" => search().proto ?? "";

  const initialStale = (): string => search().staleDays ?? "";

  const initialHealth = (): DeviceHealthFilter | "" => search().health ?? "";

  const initialPush = (): "failing" | "invalid" | "" => search().push ?? "";

  const initialLostMode = (): "active" | "inactive" | "" => {
    const value = search().lostMode;

    return value === "active" || value === "inactive" ? value : "";
  };

  const initialLocalAccount = (): LocalAccountFilter => {
    const value = search().localAccount;

    return value === "without-secure-token" || value === "not-seen-30-days" ? value : "";
  };

  const initialSetup = (): "" | "awaiting" | "complete" => search().setup ?? "";

  const initialNotSeenSince = () => search().notSeenSince ?? "";

  const initialActivation = (): DeviceActivationFilter => search().activation ?? "";

  const initialSort = (): MdmSortState => ({
    id: search().sort ?? "name",
    dir: search().direction ?? "asc",
  });

  const [q, setQ] = createSignal(search().q ?? "");
  const [debouncedQ, setDebouncedQ] = createSignal(search().q ?? "");
  const [status, setStatus] = createSignal<DeviceRow["status"] | "">(initialStatus());
  const [proto, setProto] = createSignal<DeviceRow["proto"] | "">(initialProto());
  const [groupId, setGroupId] = createSignal(search().groupId ?? "");
  const [staleDays, setStaleDays] = createSignal(initialStale());
  const [health, setHealth] = createSignal<DeviceHealthFilter | "">(initialHealth());
  const [push, setPush] = createSignal<"failing" | "invalid" | "">(initialPush());
  const [lostMode, setLostMode] = createSignal<"active" | "inactive" | "">(initialLostMode());
  const [localAccount, setLocalAccount] = createSignal<LocalAccountFilter>(initialLocalAccount());
  const [setup, setSetup] = createSignal<"" | "awaiting" | "complete">(initialSetup());
  const [notSeenSince, setNotSeenSince] = createSignal(initialNotSeenSince());
  const [activation, setActivation] = createSignal<DeviceActivationFilter>(initialActivation());
  const [attributeKey, setAttributeKey] = createSignal(search().attributeKey ?? "");
  const [attributeValue, setAttributeValue] = createSignal(search().attributeValue ?? "");
  const [sort, setSort] = createSignal<MdmSortState>(initialSort());

  const [deviceQuery, setDeviceQuery] = createSignal<DeviceQuery | null>(
    parseDeviceQueryText(search().query),
  );

  const [queryOpen, setQueryOpen] = createSignal(false);

  const queryConditionCount = () => {
    const query = deviceQuery();

    return (query?.all?.length ?? 0) + (query?.any?.length ?? 0) + (query?.none?.length ?? 0);
  };

  const clearAdvancedQuery = () => {
    setDeviceQuery(null);
    setPage(0);
    setQueryOpen(false);
  };

  const initialPageSize = () => {
    const value = Number(search().pageSize ?? DEFAULT_PAGE_SIZE);

    return Number.isInteger(value) && value >= 1 && value <= MAX_PAGE_SIZE
      ? value
      : DEFAULT_PAGE_SIZE;
  };

  const initialVisibleColumns = () => {
    const columns = search().columns?.split(",").filter(Boolean);

    return columns && columns.length ? columns : undefined;
  };

  const [pageSize, setPageSize] = createSignal(initialPageSize());
  // Undefined means the table's own persisted/default selection.
  const [viewColumns, setViewColumns] = createSignal<ReadonlyArray<string> | undefined>(
    initialVisibleColumns(),
  );

  // 1-based in the URL so a paged view is shareable; 0-based in state.
  const initialPage = () => {
    const value = Number(search().page ?? "1");

    return Number.isInteger(value) && value >= 1 ? value - 1 : 0;
  };

  const [page, setPage] = createSignal(initialPage());
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
      lostMode: lostMode(),
      localAccount: localAccount(),
      setup: setup(),
      notSeenSince: notSeenSince(),
      activation: activation(),
      attributeKey: attributeKey(),
      attributeValue: attributeValue(),
      sort: sort()?.id ?? "name",
      direction: sort()?.dir ?? "asc",
      query: formatDeviceQueryText(deviceQuery()),
      page: page(),
      columns: viewColumns()?.join(",") ?? "",
      pageSize: pageSize(),
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

      if (state.lostMode) next.lostMode = state.lostMode;

      if (state.localAccount) next.localAccount = state.localAccount;

      if (state.setup) next.setup = state.setup;

      if (state.notSeenSince) next.notSeenSince = state.notSeenSince;

      if (state.activation) next.activation = state.activation;

      if (state.attributeKey) next.attributeKey = state.attributeKey;

      if (state.attributeValue) next.attributeValue = state.attributeValue;

      if (state.sort && state.sort !== "name") next.sort = state.sort;

      if (state.direction === "desc") next.direction = state.direction;

      if (state.query) next.query = state.query;

      if (state.page > 0) next.page = String(state.page + 1);

      if (state.columns) next.columns = state.columns;

      if (state.pageSize !== DEFAULT_PAGE_SIZE) next.pageSize = String(state.pageSize);

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
    lostMode: initialLostMode(),
    localAccount: initialLocalAccount(),
    setup: initialSetup(),
    notSeenSince: initialNotSeenSince(),
    activation: initialActivation(),
    attributeKey: search().attributeKey ?? "",
    attributeValue: search().attributeValue ?? "",
    sort: initialSort(),
    query: search().query ?? "",
    page: initialPage(),
    columns: search().columns ?? "",
    pageSize: search().pageSize ?? "",
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
        lostMode: lostMode(),
        localAccount: localAccount(),
        setup: setup(),
        notSeenSince: notSeenSince(),
        activation: activation(),
        attributeKey: attributeKey(),
        attributeValue: attributeValue(),
        sort: sort(),
        deviceQuery: deviceQuery(),
        page: page(),
        columns: viewColumns()?.join(",") ?? "",
        pageSize: pageSize() === DEFAULT_PAGE_SIZE ? "" : String(pageSize()),
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

      if (filters.lostMode !== local.lostMode) {
        setLostMode(
          filters.lostMode === "active" || filters.lostMode === "inactive" ? filters.lostMode : "",
        );
        setPage(0);
      }

      if (filters.localAccount !== local.localAccount) {
        setLocalAccount(
          filters.localAccount === "without-secure-token" ||
            filters.localAccount === "not-seen-30-days"
            ? filters.localAccount
            : "",
        );
        setPage(0);
      }

      if (filters.setup !== local.setup) setSetup(filters.setup);

      if (filters.notSeenSince !== local.notSeenSince) {
        setNotSeenSince(filters.notSeenSince);
        setPage(0);
      }

      if (filters.activation !== local.activation) {
        setActivation(filters.activation);
        setPage(0);
      }

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

      // A shared `?page=3` link (or back/forward) restores the page index.
      if (filters.page !== local.page) setPage(filters.page);

      if (filters.columns !== local.columns)
        setViewColumns(filters.columns ? filters.columns.split(",").filter(Boolean) : undefined);

      if (filters.pageSize !== local.pageSize)
        setPageSize(filters.pageSize ? Number(filters.pageSize) : DEFAULT_PAGE_SIZE);
    },
    { defer: true },
  );

  const sortField = ():
    | "name"
    | "lastSeenAt"
    | "enrolledAt"
    | "status"
    | "health"
    | "activation" => {
    const id = sort()?.id;

    return id === "lastSeenAt" ||
      id === "enrolledAt" ||
      id === "status" ||
      id === "health" ||
      id === "activation"
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
    lostMode: lostMode() || undefined,
    localAccount: localAccount() || undefined,
    setup: setup() || undefined,
    notSeenSince: notSeenSince() || undefined,
    activation: activation() || undefined,
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
      limit: pageSize(),
      offset: page() * pageSize(),
    }),
    queryFn: () =>
      enterprise.searchDevices(params.tenantId, {
        ...filters(),
        limit: pageSize(),
        offset: page() * pageSize(),
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

  const filterFields = createMemo<FilterField[]>(() => {
    const attributes = (attributeDefinitions.data?.rows ?? []).filter(
      (definition) => definition.visibility === "visible",
    );
    const staleOptions = [
      { value: "7", label: "Not in 7 days" },
      { value: "30", label: "Not in 30 days" },
      { value: "90", label: "Not in 90 days" },
    ];

    if (staleDays() && !staleOptions.some((option) => option.value === staleDays()))
      staleOptions.unshift({
        value: staleDays(),
        label: `Not in ${staleDays()} days`,
      });

    return [
      {
        id: "status",
        label: "Status",
        icon: Activity,
        kind: "select",
        operators: [{ value: "is", label: "is" }],
        options: [
          { value: "enrolling", label: "Enrolling" },
          { value: "enrolled", label: "Enrolled" },
          { value: "unenrolling", label: "Unenrolling" },
          { value: "unenrolled", label: "Unenrolled" },
        ],
      },
      {
        id: "proto",
        label: "Platform",
        icon: Laptop,
        kind: "select",
        operators: [{ value: "is", label: "is" }],
        options: [
          { value: "apple", label: "Apple" },
          { value: "win", label: "Windows" },
          { value: "android", label: "Android" },
        ],
      },
      {
        id: "groupId",
        label: "Group",
        icon: UsersRound,
        kind: "select",
        operators: [{ value: "is", label: "is" }],
        options: (groups.data?.rows ?? []).map((group) => ({ value: group.id, label: group.name })),
      },
      {
        id: "health",
        label: "Health",
        icon: ShieldCheck,
        kind: "select",
        operators: [{ value: "is", label: "is" }],
        options: [
          { value: "healthy", label: "Healthy" },
          { value: "attention", label: "Attention" },
          { value: "missing", label: "MIA (still enrolled)" },
          { value: "critical", label: "Critical" },
          { value: "stale", label: "Stale" },
          { value: "unknown", label: "Unknown" },
        ],
      },
      {
        id: "push",
        label: "Push delivery",
        icon: Wifi,
        kind: "select",
        operators: [{ value: "is", label: "is" }],
        options: [
          { value: "failing", label: "Failing" },
          { value: "invalid", label: "Invalid token" },
        ],
      },
      {
        id: "lostMode",
        label: "Lost Mode",
        icon: Smartphone,
        kind: "select",
        operators: [{ value: "is", label: "is" }],
        options: [
          { value: "active", label: "In Lost Mode" },
          { value: "inactive", label: "Not in Lost Mode" },
        ],
      },
      {
        id: "localAccount",
        label: "Local accounts",
        icon: MonitorSmartphone,
        group: "macOS",
        kind: "select",
        operators: [{ value: "is", label: "is" }],
        options: [
          { value: "without-secure-token", label: "Account without SecureToken" },
          { value: "not-seen-30-days", label: "Inventory not refreshed in 30 days" },
        ],
      },
      {
        id: "setup",
        label: "ADE setup",
        icon: Laptop,
        kind: "select",
        operators: [{ value: "is", label: "is" }],
        options: [
          { value: "awaiting", label: "Awaiting Setup Assistant" },
          { value: "complete", label: "Released" },
        ],
      },
      {
        id: "notSeenSince",
        label: "Last seen before",
        icon: RefreshCw,
        kind: "text",
        operators: [{ value: "is", label: "before" }],
        placeholder: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "activation",
        label: "Windows activation",
        icon: ShieldCheck,
        group: "Windows",
        kind: "select",
        operators: [{ value: "is", label: "is" }],
        options: [
          { value: "activated", label: "Activated" },
          { value: "not-activated", label: "Not activated" },
          { value: "unknown", label: "Unknown" },
        ],
      },
      ...attributes.map<FilterField>((definition) => {
        const kind = Match.value(definition.type).pipe(
          Match.when("select", () => "select" as const),
          Match.when("boolean", () => "select" as const),
          Match.when("number", () => "number" as const),
          Match.orElse(() => "text" as const),
        );

        const options = Match.value(definition.type).pipe(
          Match.when("boolean", () => [
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ]),
          Match.when("select", () =>
            (definition.options ?? []).map((option) => ({ value: option, label: option })),
          ),
          Match.orElse(() => undefined),
        );

        return {
          id: `attr:${definition.key}`,
          label: definition.label,
          icon: SlidersHorizontal,
          group: "Attributes",
          kind,
          operators: [{ value: "is", label: "is" }],
          options,
          placeholder: "Attribute value",
        };
      }),
      {
        id: "staleDays",
        label: "Last seen",
        icon: RefreshCw,
        kind: "select",
        operators: [{ value: "is", label: "is" }],
        options: staleOptions,
      },
    ];
  });

  const filterConditions = createMemo<FilterCondition[]>(() =>
    deviceFilterConditions({
      status: status(),
      proto: proto(),
      groupId: groupId(),
      health: health(),
      push: push(),
      lostMode: lostMode(),
      localAccount: localAccount(),
      setup: setup(),
      notSeenSince: notSeenSince(),
      activation: activation(),
      staleDays: staleDays(),
      attributeKey: attributeKey(),
      attributeValue: attributeValue(),
    }),
  );

  const applyFilters = (next: ReadonlyArray<FilterCondition>) => {
    setStatus("");
    setProto("");
    setGroupId("");
    setHealth("");
    setPush("");
    setLostMode("");
    setLocalAccount("");
    setSetup("");
    setNotSeenSince("");
    setActivation("");
    setStaleDays("");
    setAttributeKey("");
    setAttributeValue("");

    for (const condition of next) {
      const value = condition.values[0] ?? "";

      if (!value) continue;

      if (condition.field.startsWith("attr:")) {
        setAttributeKey(condition.field.slice("attr:".length));
        setAttributeValue(value);
        continue;
      }

      if (condition.field === "status")
        setStatus(
          Option.getOrUndefined(
            Schema.decodeUnknownOption(
              Schema.Literals(["enrolling", "enrolled", "unenrolling", "unenrolled"]),
            )(value),
          ) ?? "",
        );
      else if (condition.field === "proto")
        setProto(
          Option.getOrUndefined(
            Schema.decodeUnknownOption(Schema.Literals(["apple", "win", "android"]))(value),
          ) ?? "",
        );
      else if (condition.field === "groupId") setGroupId(value);
      else if (condition.field === "health")
        setHealth(
          Option.getOrUndefined(
            Schema.decodeUnknownOption(
              Schema.Literals(["healthy", "attention", "missing", "critical", "unknown", "stale"]),
            )(value),
          ) ?? "",
        );
      else if (condition.field === "push")
        setPush(
          Option.getOrUndefined(
            Schema.decodeUnknownOption(Schema.Literals(["failing", "invalid"]))(value),
          ) ?? "",
        );
      else if (condition.field === "lostMode")
        setLostMode(
          Option.getOrUndefined(
            Schema.decodeUnknownOption(Schema.Literals(["active", "inactive"]))(value),
          ) ?? "",
        );
      else if (condition.field === "localAccount")
        setLocalAccount(
          Option.getOrUndefined(
            Schema.decodeUnknownOption(
              Schema.Literals(["without-secure-token", "not-seen-30-days"]),
            )(value),
          ) ?? "",
        );
      else if (condition.field === "setup")
        setSetup(
          Option.getOrUndefined(
            Schema.decodeUnknownOption(Schema.Literals(["awaiting", "complete"]))(value),
          ) ?? "",
        );
      else if (condition.field === "notSeenSince") setNotSeenSince(value);
      else if (condition.field === "activation")
        setActivation(isActivationStatus(value) ? value : "");
      else if (condition.field === "staleDays") setStaleDays(staleDaysValue(value) ?? "");
    }

    setPage(0);
  };

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

  const deviceColumns = createMemo<MdmColumn<DeviceRow>[]>(() => [
    ...attributeColumns(),
    {
      id: "name",
      header: "Name",
      icon: Laptop,
      sort: (row) => row.name,
      search: (row) => row.name,
      cell: (row) => (
        <span class="flex items-center gap-2">
          <PlatformMark proto={row.proto} />
          <EntityHoverCard
            preview={{ kind: "device", device: row }}
            href={routes.tenant(params.tenantId).device(row.id)}
            class="font-[540] text-foreground decoration-border underline-offset-2 hover:underline"
          >
            {row.name}
          </EntityHoverCard>
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      icon: Activity,
      sort: (row) => row.status,
      cell: (row) => <DeviceStatusTag status={row.status} />,
    },
    {
      id: "health",
      header: "Health",
      icon: ShieldCheck,
      // The API sorts this column (health is derived, not stored); the
      // local comparator keeps the same worst-first order if a row set is
      // ever sorted on the client.
      sort: (row) => healthRank(row.health?.level),
      sortId: "health",
      cell: (row) => (
        <DeviceHealthTag level={row.health?.level ?? "unknown"} reasons={row.health?.reasons} />
      ),
    },
    {
      // Keep the saved-view id: the column used to show update status.
      id: "osUpdate",
      header: "OS version",
      icon: Monitor,
      cell: (row) => (
        <OsVersionTag
          proto={row.proto}
          version={row.osVersion}
          build={row.osBuild}
          info={decodeSoftwareUpdate(row.osUpdate)}
        />
      ),
    },
    {
      id: "platform",
      header: "Platform",
      icon: MonitorSmartphone,
      cell: (row) => <PlatformBadge proto={row.proto} />,
    },
    {
      id: "activation",
      header: "Activation",
      icon: KeyRound,
      // Sorted by the API in administrative order (activated,
      // not-activated, unknown); the local comparator only matters if a
      // row set is ever sorted on the client.
      sort: (row) => row.windowsActivationStatus ?? "",
      sortId: "activation",
      cell: (row) => <DeviceActivationTag status={row.windowsActivationStatus} />,
      defaultHidden: true,
    },
    {
      id: "serial",
      header: "Serial",
      icon: HardDrive,
      search: (row) => row.serial,
      cell: (row) => (
        <span class="font-mono text-[11.5px] text-muted-foreground">{row.serial ?? "Unknown"}</span>
      ),
    },
    {
      id: "model",
      header: "Model",
      icon: Laptop,
      search: (row) => row.model,
      cell: (row) => <span class="text-muted-foreground">{row.model ?? "Unknown"}</span>,
    },
    {
      id: "assetTag",
      header: "Asset tag",
      icon: Package,
      search: (row) => row.assetTag,
      cell: (row) => row.assetTag ?? "—",
      defaultHidden: true,
    },
    {
      id: "groups",
      header: "Groups",
      icon: UsersRound,
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
      icon: BookOpen,
      search: (row) => row.notes,
      cell: (row) =>
        row.notes ? (
          <span class="line-clamp-2 whitespace-pre-line text-muted-foreground">{row.notes}</span>
        ) : (
          "—"
        ),
      defaultHidden: true,
    },
    {
      id: "enrolledAt",
      header: "Enrolled",
      icon: Calendar,
      sort: (row) => row.enrolledAt,
      sortId: "enrolledAt",
      class: "text-right",
      cell: (row) => (
        <span class="tabular-nums text-muted-foreground">{formatDeviceDate(row.enrolledAt)}</span>
      ),
      defaultHidden: true,
    },
    {
      id: "lastSeen",
      header: "Last seen",
      icon: Clock,
      sort: (row) => row.lastSeenAt,
      sortId: "lastSeenAt",
      class: "text-right",
      cell: (row) => {
        const presence = devicePresence(row, presenceNow());

        return (
          <span class="flex items-center justify-end gap-1.5 tabular-nums text-muted-foreground">
            <PresenceDot online={presence.online} />
            <span
              title={`${formatDeviceDate(row.lastSeenAt)} · ${presence.online ? "Online" : "Offline"}`}
            >
              {relativeTime(row.lastSeenAt)}
            </span>
          </span>
        );
      },
    },
  ]);

  const total = () => devices.data?.total ?? 0;
  const pageCount = () => Math.max(1, Math.ceil(total() / pageSize()));

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
      const last = Math.max(0, Math.ceil(total / pageSize()) - 1);

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
      setup() ||
      notSeenSince() ||
      activation() ||
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
    setSetup("");
    setNotSeenSince("");
    setActivation("");
    setAttributeKey("");
    setAttributeValue("");
    setDeviceQuery(null);
    setSort({ id: "name", dir: "asc" });
    setPageSize(DEFAULT_PAGE_SIZE);
    setViewColumns(undefined);
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
        rowNumberStart={page() * pageSize()}
        selectable={canAny(["devices.command", "devices.write", "groups.write"])}
        total={devices.data?.total}
        selectionKey={JSON.stringify(filters())}
        loading={devices.isPending}
        isFetching={devices.isFetching}
        onRefresh={() => void devices.refetch()}
        error={devices.error}
        storageKey="devices"
        visibleColumnIds={() => viewColumns()}
        onVisibleColumnsChange={(columns) => setViewColumns(columns)}
        rowHref={(row) => routes.tenant(params.tenantId).device(row.id)}
        searchValue={q()}
        onSearchChange={setQ}
        sortValue={sort()}
        onSortChange={(value) => {
          setSort(value);
          setPage(0);
        }}
        searchPlaceholder="Search name, serial, model, platform, group, notes…"
        inlineToolbar={
          <FilterBar
            inline
            fields={filterFields()}
            conditions={filterConditions()}
            onChange={applyFilters}
            hideClear
            filterExtra={
              <>
                <Show
                  when={deviceQuery()}
                  fallback={
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-7 rounded-full border-border bg-card px-2.5 text-[11.5px] text-muted-foreground"
                      aria-expanded={queryOpen() ? "true" : "false"}
                      onClick={() => setQueryOpen((value) => !value)}
                    >
                      <SlidersHorizontal class="size-3.5" />
                      Advanced
                    </Button>
                  }
                >
                  <span class="inline-flex h-7 items-center rounded-full border border-border bg-card pl-1.5 pr-0.5">
                    <button
                      type="button"
                      class="flex h-full items-center gap-1.5 rounded-full pr-1 text-[12px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/25"
                      aria-expanded={queryOpen() ? "true" : "false"}
                      onClick={() => setQueryOpen((value) => !value)}
                    >
                      <SlidersHorizontal class="size-3.5 text-subtle-foreground" />
                      <span class="text-muted-foreground">Query</span>
                      <span class="font-[520] text-foreground">
                        {queryConditionCount()} condition{queryConditionCount() === 1 ? "" : "s"}
                      </span>
                    </button>
                    <button
                      type="button"
                      class="flex size-5 shrink-0 items-center justify-center rounded-full text-subtle-foreground outline-none transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                      aria-label="Clear advanced query"
                      title="Clear advanced query"
                      onClick={clearAdvancedQuery}
                    >
                      <X class="size-3" />
                    </button>
                  </span>
                </Show>
                <Show when={hasFilters()}>
                  <Button
                    variant="ghost"
                    size="xs"
                    class="h-7 shrink-0 rounded-full px-2 text-[11.5px] text-muted-foreground"
                    onClick={clearFilters}
                  >
                    Clear filters
                  </Button>
                </Show>
              </>
            }
          />
        }
        toolbar={
          <Show when={queryOpen()}>
            <div class="animate-in rounded-xl border border-border bg-card p-3 motion-reduce:animate-none fade-in-0 slide-in-from-top-1 duration-[var(--duration-popover)] ease-swift">
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
                disabled={(page() + 1) * pageSize() >= total()}
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
        columns={deviceColumns()}
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
                                <tr class="transition-colors duration-[var(--duration-hover)] ease-swift hover:bg-hover">
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

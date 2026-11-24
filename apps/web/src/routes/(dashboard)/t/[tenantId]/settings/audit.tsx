import { useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { isServer } from "@solidjs/web";
import { useInfiniteQuery } from "@tanstack/solid-query";
import { Option, Schema } from "effect";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { ErrorText, Panel, QueryError } from "~/components/mdm/common";
import { Badge, FilterBar, LoadingState } from "@mattrax/ui";
import type { FilterCondition, FilterField } from "@mattrax/ui";
import { Button } from "~/components/ui/button";
import { Search } from "~/components/ui/icons";
import { enterprise, enterpriseQueries } from "~/lib/enterprise";
import type { AuditLogEntry, AuditSearchQuery } from "~/lib/enterprise";
import {
  auditActorKind,
  auditActorLabel,
  auditProtocolLabel,
  formatAuditAction,
} from "~/lib/audit-log";
import { errorPresentation } from "~/lib/errors";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";
import { downloadBlob } from "~/lib/download";
import { resolveTenantId } from "~/lib/tenant";

const PAGE_SIZE = 50;

/**
 * Turn an HTTP failure into a friendly message. Tagged API failures are
 * normalised by `errorPresentation`; anything else keeps the status fallback
 * instead of surfacing a raw response body.
 */
const decodeJson = Schema.decodeUnknownOption(Schema.Json);

const isString = Schema.is(Schema.String);

const isJsonObject = Schema.is(Schema.JsonObject);

const responseFailure = async (response: Response, fallback: string) => {
  const text = await response.text().catch(() => "");
  let body: Schema.Json | undefined = text;

  try {
    body = text ? Option.getOrUndefined(decodeJson(JSON.parse(text))) : undefined;
  } catch {
    // Plain-text error bodies are replaced by the status fallback below.
  }

  const presentation = errorPresentation(body, fallback);

  return new Error(presentation.tag ? presentation.message : fallback);
};

/** Common actions offered as suggestions; any exact action name is accepted. */
const KNOWN_ACTIONS = [
  "tenant.created",
  "tenant.updated",
  "device.enrolled",
  "device.checked_out",
  "device.command_failed",
  "device.command_not_now",
  "device.declaration_invalid",
  "device.push_invalid_token",
  "device.action",
  "device.unenrolled",
  "device.deleted",
  "mdm.checkin",
  "mdm.policy_delivered",
  "mdm.status_report",
  "mdm.command_result",
  "mdm.failure",
  "policy.created",
  "policy.updated",
  "policy.deleted",
  "policy.assignments_changed",
  "application.created",
  "application.catalogue_added",
  "group.created",
  "group.members_changed",
  "member.invited",
  "member.removed",
  "entra.sync_completed",
  "entra.sync_failed",
  "sso.updated",
  "scim.token_created",
  "scim.token_revoked",
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "approval.cancelled",
  "approval.expired",
  "approval.consumed",
  "approval.break_glass_used",
];

const auditFieldClass =
  "h-8 rounded-lg border border-input bg-surface px-2.5 text-[12.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

const auditSelectClass = `${auditFieldClass} pr-7`;

const isoDay = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
};

const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);

  return isoDay(date);
};

const formatDate = (value: string) => {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const AuditMetadata = Schema.Struct({
  credential: Schema.optional(
    Schema.Struct({
      type: Schema.Literals(["api_token", "oauth"]),
      name: Schema.optional(Schema.String),
    }),
  ),
  rbac: Schema.optional(
    Schema.Struct({
      roleName: Schema.optional(Schema.String),
      permission: Schema.optional(Schema.String),
      roleKind: Schema.optional(Schema.String),
    }),
  ),
});

type AuditMetadata = typeof AuditMetadata.Type;

const decodeAuditMetadata = Schema.decodeUnknownOption(AuditMetadata);

const metadataOf = (entry: AuditLogEntry): AuditMetadata | undefined =>
  Option.getOrUndefined(decodeAuditMetadata(entry.metadata));

const credentialOf = (entry: AuditLogEntry) => metadataOf(entry)?.credential;

const rbacOf = (entry: AuditLogEntry) => {
  const rbac = metadataOf(entry)?.rbac;

  if (rbac === undefined) return undefined;

  return {
    roleName: rbac.roleName,
    permission: rbac.permission,
    roleKind: rbac.roleKind === "custom" ? "custom" : "built-in",
  };
};

/** Compact one-line metadata preview; the full JSON is in the export. */
const summarizeMetadata = (metadata: Schema.Json | undefined) => {
  if (metadata === null || metadata === undefined) return "";

  if (isString(metadata)) return metadata;

  if (!isJsonObject(metadata)) return JSON.stringify(metadata);

  const rows = Object.entries(metadata).filter(([key]) => key !== "credential" && key !== "rbac");

  if (rows.length === 0) return "";

  return rows
    .slice(0, 3)
    .map(([key, value]) => {
      const text = isString(value)
        ? value
        : value === null || value === undefined
          ? "—"
          : JSON.stringify(value);

      return `${key}: ${text}`;
    })
    .join(" · ");
};

const dateStart = (value: string) =>
  value ? new Date(`${value}T00:00:00`).toISOString() : undefined;

const dateEnd = (value: string) =>
  value ? new Date(`${value}T23:59:59.999`).toISOString() : undefined;

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    // First unfiltered page only: the filter bar starts empty and later pages
    // follow the cursor the page itself requests.
    return preloadPage([
      () =>
        queryClient.ensureInfiniteQueryData(
          enterpriseQueries.auditSearch(params.tenantId, { limit: PAGE_SIZE }),
        ),
    ]);
  },
};

export default function AuditSettingsPage() {
  const params = useParams();

  const [action, setAction] = createSignal("");
  const [actor, setActor] = createSignal("");
  const [actorType, setActorType] = createSignal("");
  const [category, setCategory] = createSignal("");
  const [protocol, setProtocol] = createSignal("");
  const [targetType, setTargetType] = createSignal("");
  const [targetId, setTargetId] = createSignal("");
  const [deviceId, setDeviceId] = createSignal("");
  const [query, setQuery] = createSignal("");
  const [fromDate, setFromDate] = createSignal("");
  const [toDate, setToDate] = createSignal("");

  const [debounced, setDebounced] = createSignal({
    action: "",
    actor: "",
    targetType: "",
    targetId: "",
    deviceId: "",
    query: "",
  });

  const [exporting, setExporting] = createSignal<"csv" | "json" | null>(null);
  const [exportError, setExportError] = createSignal<unknown>();
  const [exportTruncated, setExportTruncated] = createSignal(false);
  const [expandedEntry, setExpandedEntry] = createSignal<string | null>(null);

  // Free-text filters are debounced so typing does not hit the API per key.
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(settleTimer));
  createEffect(
    () => ({
      action: action(),
      actor: actor(),
      targetType: targetType(),
      targetId: targetId(),
      deviceId: deviceId(),
      query: query(),
    }),
    (next) => {
      const current = debounced();

      if (
        current.action === next.action &&
        current.actor === next.actor &&
        current.targetType === next.targetType &&
        current.targetId === next.targetId &&
        current.deviceId === next.deviceId &&
        current.query === next.query
      )
        return;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => setDebounced(next), 250);
    },
  );

  const period = createMemo(() => {
    const from = fromDate();
    const to = toDate();

    if (!from && !to) return "";
    if (to) return "custom";
    if (from === isoDay(new Date())) return "today";
    if (from === daysAgo(6)) return "7d";
    if (from === daysAgo(29)) return "30d";

    return "custom";
  });

  const applyPeriod = (value: string) => {
    if (!value) {
      setFromDate("");
      setToDate("");
    } else if (value === "today") {
      setFromDate(isoDay(new Date()));
      setToDate("");
    } else if (value === "7d") {
      setFromDate(daysAgo(6));
      setToDate("");
    } else if (value === "30d") {
      setFromDate(daysAgo(29));
      setToDate("");
    } else if (value === "custom") {
      // Seed a visible range so the From/To fields are immediately editable.
      if (!fromDate()) setFromDate(daysAgo(29));
      if (!toDate()) setToDate(isoDay(new Date()));
    }
  };

  const rangeError = createMemo(() => {
    if (!fromDate() || !toDate()) return undefined;

    return dateStart(fromDate())! > dateEnd(toDate())!
      ? new Error("The start date must be on or before the end date.")
      : undefined;
  });

  const filters = createMemo<AuditSearchQuery>(() => ({
    action: debounced().action.trim() || undefined,
    actor: debounced().actor.trim() || undefined,
    // SAFETY: the actor-type select only offers the literal values the
    // contract declares, so a non-empty signal is already one of them.
    actorType: (actorType() || undefined) as AuditSearchQuery["actorType"],
    // SAFETY: the category select only offers the contract's literals.
    category: (category() || undefined) as AuditSearchQuery["category"],
    // SAFETY: the protocol select only offers the contract's literals.
    protocol: (protocol() || undefined) as AuditSearchQuery["protocol"],
    targetType: debounced().targetType.trim() || undefined,
    targetId: debounced().targetId.trim() || undefined,
    deviceId: debounced().deviceId.trim() || undefined,
    q: debounced().query.trim() || undefined,
    from: dateStart(fromDate()),
    to: dateEnd(toDate()),
    limit: PAGE_SIZE,
  }));

  const log = useInfiniteQuery(() => ({
    ...enterpriseQueries.auditSearch(params.tenantId, filters()),
    // Infinite queries are client-driven; running the first page during SSR
    // loses the request cookie and surfaces as an unauthenticated error.
    enabled: Boolean(params.tenantId) && !isServer && !rangeError(),
  }));

  const entries = createMemo<AuditLogEntry[]>(
    () => log.data?.pages.flatMap((page) => page.entries) ?? [],
  );

  const clearFilters = () => {
    clearTimeout(settleTimer);
    setAction("");
    setActor("");
    setActorType("");
    setCategory("");
    setProtocol("");
    setTargetType("");
    setTargetId("");
    setDeviceId("");
    setQuery("");
    setFromDate("");
    setToDate("");
    setDebounced({
      action: "",
      actor: "",
      targetType: "",
      targetId: "",
      deviceId: "",
      query: "",
    });
  };

  const exportAudit = async (format: "csv" | "json") => {
    setExporting(format);
    setExportError(undefined);
    setExportTruncated(false);

    try {
      const query = new URLSearchParams();
      const active = filters();

      for (const [key, value] of Object.entries(active)) {
        if (key === "limit" || value === undefined || value === null) continue;
        query.set(key, String(value));
      }

      query.set("format", format);

      const response = await enterprise.request(
        `/api/v1/tenants/${encodeURIComponent(resolveTenantId(params.tenantId) ?? "")}/audit/export?${query}`,
      );

      if (!response.ok) throw await responseFailure(response, `Export failed (${response.status})`);
      const body = await response.text();
      setExportTruncated(response.headers.get("X-Export-Truncated") === "true");
      const type = format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8";
      downloadBlob(
        new Blob([body], { type }),
        `audit-log-${new Date().toISOString().slice(0, 10)}.${format}`,
      );
    } catch (error) {
      setExportError(error);
    } finally {
      setExporting(null);
    }
  };

  const filterFields: FilterField[] = [
    {
      id: "category",
      label: "Category",
      kind: "select",
      operators: [{ value: "is", label: "is" }],
      options: [
        { value: "account", label: "Account action" },
        { value: "mdm", label: "Device activity" },
        { value: "system", label: "System" },
      ],
    },
    {
      id: "action",
      label: "Action",
      kind: "select",
      operators: [{ value: "is", label: "is" }],
      options: KNOWN_ACTIONS.map((value) => ({ value, label: value })),
    },
    {
      id: "actor",
      label: "Actor",
      kind: "text",
      operators: [{ value: "is", label: "is" }],
      placeholder: "Email or user id",
    },
    {
      id: "actorType",
      label: "Actor type",
      kind: "select",
      operators: [{ value: "is", label: "is" }],
      options: [
        { value: "account", label: "Account" },
        { value: "api-token", label: "API token / MCP" },
        { value: "system", label: "System" },
      ],
    },
    {
      id: "protocol",
      label: "Protocol",
      kind: "select",
      operators: [{ value: "is", label: "is" }],
      options: [
        { value: "apple", label: "Apple" },
        { value: "win", label: "Windows" },
        { value: "android", label: "Android" },
      ],
    },
    {
      id: "deviceId",
      label: "Device id",
      kind: "text",
      operators: [{ value: "is", label: "is" }],
      placeholder: "Internal device id",
    },
    {
      id: "q",
      label: "Search",
      kind: "text",
      operators: [{ value: "contains", label: "contains" }],
      placeholder: "Action, IP, certificate, target…",
    },
    {
      id: "targetType",
      label: "Target type",
      kind: "select",
      operators: [{ value: "is", label: "is" }],
      options: [
        { value: "device", label: "Device" },
        { value: "device_command", label: "Device command" },
        { value: "group", label: "Group" },
        { value: "policy", label: "Policy" },
        { value: "application", label: "Application" },
        { value: "user", label: "User" },
        { value: "tenant", label: "Tenant" },
        { value: "enrollment", label: "Enrollment" },
        { value: "apns", label: "APNs" },
        { value: "entra", label: "Entra" },
        { value: "google", label: "Google Workspace" },
        { value: "sso", label: "SSO" },
        { value: "scim_token", label: "SCIM token" },
      ],
    },
    {
      id: "targetId",
      label: "Target id",
      kind: "text",
      operators: [{ value: "contains", label: "contains" }],
      placeholder: "Contains…",
    },
    {
      id: "from",
      label: "From",
      kind: "date",
      operators: [{ value: "on or after", label: "on or after" }],
    },
    {
      id: "to",
      label: "To",
      kind: "date",
      operators: [{ value: "on or before", label: "on or before" }],
    },
  ];

  const filterConditions = createMemo<FilterCondition[]>(() => {
    const conditions: FilterCondition[] = [];

    if (category()) conditions.push({ field: "category", operator: "is", values: [category()] });

    if (action().trim())
      conditions.push({ field: "action", operator: "is", values: [action().trim()] });

    if (actor().trim())
      conditions.push({ field: "actor", operator: "is", values: [actor().trim()] });

    if (actorType()) conditions.push({ field: "actorType", operator: "is", values: [actorType()] });

    if (protocol()) conditions.push({ field: "protocol", operator: "is", values: [protocol()] });

    if (deviceId().trim())
      conditions.push({ field: "deviceId", operator: "is", values: [deviceId().trim()] });

    if (query().trim())
      conditions.push({ field: "q", operator: "contains", values: [query().trim()] });

    if (targetType())
      conditions.push({ field: "targetType", operator: "is", values: [targetType()] });

    if (targetId().trim())
      conditions.push({ field: "targetId", operator: "contains", values: [targetId().trim()] });

    if (fromDate())
      conditions.push({ field: "from", operator: "on or after", values: [fromDate()] });

    if (toDate()) conditions.push({ field: "to", operator: "on or before", values: [toDate()] });

    return conditions;
  });

  const applyFilters = (next: ReadonlyArray<FilterCondition>) => {
    clearFilters();

    for (const condition of next) {
      const value = condition.values[0] ?? "";

      if (!value) continue;

      if (condition.field === "category") setCategory(value);
      else if (condition.field === "action") setAction(value);
      else if (condition.field === "actor") setActor(value);
      else if (condition.field === "actorType") setActorType(value);
      else if (condition.field === "protocol") setProtocol(value);
      else if (condition.field === "deviceId") setDeviceId(value);
      else if (condition.field === "q") setQuery(value);
      else if (condition.field === "targetType") setTargetType(value);
      else if (condition.field === "targetId") setTargetId(value);
      else if (condition.field === "from") setFromDate(value);
      else if (condition.field === "to") setToDate(value);
    }
  };

  return (
    <div class="grid gap-5">
      <QueryError error={log.error} onRetry={() => void log.refetch()} />

      <Panel>
        <p class="mb-3 text-[12.5px] leading-5 text-muted-foreground">
          Account changes and device (MDM) activity in one append-only log. Repeated device
          check-ins fold into a short window; enrollment, policy delivery, command results and
          failures are always recorded separately.
        </p>
        <div class="space-y-2.5">
          <div class="flex flex-col gap-2 xl:flex-row xl:items-center">
            <label class="relative min-w-[18rem] flex-1">
              <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                aria-label="Search audit events"
                placeholder="Search actor, action, target or IP…"
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
                class={`${auditFieldClass} w-full pl-8`}
              />
            </label>
            <div class="flex flex-wrap items-center gap-1.5">
              <input
                type="search"
                aria-label="Filter by actor"
                placeholder="Actor email or id"
                value={actor()}
                onInput={(event) => setActor(event.currentTarget.value)}
                class={`${auditFieldClass} w-[12.5rem]`}
              />
              <select
                aria-label="Filter by action"
                value={action()}
                onChange={(event) => setAction(event.currentTarget.value)}
                class={auditSelectClass}
              >
                <option value="">Any action</option>
                {KNOWN_ACTIONS.map((value) => (
                  <option value={value}>{value}</option>
                ))}
              </select>
              <select
                aria-label="Filter by time period"
                value={period()}
                onChange={(event) => applyPeriod(event.currentTarget.value)}
                class={auditSelectClass}
              >
                <option value="">Any time</option>
                <option value="today">Today</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="custom">Custom range</option>
              </select>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <FilterBar
              fields={filterFields}
              conditions={filterConditions()}
              onChange={applyFilters}
              label="More filters"
            />
            <span
              role="status"
              aria-live="polite"
              class="mr-auto text-[11px] text-muted-foreground"
            >
              <Show
                when={entries().length > 0}
                fallback={
                  rangeError()
                    ? "Fix the date range to see events"
                    : log.isPending
                      ? "Loading audit events…"
                      : "No matching events"
                }
              >
                {entries().length} event{entries().length === 1 ? "" : "s"} loaded · newest first
              </Show>
            </span>
            <p id="audit-export-hint" class="sr-only">
              Exports the audit events that match the active filters, newest first.
            </p>
            <Button
              variant="outline"
              size="sm"
              aria-describedby="audit-export-hint"
              onClick={() => void exportAudit("csv")}
              disabled={exporting() !== null || Boolean(rangeError())}
            >
              {exporting() === "csv" ? "Exporting…" : "Export CSV"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-describedby="audit-export-hint"
              onClick={() => void exportAudit("json")}
              disabled={exporting() !== null || Boolean(rangeError())}
            >
              {exporting() === "json" ? "Exporting…" : "Export JSON"}
            </Button>
          </div>
        </div>

        <Show when={exportError()}>
          <ErrorText error={exportError()} />
        </Show>
        <Show when={exportTruncated()}>
          <div
            role="status"
            class="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/25 bg-warning/[0.07] px-3 py-2 text-xs text-warning-foreground"
          >
            <span>
              The export reached the 10,000-row limit and was truncated. Narrow the filters to
              export the rest.
            </span>
            <Button variant="ghost" size="sm" onClick={() => setExportTruncated(false)}>
              Dismiss
            </Button>
          </div>
        </Show>

        <Show
          when={entries().length > 0}
          fallback={
            <Show
              when={log.isPending}
              fallback={
                <p class="mt-4 text-[13px] text-muted-foreground">
                  No audit events match these filters.
                </p>
              }
            >
              <LoadingState class="mt-4" label="Loading audit events…" size={16} />
            </Show>
          }
        >
          <p class="mt-3 text-[11px] text-muted-foreground sm:hidden">
            Swipe the table sideways to see action and target details.
          </p>
          <div
            class="mt-4 max-h-[70vh] overflow-auto rounded-lg border border-border"
            aria-busy={log.isFetching ? "true" : undefined}
          >
            <table class="w-full min-w-[760px] text-left text-[12px]">
              <caption class="sr-only">Audit events, newest first</caption>
              <thead class="border-b border-border bg-surface text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th scope="col" class="sticky top-0 z-10 bg-popover px-2.5 py-1.5 font-medium">
                    When
                  </th>
                  <th scope="col" class="sticky top-0 z-10 bg-popover px-2.5 py-1.5 font-medium">
                    Actor
                  </th>
                  <th scope="col" class="sticky top-0 z-10 bg-popover px-2.5 py-1.5 font-medium">
                    Action
                  </th>
                  <th scope="col" class="sticky top-0 z-10 bg-popover px-2.5 py-1.5 font-medium">
                    Device / target
                  </th>
                  <th
                    scope="col"
                    class="sticky top-0 z-10 hidden bg-popover px-2.5 py-1.5 font-medium md:table-cell"
                  >
                    IP
                  </th>
                  <th
                    scope="col"
                    class="sticky top-0 z-10 hidden bg-popover px-2.5 py-1.5 font-medium lg:table-cell"
                  >
                    Details
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-border">
                <For each={entries()}>
                  {(entry) => {
                    const summary = () =>
                      summarizeMetadata(Option.getOrUndefined(decodeJson(entry.metadata)));

                    return (
                      <>
                        <tr class="transition-colors hover:bg-hover">
                          <td class="whitespace-nowrap px-2.5 py-1.5 align-middle font-mono text-[10.5px] tabular-nums text-muted-foreground">
                            {formatDate(entry.createdAt)}
                          </td>
                          <td class="max-w-[15rem] px-2.5 py-1.5 align-middle">
                            <div class="flex min-w-0 items-center gap-1.5">
                              <Show when={entry.actorType === "system"}>
                                <Badge variant="secondary">system</Badge>
                              </Show>
                              <span
                                class="truncate text-[12px] font-[500] text-foreground"
                                title={auditActorLabel(entry)}
                              >
                                {auditActorLabel(entry)}
                              </span>
                            </div>
                            <div class="truncate text-[10px] leading-4 text-muted-foreground">
                              {auditActorKind(entry)}
                              <Show when={entry.category}>
                                {" · "}
                                {entry.category}
                              </Show>
                              <Show when={credentialOf(entry)}>
                                {(credential) => (
                                  <>
                                    {" · via "}
                                    {credential().type === "oauth" ? "MCP" : "API token"}
                                    {credential().name ? ` · ${credential().name}` : ""}
                                  </>
                                )}
                              </Show>
                              <Show when={rbacOf(entry)}>
                                {(rbac) => (
                                  <>
                                    {" · "}
                                    {rbac().roleKind === "custom" ? "Custom role" : "Built-in role"}
                                    {rbac().roleName ? ` · ${rbac().roleName}` : ""}
                                  </>
                                )}
                              </Show>
                            </div>
                          </td>
                          <td class="whitespace-nowrap px-2.5 py-1.5 align-middle">
                            <span title={entry.action}>
                              <Badge variant="secondary">{formatAuditAction(entry.action)}</Badge>
                            </span>
                          </td>
                          <td class="max-w-[20rem] px-2.5 py-1.5 align-middle text-[11.5px] text-muted-foreground">
                            <div class="flex min-w-0 items-center gap-1.5">
                              <span class="shrink-0">{entry.targetType}</span>
                              <Show when={entry.targetId}>
                                <code class="truncate text-[11px]">{entry.targetId}</code>
                              </Show>
                              <Show when={auditProtocolLabel(entry.protocol)}>
                                {(label) => (
                                  <span class="shrink-0 rounded border border-border px-1 py-px text-[9.5px] tracking-wide uppercase">
                                    {label()}
                                  </span>
                                )}
                              </Show>
                              <button
                                type="button"
                                class="ml-auto shrink-0 rounded text-[10.5px] font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                                aria-expanded={expandedEntry() === entry.id ? "true" : "false"}
                                aria-controls={`audit-metadata-${entry.id}`}
                                onClick={() =>
                                  setExpandedEntry((current) =>
                                    current === entry.id ? null : entry.id,
                                  )
                                }
                              >
                                {expandedEntry() === entry.id ? "Hide" : "Details"}
                              </button>
                            </div>
                          </td>
                          <td class="hidden px-2.5 py-1.5 align-middle font-mono text-[10.5px] text-muted-foreground md:table-cell">
                            {entry.ip ?? "—"}
                          </td>
                          <td class="hidden max-w-[22rem] px-2.5 py-1.5 align-middle lg:table-cell">
                            <Show
                              when={summary()}
                              fallback={<span class="text-[11px] text-muted-foreground">—</span>}
                            >
                              <span
                                class="block truncate text-[11px] text-muted-foreground"
                                title={summary()}
                              >
                                {summary()}
                              </span>
                            </Show>
                          </td>
                        </tr>
                        <Show when={expandedEntry() === entry.id}>
                          <tr id={`audit-metadata-${entry.id}`}>
                            <td colspan="6" class="bg-surface px-3 py-3">
                              <dl class="mb-2 grid grid-cols-1 gap-x-6 gap-y-1 text-[11px] sm:grid-cols-2">
                                <div class="flex gap-2">
                                  <dt class="text-muted-foreground">Action</dt>
                                  <dd class="break-all font-mono">{entry.action}</dd>
                                </div>
                                <div class="flex gap-2">
                                  <dt class="text-muted-foreground">IP</dt>
                                  <dd class="font-mono">{entry.ip ?? "not recorded"}</dd>
                                </div>
                                <div class="flex gap-2">
                                  <dt class="text-muted-foreground">Device</dt>
                                  <dd class="break-all font-mono">{entry.deviceId ?? "—"}</dd>
                                </div>
                                <div class="flex gap-2">
                                  <dt class="text-muted-foreground">Protocol</dt>
                                  <dd>{auditProtocolLabel(entry.protocol) ?? "—"}</dd>
                                </div>
                                <div class="flex gap-2">
                                  <dt class="text-muted-foreground">Principal</dt>
                                  <dd class="break-all">{entry.principalId ?? "—"}</dd>
                                </div>
                                <div class="flex gap-2">
                                  <dt class="text-muted-foreground">Certificate</dt>
                                  <dd class="break-all font-mono">
                                    {entry.deviceCertificateSerial ?? "—"}
                                  </dd>
                                </div>
                                <div class="col-span-full flex gap-2">
                                  <dt class="text-muted-foreground">Fingerprint</dt>
                                  <dd class="break-all font-mono">
                                    {entry.deviceCertificateFingerprint ?? "—"}
                                  </dd>
                                </div>
                                <Show when={entry.userAgent}>
                                  <div class="col-span-full flex gap-2">
                                    <dt class="text-muted-foreground">User agent</dt>
                                    <dd class="break-words">{entry.userAgent}</dd>
                                  </div>
                                </Show>
                              </dl>
                              <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-2.5 font-mono text-[11px] leading-5 text-muted-foreground">
                                {JSON.stringify(entry.metadata ?? {}, null, 2)}
                              </pre>
                            </td>
                          </tr>
                        </Show>
                      </>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </div>
          <div class="flex justify-center pt-3">
            <Show
              when={log.hasNextPage}
              fallback={
                <span class="text-xs text-muted-foreground">All matching events are loaded.</span>
              }
            >
              <Button
                variant="outline"
                onClick={() => void log.fetchNextPage()}
                disabled={log.isFetchingNextPage}
              >
                {log.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            </Show>
          </div>
        </Show>
        <ErrorText error={log.error} />
      </Panel>
    </div>
  );
}

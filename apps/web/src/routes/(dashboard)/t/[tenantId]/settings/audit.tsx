import { useParams } from "@solidjs/router";
import { isServer } from "@solidjs/web";
import { useInfiniteQuery, type InfiniteData } from "@tanstack/solid-query";
import { Option, Schema } from "effect";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { ErrorText, Panel, QueryError } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  enterprise,
  enterpriseKeys,
  type AuditLogEntry,
  type AuditSearchResponse,
  type AuditSearchQuery,
} from "~/lib/enterprise";
import { errorPresentation } from "~/lib/errors";

const PAGE_SIZE = 50;
const SYSTEM_ACTOR = "system";

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

const inputClass =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-white/[0.02] px-2.5 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground sm:text-[13px] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [color-scheme:dark]";

const selectClass = inputClass;

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
  "policy.created",
  "policy.updated",
  "policy.deleted",
  "policy.assignments_changed",
  "application.created",
  "group.created",
  "group.members_changed",
  "member.invited",
  "member.removed",
  "entra.sync_completed",
  "entra.sync_failed",
  "sso.updated",
  "scim.token_created",
  "scim.token_revoked",
];

const formatAction = (action: string) =>
  action
    .split(".")
    .map((part) => part.replaceAll("_", " "))
    .join(" · ")
    .replace(/^\w/, (letter) => letter.toUpperCase());

const formatDate = (value: string) => {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const actorLabel = (entry: AuditLogEntry) => {
  if (!entry.actorEmail || entry.actorEmail === SYSTEM_ACTOR) return "System";

  return entry.actorEmail;
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

export default function AuditSettingsPage() {
  const params = useParams();

  const [action, setAction] = createSignal("");
  const [actor, setActor] = createSignal("");
  const [targetType, setTargetType] = createSignal("");
  const [targetId, setTargetId] = createSignal("");
  const [fromDate, setFromDate] = createSignal("");
  const [toDate, setToDate] = createSignal("");

  const [debounced, setDebounced] = createSignal({
    action: "",
    actor: "",
    targetType: "",
    targetId: "",
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
    }),
    (next) => {
      const current = debounced();

      if (
        current.action === next.action &&
        current.actor === next.actor &&
        current.targetType === next.targetType &&
        current.targetId === next.targetId
      )
        return;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => setDebounced(next), 250);
    },
  );

  const rangeError = createMemo(() => {
    if (!fromDate() || !toDate()) return undefined;

    return dateStart(fromDate())! > dateEnd(toDate())!
      ? new Error("The start date must be on or before the end date.")
      : undefined;
  });

  const filters = createMemo<AuditSearchQuery>(() => ({
    action: debounced().action.trim() || undefined,
    actor: debounced().actor.trim() || undefined,
    targetType: debounced().targetType.trim() || undefined,
    targetId: debounced().targetId.trim() || undefined,
    from: dateStart(fromDate()),
    to: dateEnd(toDate()),
    limit: PAGE_SIZE,
  }));

  const log = useInfiniteQuery<
    AuditSearchResponse,
    Error,
    InfiniteData<AuditSearchResponse>,
    readonly unknown[],
    string | undefined
  >(() => ({
    queryKey: enterpriseKeys.auditSearch(params.tenantId, filters()),
    queryFn: async ({ pageParam }) =>
      enterprise.searchAuditLog(params.tenantId, {
        ...filters(),
        cursor: pageParam,
      }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // Infinite queries are client-driven; running the first page during SSR
    // loses the request cookie and surfaces as an unauthenticated error.
    enabled: Boolean(params.tenantId) && !isServer && !rangeError(),
  }));

  const entries = createMemo<AuditLogEntry[]>(
    () => log.data?.pages.flatMap((page) => page.entries) ?? [],
  );

  const hasFilters = () =>
    Boolean(
      action().trim() ||
      actor().trim() ||
      targetType().trim() ||
      targetId().trim() ||
      fromDate() ||
      toDate(),
    );

  const clearFilters = () => {
    clearTimeout(settleTimer);
    setAction("");
    setActor("");
    setTargetType("");
    setTargetId("");
    setFromDate("");
    setToDate("");
    setDebounced({ action: "", actor: "", targetType: "", targetId: "" });
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

      const response = await fetch(
        `/api/v1/tenants/${encodeURIComponent(params.tenantId ?? "")}/audit/export?${query}`,
        { credentials: "include" },
      );

      if (!response.ok) throw await responseFailure(response, `Export failed (${response.status})`);
      const body = await response.text();
      setExportTruncated(response.headers.get("X-Export-Truncated") === "true");
      const type = format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8";
      const blob = new Blob([body], { type });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.${format}`;
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error);
    } finally {
      setExporting(null);
    }
  };

  return (
    <div class="grid gap-5">
      <QueryError error={log.error} onRetry={() => void log.refetch()} />

      <Panel
        title="Audit log"
        description="A chronological record of tenant changes and device lifecycle events. Entries are append-only and retained for the lifetime of the tenant."
      >
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label class="space-y-1.5">
            <span class="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Action
            </span>
            <input
              class={inputClass}
              list="audit-action-suggestions"
              placeholder="e.g. device.enrolled"
              value={action()}
              onInput={(event) => setAction(event.currentTarget.value)}
            />
            <datalist id="audit-action-suggestions">
              <For each={KNOWN_ACTIONS}>{(value) => <option value={value} />}</For>
            </datalist>
          </label>
          <label class="space-y-1.5">
            <span class="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Actor
            </span>
            <input
              class={inputClass}
              placeholder="Email or user id"
              value={actor()}
              onInput={(event) => setActor(event.currentTarget.value)}
            />
          </label>
          <label class="space-y-1.5">
            <span class="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Target type
            </span>
            <select
              class={selectClass}
              value={targetType()}
              onChange={(event) => setTargetType(event.currentTarget.value)}
            >
              <option value="">Any target</option>
              <option value="device">Device</option>
              <option value="device_command">Device command</option>
              <option value="group">Group</option>
              <option value="policy">Policy</option>
              <option value="application">Application</option>
              <option value="user">User</option>
              <option value="tenant">Tenant</option>
              <option value="enrollment">Enrollment</option>
              <option value="apns">APNs</option>
              <option value="entra">Entra</option>
              <option value="sso">SSO</option>
              <option value="scim_token">SCIM token</option>
            </select>
          </label>
          <label class="space-y-1.5">
            <span class="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              Target id
            </span>
            <input
              class={inputClass}
              placeholder="Contains…"
              value={targetId()}
              onInput={(event) => setTargetId(event.currentTarget.value)}
            />
          </label>
          <label class="space-y-1.5">
            <span class="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              From
            </span>
            <input
              type="date"
              class={inputClass}
              value={fromDate()}
              max={toDate() || undefined}
              onInput={(event) => setFromDate(event.currentTarget.value)}
            />
          </label>
          <label class="space-y-1.5">
            <span class="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
              To
            </span>
            <input
              type="date"
              class={inputClass}
              value={toDate()}
              min={fromDate() || undefined}
              onInput={(event) => setToDate(event.currentTarget.value)}
            />
          </label>
        </div>

        <Show when={rangeError()}>{(error) => <ErrorText error={error()} />}</Show>

        <div class="mt-4 flex flex-wrap items-center gap-2">
          <p id="audit-export-hint" class="sr-only">
            Exports the audit events that match the active filters, newest first.
          </p>
          <Button
            variant="outline"
            aria-describedby="audit-export-hint"
            onClick={() => void exportAudit("csv")}
            disabled={exporting() !== null || Boolean(rangeError())}
          >
            {exporting() === "csv" ? "Exporting…" : "Export CSV"}
          </Button>
          <Button
            variant="outline"
            aria-describedby="audit-export-hint"
            onClick={() => void exportAudit("json")}
            disabled={exporting() !== null || Boolean(rangeError())}
          >
            {exporting() === "json" ? "Exporting…" : "Export JSON"}
          </Button>
          <Show when={hasFilters()}>
            <Button variant="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          </Show>
          <span role="status" aria-live="polite" class="text-xs text-muted-foreground">
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
            <p class="mt-4 text-[13px] text-muted-foreground">
              {log.isPending ? "Loading audit events…" : "No audit events match these filters."}
            </p>
          }
        >
          <p class="mt-3 text-[11px] text-muted-foreground sm:hidden">
            Swipe the table sideways to see action and target details.
          </p>
          <div
            class="mt-4 max-h-[70vh] overflow-auto rounded-lg border border-white/[0.07]"
            aria-busy={log.isFetching ? "true" : undefined}
          >
            <table class="w-full min-w-[720px] text-left text-[13px]">
              <caption class="sr-only">Audit events, newest first</caption>
              <thead class="border-b border-white/[0.06] bg-white/[0.02] text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th scope="col" class="sticky top-0 z-10 bg-popover px-3 py-2.5 font-medium">
                    When
                  </th>
                  <th scope="col" class="sticky top-0 z-10 bg-popover px-3 py-2.5 font-medium">
                    Actor
                  </th>
                  <th scope="col" class="sticky top-0 z-10 bg-popover px-3 py-2.5 font-medium">
                    Action
                  </th>
                  <th scope="col" class="sticky top-0 z-10 bg-popover px-3 py-2.5 font-medium">
                    Target
                  </th>
                  <th
                    scope="col"
                    class="sticky top-0 z-10 hidden bg-popover px-3 py-2.5 font-medium lg:table-cell"
                  >
                    Details
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/[0.05]">
                <For each={entries()}>
                  {(entry) => {
                    const summary = () =>
                      summarizeMetadata(Option.getOrUndefined(decodeJson(entry.metadata)));

                    return (
                      <>
                        <tr class="transition-colors hover:bg-white/[0.02]">
                          <td class="whitespace-nowrap px-3 py-3 align-top text-xs text-muted-foreground">
                            {formatDate(entry.createdAt)}
                          </td>
                          <td
                            class="max-w-[14rem] truncate px-3 py-3 align-top text-muted-foreground"
                            title={actorLabel(entry)}
                          >
                            {actorLabel(entry)}
                            <Show when={credentialOf(entry)}>
                              {(credential) => (
                                <span class="mt-1 block truncate text-[10.5px] text-muted-foreground">
                                  via {credential().type === "oauth" ? "MCP" : "API token"}
                                  {credential().name ? ` · ${credential().name}` : ""}
                                </span>
                              )}
                            </Show>
                            <Show when={rbacOf(entry)}>
                              {(rbac) => (
                                <span class="mt-1 block truncate text-[10.5px] text-muted-foreground">
                                  {rbac().roleKind === "custom" ? "Custom role" : "Built-in role"}
                                  {rbac().roleName ? ` · ${rbac().roleName}` : ""}
                                  {rbac().permission ? ` · ${rbac().permission}` : ""}
                                </span>
                              )}
                            </Show>
                          </td>
                          <td class="px-3 py-3 align-top">
                            <Badge variant="secondary">{formatAction(entry.action)}</Badge>
                            <code class="mt-1 block break-all text-[11px] text-muted-foreground">
                              {entry.action}
                            </code>
                          </td>
                          <td class="px-3 py-3 align-top text-xs text-muted-foreground">
                            <span class="block">{entry.targetType}</span>
                            <Show when={entry.targetId}>
                              <code class="break-all text-xs">{entry.targetId}</code>
                            </Show>
                            {/* Details column is hidden on small screens; keep a
                              compact metadata line visible here instead. */}
                            <Show when={summary()}>
                              <span class="mt-1 block break-words text-xs lg:hidden">
                                {summary()}
                              </span>
                            </Show>
                            <button
                              type="button"
                              class="mt-1.5 block w-fit rounded text-[11px] font-medium text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                              aria-expanded={expandedEntry() === entry.id ? "true" : "false"}
                              aria-controls={`audit-metadata-${entry.id}`}
                              onClick={() =>
                                setExpandedEntry((current) =>
                                  current === entry.id ? null : entry.id,
                                )
                              }
                            >
                              {expandedEntry() === entry.id ? "Hide details" : "Details"}
                            </button>
                          </td>
                          <td class="hidden max-w-[22rem] px-3 py-3 align-top lg:table-cell">
                            <Show
                              when={summary()}
                              fallback={<span class="text-xs text-muted-foreground">—</span>}
                            >
                              <span
                                class="block truncate text-xs text-muted-foreground"
                                title={summary()}
                              >
                                {summary()}
                              </span>
                            </Show>
                          </td>
                        </tr>
                        <Show when={expandedEntry() === entry.id}>
                          <tr id={`audit-metadata-${entry.id}`}>
                            <td colspan="5" class="bg-white/[0.02] px-3 py-3">
                              <pre class="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-white/[0.07] bg-black/20 p-2.5 font-mono text-[11px] leading-5 text-muted-foreground">
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

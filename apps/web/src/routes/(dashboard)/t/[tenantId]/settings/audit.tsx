import { useParams } from "@solidjs/router";
import { isServer } from "@solidjs/web";
import { useInfiniteQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { ErrorText, QueryError } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  enterprise,
  enterpriseKeys,
  type AuditLogEntry,
  type AuditSearchQuery,
} from "~/lib/enterprise";

const PAGE_SIZE = 50;
const SYSTEM_ACTOR = "system";

const inputClass = "h-9 w-full rounded-lg border bg-white px-3 text-sm text-stone-800";
const selectClass = "h-9 w-full rounded-lg border bg-white px-3 text-sm text-stone-800";

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

/** Compact one-line metadata preview; the full JSON is in the export. */
const summarizeMetadata = (metadata: unknown) => {
  if (metadata === null || metadata === undefined) return "";
  if (typeof metadata === "string") return metadata;
  if (typeof metadata !== "object") return JSON.stringify(metadata);
  const rows = Object.entries(metadata as Record<string, unknown>);
  if (rows.length === 0) return "";
  return rows
    .slice(0, 3)
    .map(([key, value]) => {
      const text =
        typeof value === "string"
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

  const log = useInfiniteQuery(() => ({
    queryKey: enterpriseKeys.auditSearch(params.tenantId, filters()),
    queryFn: ({ pageParam }) =>
      enterprise.searchAuditLog(params.tenantId, {
        ...filters(),
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
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
      if (!response.ok)
        throw new Error((await response.text()) || `Export failed (${response.status})`);
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
    <div class="space-y-6">
      <QueryError error={log.error} onRetry={() => void log.refetch()} />
      <Card>
        <CardHeader>
          <CardTitle>Audit log</CardTitle>
          <p class="text-sm text-muted-foreground">
            A chronological record of tenant changes and device lifecycle events. Entries are
            append-only and retained for the lifetime of the tenant.
          </p>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label class="space-y-1 text-sm">
              <span class="text-muted-foreground">Action</span>
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
            <label class="space-y-1 text-sm">
              <span class="text-muted-foreground">Actor</span>
              <input
                class={inputClass}
                placeholder="Email or user id"
                value={actor()}
                onInput={(event) => setActor(event.currentTarget.value)}
              />
            </label>
            <label class="space-y-1 text-sm">
              <span class="text-muted-foreground">Target type</span>
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
            <label class="space-y-1 text-sm">
              <span class="text-muted-foreground">Target id</span>
              <input
                class={inputClass}
                placeholder="Contains…"
                value={targetId()}
                onInput={(event) => setTargetId(event.currentTarget.value)}
              />
            </label>
            <label class="space-y-1 text-sm">
              <span class="text-muted-foreground">From</span>
              <input
                type="date"
                class={inputClass}
                value={fromDate()}
                max={toDate() || undefined}
                onInput={(event) => setFromDate(event.currentTarget.value)}
              />
            </label>
            <label class="space-y-1 text-sm">
              <span class="text-muted-foreground">To</span>
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

          <div class="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => void exportAudit("csv")}
              disabled={exporting() !== null || Boolean(rangeError())}
            >
              {exporting() === "csv" ? "Exporting…" : "Export CSV"}
            </Button>
            <Button
              variant="outline"
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
            <span class="text-sm text-muted-foreground" aria-live="polite">
              <Show
                when={entries().length > 0}
                fallback={log.isPending ? "Loading audit events…" : "No matching events"}
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
              class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
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
              <p class="text-sm text-muted-foreground">
                {log.isPending ? "Loading audit events…" : "No audit events match these filters."}
              </p>
            }
          >
            <div class="overflow-x-auto">
              <table class="w-full min-w-[720px] text-left text-sm">
                <thead class="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th class="px-2 py-2 font-medium">When</th>
                    <th class="px-2 py-2 font-medium">Actor</th>
                    <th class="px-2 py-2 font-medium">Action</th>
                    <th class="px-2 py-2 font-medium">Target</th>
                    <th class="hidden px-2 py-2 font-medium lg:table-cell">Details</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={entries()}>
                    {(entry) => {
                      const summary = () => summarizeMetadata(entry.metadata);
                      return (
                        <tr class="border-b last:border-0">
                          <td class="whitespace-nowrap px-2 py-3 text-muted-foreground">
                            {formatDate(entry.createdAt)}
                          </td>
                          <td class="max-w-[14rem] truncate px-2 py-3" title={actorLabel(entry)}>
                            {actorLabel(entry)}
                          </td>
                          <td class="px-2 py-3">
                            <Badge variant="secondary">{formatAction(entry.action)}</Badge>
                            <code class="mt-1 block text-[11px] text-muted-foreground">
                              {entry.action}
                            </code>
                          </td>
                          <td class="px-2 py-3 text-muted-foreground">
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
                          </td>
                          <td class="hidden max-w-[22rem] px-2 py-3 lg:table-cell">
                            <Show
                              when={summary()}
                              fallback={<span class="text-muted-foreground">—</span>}
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
                      );
                    }}
                  </For>
                </tbody>
              </table>
            </div>
            <div class="flex justify-center pt-2">
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
        </CardContent>
      </Card>
    </div>
  );
}

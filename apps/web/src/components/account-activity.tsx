import { isServer } from "@solidjs/web";
import { useInfiniteQuery, type InfiniteData } from "@tanstack/solid-query";
import { Option, Schema } from "effect";
import { createMemo, createSignal, For, Show } from "solid-js";
import { ErrorText, Panel } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  enterprise,
  enterpriseKeys,
  type AccountAuditEntry,
  type AccountAuditSearchResponse,
  type AuditSearchQuery,
} from "~/lib/enterprise";
import { errorPresentation } from "~/lib/errors";
import { downloadBlob } from "~/lib/download";

const PAGE_SIZE = 25;

/**
 * Actions this stream can contain. They are suggestions for the filter, not an
 * allowlist: any exact action name is accepted.
 */
const KNOWN_ACTIONS = [
  "account.sign_in",
  "account.sign_in_failed",
  "account.step_up_failed",
  "account.mfa_enrolled",
  "account.mfa_disabled",
  "account.mfa_recovery_regenerated",
  "account.passkey_added",
  "account.passkey_removed",
  "account.email_change_requested",
  "account.email_change_completed",
  "account.email_change_cancelled",
  "account.api_token_created",
  "account.api_token_revoked",
  "account.session_revoked",
  "account.sessions_revoked",
  "account.recovery_requested",
  "account.recovery_approved",
  "account.recovery_completed",
  "account.deleted",
];

const inputClass =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-surface px-2.5 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground sm:text-[13px] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

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

/** Compact one-line metadata preview; the export carries the full record. */
const summarizeMetadata = (metadata: Schema.Json | undefined) => {
  if (metadata === null || metadata === undefined) return "";

  if (Schema.is(Schema.String)(metadata)) return metadata;

  if (!Schema.is(Schema.JsonObject)(metadata)) return JSON.stringify(metadata);

  const rows = Object.entries(metadata);

  if (rows.length === 0) return "";

  return rows
    .slice(0, 3)
    .map(([key, value]) => {
      const text = Schema.is(Schema.String)(value)
        ? value
        : value === null || value === undefined
          ? "—"
          : JSON.stringify(value);

      return `${key}: ${text}`;
    })
    .join(" · ");
};

const decodeJson = Schema.decodeUnknownOption(Schema.Json);

/**
 * Account → Activity. It is the account-scoped twin of the tenant audit page:
 * the same keyset cursor and the same CSV/JSON export, filtered by action.
 */
export function AccountActivity(props: { userId: string | undefined }) {
  const [action, setAction] = createSignal("");
  const [exporting, setExporting] = createSignal<"csv" | "json" | null>(null);
  const [exportError, setExportError] = createSignal<unknown>();
  const [exportTruncated, setExportTruncated] = createSignal(false);

  const filters = createMemo<AuditSearchQuery>(() => ({
    action: action().trim() || undefined,
    limit: PAGE_SIZE,
  }));

  const log = useInfiniteQuery<
    AccountAuditSearchResponse,
    Error,
    InfiniteData<AccountAuditSearchResponse>,
    readonly unknown[],
    string | undefined
  >(() => ({
    queryKey: enterpriseKeys.accountActivity(filters()),
    queryFn: async ({ pageParam }) =>
      enterprise.searchAccountAuditLog({ ...filters(), cursor: pageParam }),
    initialPageParam: undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // The first page is client-driven: running it during SSR loses the
    // request cookie and reports an unauthenticated error.
    enabled: Boolean(props.userId) && !isServer,
  }));

  const entries = createMemo<AccountAuditEntry[]>(
    () => log.data?.pages.flatMap((page) => page.entries) ?? [],
  );

  const exportActivity = async (format: "csv" | "json") => {
    setExporting(format);
    setExportError(undefined);
    setExportTruncated(false);

    try {
      const query = new URLSearchParams();

      if (filters().action) query.set("action", filters().action!);
      query.set("format", format);

      const response = await fetch(`/api/v1/account/audit/export?${query}`, {
        credentials: "include",
      });

      if (!response.ok) {
        const body = Option.getOrUndefined(decodeJson(await response.json().catch(() => "")));
        const presentation = errorPresentation(body, `Export failed (${response.status})`);

        throw new Error(presentation.message);
      }

      const body = await response.text();
      setExportTruncated(response.headers.get("X-Export-Truncated") === "true");
      const type = format === "json" ? "application/json;charset=utf-8" : "text/csv;charset=utf-8";
      downloadBlob(
        new Blob([body], { type }),
        `account-activity-${new Date().toISOString().slice(0, 10)}.${format}`,
      );
    } catch (error) {
      setExportError(error);
    } finally {
      setExporting(null);
    }
  };

  return (
    <Panel
      title="Activity"
      description="Sign-ins, credential changes, sessions and API tokens for your account. These events are not tied to a tenant, so they are kept on the account itself and pruned with the same retention as the tenant audit log."
    >
      <div class="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label class="min-w-0 flex-1 space-y-1.5">
          <span class="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Action
          </span>
          <Input
            list="account-activity-actions"
            placeholder="e.g. account.sign_in"
            value={action()}
            onInput={(event) => setAction(event.currentTarget.value)}
            class={inputClass}
          />
          <datalist id="account-activity-actions">
            <For each={KNOWN_ACTIONS}>{(value) => <option value={value} />}</For>
          </datalist>
        </label>
        <div class="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={exporting() !== null}
            onClick={() => void exportActivity("csv")}
          >
            {exporting() === "csv" ? "Exporting…" : "Export CSV"}
          </Button>
          <Button
            variant="outline"
            disabled={exporting() !== null}
            onClick={() => void exportActivity("json")}
          >
            {exporting() === "json" ? "Exporting…" : "Export JSON"}
          </Button>
        </div>
      </div>

      <ErrorText error={log.error ?? exportError()} />

      <Show when={exportTruncated()}>
        <div
          role="status"
          class="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/25 bg-warning/[0.07] px-3 py-2 text-xs text-warning-foreground"
        >
          <span>
            The export reached the 10,000-row limit and was truncated. Filter by action to export
            the rest.
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
            {log.isPending ? "Loading activity…" : "No account activity recorded yet."}
          </p>
        }
      >
        <ul class="mt-4 divide-y divide-border rounded-lg border border-border">
          <For each={entries()}>
            {(entry) => (
              <li class="px-3 py-2.5">
                <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p class="text-[13px] font-medium text-foreground">
                    {formatAction(entry.action)}
                  </p>
                  <time
                    class="text-[11px] text-muted-foreground"
                    datetime={entry.createdAt}
                    title={new Date(entry.createdAt).toISOString()}
                  >
                    {formatDate(entry.createdAt)}
                  </time>
                </div>
                <Show when={summarizeMetadata(Option.getOrUndefined(decodeJson(entry.metadata)))}>
                  {(summary) => (
                    <p class="mt-0.5 break-words text-[11px] leading-relaxed text-muted-foreground">
                      {summary()}
                    </p>
                  )}
                </Show>
                <Show when={entry.targetType}>
                  <p class="mt-0.5 text-[11px] text-muted-foreground">
                    {entry.targetType}
                    <Show when={entry.targetId}> · {entry.targetId}</Show>
                  </p>
                </Show>
              </li>
            )}
          </For>
        </ul>

        <div class="mt-3 flex items-center gap-2">
          <Show when={log.hasNextPage}>
            <Button
              variant="outline"
              disabled={log.isFetchingNextPage}
              onClick={() => void log.fetchNextPage()}
            >
              {log.isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </Show>
          <span class="text-xs text-muted-foreground">
            {entries().length} event{entries().length === 1 ? "" : "s"} loaded · newest first
          </span>
        </div>
      </Show>
    </Panel>
  );
}

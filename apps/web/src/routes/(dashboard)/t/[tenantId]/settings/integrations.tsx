import { useLocation, useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { isServer } from "@solidjs/web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import {
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_TEST_EVENT,
  webhookUrlProblem,
} from "@mattrax/enterprise-domain/client";
import type {
  WebhookDeliveryDetail,
  WebhookDeliveryInfo,
  WebhookDeliveryReplayResponse,
  WebhookEndpointInfo,
  WebhookEventType,
  WebhookTestResponse,
} from "@mattrax/enterprise-domain/client";
import { Checkbox, FilterBar } from "@mattrax/ui";
import type { FilterCondition, FilterField } from "@mattrax/ui";
import { ErrorText, Field, Panel, QueryError } from "~/components/mdm/common";
import SectionTabs from "~/components/settings/section-tabs";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { CheckCircle2, CircleAlert, Plus, RotateCcw } from "~/components/ui/icons";
import { errorMessage, raisedFailure } from "~/lib/errors";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import {
  optimisticallyRemoveCollectionItems,
  optimisticallyUpdateCollection,
} from "~/lib/optimistic";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";
import { useCan } from "~/lib/permissions";
import { cn } from "~/lib/utils";
import Chip from "~/components/settings/status-chip";

/**
 * Read query data only after success so a pending or disabled query cannot
 * suspend the settings pane. The deliveries query is disabled until an
 * endpoint is selected, and a disabled query's `data` never settles.
 */
function settledQueryData<T>(query: {
  readonly isSuccess: boolean;
  readonly data: T | undefined;
}): T | undefined {
  return query.isSuccess ? query.data : undefined;
}

/**
 * Settings → Integrations: outbound event webhooks.

 * The signing secret is only in the browser for the moment it is created or
 * rotated; every later list only shows its last four characters.
 */

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.webhooks(params.tenantId)),
      () => queryClient.ensureQueryData(enterpriseQueries.tenant(params.tenantId)),
    ]);
  },
};

export default function IntegrationsSettingsPage() {
  const params = useParams();
  const qc = useQueryClient();
  const { can } = useCan();
  const webhooks = useQuery(() => enterpriseQueries.webhooks(params.tenantId));

  const tenant = useQuery(() => ({
    ...enterpriseQueries.tenant(params.tenantId),
    enabled: Boolean(params.tenantId) && !isServer,
  }));

  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editing, setEditing] = createSignal<WebhookEndpointInfo | null>(null);
  const [url, setUrl] = createSignal("");
  const [description, setDescription] = createSignal("");
  const [events, setEvents] = createSignal<WebhookEventType[]>(Array.from(WEBHOOK_EVENT_TYPES));
  /** An empty event list subscribes to every event, including future ones. */
  const [allEvents, setAllEvents] = createSignal(true);
  const [enabled, setEnabled] = createSignal(true);
  const [formError, setFormError] = createSignal<unknown>();

  const [secret, setSecret] = createSignal<string | null>(null);
  const [deleteTarget, setDeleteTarget] = createSignal<WebhookEndpointInfo | null>(null);
  const [rotateTarget, setRotateTarget] = createSignal<WebhookEndpointInfo | null>(null);
  const [testResults, setTestResults] = createSignal<Record<string, WebhookTestResponse>>({});
  const [testingId, setTestingId] = createSignal<string | null>(null);
  const [rotateError, setRotateError] = createSignal<unknown>();

  // The active view lives in the URL so it survives a reload and can be
  // linked to. The tabs render as real anchors, so activation goes through
  // the router's document-level handler rather than a closure that can be
  // lost when the tablist is adopted across hydration.
  const location = useLocation();
  const tab = (): "endpoints" | "deliveries" =>
    new URLSearchParams(location.search).get("view") === "deliveries" && canReadDeliveries()
      ? "deliveries"
      : "endpoints";
  const [endpointId, setEndpointId] = createSignal("");
  const [eventFilter, setEventFilter] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal<"" | "succeeded" | "failed">("");
  const [extraDeliveries, setExtraDeliveries] = createSignal<WebhookDeliveryInfo[]>([]);
  const [nextCursor, setNextCursor] = createSignal<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [moreError, setMoreError] = createSignal<unknown>();
  const [detailOpen, setDetailOpen] = createSignal(false);
  const [detail, setDetail] = createSignal<WebhookDeliveryDetail | null>(null);
  const [detailError, setDetailError] = createSignal<unknown>();
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [replayResult, setReplayResult] = createSignal<WebhookDeliveryReplayResponse | null>(null);
  const [replayError, setReplayError] = createSignal<unknown>();

  const canManage = () => can("webhooks.write");
  const canReadDeliveries = () => can("webhooks.read");

  const urlProblem = createMemo(() => (url().trim() ? webhookUrlProblem(url()) : null));

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: enterpriseKeys.webhooks(params.tenantId) });

  const invalidateDeliveries = () =>
    qc.invalidateQueries({
      queryKey: enterpriseKeys.webhookDeliveries(params.tenantId, endpointId()),
    });

  const deliveryFilterFields: FilterField[] = [
    {
      id: "event",
      label: "Event",
      kind: "select",
      operators: [{ value: "is", label: "is" }],
      options: [
        ...WEBHOOK_EVENT_TYPES.map((event) => ({
          value: event,
          label: WEBHOOK_EVENT_LABELS[event],
        })),
        { value: WEBHOOK_TEST_EVENT, label: "Test delivery" },
      ],
    },
    {
      id: "status",
      label: "Delivery status",
      kind: "select",
      operators: [{ value: "is", label: "is" }],
      options: [
        { value: "succeeded", label: "Succeeded" },
        { value: "failed", label: "Failed" },
      ],
    },
  ];

  const deliveryFilterConditions = createMemo<FilterCondition[]>(() => {
    const conditions: FilterCondition[] = [];

    if (eventFilter()) conditions.push({ field: "event", operator: "is", values: [eventFilter()] });

    if (statusFilter())
      conditions.push({ field: "status", operator: "is", values: [statusFilter()] });

    return conditions;
  });

  const applyDeliveryFilters = (next: ReadonlyArray<FilterCondition>) => {
    const event = next.find((condition) => condition.field === "event")?.values[0] ?? "";
    const status = next.find((condition) => condition.field === "status")?.values[0] ?? "";

    setEventFilter(event);
    setStatusFilter(status === "succeeded" || status === "failed" ? status : "");
  };

  const deliveryFilters = createMemo(() => {
    const status = statusFilter();

    return {
      event: eventFilter() || undefined,
      status: status === "succeeded" || status === "failed" ? status : undefined,
    };
  });

  const deliveriesQuery = useQuery(() => ({
    ...enterpriseQueries.webhookDeliveries(params.tenantId, endpointId(), deliveryFilters()),
    enabled:
      tab() === "deliveries" && canReadDeliveries() && Boolean(params.tenantId && endpointId()),
  }));

  const deliveries = () => [
    ...(settledQueryData(deliveriesQuery)?.deliveries ?? []),
    ...extraDeliveries(),
  ];

  /**
   * The deliveries query is disabled until an endpoint is selected. Its
   * `isFetching` and `isLoading` helpers read the data node, which parks on a
   * promise that never settles while the query is disabled; short-circuit on
   * an endpoint so the panel renders without waiting for one.
   */
  const deliveriesLive = () => Boolean(endpointId()) && canReadDeliveries();
  const deliveriesFetching = () => deliveriesLive() && deliveriesQuery.isFetching;
  const deliveriesLoading = () => deliveriesLive() && deliveriesQuery.isLoading;

  const moreCursor = () =>
    nextCursor() === undefined
      ? (settledQueryData(deliveriesQuery)?.nextCursor ?? null)
      : nextCursor();

  // The first endpoint is selected by default so the deliveries tab is useful
  // without an extra click; a filter change starts the history over.
  createEffect(
    () => settledQueryData(webhooks)?.endpoints[0]?.id,
    (first) => {
      if (!endpointId() && first) setEndpointId(first);
    },
  );

  createEffect(
    () => ({ endpointId: endpointId(), event: eventFilter(), status: statusFilter() }),
    () => {
      setExtraDeliveries([]);
      setNextCursor(undefined);
      setMoreError(undefined);
    },
  );

  const loadMore = async () => {
    const cursor = moreCursor();

    if (!cursor || loadingMore()) return;
    setLoadingMore(true);
    setMoreError(undefined);

    try {
      const page = await enterprise.listWebhookDeliveries(params.tenantId, endpointId(), {
        ...deliveryFilters(),
        cursor,
      });

      setExtraDeliveries((rows) => [...rows, ...page.deliveries]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      setMoreError(error);
    } finally {
      setLoadingMore(false);
    }
  };

  const openDelivery = async (delivery: WebhookDeliveryInfo) => {
    setDetailOpen(true);
    setDetail(null);
    setDetailError(undefined);
    setReplayResult(null);
    setReplayError(undefined);
    setDetailLoading(true);

    try {
      setDetail(await enterprise.getWebhookDelivery(params.tenantId, endpointId(), delivery.id));
    } catch (error) {
      setDetailError(error);
    } finally {
      setDetailLoading(false);
    }
  };

  const replay = useMutation(() => ({
    mutationFn: (delivery: WebhookDeliveryInfo) =>
      enterprise.replayWebhookDelivery(params.tenantId, endpointId(), delivery.id),
    onSuccess: async (result) => {
      setReplayResult(result);
      setExtraDeliveries([]);
      setNextCursor(undefined);
      await invalidateDeliveries();
    },
    onError: (error) => setReplayError(error),
  }));

  const payloadText = () => JSON.stringify(detail()?.payload ?? null, null, 2);

  const toggleEvent = (event: WebhookEventType) =>
    setEvents((current) =>
      current.includes(event) ? current.filter((item) => item !== event) : [...current, event],
    );

  const toggleAllEvents = (all: boolean) => {
    setAllEvents(all);

    // Switching from "all" to a subset starts from every current event so the
    // administrator only has to untick the ones they do not want.
    if (!all && events().length === 0) setEvents(Array.from(WEBHOOK_EVENT_TYPES));
  };

  const openCreate = () => {
    setEditing(null);
    setUrl("");
    setDescription("");
    setEvents(Array.from(WEBHOOK_EVENT_TYPES));
    setAllEvents(true);
    setEnabled(true);
    setFormError(undefined);
    setEditorOpen(true);
  };

  const openEdit = (endpoint: WebhookEndpointInfo) => {
    setEditing(endpoint);
    setUrl(endpoint.url);
    setDescription(endpoint.description ?? "");
    setAllEvents(endpoint.events.length === 0);
    setEvents(
      endpoint.events.length > 0 ? Array.from(endpoint.events) : Array.from(WEBHOOK_EVENT_TYPES),
    );
    setEnabled(endpoint.enabled);
    setFormError(undefined);
    setEditorOpen(true);
  };

  const save = useMutation(() => ({
    mutationFn: async () => {
      const payload = {
        url: url().trim(),
        description: description().trim() || null,
        // An empty list means "all events", including events added later.
        events: allEvents() ? [] : events(),
        enabled: enabled(),
      };

      const current = editing();

      if (current) return enterprise.patchWebhook(params.tenantId, current.id, payload);

      return enterprise.createWebhook(params.tenantId, payload);
    },
    onMutate: async () => {
      const current = editing();

      // A create has no id until the server answers, so only an edit is shown
      // ahead of the response.
      if (!current) return;

      const payload = {
        url: url().trim(),
        description: description().trim() || null,
        events: allEvents() ? [] : events(),
        enabled: enabled(),
      };

      return optimisticallyUpdateCollection(
        qc,
        enterpriseKeys.webhooks(params.tenantId),
        "endpoints",
        (endpoints: WebhookEndpointInfo[]) =>
          endpoints.map((endpoint): WebhookEndpointInfo =>
            endpoint.id === current.id ? { ...endpoint, ...payload } : endpoint,
          ),
      );
    },
    onSuccess: (result) => {
      void invalidate();
      setEditorOpen(false);

      if ("secret" in result) setSecret(result.secret);
    },
    onError: (error, _variables, restore) => {
      restore?.();
      setFormError(error);
    },
  }));

  const remove = useMutation(() => ({
    mutationFn: (endpoint: WebhookEndpointInfo) =>
      enterprise.deleteWebhook(params.tenantId, endpoint.id),
    onMutate: async (endpoint) =>
      optimisticallyRemoveCollectionItems(
        qc,
        enterpriseKeys.webhooks(params.tenantId),
        "endpoints",
        [endpoint.id],
      ),
    onSuccess: () => {
      setDeleteTarget(null);
      void invalidate();
    },
    onError: (_error, _endpoint, restore) => restore?.(),
  }));

  const rotate = useMutation(() => ({
    mutationFn: (endpoint: WebhookEndpointInfo) =>
      enterprise.rotateWebhookSecret(params.tenantId, endpoint.id),
    onSuccess: async (result) => {
      setRotateTarget(null);
      setRotateError(undefined);
      setSecret(result.secret);
      await invalidate();
    },
    onError: (error) => setRotateError(error),
  }));

  const test = async (endpoint: WebhookEndpointInfo) => {
    setTestingId(endpoint.id);

    try {
      const result = await enterprise.testWebhook(params.tenantId, endpoint.id);
      setTestResults((current) => ({ ...current, [endpoint.id]: result }));
      await invalidate();
    } catch (error) {
      setTestResults((current) => ({
        ...current,
        [endpoint.id]: {
          status: "failed",
          responseStatus: null,
          error: errorMessage(raisedFailure(error), "Could not send the test delivery"),
          durationMs: 0,
        },
      }));
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div class="grid gap-5">
      <QueryError error={webhooks.error} onRetry={() => void webhooks.refetch()} />
      <QueryError error={tenant.error} onRetry={() => void tenant.refetch()} />

      <SectionTabs
        label="Webhook views"
        active={tab()}
        hrefFor={(id) => (id === "deliveries" ? "?view=deliveries" : "?")}
        panelMounted={(id) => tab() === id}
        tabs={[
          {
            id: "endpoints",
            label: "Endpoints",
            panelId: "webhook-panel-endpoints",
            elementId: "webhook-tab-endpoints",
          },
          {
            id: "deliveries",
            label: "Deliveries",
            panelId: "webhook-panel-deliveries",
            elementId: "webhook-tab-deliveries",
          },
        ]}
      />

      <Show when={tab() === "endpoints"}>
        <div id="webhook-panel-endpoints" role="tabpanel" aria-labelledby="webhook-tab-endpoints">
          <Panel
            title="Outbound webhooks"
            description="Send device lifecycle and enrollment events to your own HTTPS endpoint. Every delivery is signed with HMAC-SHA256."
            actions={
              <Show when={canManage()}>
                <Button onClick={openCreate}>
                  <Plus class="size-4" />
                  Add endpoint
                </Button>
              </Show>
            }
          >
            <Show when={!canManage() && settledQueryData(tenant)}>
              <p class="mb-4 rounded-lg border border-border bg-surface p-3 text-xs text-muted-foreground">
                Only a tenant owner or admin can manage webhook endpoints.
              </p>
            </Show>

            <Show
              when={(settledQueryData(webhooks)?.endpoints.length ?? 0) > 0}
              fallback={
                <div class="rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center">
                  <p class="text-xs font-medium text-foreground">No webhook endpoints yet</p>
                  <p class="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                    Add an endpoint to receive signed device and enrollment events.
                  </p>
                </div>
              }
            >
              <div class="space-y-3">
                <For each={settledQueryData(webhooks)?.endpoints ?? []}>
                  {(endpoint) => (
                    <div class="rounded-lg border border-border bg-surface p-4">
                      <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div class="min-w-0 space-y-1.5">
                          <p class="break-all font-mono text-xs text-foreground">
                            {endpoint.url}
                          </p>
                          <Show when={endpoint.description}>
                            <p class="text-xs text-muted-foreground">{endpoint.description}</p>
                          </Show>
                          <div class="flex flex-wrap items-center gap-2 pt-0.5">
                            <Chip tone={endpoint.enabled ? "success" : "neutral"}>
                              {endpoint.enabled ? "Enabled" : "Disabled"}
                            </Chip>
                            <Show when={endpoint.secretPrefix}>
                              <span class="font-mono text-xs text-muted-foreground">
                                Signing secret ····{endpoint.secretPrefix}
                              </span>
                            </Show>
                            <Show when={endpoint.lastDeliveryAt}>
                              <span class="text-xs text-muted-foreground">
                                Last delivery {new Date(endpoint.lastDeliveryAt!).toLocaleString()}{" "}
                                · {endpoint.lastDeliveryStatus ?? "unknown"}
                              </span>
                            </Show>
                          </div>
                        </div>
                        <Show when={canManage()}>
                          <div class="flex shrink-0 flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={testingId() === endpoint.id}
                              onClick={() => void test(endpoint)}
                            >
                              {testingId() === endpoint.id ? "Sending…" : "Send test"}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => openEdit(endpoint)}>
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setRotateError(undefined);
                                setRotateTarget(endpoint);
                              }}
                            >
                              <RotateCcw class="size-3.5" />
                              Rotate secret
                            </Button>
                            <Button
                              variant="destructive"
                              size="sm"
                              onClick={() => setDeleteTarget(endpoint)}
                            >
                              Delete
                            </Button>
                          </div>
                        </Show>
                      </div>

                      <div class="mt-3 flex flex-wrap gap-1.5">
                        <For
                          each={
                            endpoint.events.length > 0
                              ? endpoint.events
                              : Array.from(WEBHOOK_EVENT_TYPES)
                          }
                        >
                          {(event) => (
                            <span class="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-muted-foreground">
                              {WEBHOOK_EVENT_LABELS[event]}
                            </span>
                          )}
                        </For>
                      </div>

                      <Show when={endpoint.consecutiveFailures > 0}>
                        <p class="mt-3 flex items-start gap-2 text-xs leading-relaxed text-warning-foreground">
                          <CircleAlert class="mt-px size-3.5 shrink-0" />
                          <span>
                            {endpoint.consecutiveFailures} consecutive failed delivery
                            {endpoint.consecutiveFailures === 1 ? "" : "ies"}. We retry failed
                            deliveries automatically.
                          </span>
                        </p>
                      </Show>

                      <Show when={testResults()[endpoint.id]}>
                        {(result) => (
                          <div
                            class={cn(
                              "mt-3 flex items-start gap-2 rounded-lg border p-2.5 text-xs leading-relaxed",
                              result().status === "succeeded"
                                ? "border-success/25 bg-success/[0.07] text-success"
                                : "border-destructive/25 bg-destructive/[0.07] text-destructive",
                            )}
                          >
                            <Show
                              when={result().status === "succeeded"}
                              fallback={<CircleAlert class="mt-px size-3.5 shrink-0" />}
                            >
                              <CheckCircle2 class="mt-px size-3.5 shrink-0" />
                            </Show>
                            <span>
                              {result().status === "succeeded"
                                ? `Test delivered (HTTP ${result().responseStatus ?? "2xx"}) in ${result().durationMs}ms`
                                : `Test failed: ${result().error ?? "unknown error"}`}
                            </span>
                          </div>
                        )}
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <p class="mt-4 text-xs leading-relaxed text-muted-foreground">
              Deliveries are retried automatically after a failure and delivery history is removed
              after 30 days. Endpoints must be public HTTPS URLs; localhost and private addresses
              are rejected.
            </p>
          </Panel>
        </div>
      </Show>

      <Show when={tab() === "deliveries"}>
        <div id="webhook-panel-deliveries" role="tabpanel" aria-labelledby="webhook-tab-deliveries">
          <Panel
            title="Delivery history"
            description="Every attempt we made to an endpoint in the last 30 days, with the signed payload and the response."
            actions={
              <Button
                variant="outline"
                size="sm"
                disabled={deliveriesFetching()}
                onClick={() => void deliveriesQuery.refetch()}
              >
                {deliveriesFetching() ? "Refreshing…" : "Refresh"}
              </Button>
            }
          >
            <Show
              when={canReadDeliveries()}
              fallback={
                <p class="rounded-lg border border-border bg-surface p-3 text-xs text-muted-foreground">
                  Your role does not include the webhooks.read permission.
                </p>
              }
            >
              <Show
                when={(settledQueryData(webhooks)?.endpoints.length ?? 0) > 0}
                fallback={
                  <div class="rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center">
                    <p class="text-xs font-medium text-foreground">
                      No endpoint to show deliveries for
                    </p>
                    <p class="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                      Add an endpoint and send a test event to see delivery history here.
                    </p>
                  </div>
                }
              >
                <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label class="flex min-w-0 items-center gap-2">
                    <span class="shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Endpoint
                    </span>
                    <select
                      class="h-8 min-w-0 flex-1 rounded-full border border-border bg-card px-2.5 text-xs text-foreground outline-none transition-colors hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring/25"
                      value={endpointId()}
                      onChange={(event) => setEndpointId(event.currentTarget.value)}
                    >
                      <For each={settledQueryData(webhooks)?.endpoints ?? []}>
                        {(endpoint) => <option value={endpoint.id}>{endpoint.url}</option>}
                      </For>
                    </select>
                  </label>
                  <FilterBar
                    fields={deliveryFilterFields}
                    conditions={deliveryFilterConditions()}
                    onChange={applyDeliveryFilters}
                    label="Filter"
                  />
                </div>

                <ErrorText error={deliveriesQuery.error} />
                <ErrorText error={moreError()} />

                <Show
                  when={deliveries().length > 0}
                  fallback={
                    <p class="mt-4 rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center text-xs text-muted-foreground">
                      {deliveriesLoading()
                        ? "Loading deliveries…"
                        : "No deliveries match these filters in the last 30 days."}
                    </p>
                  }
                >
                  <div class="mt-4 divide-y divide-border rounded-lg border border-border">
                    <For each={deliveries()}>
                      {(delivery) => (
                        <div class="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                          <div class="min-w-0 space-y-1">
                            <div class="flex flex-wrap items-center gap-2">
                              <Chip tone={delivery.status === "succeeded" ? "success" : "danger"}>
                                {delivery.status}
                              </Chip>
                              <span class="font-mono text-xs text-foreground">
                                {delivery.event}
                              </span>
                              <span class="text-xs text-muted-foreground">
                                {new Date(delivery.createdAt).toLocaleString()}
                              </span>
                            </div>
                            <p class="text-xs text-muted-foreground">
                              Attempt {delivery.attempt} · Response{" "}
                              {delivery.responseStatus ?? "none"}
                              <Show when={delivery.error}>
                                {" "}
                                · <span class="text-destructive">{delivery.error}</span>
                              </Show>
                            </p>
                            <Show when={delivery.eventId}>
                              <p class="truncate font-mono text-xs text-muted-foreground">
                                {delivery.eventId}
                              </p>
                            </Show>
                          </div>
                          <div class="flex shrink-0 flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void openDelivery(delivery)}
                            >
                              View payload
                            </Button>
                            <Show when={canManage()}>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={replay.isPending}
                                onClick={() => {
                                  setReplayError(undefined);
                                  replay.mutate(delivery);
                                }}
                              >
                                Redeliver
                              </Button>
                            </Show>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>

                  <Show when={moreCursor()}>
                    <div class="mt-3">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={loadingMore()}
                        onClick={() => void loadMore()}
                      >
                        {loadingMore() ? "Loading…" : "Load older deliveries"}
                      </Button>
                    </div>
                  </Show>
                </Show>

                <p class="mt-4 text-xs leading-relaxed text-muted-foreground">
                  Redelivering keeps the original <code class="font-mono">X-Mattrax-Delivery</code>{" "}
                  id and re-signs the stored payload, so a receiver can dedupe a replay. History is
                  capped to the 30-day retention window.
                </p>
              </Show>
            </Show>
          </Panel>
        </div>
      </Show>

      <Show when={editorOpen()}>
        <Dialog open onOpenChange={setEditorOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editing() ? "Edit webhook endpoint" : "Add webhook endpoint"}
              </DialogTitle>
              <DialogDescription>
                Events are delivered as JSON with an HMAC-SHA256 signature over the timestamp and
                raw body.
              </DialogDescription>
            </DialogHeader>
            <form
              class="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();

                if (!urlProblem()) save.mutate();
              }}
            >
              <Field label="Endpoint URL" hint="Must be a public HTTPS URL.">
                <Input
                  value={url()}
                  placeholder="https://hooks.example.com/mattrax"
                  onInput={(event) => setUrl(event.currentTarget.value)}
                  required
                />
                <Show when={urlProblem()}>
                  <p class="text-xs text-destructive">{urlProblem()}</p>
                </Show>
              </Field>
              <Field label="Description" hint="Optional note for your team.">
                <Input
                  value={description()}
                  maxlength={500}
                  onInput={(event) => setDescription(event.currentTarget.value)}
                />
              </Field>
              <div class="space-y-2">
                <p class="text-xs font-medium text-foreground">Events</p>
                <label class="flex items-start gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    class="mt-0.5"
                    checked={allEvents()}
                    onCheckedChange={(checked) => toggleAllEvents(checked === true)}
                  />
                  Deliver all events, including future events
                </label>
                <div class={cn("grid gap-2 sm:grid-cols-2", allEvents() && "opacity-50")}>
                  <For each={WEBHOOK_EVENT_TYPES}>
                    {(event) => (
                      <label class="flex items-start gap-2 text-xs">
                        <Checkbox
                          class="mt-0.5"
                          checked={allEvents() || events().includes(event)}
                          disabled={allEvents()}
                          onCheckedChange={() => toggleEvent(event)}
                        />
                        <span class="min-w-0">
                          <span class="block font-medium text-foreground">
                            {WEBHOOK_EVENT_LABELS[event]}
                          </span>
                          <span class="block break-all font-mono text-xs text-muted-foreground">
                            {event}
                          </span>
                        </span>
                      </label>
                    )}
                  </For>
                </div>
              </div>
              <label class="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={enabled()}
                  onCheckedChange={(checked) => setEnabled(checked === true)}
                />
                Endpoint is enabled
              </label>
              <ErrorText error={formError() ?? save.error} />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditorOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={save.isPending || Boolean(urlProblem())}>
                  {save.isPending ? "Saving…" : editing() ? "Save changes" : "Add endpoint"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </Show>

      <Show when={Boolean(secret())}>
        <Dialog open onOpenChange={(open) => !open && setSecret(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Signing secret</DialogTitle>
              <DialogDescription>
                Copy this secret now. It is only shown once; rotate it later if it is lost.
              </DialogDescription>
            </DialogHeader>
            <div class="flex flex-col gap-2 sm:flex-row">
              <span class="contents font-mono">
                <Input value={secret() ?? ""} readonly class="min-w-0 flex-1" />
              </span>
              <Button
                type="button"
                variant="outline"
                class="shrink-0"
                onClick={() => void navigator.clipboard?.writeText(secret() ?? "")}
              >
                Copy
              </Button>
            </div>
            <p class="text-xs leading-relaxed text-muted-foreground">
              Verify deliveries with the <code class="font-mono">X-Mattrax-Signature</code> header:
              HMAC-SHA256 over <code class="font-mono">timestamp + "." + rawBody</code>.
            </p>
            <DialogFooter>
              <Button onClick={() => setSecret(null)}>I have copied it</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Show>

      <Show when={Boolean(deleteTarget())}>
        <Dialog open onOpenChange={(open) => !open && setDeleteTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete this webhook endpoint?</DialogTitle>
              <DialogDescription>
                Deliveries stop immediately and delivery history is removed. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <p class="break-all font-mono text-xs">{deleteTarget()?.url}</p>
            <ErrorText error={remove.error} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => {
                  const target = deleteTarget();

                  if (target) remove.mutate(target);
                }}
              >
                Delete endpoint
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Show>

      <Show when={Boolean(rotateTarget())}>
        <Dialog open onOpenChange={(open) => !open && setRotateTarget(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rotate signing secret?</DialogTitle>
              <DialogDescription>
                The old secret stops working immediately. Deliveries already queued for retry will
                be signed with the new secret.
              </DialogDescription>
            </DialogHeader>
            <ErrorText error={rotateError()} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setRotateTarget(null)}>
                Cancel
              </Button>
              <Button
                disabled={rotate.isPending}
                onClick={() => {
                  const target = rotateTarget();

                  if (target) rotate.mutate(target);
                }}
              >
                {rotate.isPending ? "Rotating…" : "Rotate secret"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Show>

      <Show when={detailOpen()}>
        <Dialog open onOpenChange={(open) => !open && setDetailOpen(false)}>
          <DialogContent class="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Delivery payload</DialogTitle>
              <DialogDescription>
                The exact JSON we signed and sent, plus the response we recorded.
              </DialogDescription>
            </DialogHeader>

            <Show when={detailLoading()}>
              <p class="text-xs text-muted-foreground">Loading delivery…</p>
            </Show>
            <ErrorText error={detailError()} />

            <Show when={detail()}>
              {(delivery) => (
                <div class="space-y-3">
                  <div class="flex flex-wrap items-center gap-2 text-xs">
                    <Chip tone={delivery().status === "succeeded" ? "success" : "danger"}>
                      {delivery().status}
                    </Chip>
                    <span class="font-mono text-xs text-foreground">{delivery().event}</span>
                    <span class="text-muted-foreground">
                      Attempt {delivery().attempt} · Response {delivery().responseStatus ?? "none"}
                    </span>
                  </div>
                  <Show when={delivery().error}>
                    <p class="rounded-lg border border-destructive/25 bg-destructive/[0.07] p-2.5 text-xs text-destructive">
                      {delivery().error}
                    </p>
                  </Show>
                  <div class="grid gap-1 text-xs text-muted-foreground">
                    <span class="font-mono">Delivery id · {delivery().id}</span>
                    <Show when={delivery().eventId}>
                      <span class="break-all font-mono">
                        X-Mattrax-Delivery · {delivery().eventId}
                      </span>
                    </Show>
                  </div>
                  <div class="relative">
                    <pre class="max-h-80 overflow-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs leading-relaxed text-foreground">
                      {payloadText()}
                    </pre>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      class="absolute right-2 top-2"
                      onClick={() => void navigator.clipboard?.writeText(payloadText())}
                    >
                      Copy payload
                    </Button>
                  </div>
                  <Show when={replayResult()}>
                    {(result) => (
                      <p
                        class={cn(
                          "rounded-lg border p-2.5 text-xs",
                          result().delivery.status === "succeeded"
                            ? "border-success/25 bg-success/[0.07] text-success"
                            : "border-destructive/25 bg-destructive/[0.07] text-destructive",
                        )}
                      >
                        Redelivered with the same delivery id:{" "}
                        {result().delivery.status === "succeeded"
                          ? `HTTP ${result().delivery.responseStatus ?? "2xx"}`
                          : (result().delivery.error ?? "delivery failed")}
                      </p>
                    )}
                  </Show>
                  <ErrorText error={replayError()} />
                </div>
              )}
            </Show>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDetailOpen(false)}>
                Close
              </Button>
              <Show when={canManage() && detail()}>
                {(delivery) => (
                  <Button
                    disabled={replay.isPending}
                    onClick={() => {
                      setReplayError(undefined);
                      replay.mutate(delivery());
                    }}
                  >
                    {replay.isPending ? "Redelivering…" : "Redeliver"}
                  </Button>
                )}
              </Show>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Show>
    </div>
  );
}

import { useParams, useSearchParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { isServer } from "@solidjs/web";
import { ArrowRight, Card } from "@mattrax/ui";
import { useMutation, useQuery } from "@tanstack/solid-query";
import { createEffect, createUniqueId, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ErrorText, Panel, QueryError } from "~/components/mdm/common";
import { LoadingState } from "~/components/ui";
import { Button } from "~/components/ui/button";
import {
  ArrowUpRight,
  Building2,
  CircleAlert,
  CheckCircle2,
  Download,
  HardDrive,
  MonitorSmartphone,
} from "~/components/ui/icons";
import { enterprise, enterpriseQueries } from "~/lib/enterprise";
import { billingUsageRemaining, billingUsageState } from "~/lib/billing-usage";
import type { BillingUsageState } from "~/lib/billing-usage";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";
import { useCan } from "~/lib/permissions";
import {
  PLAN_LIMIT_REACHED_BODY,
  PLAN_LIMIT_REACHED_TITLE,
  UNLIMITED_PLAN_NOTICE,
  formatPlanUsage,
} from "~/lib/plan-limits";
import { cn } from "~/lib/utils";
import { StatusChip as Chip } from "~/components/settings/status-chip";
import type { StatusTone } from "~/components/settings/status-chip";

const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
};

/** Stripe totals are minor units; an unknown currency renders as a number. */
const formatAmount = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
};

const invoiceTone = (status: string | null | undefined): StatusTone => {
  switch (status) {
    case "paid":
      return "success";
    case "open":
      return "warning";
    case "uncollectible":
      return "danger";
    default:
      return "neutral";
  }
};

const statusTone = (status: string | null | undefined, configured: boolean) => {
  if (!configured) return "neutral" as const;

  switch (status) {
    case "active":
    case "trialing":
      return "success" as const;
    case "past_due":
    case "unpaid":
    case "incomplete":
      return "danger" as const;
    case "canceled":
      return "neutral" as const;
    default:
      return "neutral" as const;
  }
};

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.billing(params.tenantId)),
      () => queryClient.ensureQueryData(enterpriseQueries.billingInvoices(params.tenantId)),
    ]);
  },
};

export default function BillingSettingsPage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const { can } = useCan();
  const usageHeadingId = createUniqueId();
  const planHeadingId = createUniqueId();
  const invoiceCaptionId = createUniqueId();

  const billing = useQuery(() => enterpriseQueries.billing(params.tenantId));

  const portal = useMutation(() => ({
    mutationFn: () => enterprise.billingPortal(params.tenantId, globalThis.location.href),
    onSuccess: ({ url }) => {
      globalThis.location.href = url;
    },
  }));

  // Do not read another query's pending data inside these options: tanstack
  // invokes the accessor outside a tracking scope and Solid's diagnostics
  // reject it. The invoices section is hidden when billing is unconfigured.
  const invoices = useQuery(() => ({
    ...enterpriseQueries.billingInvoices(params.tenantId),
    enabled: Boolean(params.tenantId),
  }));

  const checkout = useMutation(() => ({
    mutationFn: () => enterprise.billingCheckout(params.tenantId),
    onSuccess: ({ url }) => {
      globalThis.location.href = url;
    },
  }));

  const configured = () => billing.data?.configured !== false;
  // Without a plan catalogue there is nothing Checkout can sell even when
  // Stripe itself is configured for the deployment.
  const sellable = () => configured() && billing.data?.limitsConfigured !== false;
  const overLimit = () => Boolean(billing.data?.overDeviceLimit || billing.data?.overTenantLimit);

  /**
   * A tenant with a live subscription changes plan in the portal instead of
   * opening a second Checkout Session. A canceled subscription is dead, so
   * buying the plan again is allowed.
   */
  const subscribed = () => {
    const status = billing.data?.status;

    return Boolean(billing.data?.subscriptionId) && status !== "canceled";
  };

  /** Set by the Checkout success/cancel URLs the API builds from `ORIGIN`. */
  const checkoutOutcome = () => {
    const value = searchParams.checkout;

    return value === "success" || value === "cancelled" ? value : undefined;
  };

  // Stripe redirects back before its webhook is guaranteed to have landed. One
  // delayed refetch picks up the subscription without polling for it.
  let refreshedAfterCheckout = false;
  createEffect(
    () => ({ outcome: checkoutOutcome(), subscriptionId: billing.data?.subscriptionId }),
    ({ outcome, subscriptionId }) => {
      if (isServer || refreshedAfterCheckout || outcome !== "success" || subscriptionId) return;
      refreshedAfterCheckout = true;
      setTimeout(() => void billing.refetch(), 2_000);
    },
  );

  return (
    <div class="grid gap-5 xl:grid-cols-2">
      <QueryError
        class="xl:col-span-2"
        error={billing.error}
        onRetry={() => void billing.refetch()}
      />

      <Show when={billing.data && !billing.data.configured}>
        <Callout tone="warning" class="xl:col-span-2">
          Billing is not configured for this deployment. An administrator must set the Stripe
          environment variables before a plan can be purchased or managed.
        </Callout>
      </Show>
      <Show when={checkoutOutcome() === "success"}>
        <Callout tone="success" class="xl:col-span-2">
          <p class="font-medium">Checkout complete</p>
          <p class="mt-0.5">
            Your subscription starts once Stripe confirms the payment. Seat counts and invoices
            update automatically.
          </p>
        </Callout>
      </Show>
      <Show when={checkoutOutcome() === "cancelled"}>
        <Callout tone="warning" class="xl:col-span-2">
          <p class="font-medium">Checkout cancelled</p>
          <p class="mt-0.5">No plan was purchased. You can start again whenever you are ready.</p>
        </Callout>
      </Show>
      <Show when={overLimit()}>
        <Callout tone="danger" class="xl:col-span-2">
          <p class="font-medium">{PLAN_LIMIT_REACHED_TITLE}</p>
          <p class="mt-0.5">{PLAN_LIMIT_REACHED_BODY}</p>
        </Callout>
      </Show>

      <Panel class="xl:col-span-2">
        <div class="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.8fr)]">
          <Card role="region" aria-labelledby={usageHeadingId} class="min-w-0 p-4 sm:p-5">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="label-caps">Plan usage</div>
                <h2
                  id={usageHeadingId}
                  class="mt-1 text-[18px] font-[580] tracking-[-0.025em] text-foreground"
                >
                  Usage & limits
                </h2>
                <p class="mt-1 text-[12.5px] leading-5 text-muted-foreground">
                  See how much of your plan this account is using.
                </p>
              </div>
              <Show when={billing.data && !billing.data.limitsConfigured}>
                <Chip tone="neutral">Unlimited</Chip>
              </Show>
            </div>

            <div class="mt-6 grid gap-6 sm:grid-cols-2 sm:gap-5">
              <UsageMeter
                label="Device usage"
                icon={<MonitorSmartphone class="size-4" />}
                used={billing.data?.devicesUsed ?? 0}
                limit={billing.data?.deviceLimit}
                overLimit={billing.data?.overDeviceLimit ?? false}
                detail={`${billing.data?.billableDevices ?? 0} billable ${billing.data?.billableDevices === 1 ? "device" : "devices"}`}
              />
              <UsageMeter
                label="Tenant usage"
                icon={<Building2 class="size-4" />}
                used={billing.data?.tenantsUsed ?? 0}
                limit={billing.data?.tenantLimit}
                overLimit={billing.data?.overTenantLimit ?? false}
                detail={
                  billing.data?.tenantsUsed === 1
                    ? "1 organisation owned"
                    : `${billing.data?.tenantsUsed ?? 0} organisations owned`
                }
              />
            </div>

            <div class="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
              <p class="max-w-[52ch] text-[11.5px] leading-5 text-muted-foreground">
                Only enrolled devices are billable. Checked-out devices stop counting toward the
                next billing period.
              </p>
              <Button as="a" href={`/t/${params.tenantId}/devices`} variant="ghost" size="sm">
                View devices
                <ArrowRight class="size-3.5" />
              </Button>
            </div>
          </Card>

          <Card role="region" aria-labelledby={planHeadingId} class="min-w-0 p-4 sm:p-5">
            <div class="flex items-center justify-between gap-3">
              <h2 id={planHeadingId} class="label-caps">
                Current plan
              </h2>
              <Chip capitalize tone={statusTone(billing.data?.status, configured())}>
                {billing.data?.configured === false
                  ? "unavailable"
                  : (billing.data?.status ?? "inactive")}
              </Chip>
            </div>
            <p class="mt-3 text-[28px] font-[580] leading-none tracking-[-0.035em] capitalize text-foreground">
              {billing.data?.plan ?? "Free"}
            </p>
            <p class="mt-2 text-[12.5px] leading-5 text-muted-foreground">
              Current plan and renewal details.
            </p>

            <dl class="mt-6 divide-y divide-border text-[12.5px]">
              <DefinitionRow
                label="Current period ends"
                value={formatDate(billing.data?.periodEnd)}
              />
              <DefinitionRow label="Billable devices" value={billing.data?.billableDevices ?? 0} />
              <DefinitionRow
                label="Cancellation"
                value={billing.data?.cancelAtPeriodEnd ? "At period end" : "Not scheduled"}
              />
            </dl>

            <div class="mt-6">
              <Show when={can("billing.write")}>
                <div class="flex flex-wrap gap-2">
                  <Show when={!subscribed()}>
                    <Button
                      onClick={() => checkout.mutate()}
                      disabled={checkout.isPending || billing.isLoading || !sellable()}
                    >
                      {checkout.isPending ? "Opening checkout…" : "Choose a plan"}
                    </Button>
                  </Show>
                  <Button
                    variant={subscribed() ? "default" : "outline"}
                    onClick={() => portal.mutate()}
                    disabled={portal.isPending || billing.isLoading || !sellable()}
                  >
                    {portal.isPending
                      ? "Opening…"
                      : subscribed()
                        ? "Manage plan in Stripe"
                        : "Open billing portal"}
                    <ArrowUpRight class="size-3.5" />
                  </Button>
                </div>
                <p class="mt-2 text-[11.5px] leading-5 text-muted-foreground">
                  Stripe handles payment methods, plan changes and cancellations. Seat counts follow
                  your fleet automatically.
                </p>
              </Show>
              <Show when={!sellable()}>
                <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
                  {configured()
                    ? "This deployment has no plan catalogue configured, so Checkout is unavailable."
                    : "Checkout and the billing portal are unavailable until Stripe is configured for this deployment."}
                </p>
              </Show>
              <ErrorText error={checkout.error} />
              <ErrorText error={portal.error} />
            </div>
          </Card>
        </div>
      </Panel>

      <Panel
        title="Invoices"
        description="Receipts and open invoices for this tenant, newest first."
        class="xl:col-span-2"
        actions={
          <Show when={(invoices.data?.invoices.length ?? 0) > 0}>
            <Chip tone="neutral">{invoices.data?.invoices.length} total</Chip>
          </Show>
        }
      >
        <QueryError error={invoices.error} onRetry={() => void invoices.refetch()} />

        <Show when={!configured()}>
          <p class="rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed text-muted-foreground">
            Invoices appear here once this deployment is connected to Stripe.
          </p>
        </Show>

        <Show when={configured()}>
          <Show
            when={(invoices.data?.invoices.length ?? 0) > 0}
            fallback={
              <Show
                when={invoices.isLoading}
                fallback={
                  <p class="rounded-lg border border-dashed border-input bg-surface px-6 py-8 text-center text-xs text-muted-foreground">
                    No invoices yet. The first invoice is issued when a subscription starts.
                  </p>
                }
              >
                <div class="flex justify-center rounded-lg border border-dashed border-input bg-surface px-6 py-8">
                  <LoadingState label="Loading invoices…" size={16} />
                </div>
              </Show>
            }
          >
            <div class="overflow-x-auto" role="region" aria-labelledby={invoiceCaptionId}>
              <table class="w-full min-w-[34rem] text-left text-[13px]">
                <caption id={invoiceCaptionId} class="sr-only">
                  Invoices for this tenant
                </caption>
                <thead>
                  <tr class="border-b border-border text-[11px] font-medium tracking-wide text-muted-foreground">
                    <th scope="col" class="py-2 pr-3 font-medium">
                      Invoice
                    </th>
                    <th scope="col" class="py-2 pr-3 font-medium">
                      Status
                    </th>
                    <th scope="col" class="py-2 pr-3 font-medium">
                      Date
                    </th>
                    <th scope="col" class="py-2 pr-3 text-right font-medium">
                      Total
                    </th>
                    <th scope="col" class="py-2 text-right font-medium">
                      Links
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-border">
                  <For each={invoices.data?.invoices ?? []}>
                    {(invoice) => (
                      <tr>
                        <td class="py-3 pr-3 font-mono text-[12px] font-medium text-foreground">
                          {invoice.number ?? invoice.id}
                        </td>
                        <td class="py-3 pr-3">
                          <Chip
                            capitalize
                            tone={invoiceTone(invoice.status)}
                            class={invoice.status === "paid" ? "bg-success/5" : undefined}
                          >
                            {invoice.status ?? "unknown"}
                          </Chip>
                        </td>
                        <td class="py-3 pr-3 text-muted-foreground">
                          {formatDate(invoice.createdAt)}
                        </td>
                        <td class="py-3 pr-3 text-right font-medium tabular-nums">
                          {formatAmount(invoice.total, invoice.currency)}
                        </td>
                        <td class="py-3 text-right">
                          <div class="flex justify-end gap-2">
                            <Show when={invoice.hostedInvoiceUrl}>
                              {(url) => (
                                <a
                                  class="text-brand underline-offset-2 hover:underline"
                                  href={url()}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label={`View invoice ${invoice.number ?? invoice.id}`}
                                >
                                  View
                                  <ArrowUpRight class="size-3" />
                                </a>
                              )}
                            </Show>
                            <Show when={invoice.pdfUrl}>
                              {(url) => (
                                <a
                                  class="text-brand underline-offset-2 hover:underline"
                                  href={url()}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label={`Download invoice ${invoice.number ?? invoice.id} PDF`}
                                >
                                  PDF
                                  <Download class="size-3" />
                                </a>
                              )}
                            </Show>
                            <Show when={!invoice.hostedInvoiceUrl && !invoice.pdfUrl}>
                              <span class="text-muted-foreground">—</span>
                            </Show>
                          </div>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </Show>
      </Panel>

      <Panel
        title="How billing works"
        description="What counts toward your plan and what stays in Stripe."
        class="xl:col-span-2"
        actions={
          <Button
            as="a"
            href={`/t/${params.tenantId}/settings/storage`}
            variant="outline"
            size="sm"
          >
            <HardDrive class="size-3.5" />
            Review storage usage
          </Button>
        }
      >
        <ul class="grid gap-4 text-[12px] leading-5 text-muted-foreground sm:grid-cols-3">
          <li>
            <strong class="font-[560] text-foreground">Enrolled devices</strong>
            <p class="mt-1">
              Only enrolled devices are billable. Checked-out devices stop counting.
            </p>
          </li>
          <li>
            <strong class="font-[560] text-foreground">Automatic seat counts</strong>
            <p class="mt-1">Your subscription quantity follows the current fleet automatically.</p>
          </li>
          <li>
            <strong class="font-[560] text-foreground">Stripe manages payments</strong>
            <p class="mt-1">Payment methods, plan changes and cancellations happen in Stripe.</p>
          </li>
        </ul>
        <Show when={billing.data && !billing.data.limitsConfigured}>
          <p class="mt-4 rounded-lg border border-border bg-surface p-3 text-xs leading-relaxed text-muted-foreground">
            {UNLIMITED_PLAN_NOTICE}
          </p>
        </Show>
      </Panel>
    </div>
  );
}

function DefinitionRow(props: { label: string; value: JSX.Element }) {
  return (
    <div class="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <dt class="text-muted-foreground">{props.label}</dt>
      <dd class="min-w-0 text-right font-medium text-foreground">{props.value}</dd>
    </div>
  );
}

const usageTone: Record<BillingUsageState, { chip: StatusTone; progress: string; icon: string }> = {
  unlimited: {
    chip: "neutral",
    progress: "",
    icon: "text-muted-foreground",
  },
  healthy: {
    chip: "success",
    progress: "[&::-webkit-progress-value]:bg-brand [&::-moz-progress-bar]:bg-brand",
    icon: "text-brand",
  },
  near: {
    chip: "warning",
    progress: "[&::-webkit-progress-value]:bg-warning [&::-moz-progress-bar]:bg-warning",
    icon: "text-warning",
  },
  full: {
    chip: "warning",
    progress: "[&::-webkit-progress-value]:bg-warning [&::-moz-progress-bar]:bg-warning",
    icon: "text-warning",
  },
  over: {
    chip: "danger",
    progress: "[&::-webkit-progress-value]:bg-destructive [&::-moz-progress-bar]:bg-destructive",
    icon: "text-destructive",
  },
};

function UsageMeter(props: {
  label: string;
  icon: JSX.Element;
  used: number;
  limit: number | null | undefined;
  overLimit: boolean;
  detail: string;
}) {
  const state = () => billingUsageState(props.used, props.limit, props.overLimit);
  const tone = () => usageTone[state()];
  const remaining = () => billingUsageRemaining(props.used, props.limit);
  const valueLabel = () => formatPlanUsage(props.used, props.limit);
  const statusLabel = () => {
    if (state() === "unlimited") return "Unlimited";
    if (state() === "over") return `${Math.max(0, props.used - (props.limit ?? 0))} over limit`;
    if (state() === "full") return "Limit reached";

    return `${remaining() ?? 0} remaining`;
  };

  return (
    <div class="min-w-0">
      <div class="flex items-center justify-between gap-2">
        <h3 class="flex min-w-0 items-center gap-2 text-[12.5px] font-[560] text-foreground">
          <span class={cn("shrink-0", tone().icon)}>{props.icon}</span>
          <span class="truncate">{props.label}</span>
        </h3>
        <Chip tone={tone().chip} class="max-w-[45%] truncate">
          {statusLabel()}
        </Chip>
      </div>

      <div class="mt-4 flex items-baseline gap-1.5">
        <span
          data-numeric
          class="text-[32px] font-[580] leading-none tracking-[-0.04em] text-foreground"
        >
          {props.used}
        </span>
        <span class="text-[15px] font-medium text-muted-foreground">/ {props.limit ?? "∞"}</span>
      </div>

      <Show
        when={props.limit !== null && props.limit !== undefined && props.limit > 0}
        fallback={<div class="mt-3 h-2 rounded-full bg-muted" aria-hidden="true" />}
      >
        <progress
          max={props.limit ?? 1}
          value={Math.max(0, Math.min(props.used, props.limit ?? 1))}
          aria-label={`${props.label}: ${valueLabel()}`}
          aria-valuetext={valueLabel()}
          class={cn(
            "mt-3 h-2 w-full appearance-none overflow-clip rounded-full border-0 bg-muted",
            "[&::-webkit-progress-bar]:bg-transparent [&::-webkit-progress-value]:rounded-full",
            "[&::-webkit-progress-value]:transition-[inline-size] [&::-webkit-progress-value]:duration-[var(--duration-panel)] [&::-webkit-progress-value]:ease-swift",
            "[&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:transition-[inline-size] [&::-moz-progress-bar]:duration-[var(--duration-panel)] [&::-moz-progress-bar]:ease-swift",
            "motion-reduce:[&::-webkit-progress-value]:transition-none motion-reduce:[&::-moz-progress-bar]:transition-none",
            tone().progress,
          )}
        />
      </Show>

      <p class="mt-2 text-[11.5px] leading-5 text-muted-foreground">{props.detail}</p>
      <Show when={state() === "near" || state() === "full"}>
        <p class="mt-1 text-[11.5px] font-medium text-warning">
          {state() === "full" ? "This plan is at its limit." : "This plan is nearing its limit."}
        </p>
      </Show>
      <Show when={state() === "over"}>
        <p class="mt-1 text-[11.5px] font-medium text-destructive">
          Upgrade or remove usage to add more.
        </p>
      </Show>
    </div>
  );
}

const calloutTones = {
  warning: {
    box: "border-warning/25 bg-warning/[0.07]",
    text: "text-warning-foreground",
  },
  danger: {
    box: "border-destructive/25 bg-destructive/[0.07]",
    text: "text-destructive",
  },
  success: {
    box: "border-success/25 bg-success/[0.07]",
    text: "text-success",
  },
} as const;

function Callout(props: {
  tone: keyof typeof calloutTones;
  children: JSX.Element;
  class?: string;
}) {
  const tone = () => calloutTones[props.tone];

  return (
    <div class={cn("flex items-start gap-2.5 rounded-lg border p-4", tone().box, props.class)}>
      <Show
        when={props.tone === "success"}
        fallback={<CircleAlert class={cn("mt-0.5 size-4 shrink-0", tone().text)} />}
      >
        <CheckCircle2 class={cn("mt-0.5 size-4 shrink-0", tone().text)} />
      </Show>
      <div class={cn("min-w-0 text-[13px] leading-relaxed", tone().text)}>{props.children}</div>
    </div>
  );
}

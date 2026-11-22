import { useParams, useSearchParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { isServer } from "@solidjs/web";
import { useMutation, useQuery } from "@tanstack/solid-query";
import { createEffect, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ErrorText, Panel, QueryError } from "~/components/mdm/common";
import { LoadingState } from "~/components/ui";
import { Button } from "~/components/ui/button";
import { CircleAlert, CheckCircle2 } from "~/components/ui/icons";
import { enterprise, enterpriseQueries } from "~/lib/enterprise";
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

const invoiceTone = (status: string | null | undefined): keyof typeof chipTones => {
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

      <Panel title="Plan" description="Your subscription, seat usage and renewal dates.">
        <div class="divide-y divide-border text-[13px]">
          <Row label="Plan">
            <span class="font-medium text-foreground">{billing.data?.plan ?? "Free"}</span>
          </Row>
          <Row label="Status">
            <Chip tone={statusTone(billing.data?.status, configured())}>
              {billing.data?.configured === false
                ? "unavailable"
                : (billing.data?.status ?? "inactive")}
            </Chip>
          </Row>
          <Row label="Billable devices">
            <span class="font-medium text-foreground">{billing.data?.billableDevices ?? 0}</span>
          </Row>
          <Row label="Devices">
            <span class="font-medium text-foreground">
              {formatPlanUsage(billing.data?.devicesUsed, billing.data?.deviceLimit)}
            </span>
          </Row>
          <Row label="Tenants">
            <span class="font-medium text-foreground">
              {formatPlanUsage(billing.data?.tenantsUsed, billing.data?.tenantLimit)}
            </span>
          </Row>
          <Row label="Current period ends">
            <span class="font-medium text-foreground">{formatDate(billing.data?.periodEnd)}</span>
          </Row>
          <Row label="Cancels at period end">
            <span class="font-medium text-foreground">
              {billing.data?.cancelAtPeriodEnd ? "Yes" : "No"}
            </span>
          </Row>
        </div>

        <div class="mt-4 border-t border-border pt-4">
          <Show when={can("billing.write")}>
            <div class="flex flex-wrap gap-2">
              <Show when={!subscribed()}>
                <Button
                  onClick={() => checkout.mutate()}
                  disabled={checkout.isPending || billing.isLoading || !sellable()}
                >
                  {checkout.isPending ? "Opening checkout…" : "Subscribe to the device plan"}
                </Button>
              </Show>
              <Button
                variant="outline"
                onClick={() => portal.mutate()}
                disabled={portal.isPending || billing.isLoading || !sellable()}
              >
                {portal.isPending ? "Opening…" : "Open billing portal"}
              </Button>
            </div>
            <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
              Checkout buys the per-device plan and starts with the devices enrolled today. Seat
              counts follow your fleet automatically, and the billing portal changes or cancels the
              subscription.
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
      </Panel>

      <Panel
        title="Invoices"
        description="Receipts and open invoices for this tenant, newest first."
        class="xl:col-span-2"
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
            <div class="overflow-x-auto">
              <table class="w-full min-w-[36rem] text-left text-[13px]">
                <thead>
                  <tr class="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
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
                        <td class="py-2.5 pr-3 font-mono text-[12px]">
                          {invoice.number ?? invoice.id}
                        </td>
                        <td class="py-2.5 pr-3">
                          <Chip tone={invoiceTone(invoice.status)}>
                            {invoice.status ?? "unknown"}
                          </Chip>
                        </td>
                        <td class="py-2.5 pr-3 text-muted-foreground">
                          {formatDate(invoice.createdAt)}
                        </td>
                        <td class="py-2.5 pr-3 text-right font-medium">
                          {formatAmount(invoice.total, invoice.currency)}
                        </td>
                        <td class="py-2.5 text-right">
                          <div class="flex justify-end gap-2">
                            <Show when={invoice.hostedInvoiceUrl}>
                              {(url) => (
                                <a
                                  class="text-brand underline-offset-2 hover:underline"
                                  href={url()}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  View
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
                                >
                                  PDF
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

      <Panel title="Usage" description="How billing is calculated for this tenant.">
        <div class="space-y-3 text-xs leading-relaxed text-muted-foreground">
          <p>
            Billing is based on enrolled devices. Devices that check out stop counting toward the
            next billing period, and the seat quantity on the subscription follows the fleet. Card
            details, plan changes and cancellations are managed in Stripe.
          </p>
          <Show when={billing.data && !billing.data.limitsConfigured}>
            <p class="rounded-lg border border-border bg-surface p-3">{UNLIMITED_PLAN_NOTICE}</p>
          </Show>
        </div>
      </Panel>
    </div>
  );
}

function Row(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <span class="text-muted-foreground">{props.label}</span>
      <span class="min-w-0 text-right">{props.children}</span>
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
    text: "text-success-foreground",
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

const chipTones = {
  neutral: "border-border bg-surface text-muted-foreground",
  success: "border-success/25 bg-success/10 text-success-foreground",
  warning: "border-warning/25 bg-warning/10 text-warning-foreground",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
} as const;

function Chip(props: { tone: keyof typeof chipTones; children: JSX.Element }) {
  return (
    <span
      class={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
        chipTones[props.tone],
      )}
    >
      <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {props.children}
    </span>
  );
}

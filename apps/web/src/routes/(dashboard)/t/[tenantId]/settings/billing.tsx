import { useParams } from "@solidjs/router";
import { useMutation, useQuery } from "@tanstack/solid-query";
import { Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ErrorText, Panel, QueryError } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { CircleAlert } from "~/components/ui/icons";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
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

export default function BillingSettingsPage() {
  const params = useParams();
  const billing = useQuery(() => ({
    queryKey: enterpriseKeys.billing(params.tenantId),
    queryFn: () => enterprise.billing(params.tenantId),
  }));
  const portal = useMutation(() => ({
    mutationFn: () => enterprise.billingPortal(params.tenantId, globalThis.location.href),
    onSuccess: ({ url }) => {
      globalThis.location.href = url;
    },
  }));
  const configured = () => billing.data?.configured !== false;
  const overLimit = () => Boolean(billing.data?.overDeviceLimit || billing.data?.overTenantLimit);

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
      <Show when={overLimit()}>
        <Callout tone="danger" class="xl:col-span-2">
          <p class="font-medium">{PLAN_LIMIT_REACHED_TITLE}</p>
          <p class="mt-0.5">{PLAN_LIMIT_REACHED_BODY}</p>
        </Callout>
      </Show>

      <Panel title="Plan" description="Your subscription, seat usage and renewal dates.">
        <div class="divide-y divide-white/[0.05] text-[13px]">
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

        <div class="mt-4 border-t border-white/[0.06] pt-4">
          <Button
            variant="outline"
            onClick={() => portal.mutate()}
            disabled={portal.isPending || billing.isLoading || !configured()}
          >
            {portal.isPending ? "Opening…" : "Open billing portal"}
          </Button>
          <Show when={!configured()}>
            <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
              The billing portal is unavailable until Stripe is configured for this deployment.
            </p>
          </Show>
          <ErrorText error={portal.error} />
        </div>
      </Panel>

      <Panel title="Usage" description="How billing is calculated for this tenant.">
        <div class="space-y-3 text-xs leading-relaxed text-muted-foreground">
          <p>
            Billing is based on enrolled devices. Devices that check out stop counting toward the
            next billing period. Usage reporting and invoices are managed in Stripe.
          </p>
          <Show when={billing.data && !billing.data.limitsConfigured}>
            <p class="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
              {UNLIMITED_PLAN_NOTICE}
            </p>
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

function Callout(props: { tone: "warning" | "danger"; children: JSX.Element; class?: string }) {
  return (
    <div
      class={cn(
        "flex items-start gap-2.5 rounded-lg border p-4",
        props.tone === "danger"
          ? "border-destructive/25 bg-destructive/[0.07]"
          : "border-warning/25 bg-warning/[0.07]",
        props.class,
      )}
    >
      <CircleAlert
        class={cn(
          "mt-0.5 size-4 shrink-0",
          props.tone === "danger" ? "text-destructive" : "text-warning-foreground",
        )}
      />
      <div
        class={cn(
          "min-w-0 text-[13px] leading-relaxed",
          props.tone === "danger" ? "text-destructive" : "text-warning-foreground",
        )}
      >
        {props.children}
      </div>
    </div>
  );
}

const chipTones = {
  neutral: "border-white/[0.08] bg-white/[0.03] text-muted-foreground",
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

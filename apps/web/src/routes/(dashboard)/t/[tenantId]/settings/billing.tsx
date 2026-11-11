import { useParams } from "@solidjs/router";
import { useMutation, useQuery } from "@tanstack/solid-query";
import { Show } from "solid-js";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ErrorText, QueryError } from "~/components/mdm/common";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import {
  PLAN_LIMIT_REACHED_BODY,
  PLAN_LIMIT_REACHED_TITLE,
  UNLIMITED_PLAN_NOTICE,
  formatPlanUsage,
} from "~/lib/plan-limits";

const formatDate = (value: string | null | undefined) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
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
    <div class="grid gap-6 xl:grid-cols-2">
      <QueryError
        class="xl:col-span-2"
        error={billing.error}
        onRetry={() => void billing.refetch()}
      />
      {billing.data && !billing.data.configured && (
        <div class="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm xl:col-span-2">
          Billing is not configured for this deployment. An administrator must set the Stripe
          environment variables before a plan can be purchased or managed.
        </div>
      )}
      {overLimit() && (
        <div class="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm xl:col-span-2">
          <p class="font-medium">{PLAN_LIMIT_REACHED_TITLE}</p>
          <p class="mt-1">{PLAN_LIMIT_REACHED_BODY}</p>
        </div>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Plan</CardTitle>
        </CardHeader>
        <CardContent class="space-y-3 text-sm">
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">Plan</span>
            <span class="font-medium">{billing.data?.plan ?? "Free"}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">Status</span>
            <Badge variant="outline">
              {billing.data?.configured === false
                ? "unavailable"
                : (billing.data?.status ?? "inactive")}
            </Badge>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">Billable devices</span>
            <span class="font-medium">{billing.data?.billableDevices ?? 0}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">Devices</span>
            <span class="font-medium">
              {formatPlanUsage(billing.data?.devicesUsed, billing.data?.deviceLimit)}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">Tenants</span>
            <span class="font-medium">
              {formatPlanUsage(billing.data?.tenantsUsed, billing.data?.tenantLimit)}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">Current period ends</span>
            <span class="font-medium">{formatDate(billing.data?.periodEnd)}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">Cancels at period end</span>
            <span class="font-medium">{billing.data?.cancelAtPeriodEnd ? "Yes" : "No"}</span>
          </div>
          <Button
            class="mt-2"
            variant="outline"
            onClick={() => portal.mutate()}
            disabled={portal.isPending || billing.isLoading || !configured()}
          >
            {portal.isPending ? "Opening…" : "Open billing portal"}
          </Button>
          {!configured() && (
            <p class="text-xs text-muted-foreground">
              The billing portal is unavailable until Stripe is configured for this deployment.
            </p>
          )}
          <ErrorText error={portal.error} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usage</CardTitle>
        </CardHeader>
        <CardContent class="space-y-2 text-sm text-muted-foreground">
          <p>
            Billing is based on enrolled devices. Devices that check out stop counting toward the
            next billing period. Usage reporting and invoices are managed in Stripe.
          </p>
          <Show when={billing.data && !billing.data.limitsConfigured}>
            <p>{UNLIMITED_PLAN_NOTICE}</p>
          </Show>
        </CardContent>
      </Card>
    </div>
  );
}

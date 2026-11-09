import { useParams } from "@solidjs/router";
import { useMutation, useQuery } from "@tanstack/solid-query";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ErrorText } from "~/components/mdm/common";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";

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

  return (
    <div class="grid gap-6 xl:grid-cols-2">
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
            <Badge variant="outline">{billing.data?.status ?? "inactive"}</Badge>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-muted-foreground">Billable devices</span>
            <span class="font-medium">{billing.data?.billableDevices ?? 0}</span>
          </div>
          <Button
            class="mt-2"
            variant="outline"
            onClick={() => portal.mutate()}
            disabled={portal.isPending}
          >
            {portal.isPending ? "Opening…" : "Open billing portal"}
          </Button>
          <ErrorText error={portal.error} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Usage</CardTitle>
        </CardHeader>
        <CardContent class="text-sm text-muted-foreground">
          Billing is based on enrolled devices. Devices that check out stop counting toward the next
          billing period. Usage reporting and invoices are managed in Stripe.
        </CardContent>
      </Card>
    </div>
  );
}

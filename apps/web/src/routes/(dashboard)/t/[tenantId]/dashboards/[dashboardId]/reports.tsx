import { useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { Show } from "solid-js";
import { Page, PageHeader, QueryError, relativeTime } from "~/components/mdm/common";
import DashboardReportsPanel from "~/components/dashboard/reports";
import { Button } from "~/components/ui/button";
import { enterpriseQueries } from "~/lib/enterprise";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";
import { routes } from "~/lib/routes";

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.dashboard(params.tenantId, params.dashboardId)),
    ]);
  },
};

/**
 * Reports are a subpage so the dashboard itself stays the widgets the team
 * added. The dashboard remains the report definition: this page only manages
 * schedules, recipients and the downloads of the same live view.
 */
export default function DashboardReportsPage() {
  const params = useParams();
  const dashboard = useQuery(() =>
    enterpriseQueries.dashboard(params.tenantId, params.dashboardId),
  );
  const name = () => dashboard.data?.name ?? "this dashboard";

  return (
    <Page class="gap-5">
      <Button
        as="a"
        variant="ghost"
        size="sm"
        class="-ml-2 self-start"
        href={routes.tenant(params.tenantId).dashboard(params.dashboardId!)}
      >
        ← {name()}
      </Button>

      <PageHeader
        eyebrow="Reports"
        title={dashboard.data ? `Reports for ${name()}` : "Dashboard reports"}
        description="Email this dashboard on a schedule or download a snapshot now. The live widgets and the emailed copy are the same view."
      />

      <QueryError error={dashboard.error} onRetry={() => void dashboard.refetch()} />

      <Show when={dashboard.data}>
        <DashboardReportsPanel tenantId={params.tenantId!} dashboardId={params.dashboardId!} />
        <p class="text-xs text-muted-foreground">
          Reports belong to this dashboard.
          <Show when={dashboard.data?.updatedAt}>
            {" "}
            The dashboard was last updated {relativeTime(dashboard.data!.updatedAt)}.
          </Show>
        </p>
      </Show>
    </Page>
  );
}

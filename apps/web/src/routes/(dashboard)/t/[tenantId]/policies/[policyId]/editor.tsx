import type { RoutePreloadFuncArgs } from "@solidjs/router";
import PolicyConfigurationEditor from "~/components/mdm/editor";
import { enterpriseQueries } from "~/lib/enterprise";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () =>
        queryClient.ensureQueryData(
          enterpriseQueries.item(params.tenantId, "policy", params.policyId),
        ),
      () => queryClient.ensureQueryData(enterpriseQueries.policyVariables(params.tenantId)),
    ]);
  },
};

export default function PolicyEditorPage() {
  return <PolicyConfigurationEditor />;
}

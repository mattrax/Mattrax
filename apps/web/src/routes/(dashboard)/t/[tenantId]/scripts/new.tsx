import { type RoutePreloadFuncArgs, useParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { Show } from "solid-js";
import { Page, PageHeader, Panel } from "~/components/mdm/common";
import { ScriptEditor, type ScriptDraftValues } from "~/components/mdm/script-editor";
import { toast } from "~/components/toast";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import { preloadPage } from "~/lib/page-data";
import { AccessDenied, useCan } from "~/lib/permissions";
import { queryClient } from "~/lib/query-client";

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.scripts(params.tenantId)),
    ]);
  },
};

export default function NewScriptPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCan();
  const scripts = useQuery(() => enterpriseQueries.scripts(params.tenantId));

  const create = useMutation(() => ({
    mutationFn: (values: ScriptDraftValues) =>
      enterprise.createScript(params.tenantId, {
        ...values,
        description: values.description || null,
        environment: values.environment.filter((entry) => entry.name.trim()),
      }),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.scripts(params.tenantId) });
      toast.success("Script created", {
        description: "Assign it to devices or groups to deliver it.",
      });
      navigate(`/t/${params.tenantId}/scripts/${id}`);
    },
  }));

  return (
    <Show when={can("scripts.write")} fallback={<AccessDenied />}>
      <Page>
        <PageHeader
          eyebrow="Scripts"
          title="New script"
          description="Scripts execute arbitrary code on managed devices. Saving requires a fresh confirmation."
        />
        <Show when={scripts.data && !scripts.data.enabled}>
          <Panel title="Scripts are disabled">
            <p class="text-[12.5px] text-muted-foreground">
              Enable scripts on the Scripts page before creating one.
            </p>
          </Panel>
        </Show>
        <Panel title="Script">
          <ScriptEditor
            submitLabel="Create script"
            saving={create.isPending}
            error={create.error}
            disabled={scripts.data?.enabled === false}
            onSubmit={(values) => create.mutate(values)}
            onCancel={() => navigate(`/t/${params.tenantId}/scripts`)}
          />
        </Panel>
      </Page>
    </Show>
  );
}

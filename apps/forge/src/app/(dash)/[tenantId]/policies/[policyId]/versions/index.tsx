import { For } from "solid-js";
import { z } from "zod";
import { RouterOutput } from "~/api";
import { useTenantContext } from "~/app/(dash)/[tenantId]";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Textarea,
} from "~/components/ui";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";

export default function Page() {
  const tenant = useTenantContext();
  const params = useZodParams({
    policyId: z.string(),
  });
  const versions = trpc.policy.getVersions.useQuery(() => ({
    tenantId: tenant.activeTenant.id,
    policyId: params.policyId,
  }));
  const createVersion = trpc.policy.createVersion.useMutation();

  // TODO: Render a list of the policies and their content
  // TODO: Upload policy from disk

  // TODO: Track deploys in UI

  return (
    <div class="flex flex-col space-y-2">
      <h2 class="text-2xl font-bold mb-4">Versions</h2>
      <For each={versions.data ?? []}>
        {(version, i) => (
          <div class="flex flex-col space-y-2">
            <VersionRow version={version} />
            {i() === versions.data!.length && (
              <div class="flex w-full justify-center select-none disabled:opacity-70">
                <IconPhArrowCircleDownBold class="text-2xl transition" />
              </div>
            )}
          </div>
        )}
      </For>
      <div class="flex w-full justify-center select-none disabled:opacity-70">
        <IconPhPlusCircleBold class="text-2xl transition" />
      </div>
    </div>
  );
}

function VersionRow(props: {
  version: RouterOutput["policy"]["getVersions"][number];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>abc</CardTitle>
      </CardHeader>
      <CardContent>
        <div>{props.version.id}</div>
      </CardContent>
    </Card>
  );
}

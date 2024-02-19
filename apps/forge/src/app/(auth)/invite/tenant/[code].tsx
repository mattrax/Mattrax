import { Show, Suspense, createResource } from "solid-js";
import { z } from "zod";
import {
  Card,
  CardDescription,
  CardHeader,
  buttonVariants,
} from "~/components/ui";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";

export default function Page() {
  const params = useZodParams({ code: z.string() });

  const acceptTenantInvite =
    trpc.tenant.administrators.acceptInvite.useMutation();

  const [tenant] = createResource(
    async () => await acceptTenantInvite.mutateAsync(params)
  );

  return (
    <Suspense fallback="Loading...">
      <Show when={tenant()}>
        {(tenant) => (
          <Card>
            <CardHeader>
              <CardDescription>
                You are now an administrator of <b>{tenant().name}</b>.
              </CardDescription>
            </CardHeader>
            <a class={buttonVariants()} href={`/${tenant().id}`}>
              Go to tenant
            </a>
          </Card>
        )}
      </Show>
    </Suspense>
  );
}

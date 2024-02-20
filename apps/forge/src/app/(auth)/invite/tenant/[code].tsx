import { Show, Suspense, createResource } from "solid-js";
import { z } from "zod";
import { useAuthContext } from "~/app/(dash)";
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

  const acceptTenantInvite = trpc.tenant.admins.acceptInvite.useMutation();

  const trpcCtx = trpc.useContext();
  const [tenant] = createResource(async () => {
    const tenant = await acceptTenantInvite.mutateAsync(params);
    await trpcCtx.auth.me.refetch();
    return tenant;
  });

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

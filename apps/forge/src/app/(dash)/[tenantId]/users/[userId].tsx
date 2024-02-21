import { z } from "zod";
import { toast } from "solid-sonner";
import { A, Navigate, useResolvedPath } from "@solidjs/router";
import { Show, createEffect } from "solid-js";

import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";
import { useTenantContext } from "../../[tenantId]";
import { AUTH_PROVIDER_DISPLAY, userAuthProviderUrl } from "~/lib/values";
import { Badge, buttonVariants } from "~/components/ui";
import { Breadcrumb, createBreadcrumb } from "~/components/Breadcrumbs";

function UserNotFound() {
  toast.error("User not found");
  // necessary since '..' adds trailing slash -_-
  return <Navigate href="../../users" />;
}

function Bruh() {
  const matches = useResolvedPath(() => "");

  createEffect(() => console.log(matches()));

  return null;
}

export default function Page() {
  const tenant = useTenantContext();
  const params = useZodParams({
    userId: z.string(),
  });
  const user = trpc.user.get.useQuery(() => ({
    tenantId: tenant.activeTenant.id,
    id: params.userId,
  }));

  return (
    <Show when={user.data !== undefined}>
      <Show when={user.data} fallback={<UserNotFound />}>
        {(user) => {
          createBreadcrumb(
            <A class="flex flex-row items-center gap-2" href="">
              <Badge variant="outline">User</Badge>
              {user().name}
            </A>
          );

          return (
            <div class="px-4 py-8 w-full max-w-5xl mx-auto flex flex-col gap-4">
              <div class="flex flex-row justify-between">
                <div>
                  <h1 class="text-3xl font-bold">{user().name}</h1>
                  <span class="block mt-1 text-gray-700 text-sm">
                    {user().email}
                  </span>
                </div>
                <a
                  class={buttonVariants({ variant: "link" })}
                  target="_blank"
                  href={
                    userAuthProviderUrl(
                      user().provider.variant,
                      user().provider.remoteId,
                      user().providerResourceId
                    )!
                  }
                >
                  {AUTH_PROVIDER_DISPLAY[user().provider.variant]}
                  <IconPrimeExternalLink class="inline ml-1" />
                </a>
                {/* <AddMemberSheet groupId={routeParams.groupId}>
                <As component={Button}>Add Members</As>
              </AddMemberSheet> */}
              </div>
            </div>
          );
        }}
      </Show>
    </Show>
  );
}

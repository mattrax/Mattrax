import { A } from "@solidjs/router";
import { type JSX, ParentProps, Show, Suspense } from "solid-js";
import { z } from "zod";

import { trpc } from "~/lib";
import { useTenantContext } from "~/app/(dash)/[tenantId]";
import { useZodParams } from "~/lib/useZodParams";

// TODO: If the policy or version is not found redirect back to `/policies`

function useParams() {
  return useZodParams({
    policyId: z.string(),
  });
}

export default function Page(props: ParentProps) {
  const params = useParams();

  const tenant = useTenantContext();
  const policy = trpc.policy.get.useQuery(() => ({
    policyId: params.policyId,
    tenantId: tenant.activeTenant.id,
  }));

  return (
    <Suspense>
      <Show when={policy.data}>
        {(policy) => {
          // const deletePolicy = trpc.policy.delete.useMutation(() => ({
          //   onSuccess: async () => {
          //     await startTransition(() => navigate(`..`));
          //     toast.success("Policy deleted");
          //   },
          // }));

          // const [policyState, setPolicyState] =
          //   createSignal<TempPolicyState>("unchanged"); // TODO: From backend

          // TODO: Bring back `OutlineLayout` but with a region for actions
          return (
            <div class="px-4 py-8 w-full max-w-6xl mx-auto space-y-4">
              <div class="flex flex-row items-center justify-between">
                <div class="flex mb-4">
                  <h1 class="text-3xl font-bold text-center">
                    {policy().name}
                  </h1>
                  {/* // TODO: Get from backend */}
                  <div class="flex-1 pl-3">
                    <div class="h-full flex justify-center items-center content-center">
                      {/* {policyState() === "changed" && (
                      <Badge
                        onClick={() => {
                          // TODO: Open the deploy dialog
                          alert("TODO");
                        }}
                      >
                        Changes Pending
                      </Badge>
                    )}
                    {policyState() === "deploying" && (
                      <Badge
                        onClick={() => navigate("./versions")}
                        class="bg-brand animate-pulse"
                      >
                        Deploy in Progress
                      </Badge>
                    )} */}
                    </div>
                  </div>
                </div>

                <div class="flex space-x-4">
                  {/* <PolicyVersionSwitcher /> */}
                  {/* <DeployButton
                  policyState={policyState}
                  setPolicyState={setPolicyState}
                />
                <ConfirmDialog>
                  {(confirm) => (
                    <ActionsDropdown
                      policyId={params.policyId}
                      onSelect={async (item) => {
                        switch (item) {
                          case "delete":
                            confirm({
                              title: "Delete Policy?",
                              description:
                                "This will permanently delete the policy and cannot be undone.",
                              action: `Delete '${policy().name}'`,
                              inputText: policy().name,
                              async onConfirm() {
                                await deletePolicy.mutateAsync({
                                  policyId: params.policyId,
                                  tenantId: tenant.activeTenant.id,
                                });
                              },
                            });

                            break;
                        }
                      }}
                    >
                      <As
                        component={Button}
                        variant="outline"
                        class="select-none"
                      >
                        Actions
                      </As>
                    </ActionsDropdown>
                  )}
                </ConfirmDialog> */}
                </div>
              </div>
              {/* TODO: Description + editable name */}
              {/* TODO: Area for assigning it to devices/users */}

              <div class="flex h-full mb-4">
                <nav class="flex flex-col min-w-48">
                  <ul role="list" class="flex flex-1 flex-col gap-y-7">
                    <li>
                      <ul role="list" class="space-y-1">
                        <SidebarItem href="" icon={IconPhGearDuotone}>
                          General
                        </SidebarItem>
                        <SidebarItem href="versions" icon={IconPhStackDuotone}>
                          Versions
                        </SidebarItem>
                        <SidebarItem href="scope" icon={IconPhSelectionDuotone}>
                          Scope
                        </SidebarItem>
                      </ul>
                    </li>
                  </ul>
                </nav>
                <div class="flex-1">
                  <main class="px-4 w-full h-full">{props.children}</main>
                </div>
              </div>
            </div>
          );
        }}
      </Show>
    </Suspense>
  );
}

const SidebarItem = (
  props: ParentProps & {
    href: string;
    disabled?: boolean;
    icon?: (props: JSX.SvgSVGAttributes<SVGSVGElement>) => JSX.Element;
  }
) => (
  <A
    end
    href={props.href}
    class="block group rounded-md p-2 text-sm leading-6 font-semibold"
    activeClass="bg-gray-50 text-brand active-page"
    inactiveClass="text-gray-700 hover:text-brand hover:bg-gray-50 inactive-page"
  >
    <div class="flex flex-row gap-3">
      {props.icon && (
        <props.icon
          class={
            "h-6 w-6 shrink-0 group-[.active-page]:text-brand group-[.inactive-page]:text-gray-400 group-[.inactive-page]:group-hover:text-brand"
          }
          aria-hidden="true"
        />
      )}
      {props.children}
    </div>
  </A>
);

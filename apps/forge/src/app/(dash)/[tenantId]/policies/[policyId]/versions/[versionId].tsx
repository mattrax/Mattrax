import { A, useNavigate, useParams as _useParams } from "@solidjs/router";
import {
  type JSX,
  ParentProps,
  Show,
  startTransition,
  createEffect,
  createSignal,
  Accessor,
} from "solid-js";
import { As } from "@kobalte/core";
import { toast } from "solid-sonner";
import dayjs from "dayjs";
import { z } from "zod";

import { isDebugMode, trpc, untrackScopeFromSuspense } from "~/lib";
import {
  Button,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
  DialogDescription,
  DialogRoot,
  Textarea,
  createController,
} from "~/components/ui";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import { useTenantContext } from "~/app/(dash)/[tenantId]";
import { useZodParams } from "~/lib/useZodParams";
import { Breadcrumb, createBreadcrumb } from "~/components/Breadcrumbs";

// TODO: If the policy or version is not found redirect back to `/policies`

function useParams() {
  return useZodParams({
    policyId: z.string(),
    versionId: z.string(),
  });
}

export default function Page(props: ParentProps) {
  const navigate = useNavigate();
  const params = useParams();

  const tenant = useTenantContext();
  const policy = trpc.policy.get.useQuery(() => ({
    policyId: params.policyId,
    tenantId: tenant.activeTenant.id,
  }));

  return (
    <Show when={policy.data}>
      {(policy) => {
        const deletePolicy = trpc.policy.delete.useMutation(() => ({
          onSuccess: async () => {
            await startTransition(() => navigate(`..`));
            toast.success("Policy deleted");
          },
        }));

        const [policyState, setPolicyState] =
          createSignal<TempPolicyState>("unchanged"); // TODO: From backend

        createBreadcrumb(
          <A class="flex flex-row items-center gap-2" href="">
            <Badge>Policy</Badge>
            {policy().name}
          </A>
        );

        // TODO: Bring back `OutlineLayout` but with a region for actions
        return (
          <div class="px-4 py-8 w-full max-w-6xl mx-auto space-y-4">
            <div class="flex flex-row items-center justify-between">
              <div class="flex mb-4">
                <h1 class="text-3xl font-bold text-center">{policy().name}</h1>
                {/* // TODO: Get from backend */}
                <div class="flex-1 pl-3">
                  <div class="h-full flex justify-center items-center content-center">
                    {policyState() === "changed" && (
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
                    )}
                  </div>
                </div>
              </div>

              <div class="flex space-x-4">
                <PolicyVersionSwitcher
                  policyId={params.policyId}
                  versionId={params.versionId}
                />
                <DeployButton
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
                </ConfirmDialog>
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
                      <SidebarItem href="builder" icon={IconPhStackDuotone}>
                        Builder
                      </SidebarItem>
                      <SidebarItem
                        href="versions"
                        icon={IconPhSelectionDuotone}
                      >
                        Versions
                      </SidebarItem>
                      {isDebugMode() && (
                        <SidebarItem
                          href="debug"
                          icon={IconPhCookingPotDuotone}
                        >
                          Debug
                        </SidebarItem>
                      )}
                    </ul>
                  </li>
                </ul>
              </nav>
              <div class="flex-1">
                <main class="px-4 w-full h-full">
                  {props.children}
                  <Button
                    onClick={() => setPolicyState("changed")}
                    class="mt-4"
                  >
                    I changed something in the policy
                  </Button>
                </main>
              </div>
            </div>
          </div>
        );
      }}
    </Show>
  );
}

function PolicyVersionSwitcher(props: { policyId: string; versionId: string }) {
  const tenant = useTenantContext();
  const versions = trpc.policy.getVersions.useQuery(() => ({
    policyId: props.policyId,
    tenantId: tenant.activeTenant.id,
  }));

  const data = untrackScopeFromSuspense(() => versions.data);
  const isPending = untrackScopeFromSuspense(() => versions.isPending);

  const activeVersion = () => data()?.find((v) => v.id === props.versionId);

  return (
    <Select
      options={data() || []}
      placeholder="Select a fruit…"
      itemComponent={(props) => (
        <SelectItem item={props.item}>
          {dayjs(props.item.rawValue.createdAt).fromNow()}
        </SelectItem>
      )}
      disabled={isPending() || !activeVersion()}
      multiple={false}
      disallowEmptySelection={true}
      value={activeVersion()}
      onChange={(v) => {
        // TODO: Finish this
        // alert("TODO");
      }}
    >
      <SelectTrigger aria-label="Fruit" class="w-[180px]">
        <SelectValue<string>>{(state) => state.selectedOption()}</SelectValue>
      </SelectTrigger>
      <SelectContent />
    </Select>
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

function ActionsDropdown(
  props: ParentProps & { onSelect(item: "delete"): void; policyId: string }
) {
  const navigate = useNavigate();
  const tenant = useTenantContext();

  const duplicatePolicy = trpc.policy.duplicate.useMutation(() => ({
    onSuccess: async (policyId) => {
      await startTransition(() => navigate(`../${policyId}`));
      toast.success("Policy duplicated");
    },
  }));

  return (
    <DropdownMenu placement="bottom-end">
      <DropdownMenuTrigger asChild>{props.children}</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem
          disabled={duplicatePolicy.isPending}
          onSelect={() =>
            duplicatePolicy.mutate({
              policyId: props.policyId,
              tenantId: tenant.activeTenant.id,
            })
          }
        >
          Duplicate
        </DropdownMenuItem>
        {/* TODO: Fix this modal */}
        <DropdownMenuItem onSelect={() => props.onSelect("delete")}>
          Delete
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => alert("TODO")} disabled>
          Export
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type TempPolicyState = "unchanged" | "changed" | "deploying" | "deployed";

function DeployButton(props: {
  policyState: Accessor<TempPolicyState>;
  setPolicyState: (state: TempPolicyState) => void;
}) {
  const navigate = useNavigate();
  const controller = createController();
  const [page, setPage] = createSignal(0);
  // TODO: Dropdown, quick deploy or staged rollout

  createEffect(() => controller.open() && setPage(0));

  return (
    <DialogRoot controller={controller}>
      <DialogTrigger asChild>
        <As component={Button} disabled={props.policyState() !== "changed"}>
          Deploy
        </As>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deploy changes</DialogTitle>
          <DialogDescription>
            Would you like to deploy the following changes to <b>0</b> devices?
          </DialogDescription>
        </DialogHeader>

        {page() === 0 && (
          <>
            <ul class="list-disc pl-4 text-md leading-none tracking-tight text-semibold flex flex-col space-y-2">
              <li>
                <p>Modified script 'Punish bad users'</p>
              </li>
              <li>
                <p>Added Slack configuration</p>
              </li>
            </ul>

            <Button type="button" onClick={() => setPage(1)}>
              Confirm Changes
            </Button>
          </>
        )}
        {page() === 1 && (
          <>
            <Textarea placeholder="Provide some context to your team!" />
            <Button
              variant="destructive"
              onClick={() => {
                // alert("TODO");
                props.setPolicyState("deploying");
                controller.setOpen(false);
                navigate("versions");
              }}
            >
              Deploy to {5} devices
            </Button>
          </>
        )}
      </DialogContent>
    </DialogRoot>
  );
}

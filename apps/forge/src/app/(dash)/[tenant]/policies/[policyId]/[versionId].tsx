import { A, useNavigate, useParams } from "@solidjs/router";
import {
  type JSX,
  ParentProps,
  Show,
  startTransition,
  useTransition,
  createEffect,
} from "solid-js";
import { isDebugMode, trpc } from "~/lib";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui";
import { As } from "@kobalte/core";
import { toast } from "solid-sonner";
import { ConfirmDialog } from "~/components/ConfirmDialog";
import dayjs from "dayjs";
import { Badge } from "~/components/ui/badge";

// TODO: If the policy or version is not found redirect back to `/policies`

export default function Page(props: ParentProps) {
  const navigate = useNavigate();
  const [transitionPending] = useTransition();
  const params = useParams<{ policyId: string }>();

  const policy = trpc.policy.get.useQuery(() => ({
    policyId: params.policyId!,
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

        // TODO: Bring back `OutlineLayout` but with a region for actions
        return (
          <div class="px-4 py-8 w-full max-w-6xl mx-auto space-y-4">
            <div class="flex flex-row items-center justify-between">
              <div class="flex mb-4">
                <h1 class="text-3xl font-bold text-center">{policy().name}</h1>
                {/* // TODO: Get from backend */}
                <div class="flex-1 pl-3">
                  <div class="h-full flex justify-center items-center content-center">
                    <Badge onClick={() => navigate("./versions")}>
                      Deploy in Progress
                    </Badge>
                  </div>
                </div>
              </div>

              <div class="flex space-x-4">
                {!transitionPending() && <PolicyVersionSwitcher />}

                {/* // TODO: Dropdown, quick deploy or staged rollout */}
                <Button onClick={() => alert("TODO")}>Deploy</Button>
                <ConfirmDialog>
                  {(confirm) => (
                    <ActionsDropdown
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
                <main class="px-4 w-full h-full">{props.children}</main>
              </div>
            </div>
          </div>
        );
      }}
    </Show>
  );
}

function PolicyVersionSwitcher() {
  const params = useParams<{ policyId: string; versionId: string }>();
  const versions = trpc.policy.getVersions.useQuery(() => ({
    policyId: params.policyId!,
  }));

  createEffect(() => console.log(versions.data, activeVersion()));

  const activeVersion = () =>
    versions.data?.find((v) => v.id === params.versionId);

  return (
    <Select
      options={versions.data || []}
      placeholder="Select a fruit…"
      itemComponent={(props) => (
        <SelectItem item={props.item}>
          {dayjs(props.item.rawValue.createdAt).fromNow()}
        </SelectItem>
      )}
      disabled={versions.isPending || !activeVersion()}
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
  props: ParentProps & { onSelect(item: "delete"): void }
) {
  const navigate = useNavigate();
  const params = useParams<{ policyId: string }>();

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
          onSelect={() => duplicatePolicy.mutate({ policyId: params.policyId })}
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

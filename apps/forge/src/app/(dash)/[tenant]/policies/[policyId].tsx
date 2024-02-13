import { A, useNavigate, useParams } from "@solidjs/router";
import { type JSX, For, ParentProps, Show, startTransition } from "solid-js";
import { trpc } from "~/lib";
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
import { OutlineLayout } from "../OutlineLayout";

// TODO: If the policy is not found redirect back to `/policies`

const navigation = [
  { name: "General", href: "", icon: IconPhGearDuotone },
  {
    name: "Restrictions",
    href: "restrictions",
    icon: IconPhLockDuotone,
  },
  {
    name: "Script",
    href: "scripts",
    icon: IconPhClipboardDuotone,
  },
  {
    // TODO: Only for Mattrax employee's
    name: "Debug",
    href: "debug",
    icon: IconPhCookingPotDuotone,
  },
];

export default function Page(props: ParentProps) {
  const navigate = useNavigate();
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
              <h1 class="text-3xl font-bold mb-4">{policy().name}</h1>
              <div class="flex space-x-4">
                {/* // TODO: Version management */}
                {/* // TODO: Require at least one item to be selected */}
                <Select
                  // value={value()}
                  // onChange={setValue}
                  options={[
                    "Apple",
                    "Banana",
                    "Blueberry",
                    "Grapes",
                    "Pineapple",
                  ]}
                  placeholder="Select a fruit…"
                  itemComponent={(props) => (
                    <SelectItem item={props.item}>
                      {props.item.rawValue}
                    </SelectItem>
                  )}
                >
                  <SelectTrigger aria-label="Fruit" class="w-[180px]">
                    <SelectValue<string>>
                      {(state) => state.selectedOption()}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent />
                </Select>

                {/* <Progress
                  value={3}
                  minValue={0}
                  maxValue={10}
                  getValueLabel={({ value, max }) =>
                    `${value} of ${max} devices completed`
                  }
                  class="w-[300px] space-y-1"
                >
                  <div class="flex justify-between">
                    <ProgressLabel>Deploying...</ProgressLabel>
                    <ProgressValueLabel />
                  </div>
                </Progress> */}
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
                      <As component={Button} variant="outline">
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
                      <div class="text-xs font-semibold leading-6 text-brand">
                        Standard
                      </div>
                      <For each={navigation}>
                        {(item) => (
                          <SidebarItem href={item.href} icon={item.icon}>
                            {item.name}
                          </SidebarItem>
                        )}
                      </For>
                    </ul>
                  </li>
                  <li>
                    <ul role="list" class="space-y-1">
                      <div class="text-xs font-semibold leading-6 text-brand pt-2">
                        3rd Party Software
                      </div>

                      <li>
                        <SidebarItem href="chrome" icon={IconLogosChrome}>
                          Chrome
                        </SidebarItem>
                        <SidebarItem href="slack" icon={IconLogosSlackIcon}>
                          Slack
                        </SidebarItem>
                        {/* // TODO: Use a proper Office suite icon */}
                        <SidebarItem
                          href="office"
                          icon={IconLogosMicrosoftIcon}
                        >
                          Microsoft Office
                        </SidebarItem>
                      </li>
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

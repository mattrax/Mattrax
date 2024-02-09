import { A, useNavigate, useParams } from "@solidjs/router";
import {
  type JSX,
  For,
  Match,
  ParentProps,
  Show,
  startTransition,
} from "solid-js";
import { trpc } from "~/lib";
import {
  Button,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogRoot,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui";
import { As } from "@kobalte/core";
import { toast } from "solid-sonner";
import { createStore } from "solid-js/store";
import { Switch } from "solid-js";
import { Form, createZodForm } from "~/components/forms";
import { z } from "zod";
import { InputField } from "~/components/forms/InputField";

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

        const [modal, setModal] = createStore<{
          open: boolean;
          type: "delete";
        }>({
          open: false,
          type: "delete",
        });

        // TODO: Bring back `OutlineLayout` but with a region for actions
        return (
          <div class="flex-1 px-4 py-8">
            <DialogRoot
              open={modal.open}
              setOpen={() => setModal("open", false)}
            >
              <DialogContent>
                <Switch>
                  <Match when={modal.type === "delete" && modal}>
                    {(_) => {
                      const form = createZodForm({
                        schema: z.object({ input: z.string() }),
                        async onSubmit() {
                          await deletePolicy.mutateAsync({
                            policyId: params.policyId,
                          });
                        },
                      });

                      return (
                        <>
                          <DialogHeader>
                            <DialogTitle>Delete Policy?</DialogTitle>
                            <DialogDescription>
                              This will permanently delete the policy and cannot
                              be undone.
                            </DialogDescription>
                          </DialogHeader>

                          <p class="text-muted-foreground text-sm">
                            To confirm, type <b>{policy().name}</b> in the box
                            below
                          </p>
                          <Form form={form}>
                            <div class="space-y-4">
                              <InputField form={form} name="input" />
                              <form.Subscribe>
                                {(form) => (
                                  <Button
                                    type="submit"
                                    variant="destructive"
                                    disabled={
                                      form().values.input !== policy().name
                                    }
                                  >
                                    Delete '{policy().name}'
                                  </Button>
                                )}
                              </form.Subscribe>
                            </div>
                          </Form>
                        </>
                      );
                    }}
                  </Match>
                </Switch>
              </DialogContent>
            </DialogRoot>
            <div class="flex justify-between">
              <h1 class="text-3xl font-bold mb-4">{`Policy - ${
                policy().name
              }`}</h1>
              <div class="flex space-x-4">
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
                <ActionsDropdown
                  onSelect={(item) => {
                    switch (item) {
                      case "delete":
                        return setModal({ open: true, type: "delete" });
                    }
                  }}
                >
                  <As component={Button} variant="outline">
                    Actions
                  </As>
                </ActionsDropdown>
              </div>
            </div>

            {/* TODO: Description + editable name */}
            {/* TODO: Area for assigning it to devices/users */}

            <div class="flex h-full mb-4">
              <div class="lg:inset-y-0 lg:z-50 lg:flex lg:w-72 lg:flex-col">
                <div class="flex grow flex-col gap-y-5 overflow-y-auto border-r border-gray-200 bg-white px-6 pb-4">
                  <nav class="flex flex-1 flex-col">
                    <ul role="list" class="flex flex-1 flex-col gap-y-7">
                      <li>
                        <ul role="list" class="-mx-2 space-y-1">
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
                        <ul role="list" class="-mx-2 space-y-1">
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
                </div>
              </div>
              <div class="w-full">
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
    icon?: (props: JSX.SvgSVGAttributes<SVGSVGElement>) => JSX.Element;
  }
) => (
  <A
    end
    href={props.href}
    class={"group flex gap-x-3 rounded-md p-2 text-sm leading-6 font-semibold"}
    activeClass="bg-gray-50 text-brand active-page"
    inactiveClass="text-gray-700 hover:text-brand hover:bg-gray-50 inactive-page"
  >
    {props.icon && (
      <props.icon
        class={
          "h-6 w-6 shrink-0 group-[.active-page]:text-brand group-[.inactive-page]:text-gray-400 group-[.inactive-page]:group-hover:text-brand"
        }
        aria-hidden="true"
      />
    )}
    {props.children}
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
        {/* <AreYouSureModal
                stringToType={policy.data?.name || ""}
                description=
                mutate={() =>

                }
              >
                <As component={DropdownMenuItem}>Delete</As>
              </AreYouSureModal> */}
        <DropdownMenuItem onClick={() => alert("TODO")} disabled>
          Export
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

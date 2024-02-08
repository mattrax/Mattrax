import { A, redirect, useParams } from "@solidjs/router";
import { For, ParentProps, Suspense, lazy } from "solid-js";
import { trpc } from "~/lib";
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui";
import { As } from "@kobalte/core";
import {
  Progress,
  ProgressLabel,
  ProgressValueLabel,
} from "~/components/ui/progress";

// TODO: If the policy is not found redirect back to `/policies`

const navigation = [
  { name: "General", href: "/", icon: IconPhGearDuotone },
  {
    name: "Restrictions",
    href: "/restrictions",
    icon: IconPhLockDuotone,
  },
  {
    name: "Script",
    href: "/scripts",
    icon: IconPhClipboardDuotone,
  },
];

export default function Page(props: ParentProps) {
  const params = useParams();
  if (!params.policyId) redirect("/"); // TODO: Use a tenant relative redirect instead
  const policy = trpc.policy.get.useQuery(() => ({
    policyId: params.policyId!,
  }));

  const href = (suffix: string) =>
    `/${params.tenant}/policies/${params.policyId}${suffix}`;

  // TODO: Bring back `OutlineLayout` but with a region for actions
  return (
    <div class="flex-1 px-4 py-8">
      <div class="flex justify-between">
        <h1 class="text-3xl font-bold mb-4">{`Policy - ${
          policy.data?.name || ""
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
          <DropdownMenu placement="bottom-end">
            <DropdownMenuTrigger asChild>
              <As component={Button} variant="outline">
                Actions
              </As>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => alert("TODO")}>
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => alert("TODO")}>
                Delete
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => alert("TODO")} disabled>
                Export
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
                    <For each={navigation}>
                      {(item) => (
                        <li>
                          <A
                            end
                            href={href(item.href)}
                            class={
                              "group flex gap-x-3 rounded-md p-2 text-sm leading-6 font-semibold"
                            }
                            activeClass="bg-gray-50 text-brand active-page"
                            inactiveClass="text-gray-700 hover:text-brand hover:bg-gray-50 inactive-page"
                          >
                            <item.icon
                              class={
                                "h-6 w-6 shrink-0 group-[.active-page]:text-brand group-[.inactive-page]:text-gray-400 group-[.inactive-page]:group-hover:text-brand"
                              }
                              aria-hidden="true"
                            />
                            {item.name}
                          </A>
                        </li>
                      )}
                    </For>
                  </ul>
                </li>
              </ul>
            </nav>
          </div>
        </div>
        <div class="w-full">
          <main class="p-4 w-full h-full">{props.children}</main>
        </div>
      </div>
    </div>
  );
}

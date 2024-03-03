import { As, DropdownMenu as KDropdownMenu } from "@kobalte/core";
import { For, Suspense } from "solid-js";

import {
  Button,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  createController,
} from "~/components/ui";
import { CreateTenantDialog } from "./CreateTenantDialog";

// TODO: When shrinking window and scrolling to move the trigger offscreen the popover comes with it. This is Kolate behavior but I don't like it.
// TODO: Transition on dropdown open/close

type Tenant = { id: string; name: string };
export type TenantSwitcherProps = {
  activeTenant: Tenant;
  tenants: Tenant[];
  refetchSession: () => Promise<void>;
  setActiveTenant: (id: string) => void;
};

export function TenantSwitcher(props: TenantSwitcherProps) {
  const controller = createController();

  return (
    <div class="relative inline-block text-left">
      <CreateTenantDialog {...props}>
        <DropdownMenu controller={controller} sameWidth>
          <DropdownMenuTrigger asChild>
            <As component={Button} variant="outline" class="space-x-3">
              {/* // TODO: Tooltip when truncated */}
              <span class="truncate">{props.activeTenant.name}</span>

              <KDropdownMenu.Icon>
                <IconPhCaretUpDown class="h-5 w-5 -mx-1" />
              </KDropdownMenu.Icon>
            </As>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <Suspense>
              <For each={props.tenants}>
                {(tenant) => (
                  <DropdownMenuItem
                    class={
                      "block px-4 py-2 text-sm text-left w-full truncate hover:bg-gray-200"
                    }
                    onSelect={() => props.setActiveTenant(tenant.id)}
                  >
                    {/* TODO: Use a link here instead of JS for accessibility */}
                    {tenant.name}
                  </DropdownMenuItem>
                )}
              </For>

              {props.tenants.length !== 0 && <DropdownMenuSeparator />}
            </Suspense>

            <DialogTrigger asChild>
              <As
                component={DropdownMenuItem}
                as="button"
                class={
                  "block px-4 py-2 text-sm text-left w-full hover:bg-gray-200 rounded-b-md"
                }
              >
                Create new tenant
              </As>
            </DialogTrigger>
          </DropdownMenuContent>
        </DropdownMenu>
      </CreateTenantDialog>
    </div>
  );
}

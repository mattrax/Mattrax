import { For, Suspense } from "solid-js";
import { As, DropdownMenu as KDropdownMenu } from "@kobalte/core";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DialogRoot,
  DialogTrigger,
  DialogContent,
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
    <div class="w-full relative inline-block text-left">
      {/* DialogRoot must be outside the dropdown menu so it's not unrendered when the menu is closed */}
      <DialogRoot>
        <DropdownMenu controller={controller} sameWidth>
          <DropdownMenuTrigger class="mt-1 inline-flex w-full justify-between rounded-md bg-brand-secondary text-white px-4 py-2 text-sm font-medium shadow-sm hover:bg-brand-tertiary focus:outline-none focus:ring-2 focus:ring-white disabled:opacity-80 disabled:cursor-not-allowed">
            {/* // TODO: Tooltip when truncated */}
            <span class="truncate">{props.activeTenant.name}</span>

            <KDropdownMenu.Icon>
              <IconPhArrowDownBold class="-mr-1 ml-2 h-5 w-5" />
            </KDropdownMenu.Icon>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <Suspense fallback={<></>}>
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

        <DialogContent>
          <CreateTenantDialog {...props} />
        </DialogContent>
      </DialogRoot>
    </div>
  );
}

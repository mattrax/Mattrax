import { DropdownMenu } from "@kobalte/core";
import { For } from "solid-js";
import { Tenant } from "~/utils/globalCtx";
import { Dialog, createDialogController } from "~/components/ui";
import { CreateTenantDialog } from "./CreateTenantDialog";

// TODO: When shrinking window and scrolling to move the trigger offscreen the popover comes with it. This is Kolate behavior but I don't like it.
// TODO: Transition on dropdown open/close

export type TenantSwitcherProps = {
  activeTenant: Tenant | null;
  tenants: Tenant[];
  refetchSession: () => Promise<void>;
  setActiveTenant: (id: string) => void;
};

export function TenantSwitcher(props: TenantSwitcherProps) {
  const controller = createDialogController();

  return (
    <div class="w-full relative inline-block text-left">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger class="mt-1 inline-flex w-full justify-between rounded-md bg-brand-secondary text-white px-4 py-2 text-sm font-medium shadow-sm hover:bg-brand-tertiary focus:outline-none focus:ring-2 focus:ring-white">
          {/* // TODO: Tooltip when truncated */}
          <span
            class="truncate"
            classList={{
              "opacity-90": props.activeTenant === undefined,
            }}
          >
            {props.activeTenant?.name || "Select a tenant"}
          </span>

          <DropdownMenu.Icon>
            <IconPhArrowDownBold class="-mr-1 ml-2 h-5 w-5" />
          </DropdownMenu.Icon>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content class="text-gray-700 bg-white text-left rounded-b-md right-0 z-10 w-56 divide-y-2 divide-gray-100 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
            <For each={props.tenants}>
              {(tenant) => (
                <DropdownMenu.Item
                  class={
                    "block px-4 py-2 text-sm text-left w-full truncate hover:bg-gray-200"
                  }
                  onSelect={() => props.setActiveTenant(tenant.id)}
                >
                  {tenant.name}
                </DropdownMenu.Item>
              )}
            </For>

            <DropdownMenu.Separator class="h-0.5 border-t-0 bg-neutral-100 opacity-100 dark:opacity-50" />

            <DropdownMenu.Item
              as="button"
              onSelect={() => controller.setOpen(true)}
              class={
                "block px-4 py-2 text-sm text-left w-full hover:bg-gray-200 rounded-b-md"
              }
            >
              Create new tenant
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <Dialog controller={controller}>
        <CreateTenantDialog {...props} />
      </Dialog>
    </div>
  );
}

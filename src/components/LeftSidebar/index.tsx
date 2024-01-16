import { useLocation } from "@solidjs/router";
import { For, JSX } from "solid-js";
import { TenantSwitcher } from "./TenantSwitcher";
import { Tenant } from "~/utils/globalCtx";

type NavbarItem = {
  icon: (props: { class: string }) => JSX.Element;
  title: string;
  href: string;
};

const items: NavbarItem[] = [
  {
    icon: IconPhHouseDuotone,
    title: "Dashboard",
    href: "/",
  },
  {
    icon: IconPhUserDuotone,
    title: "Users",
    href: "/users",
  },
  {
    icon: IconPhLaptopDuotone,
    title: "Devices",
    href: "/devices",
  },
  {
    icon: IconPhClipboardDuotone,
    title: "Policies",
    href: "/policies",
  },
  {
    icon: IconPhAppWindowDuotone,
    title: "Applications",
    href: "/apps",
  },
  {
    icon: IconPhBookDuotone,
    title: "Scripts",
    href: "/scripts",
  },
  {
    icon: IconPhBoundingBoxDuotone,
    title: "Groups",
    href: "/groups",
  },
  {
    icon: IconPhGearDuotone,
    title: "Settings",
    href: "/settings",
  },
];

export default function Component(props: {
  activeTenant: Tenant | null;
  tenants: Tenant[];
}): JSX.Element {
  const location = useLocation();

  const itemProps = (item: NavbarItem, activeClass: string) => {
    const isRouteActive =
      // "Dashboard" route is special as `/` (when no tenants) and `/:tenantId/` are both valid
      (item.href === "/" && location.pathname === "/") ||
      // All other routes are prefixed with the tenant.
      (props.activeTenant?.id !== undefined &&
        location.pathname === `/tenant/${props.activeTenant?.id}/${item.href}`);

    let href = props.activeTenant?.id
      ? `/tenant/${props.activeTenant?.id}${item.href}`
      : undefined;
    // Dashboard route is an exception
    if (!href && item.href === "/") href = "/"; // If a tenant is selected, this link will go to `/:tenantId/` instead.

    return {
      href,
      classList: {
        [activeClass]: isRouteActive,
        "cursor-not-allowed opacity-50": href === undefined,
      },
    };
  };

  return (
    <aside class="h-full w-64 flex flex-col" aria-label="Sidebar">
      <div class="h-28 bg-brand relative">
        {import.meta.env.MODE === "development" && (
          <div class="absolute inset-0 h-1.5 bg-orange-400"></div>
        )}

        <div class="absolute inset-0">
          <h1 class="pt-3 pb-1 text-white text-center text-4xl">MATTRAX</h1>
          <div class="mx-4">
            <TenantSwitcher
              activeTenant={props.activeTenant}
              tenants={props.tenants}
            />
          </div>
        </div>
      </div>

      <div class="flex-1 bg-brandDark text-white">
        <div class="flex-row space-y-1 mt-4 mx-3">
          <For each={items}>
            {(item) => (
              <a
                class="py-1.5 px-4 h-full w-full flex space-x-4 text-center align-middle rounded-lg"
                {...itemProps(item, "bg-brandDark-secondary")}
              >
                <span>
                  <item.icon class="h-full w-5 text-xl block" />
                </span>
                <p class="text-lg">{item.title}</p>
              </a>
            )}
          </For>
        </div>
      </div>
    </aside>
  );
}

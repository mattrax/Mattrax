import { A, useMatch, useResolvedPath } from "@solidjs/router";
import { For, JSX } from "solid-js";
import { TenantSwitcher, TenantSwitcherProps } from "./TenantSwitcher";
import { As, Tabs } from "@kobalte/core";

type NavbarItem = {
  icon: (props: { class: string }) => JSX.Element;
  title: string;
  href: string;
};

const items: NavbarItem[] = [
  {
    icon: IconPhHouseDuotone,
    title: "Dashboard",
    href: "",
  },
  {
    icon: IconPhUserDuotone,
    title: "Users",
    href: "users",
  },
  {
    icon: IconPhLaptopDuotone,
    title: "Devices",
    href: "devices",
  },
  {
    icon: IconPhClipboardDuotone,
    title: "Policies",
    href: "policies",
  },
  {
    icon: IconPhAppWindowDuotone,
    title: "Applications",
    href: "apps",
  },
  {
    icon: IconPhBoundingBoxDuotone,
    title: "Groups",
    href: "groups",
  },
  {
    icon: IconPhGearDuotone,
    title: "Settings",
    href: "settings",
  },
];

export default function Component(props: TenantSwitcherProps): JSX.Element {
  const path = useResolvedPath(() => "");
  const value = useMatch(() => `${path()}/*rest`);

  const tabValue = () => value()?.params.rest?.split("/")[0];

  console.log(tabValue());

  return (
    <>
      <div class="relative flex flex-row">
        <div class="flex flex-row items-center gap-2">
          <h1 class="px-3 py-1 text-white text-center text-3xl bg-brand rounded m-2">
            MATTRAX
          </h1>
          <TenantSwitcher {...props} />
          {import.meta.env.MODE === "development" && (
            <>
              <a
                class="bg-orange-500 px-3 py-1 rounded text-white"
                href="internal"
              >
                Internal
              </a>
              <button
                class="bg-orange-400 px-3 py-1 rounded text-white"
                onClick={() => {
                  alert(
                    `Debug mode ${
                      localStorage.getItem("debug") === "1"
                        ? "disabled"
                        : "enabled"
                    }!`
                  );
                  if (localStorage.getItem("debug") === "1") {
                    localStorage.removeItem("debug");
                  } else {
                    localStorage.setItem("debug", "1");
                  }
                  globalThis.location.reload();
                }}
              >
                Debug
              </button>
            </>
          )}
        </div>
      </div>

      <nav class="text-white sticky border-b border-gray-300 top-0 z-10 bg-white">
        <Tabs.Root
          value={tabValue()}
          class="mx-2 relative"
          onChange={(c) => console.log(c)}
        >
          <Tabs.List class="flex flex-row">
            <For each={items}>
              {(item) => (
                <Tabs.Trigger asChild value={item.href}>
                  <As
                    component={A}
                    end={item.href === ""}
                    href={item.href}
                    activeClass="text-black selected"
                    inactiveClass="text-gray-500"
                    class="py-2 flex text-center align-middle transition duration-[16ms] relative group"
                  >
                    <div class="text-sm hover:bg-black/5 hover:text-black rounded px-3 py-1.5">
                      {item.title}
                    </div>
                  </As>
                </Tabs.Trigger>
              )}
            </For>
            <Tabs.Indicator class="absolute transition-all duration-200 -bottom-px flex flex-row px-2 h-[2px]">
              <div class="bg-brand flex-1" />
            </Tabs.Indicator>
          </Tabs.List>
        </Tabs.Root>
      </nav>
    </>
  );
}

import { A } from "@solidjs/router";
import { For, JSX } from "solid-js";
import { TenantSwitcher, TenantSwitcherProps } from "./TenantSwitcher";

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

      <div class="text-white sticky border-b border-gray-300 top-0 z-10 bg-white">
        <div class="flex flex-row px-2">
          <For each={items}>
            {(item) => (
              <A
                end={item.href === ""}
                href={item.href}
                activeClass="text-black selected"
                inactiveClass="text-gray-500"
                class="py-2 flex text-center align-middle transition duration-[16ms] relative group"
              >
                <div class="text-sm hover:bg-black/5 hover:text-black rounded px-3 py-1.5">
                  {item.title}
                </div>
                <div class="absolute h-[2px] left-1.5 right-1.5 -bottom-px mt-auto bg-brand hidden group-[.selected]:block" />
              </A>
            )}
          </For>
        </div>
      </div>
    </>
  );
}

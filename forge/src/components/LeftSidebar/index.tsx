import { A, useNavigate } from "@solidjs/router";
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
  const navigate = useNavigate();

  return (
    <aside class="shrink-0 h-full w-64 flex flex-col" aria-label="Sidebar">
      <div class="h-28 bg-brand relative">
        {import.meta.env.MODE === "development" && (
          <div class="absolute insert-0 h-1.5 flex z-10 w-full">
            <div
              class="bg-orange-500 w-1/2"
              onClick={() => navigate("/internal")}
            ></div>
            <div
              class="bg-orange-400 w-1/2"
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
            ></div>
          </div>
        )}

        <div class="absolute inset-0">
          <h1 class="pt-3 pb-1 text-white text-center text-4xl">MATTRAX</h1>
          <div class="mx-4">
            <TenantSwitcher {...props} />
          </div>
        </div>
      </div>

      <div class="flex-1 bg-brandDark text-white">
        <div class="flex-row space-y-1 mt-4 mx-3">
          <For each={items}>
            {(item) => (
              <A
                end={item.href === ""}
                href={item.href}
                activeClass="bg-brandDark-secondary"
                inactiveClass="hover:bg-white/10"
                class="py-1.5 px-4 h-full w-full flex space-x-4 text-center align-middle rounded-lg transition duration-[16ms]"
              >
                <span>
                  <item.icon class="h-full w-5 text-xl block" />
                </span>
                <p class="text-lg">{item.title}</p>
              </A>
            )}
          </For>
        </div>
      </div>
    </aside>
  );
}

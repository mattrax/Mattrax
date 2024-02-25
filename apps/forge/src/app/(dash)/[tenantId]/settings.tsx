import { type JSX, For, ParentProps } from "solid-js";

import { A } from "@solidjs/router";

const navigation = [
  { name: "General", href: "" },
  { name: "Administrators", href: "administrators" },
  { name: "Identity Provider", href: "identity-provider" },
  { name: "Biling", href: "billing" },
];

export default function Layout(props: ParentProps) {
  return (
    <>
      <h1 class="w-full relative max-w-6xl mx-auto pt-8 pb-4 text-3xl font-bold ">
        Tenant Settings
      </h1>
      <div class="flex flex-row flex-1 w-full relative max-w-6xl mx-auto">
        <nav class="sticky top-0 w-44 flex flex-col gap-y-5 bg-white pt-4 pl-4">
          <ul role="list" class="space-y-1">
            <For each={navigation}>
              {(item) => (
                <SidebarItem href={item.href}>{item.name}</SidebarItem>
              )}
            </For>
          </ul>
        </nav>
        <main class="flex-1 overflow-y-auto px-4 pt-4">{props.children}</main>
      </div>
    </>
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
    <div>
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

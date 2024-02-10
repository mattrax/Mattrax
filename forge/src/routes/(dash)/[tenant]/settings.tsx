import { type JSX, For, ParentProps } from "solid-js";

import { OutlineLayout } from "./OutlineLayout";
import { A } from "@solidjs/router";

const navigation = [
  { name: "General", href: "" },
  { name: "Administrators", href: "administrators" },
  { name: "Domains", href: "domains" },
  { name: "Biling", href: "billing" },
];

export default function Layout(props: ParentProps) {
  return (
    <OutlineLayout title="Settings">
      <div class="flex flex-row flex-1 space-x-4 w-full relative overflow-hidden flex-1">
        <nav class="sticky top-0 w-44 flex flex-col gap-y-5 bg-white">
          <ul role="list" class="space-y-1">
            <For each={navigation}>
              {(item) => (
                <SidebarItem href={item.href}>{item.name}</SidebarItem>
              )}
            </For>
          </ul>
        </nav>
        <main class="flex-1 overflow-y-auto">{props.children}</main>
      </div>
    </OutlineLayout>
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
    class="block group space-x-3 rounded-md p-2 text-sm leading-6 font-semibold"
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

import { As, Tabs } from "@kobalte/core";
import { A, useMatch, useResolvedPath } from "@solidjs/router";
import { For, JSX, ParentProps } from "solid-js";

import { createSignal } from "solid-js";
import { useAuthContext } from "~/app/(dash)";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Textarea,
} from "~/components/ui";
import { trpc } from "~/lib";
import { TenantSwitcher, TenantSwitcherProps } from "./TenantSwitcher";
import Logo from "~/assets/MATTRAX.png";

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

  const auth = useAuthContext();

  return (
    <>
      <div class="relative flex flex-row items-center px-6 gap-2 h-16 shrink-0">
        <A href="">
          <img src={Logo} class="h-5" />
        </A>
        <div class="w-1" />
        <TenantSwitcher {...props} />
        <div class="flex-1" />
        <FeedbackPopover>
          <As component={Button} variant="outline" size="sm" class="mr-4">
            Feedback
          </As>
        </FeedbackPopover>
        <span class="font-medium">{auth.me.name}</span>
        {/* <Button variant="destructive">Log Out</Button> */}
      </div>

      <nav class="text-white sticky border-b border-gray-300 top-0 z-10 bg-white -mt-2">
        <Tabs.Root value={tabValue()} class="mx-2 relative">
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
                    class="py-2 flex text-center align-middle transition duration-[16ms] relative group focus:outline-none"
                  >
                    <div class="text-sm rounded px-3 py-1.5 hover:bg-black/5 hover:text-black group-focus-visible:bg-black/5 group-focus-visible:text-black group-focus:outline-none">
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

function FeedbackPopover(props: ParentProps) {
  const sendFeedback = trpc.meta.sendFeedback.useMutation();
  const [open, setOpen] = createSignal(false);
  const [content, setContent] = createSignal("");

  return (
    <Popover open={open()} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{props.children}</PopoverTrigger>
      <PopoverContent class="flex flex-col gap-2 md:w-[350px]">
        <p class="text-sm">Enter feedback and we will get back to you:</p>
        <Textarea
          value={content()}
          onInput={(e) => setContent(e.target.value)}
        />
        <Button
          class="w-full"
          onClick={async () => {
            sendFeedback.mutateAsync({ content: content() });
            setOpen(false);
            setContent("");
          }}
          disabled={sendFeedback.isPending}
          size="sm"
        >
          Submit
        </Button>
      </PopoverContent>
    </Popover>
  );
}

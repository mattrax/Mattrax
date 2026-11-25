import type { ComponentProps, JSX } from "@solidjs/web";
import { createContext, Show, useContext } from "solid-js";
import { splitProps } from "./lib/solid";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "@ui-sdk/solid/menu";
import { cn } from "./lib/cn";
import { Check, ChevronRight } from "./icons";

type Placement = "bottom-start" | "bottom-end" | "top-start" | "top-end" | "bottom" | "top";

const AlignmentContext = createContext<{
  side: "top" | "bottom";
  align: "start" | "center" | "end";
}>({ side: "bottom", align: "start" });

const menuSurface =
  "fixed z-[75] min-w-[11rem] overflow-y-auto overflow-x-hidden rounded-[10px] border border-border bg-popover p-1 text-popover-foreground shadow-popover outline-none";

const itemBase =
  "relative flex h-8 cursor-default select-none items-center gap-2 rounded-[6px] px-2 text-[12.5px] font-[450] outline-none data-highlighted:bg-hover data-disabled:pointer-events-none data-disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5";

type DropdownMenuProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  placement?: Placement;
  children?: JSX.Element;
};

function DropdownMenu(props: DropdownMenuProps) {
  const [local, others] = splitProps(props, ["placement", "children"]);
  const placement = () => local.placement ?? "bottom-start";

  return (
    <AlignmentContext
      value={{
        side: placement().startsWith("top") ? "top" : "bottom",
        align: placement().endsWith("start")
          ? "start"
          : placement().endsWith("end")
            ? "end"
            : "center",
      }}
    >
      <Menu {...others}>{local.children}</Menu>
    </AlignmentContext>
  );
}

function DropdownMenuTrigger(
  props: Omit<ComponentProps<"button">, "style" | "disabled"> & { disabled?: boolean },
) {
  const [local, others] = splitProps(props, ["class"]);

  return <MenuTrigger class={cn("outline-none", local.class)} {...others} />;
}

function DropdownMenuContent(
  props: Omit<ComponentProps<"div">, "style"> & {
    sideOffset?: number;
    class?: string;
    children?: JSX.Element;
    /** Where focus goes when the menu closes; "none" leaves it in place. */
    finalFocus?: Parameters<typeof MenuContent>[0]["finalFocus"];
    /** Portal target; a menu opened inside a modal must stay inside it. */
    container?: Parameters<typeof MenuContent>[0]["container"];
  },
) {
  const placement = useContext(AlignmentContext);
  const [local, others] = splitProps(props, [
    "class",
    "children",
    "sideOffset",
    "finalFocus",
    "container",
  ]);

  return (
    <MenuContent
      side={placement.side}
      align={placement.align}
      sideOffset={local.sideOffset ?? 6}
      finalFocus={local.finalFocus}
      container={local.container}
      class={cn(
        menuSurface,
        "data-[side=bottom]:origin-top data-[side=top]:origin-bottom data-[side=left]:origin-right data-[side=right]:origin-left transition-[opacity,transform] duration-[var(--duration-popover)] ease-swift",
        "data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0",
        local.class,
      )}
      {...others}
    >
      {local.children}
    </MenuContent>
  );
}

function DropdownMenuGroup(props: Omit<ComponentProps<"div">, "style">) {
  const [local, others] = splitProps(props, ["class"]);

  return <MenuGroup class={cn("py-0.5", local.class)} {...others} />;
}

function DropdownMenuLabel(props: Omit<ComponentProps<"div">, "style"> & { inset?: boolean }) {
  const [local, others] = splitProps(props, ["class", "inset"]);

  return (
    <MenuGroupLabel
      class={cn("label-caps flex h-7 items-center px-2", local.inset && "pl-7", local.class)}
      {...others}
    />
  );
}

type DropdownMenuItemProps = Omit<Omit<ComponentProps<"div">, "style">, "onSelect"> & {
  value?: string;
  inset?: boolean;
  variant?: "default" | "destructive";
  as?: "div" | "a";
  href?: string;
  target?: string;
  rel?: string;
  onSelect?: () => void | Promise<void>;
  disabled?: boolean;
  closeOnSelect?: boolean;
};

function DropdownMenuItem(props: DropdownMenuItemProps) {
  const [local, others] = splitProps(props, [
    "class",
    "inset",
    "variant",
    "value",
    "onSelect",
    "as",
    "href",
    "target",
    "rel",
    "children",
  ]);

  return (
    <MenuItem
      value={local.value ?? local.onSelect?.name ?? "item"}
      onSelect={local.onSelect}
      render={
        local.as === "a"
          ? (partProps) => (
              <a {...partProps} href={local.href} target={local.target} rel={local.rel}>
                {local.children}
              </a>
            )
          : undefined
      }
      class={cn(
        itemBase,
        local.variant === "destructive" && "text-destructive data-highlighted:bg-destructive/10",
        local.inset && "pl-7",
        local.class,
      )}
      {...others}
    >
      {local.as === "a" ? null : local.children}
    </MenuItem>
  );
}

type DropdownMenuCheckboxItemProps = Omit<Omit<ComponentProps<"div">, "style">, "onChange"> & {
  value?: string;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  closeOnSelect?: boolean;
  children?: JSX.Element;
};

function DropdownMenuCheckboxItem(props: DropdownMenuCheckboxItemProps) {
  const [local, others] = splitProps(props, [
    "class",
    "checked",
    "onCheckedChange",
    "children",
    "value",
  ]);

  return (
    <MenuCheckboxItem
      value={local.value ?? "item"}
      checked={local.checked ?? false}
      onCheckedChange={(checked) => local.onCheckedChange?.(checked === true)}
      class={cn(itemBase, "pl-7", local.class)}
      {...others}
    >
      <span class="absolute inset-y-0 left-2 flex items-center justify-center">
        <Show when={local.checked}>
          <Check class="size-3 text-foreground" stroke-width={3} />
        </Show>
      </span>
      {local.children}
    </MenuCheckboxItem>
  );
}

type DropdownMenuRadioGroupProps = Omit<ComponentProps<"div">, "style"> & {
  value?: string;
  onValueChange?: (value: string) => void;
  children?: JSX.Element;
};

function DropdownMenuRadioGroup(props: DropdownMenuRadioGroupProps) {
  const [local, others] = splitProps(props, ["class", "value", "onValueChange"]);

  return (
    <MenuRadioGroup
      value={local.value}
      onValueChange={(value) => local.onValueChange?.(value ?? "")}
      class={cn("py-0.5", local.class)}
      {...others}
    />
  );
}

function DropdownMenuRadioItem(
  props: Omit<ComponentProps<"div">, "style"> & {
    value: string;
    children?: JSX.Element;
    /** The selected marker: a leading dot (default), a trailing check, or none. */
    indicator?: "dot" | "check" | "none";
  },
) {
  const [local, others] = splitProps(props, ["class", "value", "children", "indicator"]);
  const indicator = () => local.indicator ?? "dot";

  return (
    <MenuRadioItem
      value={local.value}
      class={cn(
        itemBase,
        indicator() === "dot" && "pl-7",
        indicator() === "check" && "pr-7",
        indicator() === "none" && "pl-2",
        local.class,
      )}
      {...others}
    >
      <Show when={indicator() === "dot"}>
        <span class="absolute inset-y-0 left-2 flex items-center justify-center">
          <span class="size-1.5 rounded-full bg-current" />
        </span>
      </Show>
      {local.children}
      <Show when={indicator() === "check"}>
        <span class="absolute inset-y-0 right-2 flex items-center justify-center">
          <Check class="size-3 text-foreground" stroke-width={3} />
        </span>
      </Show>
    </MenuRadioItem>
  );
}

function DropdownMenuSeparator(props: Omit<ComponentProps<"div">, "style">) {
  const [local, others] = splitProps(props, ["class"]);

  return <MenuSeparator class={cn("-mx-1 my-1 h-px bg-border", local.class)} {...others} />;
}

function DropdownMenuShortcut(props: Omit<ComponentProps<"span">, "style">) {
  const [local, others] = splitProps(props, ["class"]);

  return (
    <MenuShortcut
      class={cn("ml-auto text-[10.5px] tracking-[0.06em] text-subtle-foreground", local.class)}
      {...others}
    />
  );
}

function DropdownMenuArrow() {
  return <ChevronRight class="ml-auto size-3.5 text-subtle-foreground" />;
}

export {
  DropdownMenu,
  DropdownMenuArrow,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
};

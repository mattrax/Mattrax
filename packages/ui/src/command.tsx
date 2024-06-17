import type {
	Component,
	ComponentProps,
	ParentComponent,
	ParentProps,
	ValidComponent,
	VoidProps,
} from "solid-js";
import { createContext, createSignal, splitProps, useContext } from "solid-js";

import type { DialogRootProps } from "@kobalte/core/dialog";
import * as CommandPrimitive from "cmdk-solid";

import clsx from "clsx";
import { Dialog, DialogContent } from "./dialog";

const CommandContext = createContext<{
	open: () => boolean;
	setOpen: (open: boolean) => void;
}>();

const useCommandCtx = () => useContext(CommandContext)!;

const Command: Component<ParentProps<CommandPrimitive.CommandRootProps>> = (
	props,
) => {
	const [local, others] = splitProps(props, ["class"]);

	return (
		<CommandPrimitive.CommandRoot
			class={clsx(
				"flex size-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground",
				local.class,
			)}
			{...others}
		/>
	);
};

const CommandDialog: Component<ParentProps<DialogRootProps>> = (props) => {
	const [local, others] = splitProps(props, ["children"]);

	return (
		<CommandContext.Provider
			value={{
				open: () => props.open ?? false,
				setOpen: props.onOpenChange ?? (() => {}),
			}}
		>
			<Dialog {...others}>
				<DialogContent
					class="overflow-hidden !p-0 w-full max-w-xl"
					positionClass="left-1/2 top-1/4 -translate-x-1/2"
					closeButton={false}
				>
					<Command
						loop={true}
						class="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-group]]:px-2 [&_[cmdk-input-wrapper]_svg]:size-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:size-5"
					>
						{local.children}
					</Command>
				</DialogContent>
			</Dialog>
		</CommandContext.Provider>
	);
};

const CommandInput: Component<VoidProps<CommandPrimitive.CommandInputProps>> = (
	props,
) => {
	const [local, others] = splitProps(props, ["class"]);

	return (
		<div class="flex items-center border-b px-3" cmdk-input-wrapper="">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="mr-2 size-4 shrink-0 opacity-50"
				aria-hidden="true"
			>
				<path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
				<path d="M21 21l-6 -6" />
			</svg>
			<CommandPrimitive.CommandInput
				class={clsx(
					"flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
					local.class,
				)}
				{...others}
			/>
		</div>
	);
};

const CommandList: Component<ParentProps<CommandPrimitive.CommandListProps>> = (
	props,
) => {
	const [local, others] = splitProps(props, ["class"]);

	return (
		<CommandPrimitive.CommandList
			class={clsx(
				"max-h-[300px] overflow-y-auto overflow-x-hidden",
				local.class,
			)}
			{...others}
		/>
	);
};

const CommandEmpty: Component<ParentProps<CommandPrimitive.CommandEmptyProps>> =
	(props) => {
		const [local, others] = splitProps(props, ["class"]);

		return (
			<CommandPrimitive.CommandEmpty
				class={clsx("py-6 text-center text-sm", local.class)}
				{...others}
			/>
		);
	};

const CommandGroup: Component<ParentProps<CommandPrimitive.CommandGroupProps>> =
	(props) => {
		const [local, others] = splitProps(props, ["class"]);

		return (
			<CommandPrimitive.CommandGroup
				class={clsx(
					"overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground",
					local.class,
				)}
				{...others}
			/>
		);
	};

const CommandSeparator: Component<
	VoidProps<CommandPrimitive.CommandSeparatorProps>
> = (props) => {
	const [local, others] = splitProps(props, ["class"]);

	return (
		<CommandPrimitive.CommandSeparator
			class={clsx("h-px bg-border", local.class)}
			{...others}
		/>
	);
};

const CommandItem = <T extends ValidComponent = "div">(
	props: CommandPrimitive.CommandItemProps<T>,
) => {
	const [local, others] = splitProps(props as any, ["class"]);

	return (
		<CommandPrimitive.CommandItem
			{...({
				"cmdk-item": "",
				class: clsx(
					"relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
					local.class,
				) as any,
				// types are broke
			} as any)}
			{...others}
		/>
	);
};

const CommandShortcut: Component<ComponentProps<"span">> = (props) => {
	const [local, others] = splitProps(props, ["class"]);

	return (
		<span
			class={clsx(
				"ml-auto text-xs tracking-widest text-muted-foreground",
				local.class,
			)}
			{...others}
		/>
	);
};

export {
	Command,
	CommandDialog,
	CommandInput,
	CommandList,
	CommandEmpty,
	CommandGroup,
	CommandItem,
	CommandShortcut,
	CommandSeparator,
	useCommandCtx,
};

import {
	type PolymorphicProps,
	Select as SelectPrimitive,
} from "@kobalte/core";
import type { Component, ComponentProps, JSX } from "solid-js";
import { For, Show, Suspense, splitProps } from "solid-js";

import type { ListboxItemProps } from "@kobalte/core/listbox";
import type {
	SelectContentProps,
	SelectTriggerProps,
} from "@kobalte/core/select";
import { createVirtualizer } from "@tanstack/solid-virtual";
import clsx from "clsx";

const Select = (props: ComponentProps<typeof SelectPrimitive.Root>) => (
	<SelectPrimitive.Root
		{...props}
		disallowEmptySelection={props.disallowEmptySelection ?? true}
	/>
);

const SelectValue = SelectPrimitive.Value;

const SelectListbox = SelectPrimitive.Listbox;

const SelectTrigger: Component<PolymorphicProps<"button", SelectTriggerProps>> =
	(props) => {
		const [, rest] = splitProps(props, ["class", "children"]);
		return (
			<SelectPrimitive.Trigger
				class={clsx(
					"border-input ring-offset-background placeholder:text-muted-foreground focus:ring-ring flex h-10 w-full items-center justify-between rounded-md border bg-transparent px-3 py-2 text-sm",
					"focus:outline-none focus:ring-2 focus:ring-offset-2 transition-shadow duration-75",
					"disabled:cursor-not-allowed disabled:opacity-50",
					props.class,
				)}
				{...rest}
			>
				{props.children}
				<SelectPrimitive.Icon>
					<IconTablerChevronDown class="h-4 w-4 opacity-50" />
				</SelectPrimitive.Icon>
			</SelectPrimitive.Trigger>
		);
	};

const SelectContent: Component<PolymorphicProps<"div", SelectContentProps>> = (
	props,
) => {
	const [local, rest] = splitProps(props, ["class", "children"]);

	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				class={clsx(
					"bg-popover text-popover-foreground relative z-50 min-w-[8rem] overflow-hidden rounded-md border shadow-md focus:outline-none",
					"ui-expanded:animate-in ui-expanded:fade-in-0 ui-expanded:slide-in-from-top-2",
					"ui-closed:animate-out ui-closed:fade-out-0 ui-closed:slide-out-to-top-2",
					props.class,
				)}
				{...rest}
			>
				{local.children ?? (
					<SelectPrimitive.Listbox class="m-0 p-1 focus:outline-none" />
				)}
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	);
};

function SelectContentVirtualized<TKey>(props: {
	// TODO: Can we derive this from the select's options somehow?
	length: () => number;
	getItemIndex: (key: TKey) => number;
	children: (key: TKey, index: number) => JSX.Element;
}) {
	return (
		<Suspense fallback={<SelectContent />}>
			<SelectContent>
				<Show when>
					{(_) => {
						let listboxRef!: HTMLUListElement;
						const virtualizer = createVirtualizer({
							count: props.length(),
							getScrollElement: () => listboxRef,
							getItemKey: (index) => index,
							estimateSize: () => 32,
							overscan: 5,
						});

						return (
							<SelectListbox
								ref={listboxRef}
								scrollToItem={(key) =>
									virtualizer.scrollToIndex(props.getItemIndex(key as any))
								}
								style={{ height: "200px", width: "100%", overflow: "auto" }}
								class="m-0 p-1 focus:outline-none"
							>
								{(items) => (
									<div
										style={{
											height: `${virtualizer.getTotalSize()}px`,
											width: "100%",
											position: "relative",
										}}
									>
										<For each={virtualizer.getVirtualItems()}>
											{(virtualRow) => {
												const item = items().at(virtualRow.index);
												if (item) {
													return (
														<SelectItem
															item={item}
															style={{
																position: "absolute",
																top: 0,
																left: 0,
																width: "100%",
																height: `${virtualRow.size}px`,
																transform: `translateY(${virtualRow.start}px)`,
															}}
														>
															{props.children(item.rawValue, item.index)}
														</SelectItem>
													);
												}
											}}
										</For>
									</div>
								)}
							</SelectListbox>
						);
					}}
				</Show>
			</SelectContent>
		</Suspense>
	);
}

const SelectItem: Component<
	PolymorphicProps<"li", ListboxItemProps> & { disabled?: boolean }
> = (props) => {
	const [, rest] = splitProps(props, ["class", "children"]);
	return (
		<SelectPrimitive.Item
			class={clsx(
				"focus:bg-accent focus:text-accent-foreground relative mt-0 flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none aria-disabled:pointer-events-none aria-disabled:opacity-50",
				props.class,
			)}
			aria-disabled={props.disabled || false}
			{...rest}
		>
			<span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
				<SelectPrimitive.ItemIndicator>
					<IconTablerCheck class="h-4 w-4" />
				</SelectPrimitive.ItemIndicator>
			</span>
			<SelectPrimitive.ItemLabel>{props.children}</SelectPrimitive.ItemLabel>
		</SelectPrimitive.Item>
	);
};

export {
	Select,
	SelectValue,
	SelectListbox,
	SelectTrigger,
	SelectContent,
	SelectContentVirtualized,
	SelectItem,
};

import type { JSX, ValidComponent } from "solid-js";
import { For, Show, Suspense, splitProps } from "solid-js";

import {
	Combobox as ComboboxPrimitive,
	type PolymorphicProps,
} from "@kobalte/core";
import type { ListboxSectionProps } from "@kobalte/core/listbox";
import type {
	ListboxItemIndicatorProps,
	ListboxItemProps,
} from "@kobalte/core/listbox";

import type {
	ComboboxContentProps,
	ComboboxControlProps,
	ComboboxInputProps,
	ComboboxTriggerProps,
} from "@kobalte/core/combobox";
import { createVirtualizer } from "@tanstack/solid-virtual";
import clsx from "clsx";

const ComboboxRoot = ComboboxPrimitive.Root;

const ComboboxItem = <T extends ValidComponent = "li">(
	props: PolymorphicProps<T, ListboxItemProps>,
) => {
	const [local, rest] = splitProps(
		props as ComboboxPrimitive.ComboboxItemProps & {
			class?: string | undefined;
		},
		["class"],
	);
	return (
		<ComboboxPrimitive.Item
			class={clsx(
				"relative flex cursor-default select-none items-center justify-between rounded-sm px-2 py-1.5 pl-8 pr-2 text-sm outline-none aria-disabled:pointer-events-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground aria-disabled:opacity-50",
				props.class,
			)}
			aria-disabled={props.disabled || false}
			{...rest}
		>
			<span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
				<ComboboxPrimitive.ItemIndicator>
					<IconTablerCheck class="h-4 w-4" />
				</ComboboxPrimitive.ItemIndicator>
			</span>
			<ComboboxPrimitive.ItemLabel>
				{props.children as any}
			</ComboboxPrimitive.ItemLabel>
		</ComboboxPrimitive.Item>
	);
};

const ComboboxItemLabel = ComboboxPrimitive.ItemLabel;

const ComboboxItemIndicator = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ListboxItemIndicatorProps>,
) => {
	const [, rest] = splitProps(props as any, ["children"]);
	return (
		<ComboboxPrimitive.ItemIndicator {...rest}>
			{props.children ?? <IconPhCheck />}
		</ComboboxPrimitive.ItemIndicator>
	);
};

const ComboboxSection = <T extends ValidComponent = "li">(
	props: PolymorphicProps<T, ListboxSectionProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<ComboboxPrimitive.Section
			class={clsx(
				"overflow-hidden p-1 px-2 py-1.5 text-xs font-medium text-muted-foreground ",
				props.class,
			)}
			{...rest}
		/>
	);
};

// due to the generic typing this needs to be a function
function ComboboxControl<Option>(
	props: PolymorphicProps<"div", ComboboxControlProps<Option>>,
) {
	const [, rest] = splitProps(props, ["class"]);
	return (
		<ComboboxPrimitive.Control
			class={clsx("flex items-center rounded-md border px-3", props.class)}
			{...rest}
		/>
	);
}

const ComboboxInput = <T extends ValidComponent = "input">(
	props: PolymorphicProps<T, ComboboxInputProps>,
) => {
	const [, rest] = splitProps(props as any, ["class"]);
	return (
		<ComboboxPrimitive.Input
			class={clsx(
				"flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
				props.class,
			)}
			{...rest}
		/>
	);
};

const ComboboxHiddenSelect = ComboboxPrimitive.HiddenSelect;

const ComboboxTrigger = <T extends ValidComponent = "button">(
	props: PolymorphicProps<T, ComboboxTriggerProps>,
) => {
	const [, rest] = splitProps(props as any, ["class", "children"]);
	return (
		<ComboboxPrimitive.Trigger
			class={clsx("size-4 opacity-50", props.class)}
			{...rest}
		>
			<ComboboxPrimitive.Icon>
				{props.children ?? <IconTablerSelector />}
			</ComboboxPrimitive.Icon>
		</ComboboxPrimitive.Trigger>
	);
};

const ComboboxContent = <T extends ValidComponent = "div">(
	props: PolymorphicProps<T, ComboboxContentProps>,
) => {
	const [local, rest] = splitProps(props as any, ["class", "children"]);
	return (
		<ComboboxPrimitive.Portal>
			<ComboboxPrimitive.Content
				class={clsx(
					"relative z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md animate-in fade-in-80",
					props.class,
				)}
				{...rest}
			>
				{local.children ?? <ComboboxPrimitive.Listbox class="m-0 p-1" />}
			</ComboboxPrimitive.Content>
		</ComboboxPrimitive.Portal>
	);
};

function ComboboxContentVirtualized<TKey>(props: {
	// TODO: Can we derive this from the select's options somehow?
	length: () => number;
	getItemIndex: (key: TKey) => number;
	children: (key: TKey, index: number) => JSX.Element;
}) {
	return (
		<Suspense fallback={<ComboboxContent />}>
			<ComboboxContent>
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
							<ComboboxPrimitive.Listbox
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

												console.log("ROW", virtualRow.index, virtualRow.key); // TODO

												if (item) {
													return (
														<ComboboxItem
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
														</ComboboxItem>
													);
												}
											}}
										</For>
									</div>
								)}
							</ComboboxPrimitive.Listbox>
						);
					}}
				</Show>
			</ComboboxContent>
		</Suspense>
	);
}

export {
	ComboboxRoot,
	ComboboxItem,
	ComboboxItemLabel,
	ComboboxItemIndicator,
	ComboboxSection,
	ComboboxControl,
	ComboboxTrigger,
	ComboboxInput,
	ComboboxHiddenSelect,
	ComboboxContent,
	ComboboxContentVirtualized,
};

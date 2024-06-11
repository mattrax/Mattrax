import type { ComponentProps, JSX, ValidComponent } from "solid-js";
import {
	ErrorBoundary,
	For,
	Show,
	Suspense,
	createEffect,
	createMemo,
	createSignal,
	splitProps,
} from "solid-js";

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

// function ComboboxContentVirtualized<TKey>(props: {
// 	// TODO: Can we derive this from the select's options somehow?
// 	length: () => number;
// 	getItemIndex: (key: TKey) => number;
// 	children: (key: TKey, index: number) => JSX.Element;
// }) {
// 	return (
// 		<Suspense fallback={<ComboboxContent />}>
// 			<ComboboxContent>
// 				<Show when>
// 					{(_) => {
// 						let listboxRef!: HTMLUListElement;
// 						const virtualizer = createVirtualizer({
// 							count: props.length(),
// 							getScrollElement: () => listboxRef,
// 							getItemKey: (index) => index,
// 							estimateSize: () => 32,
// 							overscan: 5,
// 						});

// 						return (
// 							<ComboboxPrimitive.Listbox
// 								ref={listboxRef}
// 								scrollToItem={(key) =>
// 									virtualizer.scrollToIndex(props.getItemIndex(key as any))
// 								}
// 								style={{ height: "200px", width: "100%", overflow: "auto" }}
// 								class="m-0 p-1 focus:outline-none"
// 							>
// 								{(items) => (
// 									<div
// 										style={{
// 											height: `${virtualizer.getTotalSize()}px`,
// 											width: "100%",
// 											position: "relative",
// 										}}
// 									>
// 										<For each={virtualizer.getVirtualItems()}>
// 											{(virtualRow) => {
// 												const item = items().at(virtualRow.index);

// 												if (item) {
// 													return (
// 														<ComboboxItem
// 															item={item}
// 															style={{
// 																position: "absolute",
// 																top: 0,
// 																left: 0,
// 																width: "100%",
// 																height: `${virtualRow.size}px`,
// 																transform: `translateY(${virtualRow.start}px)`,
// 															}}
// 														>
// 															{props.children(item.rawValue, item.index)}
// 														</ComboboxItem>
// 													);
// 												}
// 											}}
// 										</For>
// 									</div>
// 								)}
// 							</ComboboxPrimitive.Listbox>
// 						);
// 					}}
// 				</Show>
// 			</ComboboxContent>
// 		</Suspense>
// 	);
// }

function ComboboxManaged<T>(props: {
	setActiveItem: (item: T | null) => void;
	count: number;
	getItemFromIndex: (index: number) => T;
	renderValueForInput: (item: T) => string;
	children: (item: T, index: number) => JSX.Element;
	applySearch?: (item: T, search: string) => boolean;
	defaultValue?: number | null;
	disabled?: boolean;
	disallowEmptySelection?: boolean;
	placeholder?: string;
	"aria-label"?: string;
	class?: string;
	// TODO: Search
}) {
	const [search, setSearch] = createSignal<string | null>(null);
	const [active, setActive] = createSignal<number | null>(
		props.defaultValue ?? null,
	);

	const inputValue = () => {
		const i = active();
		return i !== null
			? props.renderValueForInput(props.getItemFromIndex(i))
			: "";
	};

	const options = createMemo(() => {
		const query = search();
		const options = [...Array(props.count).keys()];

		return query
			? options.filter((i) =>
					props.applySearch
						? props.applySearch(props.getItemFromIndex(i), query)
						: true,
				)
			: options;
	});

	// My own custom virtualizer cause I can't get Tanstack Virtual to work
	const entrySize = 32;
	const containerSize = () => options().length * entrySize;

	return (
		<ComboboxRoot
			virtualized
			value={active()}
			// We don't apply filtering to these options cause something was bugged with Kobalte when doing that.
			options={[...Array(props.count).keys()]}
			onChange={(index: number | null) => {
				const actualIndex = index ? options()[index]! : null;
				console.log("CHANGE", index, actualIndex, [...options()]); // TODO

				setSearch(null);
				setActive(actualIndex); // TODO: Account for virtualised
				props.setActiveItem(
					actualIndex ? props.getItemFromIndex(actualIndex) : null,
				);
			}}
			disallowEmptySelection={props.disallowEmptySelection}
			disabled={props.disabled}
			placeholder={props.placeholder}
			class={props.class}
			open={search() !== null ? true : undefined}
			defaultFilter={() => true}
		>
			<ComboboxControl aria-label={props?.["aria-label"]}>
				<ComboboxInput
					value={inputValue()}
					onInput={(e) => {
						// console.log("INPUT", e.currentTarget.value); // TODO
						setSearch((e.target as HTMLInputElement).value);
					}}
					onFocusOut={(e) => {
						setSearch(null);
						e.currentTarget.value = inputValue();
					}}
					readOnly={props.applySearch === undefined}
				/>
				<ComboboxTrigger />
			</ComboboxControl>

			<Suspense fallback={<ComboboxContent />}>
				<ComboboxContent>
					<ComboboxPrimitive.Listbox
						scrollToItem={(index) => {
							// TODO: Scroll to item
						}}
						style={{
							height: "200px",
							width: "100%",
							overflow: "auto",
						}}
						class="m-0 p-1 focus:outline-none"
					>
						{(items) => (
							<div
								style={{
									height: `${containerSize()}px`,
									width: "100%",
									position: "relative",
								}}
							>
								<For each={options()}>
									{(indexInVirtualiser, i) => {
										return (
											<ComboboxItem
												item={items().at(indexInVirtualiser)!}
												// item={{
												// 	type: "item",
												// 	key: indexInVirtualiser.toString(),
												// 	index: indexInVirtualiser,
												// 	rawValue: indexInVirtualiser,
												// 	textValue: "",
												// 	disabled: false,
												// 	level: 0,
												// }}
												style={{
													position: "absolute",
													top: 0,
													left: 0,
													width: "100%",
													height: `${entrySize}px`,
													transform: `translateY(${i() * entrySize}px)`,
												}}
												onSelect={() => {
													console.log("SELECT CHECKBOX");
												}}
												onClick={() => {
													console.log("CLICK CHECKBOX");
													// setSearch(null);
													// setActive(indexInVirtualiser);
													// props.setActiveItem(
													// 	props.getItemFromIndex(indexInVirtualiser),
													// );
												}}
											>
												{props.children(
													props.getItemFromIndex(indexInVirtualiser),
													indexInVirtualiser,
												)}
											</ComboboxItem>
										);
									}}
								</For>
								{/* <For each={options()}>
									{(indexInVirtualiser, i) => {
										return (
											<ComboboxItemWithoutKobalte
												// item={{
												// 	type: "item",
												// 	key: indexInVirtualiser.toString(),
												// 	index: indexInVirtualiser,
												// 	rawValue: indexInVirtualiser,
												// 	textValue: "",
												// 	disabled: false,
												// 	level: 0,
												// }}
												style={{
													position: "absolute",
													top: 0,
													left: 0,
													width: "100%",
													height: `${entrySize}px`,
													transform: `translateY(${i() * entrySize}px)`,
												}}
												onSelect={() => {
													console.log("SELECT CHECKBOX");
												}}
												onClick={() => {
													console.log("CLICK CHECKBOX");
													setSearch(null);
													setActive(indexInVirtualiser);
													props.setActiveItem(
														props.getItemFromIndex(indexInVirtualiser),
													);
												}}
											>
												{props.children(
													props.getItemFromIndex(indexInVirtualiser),
													indexInVirtualiser,
												)}
											</ComboboxItemWithoutKobalte>
										);
									}}
								</For> */}
							</div>
						)}
					</ComboboxPrimitive.Listbox>
				</ComboboxContent>
			</Suspense>
		</ComboboxRoot>
	);
}

export {
	ComboboxManaged,
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
};

import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuPortal,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
	Kbd,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@mattrax/ui";
import { useNavigate } from "@solidjs/router";
import { createMutation, createQuery } from "@tanstack/solid-query";
import clsx from "clsx";
import {
	type Accessor,
	type ComponentProps,
	For,
	Match,
	type Setter,
	Show,
	Switch,
} from "solid-js";
import { db } from "~/lib/db";
import type { Filter } from "./filters";

export function FilterBar(props: {
	filters: Accessor<Filter[]>;
	setFilters: Setter<Filter[]>;
}) {
	const navigate = useNavigate();
	const createView = createMutation(() => ({
		mutationKey: ["createView"],
		mutationFn: async (data: Filter[]) => {
			const id = crypto.randomUUID();
			await (await db).add("views", {
				id,
				name: "New view", // TODO: Ask user
				description: "My cool view",
				data,
			});
			navigate(`/views/${id}`);
		},
	}));

	return (
		<div class="flex h-[45px] w-full flex-row items-center gap-4 px-4 bg-black/5">
			<div class="relative flex h-full cursor-default items-center overflow-hidden">
				<AppliedFilters filters={props.filters} setFilters={props.setFilters} />
			</div>

			<AddFilterButton filters={props.filters} setFilters={props.setFilters} />

			<div class="flex-1" />

			<Show when={props.filters().length > 0}>
				<>
					<Tooltip>
						{/* // TODO: Ask the user for the view name */}
						<TooltipTrigger
							as="button"
							type="button"
							class="text-center"
							onClick={() => createView.mutate(props.filters())}
						>
							<div class="flex items-center justify-center h-full">
								<IconPhFloppyDisk />
							</div>
						</TooltipTrigger>
						<TooltipContent>Create new view from active filters</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger
							as="button"
							type="button"
							class="text-center"
							onClick={() => props.setFilters([])}
						>
							<div class="flex items-center justify-center h-full">
								<IconPhX />
							</div>
						</TooltipTrigger>
						<TooltipContent>Clear all filters</TooltipContent>
					</Tooltip>
				</>
			</Show>
		</div>
	);
}

function AppliedFilters(props: {
	filters: Accessor<Filter[]>;
	setFilters: Setter<Filter[]>;
}) {
	// TODO: Horizontal scroll

	return (
		<div class="flex space-x-2">
			<For each={props.filters()}>
				{(filter) => (
					<Switch>
						<Match when={filter.type === "string" && filter.op === "eq"}>
							<FilterContainer>
								<StaticSection>
									<IconPhMagnifyingGlass />
									<FilterText class="px-1 pr-2">{filter.value}</FilterText>
									<RemoveFilter
										onClick={() =>
											props.setFilters((filters) =>
												filters.filter((f) => f !== filter),
											)
										}
									/>
								</StaticSection>
							</FilterContainer>
						</Match>
						<Match when={filter.type === "enum" && filter.target === "type"}>
							<FilterContainer>
								<StaticSection>
									<IconPhShapes />
									<FilterText>Type</FilterText>
								</StaticSection>

								<InteractiveSection class="border-l px-2">
									is
								</InteractiveSection>

								<InteractiveSection class="gap-1 border-l border-app-darkerBox/70 py-0.5 pl-1.5 pr-2 text-sm">
									{filter.value}
								</InteractiveSection>

								<RemoveFilter
									onClick={() =>
										props.setFilters((filters) =>
											filters.filter((f) => f !== filter),
										)
									}
								/>
							</FilterContainer>
						</Match>
					</Switch>
				)}
			</For>
		</div>
	);
}

export const FilterContainer = (props: ComponentProps<"div">) => (
	<div
		class={clsx(
			"flex flex-row items-center rounded bg-gray-300 overflow-hidden shrink-0 h-6",
			props.class,
		)}
		{...props}
	/>
);

export const StaticSection = (props: ComponentProps<"div">) => (
	<div
		class={clsx("flex flex-row items-center pl-2 pr-1 text-sm", props.class)}
		{...props}
	/>
);

export const InteractiveSection = (props: ComponentProps<"div">) => (
	<div
		class={clsx(
			"flex group flex-row items-center border-gray-200 px-2 py-0.5 text-sm",
			props.class,
		)}
		{...props}
	/>
);

export const FilterText = (props: ComponentProps<"span">) => (
	<span class={clsx("mx-1 py-0.5 text-sm", props.class)} {...props} />
);

export const RemoveFilter = (props: ComponentProps<"button">) => (
	<Tooltip>
		<TooltipTrigger
			as="button"
			class={clsx(
				"flex h-full items-center rounded-r border-l border-gray-200 px-1.5 py-0.5 text-sm hover:bg-gray-200",
				props.class,
			)}
			{...props}
		>
			<IconPhX />
		</TooltipTrigger>
		<TooltipContent>Remove filter</TooltipContent>
	</Tooltip>
);

function AddFilterButton(props: {
	filters: Accessor<Filter[]>;
	setFilters: Setter<Filter[]>;
}) {
	return (
		<DropdownMenu>
			<Tooltip>
				<DropdownMenuTrigger as="button">
					<TooltipTrigger as={IconPhFunnelSimple} class="w-6 h-6" />
				</DropdownMenuTrigger>
				<TooltipContent>
					<span class="mr-2">Filter</span>
					{/* // TODO: Hook up this keybind */}
					<Kbd>F</Kbd>
				</TooltipContent>
			</Tooltip>
			<DropdownMenuContent class="select-none">
				{/* // TODO: Search for filters */}
				{/* <DropdownMenuItem><Input /></DropdownMenuItem> */}

				<DropdownMenuSub>
					<DropdownMenuSubTrigger>Type</DropdownMenuSubTrigger>
					<DropdownMenuPortal>
						<DropdownMenuSubContent>
							{/* // TODO: All selected items here should end up as at most one filter block in the UI */}
							<DropdownMenuCheckboxItem
								checked={
									props
										.filters()
										.find(
											(f) =>
												f.type === "enum" &&
												f.target === "type" &&
												f.value === "users",
										) !== undefined
								}
								onChange={(checked) => {
									if (checked) {
										props.setFilters((filters) => [
											...filters,
											{ type: "enum", target: "type", value: "users" },
										]);
									} else {
										props.setFilters((filters) =>
											filters.filter(
												(f) =>
													f.type === "enum" &&
													f.target === "type" &&
													f.value !== "users",
											),
										);
									}
								}}
							>
								User
							</DropdownMenuCheckboxItem>
							<DropdownMenuCheckboxItem
								checked={
									props
										.filters()
										.find(
											(f) =>
												f.type === "enum" &&
												f.target === "type" &&
												f.value === "devices",
										) !== undefined
								}
								onChange={(checked) => {
									if (checked) {
										props.setFilters((filters) => [
											...filters,
											{ type: "enum", target: "type", value: "devices" },
										]);
									} else {
										props.setFilters((filters) =>
											filters.filter(
												(f) =>
													f.type === "enum" &&
													f.target === "type" &&
													f.value !== "devices",
											),
										);
									}
								}}
							>
								Device
							</DropdownMenuCheckboxItem>
							<DropdownMenuCheckboxItem
								checked={
									props
										.filters()
										.find(
											(f) =>
												f.type === "enum" &&
												f.target === "type" &&
												f.value === "groups",
										) !== undefined
								}
								onChange={(checked) => {
									if (checked) {
										props.setFilters((filters) => [
											...filters,
											{ type: "enum", target: "type", value: "groups" },
										]);
									} else {
										props.setFilters((filters) =>
											filters.filter(
												(f) =>
													f.type === "enum" &&
													f.target === "type" &&
													f.value !== "groups",
											),
										);
									}
								}}
							>
								Group
							</DropdownMenuCheckboxItem>
							<DropdownMenuCheckboxItem checked={false}>
								Policy
							</DropdownMenuCheckboxItem>
							<DropdownMenuCheckboxItem checked={false}>
								Applications
							</DropdownMenuCheckboxItem>
						</DropdownMenuSubContent>
					</DropdownMenuPortal>
				</DropdownMenuSub>

				{/* // TODO: Query by membership in group */}

				{/* // TODO: This should probs only show up when filtered to devices */}
				{/* <DropdownMenuSub>
					<DropdownMenuSubTrigger>Owner</DropdownMenuSubTrigger>
					<DropdownMenuPortal>
						<DropdownMenuSubContent>
							// TODO: This only works for entities with an owner. Eg. device
						</DropdownMenuSubContent>
					</DropdownMenuPortal>
				</DropdownMenuSub> */}

				{/* <DropdownMenuSub>
					<DropdownMenuSubTrigger>Created at</DropdownMenuSubTrigger>
					<DropdownMenuPortal>
						<DropdownMenuSubContent>
							TODO
						</DropdownMenuSubContent>
					</DropdownMenuPortal>
				</DropdownMenuSub> */}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

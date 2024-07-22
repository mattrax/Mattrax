import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuPortal,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
	Input,
	Kbd,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@mattrax/ui";
import { useNavigate } from "@solidjs/router";
import { createMutation, createQuery } from "@tanstack/solid-query";
import { createColumnHelper } from "@tanstack/solid-table";
import clsx from "clsx";
import {
	type Accessor,
	type ComponentProps,
	For,
	Match,
	type Setter,
	Show,
	Suspense,
	Switch,
	createSignal,
} from "solid-js";
import {
	StandardTable,
	createStandardTable,
	selectCheckboxColumn,
} from "~/components/StandardTable";
import { db } from "../../util/db";

// TODO: Rest of the possibilities + clean this up
export type Filter =
	| {
			type: "string";
			op: "eq";
			// field: string[]; // TODO: Can we typesafe this?
			value: string;
	  }
	| {
			type: "enum";
			target: "type"; // TODO: This should be more dynamic cause it's not a filter thing???
			// TODO: `op: "contains"`???
			value: string; // TODO: Allow multiple values
	  };

export default function Page() {
	const ctx = createSearchPageContext();
	return <SearchPage {...ctx} />;
}

export function createSearchPageContext(defaultFilters: Filter[] = []) {
	const [filters, setFilters] = createSignal<Filter[]>(defaultFilters);
	return { filters, setFilters };
}

const column = createColumnHelper<any>(); // TODO: Not using any

const columns = [
	selectCheckboxColumn,
	column.accessor("name", {
		header: "Name",
		cell: (props) => (
			<a
				class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
				href="todo" // TODO: {`/users/${props.row.original.id}`}
			>
				{props.row.original.name}
			</a>
		),
	}),
	// TODO: This needs to dispatch to the correct entity type to render it
];

export function SearchPage(props: {
	filters: Accessor<Filter[]>;
	setFilters: Setter<Filter[]>;
}) {
	// TODO: Ordering
	// TODO: Result format (table or chart)

	// TODO: Make this reactive to DB changes!!!
	const query = createQuery(() => ({
		queryKey: ["search", props.filters()],
		// TODO: Filtering inside or outside Tanstack Query??? I can see merits both ways
		queryFn: async (ctx) => {
			let result: any[] = [];

			const d = await db;
			const activeFilters = ctx.queryKey[1] as Filter[];

			if (activeFilters.some((f) => f.type === "enum" && f.target === "type")) {
				for (const filter of activeFilters) {
					if (filter.type === "enum" && filter.target === "type") {
						switch (filter.value) {
							case "users":
								result = result.concat(await d.getAll("users"));
								break;
							case "devices":
								result = result.concat(await d.getAll("devices"));
								break;
							case "groups":
								result = result.concat(await d.getAll("groups"));
								break;
							case "policies":
								result = result.concat(await d.getAll("policies"));
								break;
							case "apps":
								result = result.concat(await d.getAll("apps"));
								break;
						}
					}
				}
			} else {
				result = result.concat(await d.getAll("users"));
				result = result.concat(await d.getAll("devices"));
				result = result.concat(await d.getAll("groups"));
				result = result.concat(await d.getAll("policies"));
				result = result.concat(await d.getAll("apps"));
			}

			const searchQuery = activeFilters.find(
				(f) => f.type === "string" && f.op === "eq",
			);
			if (searchQuery) {
				result = result.filter((r) => {
					for (const [key, value] of Object.entries(r)) {
						if (
							typeof value === "string" &&
							value.toLowerCase().includes(searchQuery.value.toLowerCase())
						) {
							return true;
						}
					}
					return false;
				});
			}

			return result;
		},
	}));

	const table = createStandardTable({
		get data() {
			return query.data || [];
		},
		columns,
	});
	// createSearchParamFilter(table, "name", "search");

	// const dialog = createBulkDeleteDialog({
	// 	table,
	// 	onDelete: (data) => {
	// 		console.log(data);
	// 		alert("Do delete"); // TODO
	// 	},
	// });

	return (
		<div class="p-4">
			{/* // TODO: Don't use `eq` op cause this should be full-text search */}
			<div class="relative">
				<div class="absolute top-0 bottom-0 pl-2 text-center">
					<div class="flex items-center justify-center h-full">
						<IconPhMagnifyingGlass />
					</div>
				</div>
				{/* // TODO: Debounce input a bit */}
				<Input
					placeholder="Search"
					class="mb-2 select-none pl-8"
					value={
						props.filters().find((f) => f.type === "string" && f.op === "eq")
							?.value ?? ""
					}
					onInput={(e) => {
						// TODO: Tack this on and update if we already have a search one????
						props.setFilters((filters) => [
							...(e.currentTarget.value === ""
								? []
								: ([
										{
											type: "string",
											op: "eq",
											// TODO: Search all fields but allow the user to refine it to a specific field???
											value: e.currentTarget.value,
										},
									] as const)),
							...filters.filter((f) => !(f.type === "string" && f.op === "eq")),
						]);
					}}
				/>
				<Show
					when={
						props
							.filters()
							.find((f) => f.type === "string" && f.op === "eq") !== undefined
					}
				>
					<button
						type="button"
						class="absolute top-0 bottom-0 right-0 pr-2 text-center"
						onClick={() =>
							props.setFilters((filters) =>
								filters.filter((f) => !(f.type === "string" && f.op === "eq")),
							)
						}
					>
						<div class="flex items-center justify-center h-full">
							<IconPhX />
						</div>
					</button>
				</Show>
			</div>
			<FilterBar filters={props.filters} setFilters={props.setFilters} />

			{/* // TODO: Optionally render results as chart */}
			<Suspense>
				<StandardTable table={table} />
			</Suspense>

			{/* // TODO: Remove this */}
			<pre class="pt-2">{JSON.stringify(props.filters(), null, 2)}</pre>
		</div>
	);
}

function FilterBar(props: {
	filters: Accessor<Filter[]>;
	setFilters: Setter<Filter[]>;
}) {
	const navigate = useNavigate();
	const createView = createMutation(() => ({
		mutationKey: ["createView"],
		mutationFn: async (data: Filter[]) => {
			const id = crypto.randomUUID();
			(await db).add("views", {
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

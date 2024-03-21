import { As, RadioGroup } from "@kobalte/core";
import { createColumnHelper } from "@tanstack/solid-table";
import {
	type ParentProps,
	Suspense,
	createSignal,
	Accessor,
	createMemo,
	For,
	createEffect,
} from "solid-js";
import { debounce } from "@solid-primitives/scheduled";

import IconCarbonCaretDown from "~icons/carbon/caret-down.jsx";
import {
	ColumnsDropdown,
	StandardTable,
	createStandardTable,
	selectCheckboxColumn,
} from "~/components/StandardTable";

export const route = {
	load: ({ params }) => {
		trpc.useContext().user.list.ensureData({
			tenantSlug: params.tenantSlug!,
		});
	},
} satisfies RouteDefinition;

const column = createColumnHelper<{ id: string; name: string }>();

const columns = [
	selectCheckboxColumn,
	column.accessor("name", {
		header: "Name",
		cell: (props) => (
			<A
				class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
				href={props.row.original.id}
			>
				{props.getValue()}
			</A>
		),
	}),
	// TODO: Descriptions, supported OS's.
];

function createApplicationsTable() {
	// const groups = trpc.policy.list.useQuery();

	const table = createStandardTable({
		get data() {
			return []; // TODO
			// return groups.data || [];
		},
		columns,
	});

	return { table };
}

export default function Page() {
	const { table } = createApplicationsTable();

	const isLoading = () => false;

	if (!isDebugMode()) {
		return (
			<PageLayout heading={<PageLayoutHeading>Applications</PageLayoutHeading>}>
				<h1 class="text-muted-foreground opacity-70">Coming soon...</h1>
			</PageLayout>
		);
	}

	return (
		<PageLayout
			heading={
				<>
					<PageLayoutHeading>Applications</PageLayoutHeading>
					<CreateApplicationSheet>
						<As component={Button} class="ml-auto">
							Create Application
						</As>
					</CreateApplicationSheet>
				</>
			}
		>
			<div class="flex flex-row items-center gap-4">
				<Input
					placeholder={isLoading() ? "Loading..." : "Search..."}
					disabled={isLoading()}
					value={(table.getColumn("name")?.getFilterValue() as string) ?? ""}
					onInput={(event) =>
						table.getColumn("name")?.setFilterValue(event.target.value)
					}
				/>
				<ColumnsDropdown table={table}>
					<As component={Button} variant="outline" class="ml-auto select-none">
						Columns
						<IconCarbonCaretDown class="ml-2 h-4 w-4" />
					</As>
				</ColumnsDropdown>
			</div>
			<Suspense>
				<StandardTable table={table} />
			</Suspense>
			{/* <AppleAppStoreDemo /> */}
		</PageLayout>
	);
}

import { A, type RouteDefinition } from "@solidjs/router";
import { createQuery, queryOptions } from "@tanstack/solid-query";
import {
	Button,
	Input,
	Label,
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
	Tabs,
	TabsList,
	TabsTrigger,
} from "@mattrax/ui";
import { Form, InputField, createZodForm } from "@mattrax/ui/forms";

import { isDebugMode, trpc } from "~/lib";
import { PageLayout, PageLayoutHeading } from "../PageLayout";
import { z } from "zod";
import clsx from "clsx";

const IOS_APP_SCHEMA = z.object({
	results: z.array(
		z.object({
			artworkUrl100: z.string(),
			trackName: z.string(),
			sellerName: z.string(),
			bundleId: z.string(),
		}),
	),
});

import { createWritableMemo } from "@solid-primitives/memo";

const APPLICATION_TARGETS = {
	iOS: {
		display: "iOS/iPad OS",
		queryOptions: (search) => ({
			queryKey: ["appStoreSearch", search()],
			queryFn: async () => {
				// TODO: Pagination support
				const res = await fetch(
					`https://itunes.apple.com/search?term=${search()}&entity=software`,
				);

				return IOS_APP_SCHEMA.parse(await res.json());
			},
		}),
	},
} satisfies Record<
	string,
	{ display: string; queryOptions: (search: Accessor<string>) => any }
>;

function CreateApplicationSheet(props: ParentProps) {
	const form = createZodForm({
		schema: z.object({
			name: z.string(),
		}),
		onSubmit: () => {
		},
	});

	const [search, setSearch] = createSignal("");
	const [targetType, setTargetType] =
		createSignal<keyof typeof APPLICATION_TARGETS>("iOS");

	const query = createQuery(
		queryOptions(() => APPLICATION_TARGETS[targetType()].queryOptions(search)),
	);

	const [selected, setSelected] = createWritableMemo(
		(prev: string | undefined) => {
			const results = query.data?.results;
			if (!results) return undefined;

			const first = results[0]?.bundleId;
			if (!prev) return first;
			if (results.find((result) => result.bundleId === prev)) return prev;

			return first;
		},
	);

	return (
		<Sheet>
			<SheetTrigger asChild>{props.children}</SheetTrigger>
			<SheetContent asChild>
				<As
					component={Form}
					form={form}
					fieldsetClass="p-6 overflow-hidden space-y-4 h-full flex flex-col"
				>
					<SheetHeader>
						<SheetTitle>Create Application</SheetTitle>
					</SheetHeader>
					<InputField form={form} label="Name" name="name" />
					<div class="flex flex-col space-y-1.5">
						<Label>Target</Label>
						<Tabs value={targetType()} onChange={setTargetType}>
							<TabsList>
								<For
									each={
										["iOS"] satisfies Array<keyof typeof APPLICATION_TARGETS>
									}
								>
									{(target) => (
										<TabsTrigger value={target}>
											{APPLICATION_TARGETS[target].display}
										</TabsTrigger>
									)}
								</For>
								{/*
								<TabsTrigger value="macOS">macOS</TabsTrigger>
								<TabsTrigger value="windows">Windows</TabsTrigger> */}
							</TabsList>
						</Tabs>
						<Input
							placeholder="Search Targets..."
							value={search()}
							onKeyPress={e => e.key === "Enter" && e.preventDefault()}
							onInput={debounce((e) => setSearch(e.target.value), 200)}
						/>
					</div>
					<RadioGroup.Root
						class="flex-1 overflow-y-auto !mt-1.5"
						value={selected()}
						onChange={setSelected}
					>
						<div class="p-1">
							<Suspense>
								<For each={query.data?.results}>
									{(app) => (
										<RadioGroup.Item value={app.bundleId}>
											<RadioGroup.ItemInput class="peer" />
											<RadioGroup.ItemControl
												class={clsx(
													"flex flex-row p-2 gap-2 items-center rounded-md",
													"border-2 border-transparent ui-checked:border-brand peer-focus-visible:outline outline-brand",
												)}
											>
												<img src={app.artworkUrl100} class="rounded h-12" />
												<div class="flex flex-col text-sm flex-1">
													<span class="font-semibold">{app.trackName}</span>
													<span class="text-gray-700">{app.sellerName}</span>
												</div>
											</RadioGroup.ItemControl>
										</RadioGroup.Item>
									)}
								</For>
							</Suspense>
						</div>
					</RadioGroup.Root>
					<Button type="submit" class="grow-0">
						Create
					</Button>
				</As>
			</SheetContent>
		</Sheet>
	);
}

import { As, RadioGroup } from "@kobalte/core";
import { createColumnHelper } from "@tanstack/solid-table";
import {
	type ParentProps,
	Suspense,
	createSignal,
	type Accessor,
	For,
	createEffect,
	startTransition,
	ErrorBoundary,
	catchError,
} from "solid-js";
import { debounce } from "@solid-primitives/scheduled";

import IconCarbonCaretDown from "~icons/carbon/caret-down.jsx";
import {
	ColumnsDropdown,
	StandardTable,
	createStandardTable,
	selectCheckboxColumn,
} from "~c/StandardTable";

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
	const tenantSlug = useTenantSlug();
	const apps = trpc.app.list.useQuery(() => ({
		tenantSlug: tenantSlug(),
	}));

	const table = createStandardTable({
		get data() {
			return apps.data ?? [];
		},
		columns,
	});

	return { table, apps };
}

export default function Page() {
	const { table, apps } = createApplicationsTable();

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
					placeholder={apps.isLoading ? "Loading..." : "Search..."}
					disabled={apps.isLoading}
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
		</PageLayout>
	);
}

import { A, useNavigate, type RouteDefinition } from "@solidjs/router";
import { createQuery, queryOptions } from "@tanstack/solid-query";
import {
	Button,
	Input,
	Sheet,
	SheetContent,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
	Tabs,
	TabsList,
	TabsTrigger,
} from "@mattrax/ui";
import { Form, createZodForm } from "@mattrax/ui/forms";

import { trpc } from "~/lib";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { z } from "zod";
import clsx from "clsx";
import { useTenantSlug } from "../../t.[tenantSlug]";

const IOS_APP_SCHEMA = z.object({
	results: z.array(
		z.object({
			artworkUrl512: z.string(),
			trackName: z.string(),
			sellerName: z.string(),
			bundleId: z.string(),
		}),
	),
});

const APPLICATION_TARGETS = {
	iOS: {
		display: "iOS/iPad OS",
		queryOptions: (search) => ({
			queryKey: ["appStoreSearch", search()],
			queryFn: async () => {
				// TODO: Pagination support
				const res = await fetch(
					`https://itunes.apple.com/search?${new URLSearchParams({
						...(search() && { term: search() }),
						entity: "software",
					})}`,
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
	const tenantSlug = useTenantSlug();
	const navigate = useNavigate();

	const createApplication = trpc.app.create.useMutation();
	const form = createZodForm({
		schema: z.object({
			targetType: z.custom<keyof typeof APPLICATION_TARGETS>(),
			targetId: z.string(),
		}),
		defaultValues: {
			targetType: "iOS",
			targetId: "",
		},
		onSubmit: async ({ value }) => {
			const app = await createApplication.mutateAsync({
				...value,
				name: query.data?.results.find((r) => r.bundleId === value.targetId)
					?.trackName!,
				tenantSlug: tenantSlug(),
			});
			await startTransition(() => navigate(app.id));
		},
	});

	const [search, setSearch] = createSignal("");

	const query = createQuery(
		queryOptions(() => ({
			...APPLICATION_TARGETS[form.getFieldValue("targetType")].queryOptions(
				search,
			),
			throwOnError: false,
		})),
	);

	createEffect(() => {
		const results = query.data?.results;
		if (!results) {
			form.setFieldValue("targetId", undefined!);
			return;
		}

		const first = results[0]?.bundleId;
		if (!form.getFieldValue("targetId")) form.setFieldValue("targetId", first!);
		if (
			results.find(
				(result) => result.bundleId === form.getFieldValue("targetId"),
			)
		)
			return;

		form.setFieldValue("targetId", first!);
	});

	return (
		<Sheet>
			<SheetTrigger asChild>{props.children}</SheetTrigger>
			<SheetContent asChild padding="none">
				<As
					component={Form}
					form={form}
					fieldsetClass="p-6 overflow-hidden space-y-4 h-full flex flex-col"
				>
					<SheetHeader>
						<SheetTitle>Create Application</SheetTitle>
					</SheetHeader>
					<div class="flex flex-col space-y-1.5">
						<form.Field name="targetType">
							{(field) => (
								<Tabs
									value={field().state.value}
									onChange={(v) => field().handleChange(v as any)}
								>
									<TabsList>
										<For
											each={
												["iOS"] satisfies Array<
													keyof typeof APPLICATION_TARGETS
												>
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
							)}
						</form.Field>
						<Input
							placeholder="Search Targets..."
							value={search()}
							onKeyPress={(e) => e.key === "Enter" && e.preventDefault()}
							onInput={debounce((e) => setSearch(e.target.value), 200)}
						/>
					</div>
					<form.Field name="targetId">
						{(field) => (
							<RadioGroup.Root
								class="flex-1 overflow-y-auto !mt-1.5"
								value={field().state.value}
								onChange={(v) => field().handleChange(v)}
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
														<img
															src={app.artworkUrl512}
															alt=""
															class="rounded h-12"
														/>
														<div class="flex flex-col text-sm flex-1">
															<span class="font-semibold">{app.trackName}</span>
															<span class="text-gray-700">
																{app.sellerName}
															</span>
														</div>
													</RadioGroup.ItemControl>
												</RadioGroup.Item>
											)}
										</For>
									</Suspense>
								</div>
							</RadioGroup.Root>
						)}
					</form.Field>
					<Button type="submit" class="grow-0">
						Create
					</Button>
				</As>
			</SheetContent>
		</Sheet>
	);
}

import { createColumnHelper } from "@tanstack/solid-table";
import { type Accessor, Suspense } from "solid-js";

import {
	ColumnsDropdown,
	StandardTable,
	createSearchParamFilter,
	createStandardTable,
	selectCheckboxColumn,
} from "~c/StandardTable";
import IconCarbonCaretDown from "~icons/carbon/caret-down.jsx";

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

export default function Page() {
	const tenantSlug = useTenantSlug();

	const apps = trpc.app.list.createQuery(() => ({ tenantSlug: tenantSlug() }));
	cacheMetadata("application", () => apps.data ?? []);

	const table = createStandardTable({
		get data() {
			return apps.data ?? [];
		},
		columns,
	});

	createSearchParamFilter(table, "name", "search");

	return (
		<PageLayout
			heading={
				<>
					<PageLayoutHeading>Applications</PageLayoutHeading>
					<CreateApplicationSheet>
						{(props) => (
							<Button class="ml-auto" {...props}>
								Create Application
							</Button>
						)}
					</CreateApplicationSheet>
				</>
			}
		>
			<div class="flex flex-row items-center gap-4">
				<TableSearchParamsInput query={apps} />
				<ColumnsDropdown table={table}>
					<DropdownMenuTrigger
						as={Button}
						variant="outline"
						class="ml-auto select-none"
					>
						Columns
						<IconCarbonCaretDown class="ml-2 h-4 w-4" />
					</DropdownMenuTrigger>
				</ColumnsDropdown>
			</div>
			<Suspense>
				<StandardTable table={table} />
			</Suspense>
		</PageLayout>
	);
}

import { Button, DropdownMenuTrigger } from "@mattrax/ui";
import { A, type RouteDefinition } from "@solidjs/router";
import { queryOptions } from "@tanstack/solid-query";

import { z } from "zod";
import { trpc } from "~/lib";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import { TableSearchParamsInput } from "~c/TableSearchParamsInput";
import { useTenantSlug } from "../../t.[tenantSlug]";
import { cacheMetadata } from "../metadataCache";
import { CreateApplicationSheet } from "./CreateApplicationSheet";

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

export const APPLICATION_TARGETS = {
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

import { Button, DropdownMenuTrigger } from "@mattrax/ui";
import { A, type RouteDefinition } from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";

import { Suspense } from "solid-js";
import { trpc } from "~/lib";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import {
	ColumnsDropdown,
	StandardTable,
	createSearchParamFilter,
	createStandardTable,
	selectCheckboxColumn,
} from "~c/StandardTable";
import { TableSearchParamsInput } from "~c/TableSearchParamsInput";
import IconCarbonCaretDown from "~icons/carbon/caret-down.jsx";
import { cacheMetadata } from "../metadataCache";
import { CreateApplicationSheet } from "./CreateApplicationSheet";
import { useTenantSlug } from "../ctx";

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

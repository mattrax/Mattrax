import {
	Badge,
	Button,
	DropdownMenuTrigger,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@mattrax/ui";
import { A, type RouteDefinition } from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";
import { Show, Suspense } from "solid-js";

import type { RouterOutput } from "~/api/trpc";
import { TableSearchParamsInput } from "~/components/TableSearchParamsInput";
import { trpc } from "~/lib";
import { AUTH_PROVIDER_DISPLAY } from "~/lib/values";
import { PageLayout, PageLayoutHeading } from "~c/PageLayout";
import {
	ColumnsDropdown,
	StandardTable,
	createSearchParamFilter,
	createSearchParamPagination,
	createStandardTable,
	selectCheckboxColumn,
} from "~c/StandardTable";
import IconCarbonCaretDown from "~icons/carbon/caret-down.jsx";
import IconCarbonCaretSort from "~icons/carbon/caret-sort.jsx";
import IconMaterialSymbolsWarningRounded from "~icons/material-symbols/warning-rounded.jsx";
import { useTenantSlug } from "../../t.[tenantSlug]";
import { cacheMetadata } from "../metadataCache";

export const route = {
	load: ({ params }) => {
		trpc.useContext().user.list.ensureData({
			tenantSlug: params.tenantSlug!,
		});
	},
} satisfies RouteDefinition;

const column = createColumnHelper<RouterOutput["user"]["list"][number]>();

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
	column.accessor("email", {
		header: ({ column }) => {
			return (
				<Button
					variant="ghost"
					onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
				>
					Email
					{/* TODO: Indicate which way we are sorting */}
					<IconCarbonCaretSort class="ml-2 h-4 w-4" />
				</Button>
			);
		},
	}),
	column.accessor("provider.variant", {
		header: "Provider",
		cell: (props) => {
			const providerDisplayName = () => AUTH_PROVIDER_DISPLAY[props.getValue()];
			return (
				<span class="flex flex-row gap-1 items-center">
					<Badge variant="secondary">{providerDisplayName()}</Badge>
					<Show when={props.row.original.resourceId === null}>
						<Tooltip>
							<TooltipTrigger>
								<IconMaterialSymbolsWarningRounded class="w-4 h-4 text-yellow-600" />
							</TooltipTrigger>
							<TooltipContent>
								User not found in {providerDisplayName()}
							</TooltipContent>
						</Tooltip>
					</Show>
				</span>
			);
		},
	}),
	// TODO: Link to OAuth provider
	// TODO: Actions
];

export default function Page() {
	const tenantSlug = useTenantSlug();

	const users = trpc.user.list.createQuery(() => ({
		tenantSlug: tenantSlug(),
	}));
	cacheMetadata("user", () => users.data ?? []);

	const table = createStandardTable({
		get data() {
			return users.data || [];
		},
		columns,
		pagination: true,
	});

	createSearchParamPagination(table, "page");
	createSearchParamFilter(table, "name", "search");

	return (
		<PageLayout heading={<PageLayoutHeading>Users</PageLayoutHeading>}>
			<div class="flex flex-row items-center gap-4">
				<TableSearchParamsInput query={users} class="flex-1" />
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

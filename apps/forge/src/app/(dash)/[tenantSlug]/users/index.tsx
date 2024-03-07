import { As } from "@kobalte/core";
import { A } from "@solidjs/router";
import { createColumnHelper } from "@tanstack/solid-table";
import { Show, Suspense } from "solid-js";
import { RouterOutput } from "~/api/trpc";

import {
	ColumnsDropdown,
	StandardTable,
	createStandardTable,
	createSearchParamPagination,
	selectCheckboxColumn,
} from "~/components/StandardTable";
import {
	Badge,
	Button,
	Input,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "~/components/ui";
import { trpc, untrackScopeFromSuspense } from "~/lib";
import { AUTH_PROVIDER_DISPLAY } from "~/lib/values";
import { PageLayout, PageLayoutHeading } from "../PageLayout";
import { useTenantSlug } from "../../[tenantSlug]";

const column = createColumnHelper<RouterOutput["user"]["list"][number]>();

export const columns = [
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

function createUsersTable() {
	const tenantSlug = useTenantSlug();
	const users = trpc.user.list.useQuery(() => ({
		tenantSlug: tenantSlug(),
	}));

	const table = createStandardTable({
		get data() {
			return users.data || [];
		},
		columns,
		pagination: true,
	});

	createSearchParamPagination(table, "page");

	return { table, users };
}

export default function Page() {
	const { table, users } = createUsersTable();

	const isLoading = untrackScopeFromSuspense(() => users.isLoading);

	return (
		<PageLayout heading={<PageLayoutHeading>Users</PageLayoutHeading>}>
			<div class="flex flex-row items-center gap-4">
				<Input
					placeholder={isLoading() ? "Loading..." : "Search..."}
					disabled={isLoading()}
					value={(table.getColumn("email")?.getFilterValue() as string) ?? ""}
					onInput={(event) =>
						table.getColumn("email")?.setFilterValue(event.target.value)
					}
					class="flex-1"
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

import {
	type AccessorKeyColumnDef,
	createColumnHelper,
} from "@tanstack/solid-table";
import type { Database } from "~/lib/db";

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

export const filters = {
	users: {
		table: () => {
			const column = createColumnHelper<Database["users"]["value"]>();

			return [
				column.accessor("name", {
					header: "Name",
					cell: (props) => (
						<a
							class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
							href={`/users/${props.row.original.id}`}
						>
							{props.row.original.name}
						</a>
					),
				}),
				// column.accessor("email", {
				// 	header: ({ column }) => {
				// 		return (
				// 			<Button variant="ghost" onClick={() => column.toggleSorting()}>
				// 				Email
				// 				<Switch fallback={<IconCarbonCaretSort class="ml-2 h-4 w-4" />}>
				// 					<Match when={column.getIsSorted() === "asc"}>
				// 						<IconCarbonCaretSortUp class="ml-2 h-4 w-4" />
				// 					</Match>
				// 					<Match when={column.getIsSorted() === "desc"}>
				// 						<IconCarbonCaretSortDown class="ml-2 h-4 w-4" />
				// 					</Match>
				// 				</Switch>
				// 			</Button>
				// 		);
				// 	},
				// }),
				// column.accessor("provider.variant", {
				// 	header: "Provider",
				// 	cell: (props) => {
				// 		const providerDisplayName = () => AUTH_PROVIDER_DISPLAY[props.getValue()];
				// 		return (
				// 			<span class="flex flex-row gap-1 items-center">
				// 				<Badge variant="outline">{providerDisplayName()}</Badge>
				// 				<Show when={props.row.original.resourceId === null}>
				// 					<Tooltip>
				// 						<TooltipTrigger>
				// 							<IconMaterialSymbolsWarningRounded class="w-4 h-4 text-yellow-600" />
				// 						</TooltipTrigger>
				// 						<TooltipContent>
				// 							User not found in {providerDisplayName()}
				// 						</TooltipContent>
				// 					</Tooltip>
				// 				</Show>
				// 			</span>
				// 		);
				// 	},
				// }),
				// TODO: Link to OAuth provider
				// TODO: Actions
			];
		},
		// TODO: Define bulk actions like delete
		// columns: {
		// 	name: {
		// 		// TODO: Document which filters are supported
		// 	},
		// },
	},
	devices: {
		table: () => {
			const column = createColumnHelper<Database["devices"]["value"]>();

			return [
				column.accessor("name", {
					header: "Name",
					cell: (props) => (
						<a
							class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
							href={`/devices/${props.row.original.id}`}
						>
							{props.row.original.name}
						</a>
					),
				}),
			];
		},
	},
	groups: {
		table: () => {
			const column = createColumnHelper<Database["groups"]["value"]>();

			return [
				column.accessor("name", {
					header: "Name",
					cell: (props) => (
						<a
							class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
							href={`/groups/${props.row.original.id}`}
						>
							{props.row.original.name}
						</a>
					),
				}),
			];
		},
	},
	policies: {
		table: () => {
			const column = createColumnHelper<Database["policies"]["value"]>();

			return [
				column.accessor("name", {
					header: "Name",
					cell: (props) => (
						<a
							class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
							href={`/policies/${props.row.original.id}`}
						>
							{props.row.original.name}
						</a>
					),
				}),
			];
		},
	},
	apps: {
		table: () => {
			const column = createColumnHelper<Database["apps"]["value"]>();

			return [
				column.accessor("name", {
					header: "Name",
					cell: (props) => (
						<a
							class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
							href={`/applications/${props.row.original.id}`}
						>
							{props.row.original.name}
						</a>
					),
				}),
			];
		},
	},
} satisfies Record<string, { table: () => AccessorKeyColumnDef<any, any>[] }>;

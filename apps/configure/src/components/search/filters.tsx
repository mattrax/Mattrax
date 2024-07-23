import {
	type AccessorKeyColumnDef,
	createColumnHelper,
} from "@tanstack/solid-table";
import { type Database, db } from "~/lib/db";

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

// TODO: Rename this object probs???
export const filters = {
	users: {
		load: async () => await (await db).getAll("users"),
		columns: () => {
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
		// filters: {
		// 	"name"
		// }
		// TODO: Define bulk actions like delete
		// columns: {
		// 	name: {
		// 		// TODO: Document which filters are supported
		// 	},
		// },
	},
	devices: {
		load: async () => await (await db).getAll("devices"),
		columns: () => {
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
		load: async () => await (await db).getAll("groups"),
		columns: () => {
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
		load: async () => await (await db).getAll("policies"),
		columns: () => {
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
		load: async () => await (await db).getAll("apps"),
		columns: () => {
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
} satisfies Record<
	string,
	{
		// TODO: Tie column and data types together
		load: () => Promise<any>;
		columns: () => AccessorKeyColumnDef<any, any>[];
	}
>;

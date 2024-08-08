// This file contains the configuration for data fetching, filtering, ordering, and rendering.

import { Badge } from "@mattrax/ui";
import { A } from "@solidjs/router";
import { type Entity, defineEntity } from "./filters";

const typeColumn = (type: string) =>
	({
		header: "Type",
		// Badge width + padding
		size: 66.82 + 2 * 16,
		render: () => <Badge variant="secondary">{type.toUpperCase()}</Badge>,
		raw: () => type.toUpperCase(),
	}) as const;

export const entities = {
	users: defineEntity({
		load: async (db) => await db.getAll("users"),
		columns: {
			type: typeColumn("USER"),
			name: {
				header: "Name",
				render: (user) => (
					<A
						class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
						href={`../users/${user.id}`}
					>
						{user.name}
					</A>
				),
				raw: (user) => user.name,
			},
			email: {
				header: "Email",
				render: (user) => <p>{user.upn}</p>,
				raw: (user) => user.upn,
			},
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
		},
		actions: {
			delete: {
				title: "Delete",
				variant: "destructive",
				apply: async (data) => alert("TODO: Bulk delete"),
			},
			// TODO: Assign to group
		},
		// TODO: Should filters be a global thing or scoped to the entity???
		filters: {
			email: {
				title: "Email",
				icon: IconPhEnvelope as any,
				// operations: [
				// 	// TODO: Allow the user to define `string[]` for it
				// 	{
				// 		title: "in",
				// 		apply: (data) => {},
				// 	},
				// 	{
				// 		title: "not in",
				// 		apply: (data) => {},
				// 	},
				// 	// TODO: Allow the user to define `string` using Combobox (with values from DB)
				// 	{
				// 		title: "equals",
				// 		apply: (data) => {},
				// 	},
				// ],
				// render: (data) => data.email,
			},
		},
		// TODO: Relations
	}),
	devices: defineEntity({
		load: async (db) => await db.getAll("devices"),
		columns: {
			type: typeColumn("DEVICE"),
			name: {
				header: "Name",
				render: (device) => (
					<A
						class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
						href={`../devices/${device.id}`}
					>
						{device.name}
					</A>
				),
				raw: (device) => device.name,
			},
			model: {
				header: "Model",
				render: (device) => <p>{device.model}</p>,
				raw: (device) => device.model!, // TODO: Remove assert
			},
			manufacturer: {
				header: "Manufacturer",
				render: (device) => <p>{device.manufacturer}</p>,
				raw: (device) => device.manufacturer!, // TODO: Remove assert
			},
		},
		actions: {
			sync: {
				title: "Sync",
				apply: async (data) => alert("TODO: Sync"),
			},
			// TODO: Make these devices actions only available on supported OS's
			diagnostics: {
				title: "Collect diagnostics",
				apply: async (data) => alert("TODO: Collect diagnostics"),
			},
			rename: {
				title: "Rename",
				apply: async (data) => alert("TODO: Rename"),
			},
			delete: {
				title: "Delete",
				variant: "destructive",
				apply: async (data) => alert("TODO: Bulk delete"),
			},
			retire: {
				title: "Retire",
				variant: "destructive",
				apply: async (data) => alert("TODO: Retire device"),
			},
			wipe: {
				title: "Wipe",
				variant: "destructive",
				apply: async (data) => alert("TODO: Wipe"),
			},
			reset: {
				title: "Autopilot reset",
				variant: "destructive",
				apply: async (data) => alert("TODO: Autopilot reset"),
			},
			restart: {
				title: "Restart",
				variant: "destructive",
				apply: async (data) => alert("TODO: Restart"),
			},
			// TODO: Maybe "Send notification"???
		},
		filters: {},
	}),
	groups: defineEntity({
		load: async (db) => await db.getAll("groups"),
		columns: {
			type: typeColumn("GROUP"),
			name: {
				header: "Name",
				render: (group) => (
					<A
						class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
						href={`../groups/${group.id}`}
					>
						{group.name}
					</A>
				),
				raw: (group) => group.name,
			},
			description: {
				header: "Description",
				render: (group) => <p>{group.description}</p>,
				raw: (group) => group.description!, // TODO: Remove assert
			},
		},
		actions: {
			delete: {
				title: "Delete",
				variant: "destructive",
				apply: async (data) => alert("TODO: Bulk delete"),
			},
		},
		filters: {},
	}),
	policies: defineEntity({
		load: async (db) => await db.getAll("policies"),
		columns: {
			type: typeColumn("POLICY"),
			name: {
				header: "Name",
				render: (policy) => (
					<A
						class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
						href={`../policies/${policy.id}`}
					>
						{policy.name}
					</A>
				),
				raw: (policy) => policy.name,
			},
			description: {
				header: "Description",
				render: (group) => <p>{group.description}</p>,
				raw: (group) => group.description!, // TODO: Remove assert
			},
		},
		actions: {
			delete: {
				title: "Delete",
				variant: "destructive",
				apply: async (data) => alert("TODO: Bulk delete"),
			},
		},
		filters: {},
	}),
	scripts: defineEntity({
		load: async (db) => await db.getAll("scripts"),
		columns: {
			type: typeColumn("SCRIPT"),
			name: {
				header: "Name",
				render: (script) => (
					<A
						class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
						href={`../scripts/${script.id}`}
					>
						{script.name}
					</A>
				),
				raw: (script) => script.name,
			},
			description: {
				header: "Description",
				render: (group) => <p>{group.description}</p>,
				raw: (group) => group.description!, // TODO: Remove assert
			},
		},
		actions: {
			delete: {
				title: "Delete",
				variant: "destructive",
				apply: async (data) => alert("TODO: Bulk delete"),
			},
		},
		filters: {},
	}),
	apps: defineEntity({
		load: async (db) => await db.getAll("apps"),
		columns: {
			type: typeColumn("APP"),
			name: {
				header: "Name",
				render: (app) => (
					<A
						class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
						href={`../applications/${app.id}`}
					>
						{app.name}
					</A>
				),
				raw: (app) => app.name,
			},
			description: {
				header: "Description",
				render: (group) => <p>{group.description}</p>,
				raw: (group) => group.description!, // TODO: Remove assert
			},
		},
		actions: {
			delete: {
				title: "Delete",
				variant: "destructive",
				apply: async (data) => alert("TODO: Bulk delete"),
			},
		},
		filters: {},
	}),
} satisfies Record<string, Entity<any>>;

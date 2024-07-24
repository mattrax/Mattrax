// This file contains the configuration for data fetching, filtering, ordering, and rendering.

import { Badge } from "@mattrax/ui";
import { db } from "~/lib/db";
import { type Entity, defineEntity } from "./filters";

const typeColumn = (type: string) =>
	({
		header: "Type",
		// Badge width + padding
		size: 66.82 + 2 * 16,
		render: () => <Badge variant="secondary">{type.toUpperCase()}</Badge>,
	}) as const;

export const entities = {
	users: defineEntity({
		load: async () => await (await db).getAll("users"),
		columns: {
			type: typeColumn("USER"),
			name: {
				header: "Name",
				render: (user) => (
					<a
						class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
						href={`/users/${user.id}`}
					>
						{user.name}
					</a>
				),
			},
			email: {
				header: "Email",
				render: (user) => <p>{user.upn}</p>,
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
		// TODO: Define filters
		// TODO: Define bulk actions like delete
	}),
	devices: defineEntity({
		load: async () => await (await db).getAll("devices"),
		columns: {
			type: typeColumn("DEVICE"),
			name: {
				header: "Name",
				render: (device) => (
					<a
						class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
						href={`/devices/${device.id}`}
					>
						{device.name}
					</a>
				),
			},
			model: {
				header: "Model",
				render: (device) => <p>{device.model}</p>,
			},
			manufacturer: {
				header: "Manufacturer",
				render: (device) => <p>{device.manufacturer}</p>,
			},
		},
	}),
	groups: defineEntity({
		load: async () => await (await db).getAll("groups"),
		columns: {
			type: typeColumn("GROUP"),
			name: {
				header: "Name",
				render: (group) => (
					<a
						class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
						href={`/groups/${group.id}`}
					>
						{group.name}
					</a>
				),
			},
			description: {
				header: "Description",
				render: (group) => <p>{group.description}</p>,
			},
		},
	}),
	policies: defineEntity({
		load: async () => await (await db).getAll("policies"),
		columns: {
			type: typeColumn("POLICY"),
			name: {
				header: "Name",
				render: (policy) => (
					<a
						class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
						href={`/policies/${policy.id}`}
					>
						{policy.name}
					</a>
				),
			},
			description: {
				header: "Description",
				render: (group) => <p>{group.description}</p>,
			},
		},
	}),
	apps: defineEntity({
		load: async () => await (await db).getAll("apps"),
		columns: {
			type: typeColumn("APP"),
			name: {
				header: "Name",
				render: (app) => (
					<a
						class="font-medium hover:underline focus:underline p-1 -m-1 w-full block"
						href={`/applications/${app.id}`}
					>
						{app.name}
					</a>
				),
			},
			description: {
				header: "Description",
				render: (group) => <p>{group.description}</p>,
			},
		},
	}),
} satisfies Record<string, Entity<any>>;

import { type RouteDefinition, createAsync } from "@solidjs/router";
import { type ParentProps, Show, Suspense, createMemo } from "solid-js";

import { useCommandGroup } from "~/components/CommandPalette";
import { trpc } from "~/lib";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { useTenantParams } from "./t.[tenantSlug]/ctx";
import { useTenants } from "./utils";

export const route = {
	load: ({ params }) => {
		trpc.useContext().tenant.list.ensureData({ orgSlug: params.orgSlug! });
	},
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const params = useTenantParams();

	useTenants();

	useCommandGroup("Tenant", [
		{
			title: "Overview",
			href: "",
		},
		{
			title: "Users",
			href: "users",
		},
		{
			title: "Devices",
			href: "devices",
		},
		{
			title: "Policies",
			href: "policies",
		},
		{
			title: "Applications",
			href: "apps",
		},
		{
			title: "Groups",
			href: "groups",
		},
		{
			title: "Settings",
			href: "settings",
		},
		{
			title: "Create Tenant",
			onClick: () => alert(1), // TODO
		},
		{
			title: "Invite Account",
			onClick: () => alert(1), // TODO
		},
		{
			title: "Create Policy",
			onClick: () => alert(1), // TODO
		},
		{
			title: "Create Application",
			onClick: () => alert(1), // TODO
		},
		{
			title: "Create Group",
			onClick: () => alert(1), // TODO
		},
		// TODO: Search/open group/policy/application from popup
	]);

	return (
		<>
			<MErrorBoundary>
				{/* we key here on purpose - tenants are the root-most unit of isolation */}
				<Show when={params.tenantSlug} keyed>
					<Suspense
						fallback={
							<Show when={false}>
								{(_) => {
									console.warn("t.[tenantSlug] layout suspensed!");
									return null;
								}}
							</Show>
						}
					>
						{props.children}
					</Suspense>
				</Show>
			</MErrorBoundary>
		</>
	);
}

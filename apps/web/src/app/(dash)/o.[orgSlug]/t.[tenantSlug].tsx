import { type RouteDefinition, createAsync } from "@solidjs/router";
import { type ParentProps, Show, Suspense, createMemo } from "solid-js";

import { trpc } from "~/lib";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { cachedOrgs } from "../utils";
import { useTenantParams } from "./t.[tenantSlug]/ctx";
import { cachedTenantsForOrg } from "./utils";

export const route = {
	load: ({ params }) => {
		trpc.useContext().tenant.list.ensureData({ orgSlug: params.orgSlug! });
	},
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const params = useTenantParams();

	const orgs = createAsync(() => cachedOrgs());

	createMemo(
		createAsync(async () => {
			const org = orgs()?.find((o) => o.slug === params.orgSlug);
			if (!org) return;
			return await cachedTenantsForOrg(org.id);
		}),
	);

	return (
		<>
			<MErrorBoundary>
				{/* we key here on purpose - tenants are the root-most unit of isolation */}
				<Show when={params.tenantSlug} keyed>
					<Suspense>{props.children}</Suspense>
				</Show>
			</MErrorBoundary>
		</>
	);
}

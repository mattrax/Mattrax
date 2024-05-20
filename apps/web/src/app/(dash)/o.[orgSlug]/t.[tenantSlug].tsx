import { type ParentProps, Show, Suspense, createMemo } from "solid-js";
import { type RouteDefinition, createAsync } from "@solidjs/router";
import { z } from "zod";

import { useZodParams } from "~/lib/useZodParams";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { trpc } from "~/lib";
import { cachedOrgs } from "../utils";
import { cachedTenantsForOrg } from "./utils";

export function useTenantSlug() {
	const params = useZodParams({ tenantSlug: z.string() });
	return () => params.tenantSlug;
}

export const route = {
	load: ({ params }) => {
		trpc.useContext().tenant.list.ensureData({ orgSlug: params.orgSlug! });
	},
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const params = useZodParams({ orgSlug: z.string(), tenantSlug: z.string() });

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

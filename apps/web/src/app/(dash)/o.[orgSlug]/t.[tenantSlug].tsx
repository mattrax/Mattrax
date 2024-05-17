import { type ParentProps, Show, Suspense, createMemo } from "solid-js";
import { type RouteDefinition, A, createAsync } from "@solidjs/router";
import { z } from "zod";

import { useZodParams } from "~/lib/useZodParams";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import IconPhCaretUpDown from "~icons/ph/caret-up-down.jsx";
import { MultiSwitcher } from "../MultiSwitcher";
import { Button } from "@mattrax/ui";
import { trpc } from "~/lib";
import { createQueryCacher, useCachedQueryData } from "~/cache";
import { cachedOrgs } from "../utils";
import { cachedTenantsForOrg } from "./utils";

export function useTenantSlug() {
	const params = useZodParams({ tenantSlug: z.string() });
	return () => params.tenantSlug;
}

const NAV_ITEMS = [
	{ title: "Dashboard", href: "" },
	{ title: "Users", href: "users" },
	{ title: "Devices", href: "devices" },
	{ title: "Policies", href: "policies" },
	{ title: "Applications", href: "apps" },
	{ title: "Groups", href: "groups" },
	{ title: "Settings", href: "settings" },
];

export const route = {
	load: ({ params }) => {
		trpc.useContext().tenant.list.ensureData({ orgSlug: params.orgSlug! });
	},
	info: {
		NAV_ITEMS,
		BREADCRUMB: {
			hasNestedSegments: true,
			Component: (props: { href: string }) => {
				const params = useZodParams({
					orgSlug: z.string(),
					tenantSlug: z.string(),
				});

				const query = trpc.org.list.createQuery();
				const orgs = useCachedQueryData(query, () => cachedOrgs());
				const org = () => orgs()?.find((o) => o.slug === params.orgSlug);

				return (
					<Show when={org()}>
						{(org) => {
							const query = trpc.tenant.list.createQuery(() => ({
								orgSlug: params.orgSlug,
							}));
							createQueryCacher(query, "tenants", (t) => ({ ...t }));
							const tenants = useCachedQueryData(query, () =>
								cachedTenantsForOrg(org().id),
							);

							const tenant = () =>
								tenants()?.find((t) => t.slug === params.tenantSlug);

							return (
								<div class="flex flex-row items-center py-1 gap-2">
									<A href={props.href}>{tenant()?.name}</A>
									<MultiSwitcher>
										<Button variant="ghost" size="iconSmall">
											<IconPhCaretUpDown class="h-5 w-5 -mx-1" />
										</Button>
									</MultiSwitcher>
								</div>
							);
						}}
					</Show>
				);
			},
		},
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

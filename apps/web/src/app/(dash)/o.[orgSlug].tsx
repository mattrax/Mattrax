/* @refresh skip */

import { Button } from "@mattrax/ui";
import { type RouteDefinition, A, createAsync } from "@solidjs/router";
import { createMemo, lazy, type ParentProps } from "solid-js";
import { z } from "zod";

import IconPhCaretUpDown from "~icons/ph/caret-up-down.jsx";
import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";
import { createQueryCacher, useCachedQueryData } from "~/cache";
import { cachedOrgs } from "./utils";

const MultiSwitcher = lazy(() =>
	import("./MultiSwitcher").then((s) => ({ default: s.MultiSwitcher })),
);

export function useOrgSlug() {
	const params = useZodParams({ orgSlug: z.string() });
	return () => params.orgSlug;
}

export default function Layout(props: ParentProps) {
	createMemo(createAsync(() => cachedOrgs()));

	return <>{props.children}</>;
}

const NAV_ITEMS = [
	{ title: "Overview", href: "" },
	{ title: "Settings", href: "settings" },
];

export const route = {
	load: ({ params }) => {
		trpc.useContext().org.tenants.ensureData({ orgSlug: params.orgSlug! });
		trpc.useContext().org.list.ensureData();
	},
	info: {
		NAV_ITEMS,
		BREADCRUMB: {
			Component: (props: { href: string }) => {
				const params = useZodParams({ orgSlug: z.string() });

				const query = trpc.org.list.createQuery();
				createQueryCacher(query, "orgs", (org) => ({
					id: org.id,
					name: org.name,
					slug: org.slug,
				}));
				const orgs = useCachedQueryData(query, () => cachedOrgs());

				const org = () => orgs()?.find((o) => o.slug === params.orgSlug);

				return (
					<div class="flex flex-row items-center py-1 gap-2">
						<A href={props.href}>{org()?.name}</A>
						<MultiSwitcher>
							<Button variant="ghost" size="iconSmall">
								<IconPhCaretUpDown class="h-5 w-5 -mx-1" />
							</Button>
						</MultiSwitcher>
					</div>
				);
			},
		},
	},
} satisfies RouteDefinition;

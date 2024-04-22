/* @refresh skip */

import { As } from "@kobalte/core";
import { Button } from "@mattrax/ui";
import { type RouteDefinition, A } from "@solidjs/router";
import type { ParentProps } from "solid-js";
import { z } from "zod";

import { AuthContext } from "~/components/AuthContext";
import IconPhCaretUpDown from "~icons/ph/caret-up-down.jsx";
import { OrgContext, useOrg } from "./o.[orgSlug]/Context";
import { useZodParams } from "~/lib/useZodParams";
import { MultiSwitcher } from "./MultiSwitcher";
import { trpc } from "~/lib";

export function useOrgSlug() {
	const params = useZodParams({ orgSlug: z.string() });
	return () => params.orgSlug;
}

export default function Layout(props: ParentProps) {
	return <>{props.children}</>;
}

const NAV_ITEMS = [
	{ title: "Overview", href: "" },
	{ title: "Settings", href: "settings" },
];

export const route = {
	load: ({ params }) =>
		trpc.useContext().org.tenants.ensureData({ orgSlug: params.orgSlug! }),
	info: {
		NAV_ITEMS,
		BREADCRUMB: {
			Component: (props: { href: string }) => {
				return (
					<AuthContext>
						<OrgContext>
							<div class="flex flex-row items-center py-1 gap-2">
								<A href={props.href}>{useOrg()().name}</A>
								<MultiSwitcher>
									<As component={Button} variant="ghost" size="iconSmall">
										<IconPhCaretUpDown class="h-5 w-5 -mx-1" />
									</As>
								</MultiSwitcher>
							</div>
						</OrgContext>
					</AuthContext>
				);
			},
		},
	},
} satisfies RouteDefinition;

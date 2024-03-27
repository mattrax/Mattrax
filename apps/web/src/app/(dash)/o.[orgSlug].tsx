import { As, DropdownMenu as KDropdownMenu } from "@kobalte/core";
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@mattrax/ui";
import { type RouteDefinition, useNavigate } from "@solidjs/router";
import { For, type ParentProps, Suspense } from "solid-js";
import { z } from "zod";

import IconPhCaretUpDown from "~icons/ph/caret-up-down.jsx";
import { AuthContext, useAuth } from "~/components/AuthContext";
import { OrgContext, useOrg } from "./o.[orgSlug]/Context";
import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";

export function useOrgSlug() {
	const params = useZodParams({ orgSlug: z.string() });
	return () => params.orgSlug;
}

export default function Layout(props: ParentProps) {
	return <>{props.children}</>;
}

function OrgSwitcher() {
	const auth = useAuth();
	const org = useOrg();

	const navigate = useNavigate();

	return (
		<DropdownMenu>
			<div class="flex flex-row items-center gap-2">
				<span>{org().name}</span>
				<DropdownMenuTrigger asChild>
					<As component={Button} variant="ghost" size="iconSmall">
						<KDropdownMenu.Icon>
							<IconPhCaretUpDown class="h-5 w-5 -mx-1" />
						</KDropdownMenu.Icon>
					</As>
				</DropdownMenuTrigger>
			</div>
			<DropdownMenuContent>
				<Suspense>
					<For each={auth().orgs}>
						{(org) => (
							<DropdownMenuItem
								class={
									"block px-4 py-2 text-sm text-left w-full truncate hover:bg-gray-200"
								}
								onSelect={() => navigate(`/o/${org.slug}`)}
							>
								{org.name}
							</DropdownMenuItem>
						)}
					</For>

					{/* {auth().orgs.length !== 0 && <DropdownMenuSeparator />} */}
				</Suspense>
			</DropdownMenuContent>
		</DropdownMenu>
	);
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
			Component: () => {
				return (
					<AuthContext>
						<OrgContext>
							<OrgSwitcher />
						</OrgContext>
					</AuthContext>
				);
			},
		},
	},
} satisfies RouteDefinition;

import { As, DropdownMenu as KDropdownMenu } from "@kobalte/core";
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@mattrax/ui";
import { A, useMatch, useNavigate } from "@solidjs/router";
import { For, ParentProps, Suspense } from "solid-js";

import IconPhCaretUpDown from "~icons/ph/caret-up-down.jsx";
import { AuthContext, useAuth } from "~/components/AuthContext";
import { Breadcrumb } from "~/components/Breadcrumbs";
import { OrgContext, useOrg } from "./o.[orgSlug]/Context";
import { useZodParams } from "~/lib/useZodParams";
import { z } from "zod";

export function useOrgSlug() {
	const params = useZodParams({ orgSlug: z.string() });
	return () => params.orgSlug;
}

export default function Layout(props: ParentProps) {
	return (
		<>
			<Breadcrumb>
				<AuthContext>
					<OrgContext>
						<OrgSwitcher />
					</OrgContext>
				</AuthContext>
			</Breadcrumb>
			{props.children}
		</>
	);
}

function OrgSwitcher() {
	const auth = useAuth();
	const org = useOrg();

	const navigate = useNavigate();

	const segmentMatch = useMatch(() => "./:segment/:subSegment/*");

	return (
		<DropdownMenu>
			<div class="flex flex-row items-center gap-2">
				<A href={segmentMatch()?.params.segment ?? ""} class="block">
					{org().name}
				</A>
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
								onSelect={() => navigate(`../${org.slug}`)}
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
	info: { NAV_ITEMS },
};

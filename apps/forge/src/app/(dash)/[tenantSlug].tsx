import { useNavigate } from "@solidjs/router";
import { z } from "zod";
import {
	ErrorBoundary,
	ParentProps,
	Show,
	Suspense,
	startTransition,
} from "solid-js";

import { Button } from "~/components/ui";
import TopBar from "./[tenantSlug]/TopBar";
import { NavItems, useNavbarItems } from "./NavItems";
import { useZodParams } from "~/lib/useZodParams";

export function useTenantSlug() {
	const params = useZodParams({ tenantSlug: z.string() });
	return () => params.tenantSlug;
}

export default function Layout(props: ParentProps) {
	const params = useZodParams({ tenantSlug: z.string() });
	const navigate = useNavigate();

	function setTenantSlug(slug: string) {
		startTransition(() => navigate(`../${slug}`));
	}

	useNavbarItems(NAV_ITEMS);

	return (
		<>
			<TopBar setActiveTenant={setTenantSlug} />
			<NavItems />
			{/* we don't key the sidebar so that the tenant switcher closing animation can still play */}
			<ErrorBoundary
				fallback={(err, reset) => (
					<div class="flex flex-col items-center justify-center h-full gap-4">
						<h1 class="text-3xl font-semibold">An error occurred!</h1>
						<p class="text-gray-600 max-w-4xl">{err.toString()}</p>
						{err instanceof Error && (
							<code class="whitespace-pre max-w-6xl overflow-x-auto">
								{err.stack}
							</code>
						)}
						<Button onClick={reset}>Reload</Button>
					</div>
				)}
			>
				{/* we key here on purpose - tenants are the root-most unit of isolation */}
				<Show when={params.tenantSlug} keyed>
					<Suspense>{props.children}</Suspense>
				</Show>
			</ErrorBoundary>
		</>
	);
}

const NAV_ITEMS = [
	{
		title: "Dashboard",
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
];

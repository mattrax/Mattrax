import { useNavigate } from "@solidjs/router";
import { z } from "zod";
import { ParentProps, Show, Suspense, startTransition } from "solid-js";

import { TopBar } from "./[tenantSlug]/TopBar";
import { NavItems, useNavbarItems } from "./NavItems";
import { useZodParams } from "~/lib/useZodParams";
import { MErrorBoundary } from "~/components/MattraxErrorBoundary";

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
			<MErrorBoundary>
				{/* we key here on purpose - tenants are the root-most unit of isolation */}
				<Show when={params.tenantSlug} keyed>
					<Suspense>{props.children}</Suspense>
				</Show>
			</MErrorBoundary>
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

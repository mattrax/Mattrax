import { type ParentProps, Show, Suspense, startTransition } from "solid-js";
import { RouteDefinition, useNavigate } from "@solidjs/router";
import { z } from "zod";

import { useZodParams } from "~/lib/useZodParams";
import { MErrorBoundary } from "~/components/MattraxErrorBoundary";
import { Breadcrumb } from "~/components/Breadcrumbs";
import { AuthContext } from "../AuthContext";
import { TenantContext } from "./TenantContext";
import { TenantSwitcher } from "./[tenantSlug]/TenantSwitcher";

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

export const route = { info: { NAV_ITEMS } } satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const params = useZodParams({ tenantSlug: z.string() });
	const navigate = useNavigate();

	return (
		<>
			<Breadcrumb>
				<AuthContext>
					<TenantContext>
						<TenantSwitcher
							setActiveTenant={(slug) => {
								startTransition(() => navigate(`../${slug}`));
							}}
						/>
					</TenantContext>
				</AuthContext>
			</Breadcrumb>
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

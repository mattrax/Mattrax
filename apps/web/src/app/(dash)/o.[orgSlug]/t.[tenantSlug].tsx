import { type ParentProps, Show, Suspense, startTransition } from "solid-js";
import { type RouteDefinition, useNavigate } from "@solidjs/router";
import { z } from "zod";

import { useZodParams } from "~/lib/useZodParams";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { AuthContext } from "~c/AuthContext";
import { TenantContext } from "./t.[tenantSlug]/Context";
import { TenantSwitcher } from "./t.[tenantSlug]/TenantSwitcher";

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
	info: {
		NAV_ITEMS,
		BREADCRUMB: {
			hasNestedSegments: true,
			Component: (props: any) => {
				const navigate = useNavigate();

				return (
					<AuthContext>
						<TenantContext>
							<TenantSwitcher
								setActiveTenant={(slug) => {
									startTransition(() => navigate(`${props.path}/../${slug}`));
								}}
							/>
						</TenantContext>
					</AuthContext>
				);
			},
		},
	},
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	const params = useZodParams({ tenantSlug: z.string() });

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

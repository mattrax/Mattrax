import { createContextProvider } from "@solid-primitives/context";
import { type ParentProps, Switch, Match } from "solid-js";
import { z } from "zod";
import { Navigate } from "@solidjs/router";

import type { RouterOutput } from "~/api";
import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";

const [TenantContextProvider, useTenant] = createContextProvider(
	(props: { tenant: RouterOutput["tenant"]["list"][number] }) => () =>
		props.tenant,
	() => {
		throw new Error("`useTenant` used without `TenantContext` mounted above.");
	},
);

export { useTenant };

export function TenantContext(props: ParentProps) {
	const params = useZodParams({ tenantSlug: z.string(), orgSlug: z.string() });

	const tenants = trpc.tenant.list.createQuery(() => ({
		orgSlug: params.orgSlug,
	}));

	const activeTenant = () => {
		if (tenants.data === undefined) return undefined;

		return tenants.data.find((t) => t.slug === params.tenantSlug) ?? null;
	};

	return (
		<Switch>
			<Match when={activeTenant() === null}>
				<Navigate
					href={() => {
						const firstTenant = tenants.data?.[0];
						return firstTenant?.slug
							? `/o/${params.orgSlug}/t/${firstTenant.slug}`
							: `/o/${params.orgSlug}`;
					}}
				/>
			</Match>
			<Match when={activeTenant()}>
				{(tenant) => (
					<TenantContextProvider tenant={tenant()}>
						{props.children}
					</TenantContextProvider>
				)}
			</Match>
		</Switch>
	);
}

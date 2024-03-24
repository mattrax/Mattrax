import { createContextProvider } from "@solid-primitives/context";
import { ParentProps, Show, createMemo } from "solid-js";
import { z } from "zod";
import { Navigate } from "@solidjs/router";

import { RouterOutput } from "~/api";
import { useAuth } from "../../AuthContext";
import { useZodParams } from "~/lib/useZodParams";

const [TenantContextProvider, useTenant] = createContextProvider(
	(props: {
		tenant: RouterOutput["auth"]["me"]["tenants"][number];
	}) =>
		() =>
			props.tenant,
	null!,
);

export { useTenant };

export function TenantContext(props: ParentProps) {
	const params = useZodParams({ tenantSlug: z.string() });
	const auth = useAuth();

	const activeTenant = createMemo(() =>
		auth().tenants.find((t) => t.slug === params.tenantSlug),
	);

	return (
		<Show
			when={activeTenant()}
			fallback={
				<Navigate
					href={() => {
						const firstTenant = auth().tenants[0];
						return firstTenant?.slug ? `../${firstTenant.slug}` : "/";
					}}
				/>
			}
		>
			{(tenant) => (
				<TenantContextProvider tenant={tenant()}>
					{props.children}
				</TenantContextProvider>
			)}
		</Show>
	);
}

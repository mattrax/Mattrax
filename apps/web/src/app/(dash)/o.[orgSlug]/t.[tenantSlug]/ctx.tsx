import { useNavigate } from "@solidjs/router";
import { createEffect } from "solid-js";
import { z } from "zod";

import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";

export function useTenantParams() {
	const params = useZodParams({ tenantSlug: z.string(), orgSlug: z.string() });
	return params;
}

export function useTenantSlug() {
	const params = useTenantParams();
	return () => params.tenantSlug;
}

export function useTenant() {
	const params = useTenantParams();
	const navigate = useNavigate();
	const tenants = trpc.tenant.list.createQuery(() => ({
		orgSlug: params.orgSlug,
	}));

	const activeTenant = () => {
		if (tenants.data === undefined) return undefined;
		return tenants.data.find((t) => t.slug === params.tenantSlug);
	};

	createEffect(() => {
		if (tenants.data === undefined) return;

		if (activeTenant() === undefined) {
			const firstTenant = tenants.data?.[0];
			navigate(
				firstTenant?.slug
					? `/o/${params.orgSlug}/t/${firstTenant.slug}`
					: `/o/${params.orgSlug}`,
			);
		}
	});

	return Object.assign(activeTenant, {
		query: tenants,
	});
}

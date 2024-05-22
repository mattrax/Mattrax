import type { VariantTableVariants } from "~/components/VariantTableSheet";
import { trpc } from "~/lib";
import { useTenantSlug } from "../../../t.[tenantSlug]";

export function createMembersVariants(pathToTenant: string) {
	const tenantSlug = useTenantSlug();

	return {
		user: {
			label: "Users",
			query: trpc.tenant.variantTable.users.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
			href: (item) => `${pathToTenant}users/${item.id}`,
		},
		device: {
			label: "Devices",
			query: trpc.tenant.variantTable.devices.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
			href: (item) => `${pathToTenant}/devices/${item.id}`,
		},
	} satisfies VariantTableVariants;
}

export function createAssignmentsVariants(pathToTenant: string) {
	const tenantSlug = useTenantSlug();

	return {
		policy: {
			label: "Policies",
			query: trpc.tenant.variantTable.policies.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
			href: (item) => `${pathToTenant}policies/${item.id}`,
		},
		application: {
			label: "Applications",
			query: trpc.tenant.variantTable.apps.createQuery(() => ({
				tenantSlug: tenantSlug(),
			})),
			href: (item) => `${pathToTenant}/apps/${item.id}`,
		},
	} satisfies VariantTableVariants;
}

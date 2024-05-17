import { cache } from "@solidjs/router";
import { mattraxCache } from "~/cache";

export const cachedTenantsForOrg = cache(
	(orgId: string) =>
		mattraxCache.tenants
			.orderBy("id")
			.filter((o) => o.orgId === orgId)
			.toArray(),
	"cachedTenantsForOrg",
);

import { cache } from "@solidjs/router";
import { getMattraxCache } from "~/cache";

export const cachedTenantsForOrg = cache(
	(orgId: string) =>
		getMattraxCache().then((c) =>
			c.tenants
				.orderBy("id")
				.filter((o) => o.orgId === orgId)
				.toArray(),
		),
	"cachedTenantsForOrg",
);

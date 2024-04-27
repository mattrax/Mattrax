import { cache } from "@solidjs/router";
import { mattraxCache } from "~/cache";

// can't be in a route file that consumes it
export const cachedOrgs = cache(
	() => mattraxCache.orgs.orderBy("id").toArray(),
	"cachedOrgs",
);

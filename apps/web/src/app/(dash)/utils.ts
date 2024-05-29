import { cache } from "@solidjs/router";
import { getMattraxCache } from "~/cache";
import { trpc } from "~/lib";

// can't be in a route file that consumes it
export const cachedOrgs = cache(
	() => getMattraxCache().then((c) => c.orgs.orderBy("id").toArray()),
	"cachedOrgs",
);

export const useAuth = () => trpc.auth.me.createQuery();

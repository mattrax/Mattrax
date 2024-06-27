import { createQueryCacher, useCachedQueryData } from "~/cache";
import { trpc } from "~/lib";

export const useOrgs = () => {
	const query = trpc.org.list.createQuery();
	const result = useCachedQueryData(query, "orgs", (table) =>
		table.orderBy("id"),
	);
	createQueryCacher(query, "orgs", (org) => ({
		id: org.id,
		name: org.name,
		slug: org.slug,
	}));

	// TODO: Account for slug change

	return result;
};

export const useAuth = () => trpc.auth.me.createQuery();

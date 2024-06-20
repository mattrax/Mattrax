import type { UseTRPCQueryResult } from "@solid-mediakit/trpc";
import { useNavigate } from "@solidjs/router";
import { createQuery, useQueryClient } from "@tanstack/solid-query";
import {
	createEffect,
	createMemo,
	createResource,
	createRoot,
	createSignal,
	startTransition,
	untrack,
} from "solid-js";
import { createStore, unwrap } from "solid-js/store";
import type { OrgProcedureInput } from "~/api";
import { createQueryCacher, useCachedQueryData } from "~/cache";
import { trpc } from "~/lib";
import { useOrgs } from "../utils";
import { useOrgSlug } from "./ctx";

export function useOrgQuery<TData, TError, T extends Record<string, unknown>>(
	arg: () => T,
	query: (
		// These arguments matches the args for `orgProcedure` on the server.
		// That's why they are wacky.
		args: (() => { orgId: string } & T) | (() => { orgSlug: string } & T),
	) => UseTRPCQueryResult<TData, TError>,
) {
	const navigate = useNavigate();
	const orgs = useOrgs();
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();

	// TODO: Explain this memo
	const orgId = createMemo(() => {
		console.log(JSON.parse(JSON.stringify(orgs.data ?? "undefined"))); // TODO

		const orgId = orgs.data?.find((o) => o.slug === orgSlug())?.id;
		if (orgId) return orgId;

		// If the server has responded and if it's still not found above, we know it doesn't exist so we redirect.
		if (orgs.isStale) startTransition(() => navigate(`/o/${orgSlug()}`));

		// Wait for the server to response if the org is not found in the cache, or
		// wait for the redirect off this route.
		return undefined;
	});

	// TODO: Explain this memo & why this system exists
	const data = createMemo((previousQuery) => {
		// @ts-expect-error // TODO: Are solid's types bugged?
		const prevQuery: UseTRPCQueryResult<TData, TError> | undefined =
			previousQuery;

		const id = orgId();
		const userArgs = arg();
		console.log("useOrgQuery2", id, id ? "orgId" : "orgSlug", prevQuery); // TODO

		// When the `orgId` becomes available, we switch to use it.
		// This is so if the slug changes we can easily account for it by redirecting the user.
		// We rely on the slug when it's not available so we don't need to block rendering on a waterfall.
		const args = id
			? () => ({ orgId: id, ...userArgs })
			: () => ({ orgSlug: orgSlug(), ...userArgs });

		// TODO: Compare query key and if it's the same skip recreating.

		if (prevQuery) {
			// TODO: Reactivity to `prevQuery`?
			// If the old query is loading, let is finish before switching to the new query.
			if (prevQuery.query.isPending) {
				console.log("PREV QUERY PENDING");
				// TODO: Explain why subscribe
				prevQuery.query.data;

				// createEffect(() => console.log("TRAJKFD", prevQuery.query.data)); // TODO

				// queryClient.fetchQuery();

				return prevQuery;
			}

			console.log("LOADED", JSON.parse(JSON.stringify(prevQuery.query.data))); // TODO
			queryClient.setQueryData(
				[prevQuery.query.trpc.queryKey[0].split("."), args()],
				prevQuery.query.data,
			);
			prevQuery.dispose();

			// queryClient.setQueryData(["todo"], "helloworld");
			// return prevQuery; // TODO
		}

		console.log("NEW QUERY", args); // TODO
		// TODO: explain root
		return createRoot((dispose) => ({
			query: query(args),
			dispose,
		}));
	});

	// TODO: The docs impl this can be `unwrap(data)` but it's not working.
	return new Proxy<UseTRPCQueryResult<TData, TError>>({} as any, {
		get(_, prop) {
			// @ts-expect-error
			return data().query[prop];
		},
	});
}

export const useOrgId = () => {
	// TODO

	return {};
};

export const useTenants = () => {
	const abc = useOrgQuery(
		() => ({}),
		(args) => trpc.tenant.list.createQuery(args),
	);

	createEffect(() =>
		console.log(
			"useOrgQueryDebug",
			JSON.parse(
				JSON.stringify({
					queryKey: abc.trpc.queryKey,
					data: abc.data,
				}),
			),
		),
	);

	const orgs = useOrgs();
	const orgSlug = useOrgSlug();
	const navigate = useNavigate();

	// We use a resource so this triggers suspense in `useTenantsForOrg` until it's defined.
	const [orgId] = createResource(
		() => [orgs.data, orgs.isStale, orgSlug()] as const,
		([orgs, orgsIsStale, orgSlug]) => {
			const orgId = orgs?.find((o) => o.slug === orgSlug)?.id;
			if (orgId) return orgId;

			// If the server has responded and if it's still not found above, we know it doesn't exist.
			if (orgsIsStale) startTransition(() => navigate(`/o/${orgSlug}`));

			// Wait for the server to response so it's not stale, or
			// wait for the redirect off this route.
			return new Promise<string>(() => {});
		},
	);

	return createMemo(() => {
		const o = orgId();
		if (!o) return undefined;
		return useTenantsForOrg(() => o);
	});
};

export const useTenantsForOrg = (orgId: () => string) => {
	const query = trpc.tenant.list.createQuery(() => ({
		orgId: orgId(),
	}));

	// TODO: Account for change to slug
	// TODO: .orderBy("id")
	const result = useCachedQueryData(
		query,
		"tenants",
		(table) => table.where("orgId").equals(orgId()), // TODO: We can't use slug here!
	);

	// createQueryCacher(query, "tenants", (org) => ({
	// 	id: org.id,
	// 	name: org.name,
	// 	slug: org.slug,
	// }));

	return result;
};

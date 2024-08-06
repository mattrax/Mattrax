import { useNavigate } from "@solidjs/router";
import { createEffect, createMemo } from "solid-js";
import { z } from "zod";
import { trpc } from "~/lib";
import { useZodParams } from "~/lib/useZodParams";

export function useOrgSlug() {
	const params = useZodParams({ orgSlug: z.string() });
	return () => params.orgSlug;
}

export function useOrg() {
	const orgSlug = useOrgSlug();
	const navigate = useNavigate();
	const orgs = trpc.org.list.createQuery();

	const activeOrg = createMemo(() =>
		orgs.data?.find((o) => o.slug === orgSlug()),
	);

	createEffect(() => {
		if (orgs.data !== undefined && activeOrg() === undefined) {
			navigate("/");
		}
	});

	return Object.assign(activeOrg, {
		query: orgs,
	});
}

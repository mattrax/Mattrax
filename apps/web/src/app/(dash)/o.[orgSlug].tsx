/* @refresh skip */

import { type RouteDefinition, createAsync } from "@solidjs/router";
import { createMemo, type ParentProps } from "solid-js";
import { z } from "zod";

import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";
import { cachedOrgs } from "./utils";

export function useOrgSlug() {
	const params = useZodParams({ orgSlug: z.string() });
	return () => params.orgSlug;
}

export default function Layout(props: ParentProps) {
	createMemo(createAsync(() => cachedOrgs()));

	return <>{props.children}</>;
}

export const route = {
	load: ({ params }) => {
		trpc.useContext().org.tenants.ensureData({ orgSlug: params.orgSlug! });
		trpc.useContext().org.list.ensureData();
	},
} satisfies RouteDefinition;

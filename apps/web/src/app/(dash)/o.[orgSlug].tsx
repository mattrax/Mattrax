/* @refresh skip */

import { createReconnectingWS } from "@solid-primitives/websocket";
import type { RouteDefinition } from "@solidjs/router";
import {
	type ParentProps,
	Suspense,
	createEffect,
	createReaction,
} from "solid-js";

import { createQuery, useQueryClient } from "@tanstack/solid-query";
import { useCommandGroup } from "~/components/CommandPalette";
import { trpc } from "~/lib";
import { useOrgSlug } from "./o.[orgSlug]/ctx";
import { useOrgs } from "./utils";

export const route = {
	load: ({ params }) => {
		trpc.useContext().org.tenants.ensureData({ orgSlug: params.orgSlug! });
		trpc.useContext().org.list.ensureData();
	},
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
	useOrgs();

	useCommandGroup("Organisation", [
		{
			title: "Create Tenant",
			onClick: () => alert(1), // TODO
		},
		{
			title: "Invite User",
			onClick: () => alert(1), // TODO
		},
		{
			title: "Settings",
			href: "settings",
		},
	]);

	return (
		<>
			{props.children}
			<Suspense>
				{
					// @ts-expect-error
					() => {
						useInvalidationSystem();
						return null;
					}
				}
			</Suspense>
		</>
	);
}

function useInvalidationSystem() {
	const orgSlug = useOrgSlug();
	const queryClient = useQueryClient();

	const rustUrl = createQuery(() => ({
		queryKey: ["where_da_rust"],
		queryFn: async () => {
			const resp = await fetch("/api/where_da_rust");
			if (!resp.ok) {
				console.warn("Failed to fetch url of Rust backend!");
				return;
			}
			return await resp.text();
		},
		refetchInterval: 10 * 60 * 1000,
	}));

	createEffect(() => {
		if (!rustUrl.data) return;

		const ws = createReconnectingWS(
			`${rustUrl.data
				?.replace("https://", "wss://")
				?.replace("http://", "ws://")}/realtime`,
			undefined,
			{
				// Back off in dev so the console doesn't get spammed
				delay: import.meta.env.DEV ? 9999999 : undefined,
			},
		);

		ws.addEventListener("open", () =>
			ws.send(JSON.stringify({ type: "setOrg", orgSlug: orgSlug() })),
		);
		createReaction(() =>
			ws.send(JSON.stringify({ type: "setOrg", orgSlug: orgSlug() })),
		);

		ws.addEventListener("message", (e) => {
			const event = parseJsonSafe(e.data);
			if (!event) return;

			if (event.type === "invalidation") {
				queryClient.invalidateQueries({
					predicate: (query) => {
						const input = query.queryKey?.[1];
						// If it is a valid input to `tenantProcedure` or `orgProcedure`
						if (input && typeof input === "object" && !Array.isArray(input)) {
							// if the event has a tenant
							if ("tenantSlug" in event) {
								// We invalidate anything in the tenant
								if (
									"tenantSlug" in input &&
									input.tenantSlug === event.tenantSlug
								) {
									return true;
								}
							} else {
								// We invalidate anything in the org
								if ("orgSlug" in input && input.orgSlug === event.orgSlug) {
									return true;
								}
							}
						}

						return false;
					},
				});
			} else if (event.type === "error") {
				console.error("Error from realtime backend:", event.error);
			}
		});
	});
}

function parseJsonSafe(json: string) {
	try {
		return JSON.parse(json);
	} catch (e) {
		console.warn("Error parsing invalidation message:", e);
		return null;
	}
}

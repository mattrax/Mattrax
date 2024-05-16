import { createContextProvider } from "@solid-primitives/context";
import type { RouteDefinition } from "@solidjs/router";
import type { ParentProps } from "solid-js";
import { Badge } from "@mattrax/ui";
import { z } from "zod";

import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";
import type { RouterOutput } from "~/api";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { createNotFoundRedirect } from "~/lib/utils";
import { getMetadata } from "../metadataCache";

// const NAV_ITEMS = [{ title: "Application", href: "" }];

export const route = {
	load: ({ params }) =>
		trpc.useContext().app.get.ensureData({
			id: params.appId!,
		}),
	info: {
		// NAV_ITEMS,
		BREADCRUMB: {
			Component: () => {
				const params = useZodParams({ appId: z.string() });

				const query = trpc.app.get.createQuery(() => ({
					id: params.appId,
				}));

				return (
					<>
						<span>
							{getMetadata("application", params.appId)?.name ??
								query.data?.name}
						</span>
						<Badge variant="outline">App</Badge>
					</>
				);
			},
		},
	},
} satisfies RouteDefinition;

function useAppId() {
	const params = useZodParams({ appId: z.string() });
	return () => params.appId;
}

export const [AppContextProvider, useApp] = createContextProvider(
	(props: {
		app: NonNullable<RouterOutput["app"]["get"]>;
		query: ReturnType<typeof trpc.app.get.createQuery>;
	}) => {
		return Object.assign(() => props.app, { query: props.query });
	},
	null!,
);

export default function Layout(props: ParentProps) {
	const appId = useAppId();

	createNotFoundRedirect({
		query: trpc.app.get.createQuery(() => ({ id: appId() })),
		toast: "Application not found",
		to: "../../apps",
	});

	return <MErrorBoundary>{props.children}</MErrorBoundary>;
}

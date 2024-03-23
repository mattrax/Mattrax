import { createContextProvider } from "@solid-primitives/context";
import { useMatch, useMatches } from "@solidjs/router";
import { createMemo } from "solid-js";

export type NavItemConfig = {
	title: string;
	href: string;
};

export const [NavItemsProvider, useNavItemsContext] = createContextProvider(
	() => {
		const matches = useMatches();

		const route = createMemo(() =>
			[...matches()]
				.reverse()
				.find((m) => Array.isArray(m.route.info?.NAV_ITEMS)),
		);

		const items = createMemo(
			() => route()?.route.info?.NAV_ITEMS as Array<NavItemConfig> | undefined,
		);

		const prefix = () => route()?.path ?? "";

		const match = useMatch(() => `${prefix()}/*rest`);

		const value = createMemo(() => match()?.params.rest?.split("/")[0] ?? "");

		return { items, value, prefix };
	},
	null!,
);

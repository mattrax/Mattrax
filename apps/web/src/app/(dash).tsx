import { startTransition, type ParentProps } from "solid-js";
import { RouteSectionProps, useNavigate } from "@solidjs/router";
import { isServer } from "solid-js/web";
import { parse } from "cookie-es";

import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { trpc } from "~/lib";

export const route = {
	load: () => {
		trpc.useContext().auth.me.ensureData();
	},
};

export default function Layout(props: RouteSectionProps<never, "topbar">) {
	const navigate = useNavigate();

	if (!isServer) {
		// isLoggedIn cookie trick for quick login navigation
		const cookies = parse(document.cookie);
		if (cookies.isLoggedIn !== "true") {
			startTransition(() =>
				navigate(
					`/login?${new URLSearchParams({
						continueTo: location.pathname,
					})}`,
				),
			);

			// return null;
		}
	}

	return (
		<MErrorBoundary>
			{props.slots.topbar}
			{props.children}
		</MErrorBoundary>
	);
}

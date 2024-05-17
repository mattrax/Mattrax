import { startTransition, type ParentProps } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { isServer } from "solid-js/web";
import { parse } from "cookie-es";

import { NavItemsProvider } from "./(dash)/TopBar/NavItems";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { trpc } from "~/lib";
import { TopBar } from "./(dash)/TopBar";

export const route = {
	load: () => {
		trpc.useContext().auth.me.ensureData();
	},
};

export default function Layout(props: ParentProps) {
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
			<NavItemsProvider>
				<TopBar />
				{props.children}
			</NavItemsProvider>
		</MErrorBoundary>
	);
}

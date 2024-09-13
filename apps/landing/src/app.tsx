import { Router, useLocation } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { isServer, Suspense } from "solid-js/web";
import { createComputed, createEffect, type ParentProps } from "solid-js";

import "@fontsource-variable/inter";
import "@mattrax/ui/css";
import "./app.css";

export default function App() {
	return (
		<Suspense>
			<Router root={Root}>
				<FileRoutes />
			</Router>
		</Suspense>
	);
}

function Root(props: ParentProps) {
	const location = useLocation();

	// TODO: Move this logic back into `entry-client.tsx` once all pages support dark mode
	if (!isServer) {
		const prefersColorSchema = window.matchMedia?.(
			"(prefers-color-scheme: dark)",
		);
		const computeTheme = () => {
			let theme = localStorage.getItem("theme");
			if (!theme)
				theme = prefersColorSchema?.matches === true ? "dark" : "light";

			// These pages don't support dark mode
			if (!location.pathname.startsWith("/docs")) theme = "light";

			if (theme === "dark") {
				document.body.classList.add("dark");
			} else {
				document.body.classList.remove("dark");
			}
		};
		createComputed(() => computeTheme());
		prefersColorSchema?.addEventListener("change", () => computeTheme());

		createEffect(() => {
			if (location.pathname.startsWith("/docs")) {
				document.body.classList.remove("noise-background");
			} else {
				document.body.classList.add("noise-background");
			}
		});
	}

	return props.children;
}

/* @refresh reload */
import { Router, useLocation } from "@solidjs/router";
import { render } from "solid-js/web";
import "./index.css";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { type ParentProps, lazy } from "solid-js";
import { routes } from "./routes";

const TanstackQueryDevtools = lazy(() =>
	import("@tanstack/solid-query-devtools").then((m) => ({
		default: m.SolidQueryDevtools,
	})),
);

const client = new QueryClient();

function Root(props: ParentProps) {
	const location = useLocation();

	if (location.query?.dev) {
		localStorage.setItem(
			"dev",
			location.query?.dev === "false" ? "false" : "true",
		);
	}

	const isDevMode =
		import.meta.env.DEV || localStorage.getItem("dev") === "true";

	return (
		<>
			{isDevMode && <TanstackQueryDevtools />}
			{props.children}
		</>
	);
}

render(
	() => (
		<QueryClientProvider client={client}>
			<Router root={Root}>{routes}</Router>
		</QueryClientProvider>
	),
	document.getElementById("root")!,
);

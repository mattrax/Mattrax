/* @refresh reload */
import { Router, useLocation } from "@solidjs/router";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { type ParentProps, lazy } from "solid-js";
import { render } from "solid-js/web";
import { Toaster } from "solid-sonner";
import { routes } from "./routes";
import "./index.css";
import "@mattrax/ui/css";
import "./indexed-db-observers-polyfill.js";

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
			<Toaster />
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

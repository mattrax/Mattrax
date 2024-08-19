/* @refresh reload */
import { Router, useLocation } from "@solidjs/router";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { type ParentProps, lazy, onMount } from "solid-js";
import { render } from "solid-js/web";
import { Toaster } from "solid-sonner";
import { routes } from "./routes";
import "./index.css";
import "@mattrax/ui/css";

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

	onMount(() =>
		setTimeout(() => document.body.classList.remove("disable-animations"), 800),
	);

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

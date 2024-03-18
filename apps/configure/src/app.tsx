import { FileRoutes } from "@solidjs/start/router";
import { Router } from "@solidjs/router";
import { Buffer } from "buffer";
// @ts-expect-error
import nextTick from "browser-next-tick";
import { QueryClientProvider, QueryClient } from "@tanstack/solid-query";

import "./styles.css";
import Layout from "./Layout";

// Polyfilled as it's required for `plist`
// @ts-ignore
window.Buffer = Buffer;

// Polyfilled as it's required for `xml`
// @ts-ignore
globalThis.process = { nextTick, env: {} };

const queryClient = new QueryClient();

export default function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<Router root={(props) => <Layout>{props.children}</Layout>}>
				<FileRoutes />
			</Router>
		</QueryClientProvider>
	);
}

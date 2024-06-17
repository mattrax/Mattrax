import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start/router";
import { Suspense } from "solid-js/web";

import "@fontsource-variable/inter";
import "@mattrax/ui/css";
import "./app.css";

export default function App() {
	return (
		<Suspense>
			<Router>
				<FileRoutes />
			</Router>
		</Suspense>
	);
}

import { type RouteDefinition, Router } from "@solidjs/router";
/* @refresh reload */
import { render } from "solid-js/web";
import "./index.css";

import App from "./App";

const routes = [
	{
		path: "/",
		component: App,
	},
] satisfies RouteDefinition[];

render(() => <Router>{routes}</Router>, document.getElementById("root")!);

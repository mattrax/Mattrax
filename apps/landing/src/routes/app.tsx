// @refresh reload
import { Router } from "@solidjs/router";
import type { RouteDefinition } from "@solidjs/router";
import { Suspense, lazy } from "solid-js";
import "@fontsource/inter/latin-400.css"; // `normal`
import "@fontsource/inter/latin-500.css"; // `medium`
import "@fontsource/inter/latin-600.css"; // `semibold`
import "@fontsource/inter/latin-700.css"; // `bold`

const routes = [
  {
    path: "/",
    component: lazy(() => import("./routes/index")),
  },
  {
    path: "/company",
    component: lazy(() => import("./routes/company")),
  },
  {
    path: "/*all",
    component: () => <h1>Not Found!</h1>,
  },
] satisfies RouteDefinition[];

export default function App(props: { url: string }) {
  return (
    <Router
      url={props.url}
      root={(props) => <Suspense>{props.children}</Suspense>}
    >
      {routes}
    </Router>
  );
}

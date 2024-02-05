// @refresh reload
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start";
import { Suspense } from "solid-js";
import "./app.css";
import "@fontsource/inter/latin-200.css";

export default function App() {
  return (
    <Router
      root={(props) => (
        <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div class="mx-auto max-w-3xl pt-2 lg:pt-8">
            <article class="prose prose-slate lg:prose-lg whitespace-normal">
              <Suspense>{props.children}</Suspense>
            </article>
          </div>
        </div>
      )}
    >
      <FileRoutes />
    </Router>
  );
}

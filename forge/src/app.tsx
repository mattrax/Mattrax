// @refresh reload
import { Router } from "@solidjs/router";
import { ErrorBoundary, Suspense } from "solid-js";
import { routes } from "./routes";
import { Toaster } from "solid-sonner";
import "./app.css";
import "./sonner.css";

export default function App() {
  return (
    <ErrorBoundary
      fallback={(err, reset) => {
        // Solid Start + HMR is buggy as all hell so this hacks around it.
        if (
          import.meta.env.DEV &&
          err.toString() ===
            "Error: Make sure your app is wrapped in a <Router />" &&
          typeof document !== "undefined"
        ) {
          console.error(
            "Automatically resetting error boundary due to HMR-related router context error."
          );
          reset();
        }

        return (
          <div>
            <div>Error:</div>
            <p>{err.toString()}</p>
            <button onClick={reset}>Reset</button>
          </div>
        );
      }}
    >
      <Toaster />
      <Router root={(props) => <Suspense>{props.children}</Suspense>}>
        {routes}
      </Router>
    </ErrorBoundary>
  );
}

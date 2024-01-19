// @refresh reload
import { Router } from "@solidjs/router";
import { FileRoutes } from "@solidjs/start";
import { ErrorBoundary, Suspense } from "solid-js";
import "./app.css";

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
      <Router root={(props) => <Suspense>{props.children}</Suspense>}>
        <FileRoutes />
      </Router>
    </ErrorBoundary>
  );
}

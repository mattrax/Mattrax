import { Head, Title } from "@solidjs/meta";
import { createRouter } from "@solidjs/router";
import { fileRoutes } from "@solidjs/router/fs";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { isServer } from "@solidjs/web";
import { Errored, Loading, onSettled } from "solid-js";
import { pageRoutes } from "virtual:file-routes";
import "./app.css";

// Data lives behind the API Worker's auth and only the browser has the session
// it expects. Keeping queries idle during SSR avoids holding the document open
// (and serializing transport errors) while the client fetches after hydration.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      enabled: !isServer,
      retry: (count, error) => {
        // Client errors (4xx) will not get better by retrying.
        const message = error instanceof Error ? error.message : String(error);
        if (/^(Enterprise(Unauthorized|Forbidden|NotFound|BadRequest))/.test(message)) return false;
        return count < 1;
      },
    },
  },
});

const Router = createRouter({ routes: fileRoutes(pageRoutes) });

function ErrorFallback(props: { error: unknown; reset: () => void }) {
  console.error("Mattrax page error", props.error);
  const message =
    props.error instanceof Error ? props.error.message : String(props.error ?? "Unknown error");
  return (
    <div class="flex min-h-screen items-center justify-center bg-stone-50 p-6">
      <div class="w-full max-w-md rounded-xl border bg-white p-6 shadow-sm">
        <h1 class="text-lg font-semibold text-stone-900">Something went wrong</h1>
        <p class="mt-2 text-sm text-muted-foreground">
          The page could not load. This is usually temporary.
        </p>
        <pre class="mt-4 max-h-40 overflow-auto rounded-lg bg-stone-100 p-3 text-xs text-stone-600">
          {message}
        </pre>
        <div class="mt-5 flex gap-2">
          <button
            type="button"
            class="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
            onClick={props.reset}
          >
            Try again
          </button>
          <a
            href="/dashboard"
            class="rounded-lg border px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
          >
            Go to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  // Browser tests (and the first user interaction) need a deterministic signal
  // that hydration completed; SSR markup alone does not attach event handlers.
  onSettled(() => {
    if (typeof document !== "undefined") document.documentElement.dataset.hydrated = "true";
  });

  return (
    <Router>
      {(props) => (
        <Head>
          <Title>Mattrax</Title>
          <QueryClientProvider client={queryClient}>
            <Errored fallback={(error, reset) => <ErrorFallback error={error()} reset={reset} />}>
              <Loading fallback="Loading...">{props.children}</Loading>
            </Errored>
          </QueryClientProvider>
        </Head>
      )}
    </Router>
  );
}

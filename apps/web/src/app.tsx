import { Head, Title } from "@solidjs/meta";
import { createRouter } from "@solidjs/router";
import { fileRoutes } from "@solidjs/router/fs";
import { QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { isServer } from "@solidjs/web";
import { Errored, Loading, onSettled } from "solid-js";
import { pageRoutes } from "virtual:file-routes";
import { errorPresentation, errorTag } from "~/lib/errors";
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
        const tag = errorTag(error);
        if (
          tag &&
          (tag.startsWith("Enterprise") ||
            tag.startsWith("Platform") ||
            tag.startsWith("Password") ||
            tag.startsWith("Session"))
        )
          return false;
        return count < 1;
      },
    },
  },
});

const Router = createRouter({ routes: fileRoutes(pageRoutes) });

function ErrorFallback(props: { error: unknown; reset: () => void }) {
  console.error("Mattrax page error", props.error);
  const presentation = errorPresentation(props.error);
  return (
    <div class="dark flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div class="w-full max-w-md rounded-2xl border border-white/[0.08] bg-card p-6 shadow-2xl shadow-black/50">
        <span class="mb-5 flex size-8 items-center justify-center rounded-lg bg-gradient-to-b from-white to-white/85 text-[13px] font-bold text-black">
          M
        </span>
        <h1 class="text-lg font-semibold tracking-tight">{presentation.title}</h1>
        <p class="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {presentation.message}
        </p>
        <div class="mt-5 flex gap-2">
          <button
            type="button"
            class="rounded-lg bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            onClick={props.reset}
          >
            Try again
          </button>
          <a
            href="/dashboard"
            class="rounded-lg border border-white/[0.09] px-3.5 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-white/[0.05]"
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

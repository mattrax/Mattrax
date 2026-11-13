import { Head, Title } from "@solidjs/meta";
import { createRouter } from "@solidjs/router";
import { fileRoutes } from "@solidjs/router/fs";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/solid-query";
import { isServer } from "@solidjs/web";
import { Errored, Loading, createEffect, onSettled } from "solid-js";
import { pageRoutes } from "virtual:file-routes";
import { errorPresentation, errorTag } from "~/lib/errors";
import { GlobalErrorBanner } from "~/components/global-error-banner";
import { reportGlobalError } from "~/lib/global-errors";
import { authClient } from "~/lib/auth";
import { syncPostHogUser } from "~/lib/posthog";
import "./app.css";

// Data lives behind the API Worker's auth and only the browser has the session
// it expects. Keeping queries idle during SSR avoids holding the document open
// (and serializing transport errors) while the client fetches after hydration.
const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      // Mutations that render their own inline error opt out with
      // `meta: { inlineError: true }` to avoid showing the same failure twice.
      if (mutation.meta?.inlineError) return;
      reportGlobalError(error);
    },
  }),
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

/**
 * Keep browser analytics identity aligned with the dashboard session. The
 * server-side API capture uses the authenticated id; this makes browser
 * pageviews, session ids and server events resolve to the same person.
 */
function PostHogIdentity() {
  const session = authClient.useSession();
  createEffect(
    () => {
      const state = session();

      return state.isPending ? undefined : (state.data?.user ?? null);
    },
    (user) => {
      if (user !== undefined) syncPostHogUser(user);
    },
  );

  return null;
}

function BootSplash() {
  return (
    <div class="dark flex min-h-screen items-center justify-center bg-background text-foreground">
      <div class="flex items-center gap-2.5">
        <span class="flex size-7 animate-pulse items-center justify-center rounded-[7px] bg-gradient-to-b from-white to-white/85 text-[13px] font-bold text-black">
          M
        </span>
        <span class="text-[13px] font-medium text-muted-foreground">Loading Mattrax…</span>
      </div>
    </div>
  );
}

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
        <p class="mt-2 text-[13px] leading-relaxed text-muted-foreground">{presentation.message}</p>
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
            <PostHogIdentity />
            <Errored fallback={(error, reset) => <ErrorFallback error={error()} reset={reset} />}>
              <Loading fallback={<BootSplash />}>{props.children}</Loading>
            </Errored>
            <GlobalErrorBanner />
          </QueryClientProvider>
        </Head>
      )}
    </Router>
  );
}

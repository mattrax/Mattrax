import { createContextProvider } from "@solid-primitives/context";
import { useNavigate } from "@solidjs/router";
import { parse } from "cookie-es";
import { ErrorBoundary, ParentProps, Show, Suspense, onMount } from "solid-js";

import { RouterOutput } from "~/api/trpc";
import { trpc } from "~/lib";

export const [AuthContextProvider, useAuthContext] = createContextProvider(
  (props: {
    meQuery: ReturnType<typeof trpc.auth.me.useQuery>;
    me: RouterOutput["auth"]["me"];
  }) => props,
  null!,
);

export default function Layout(props: ParentProps) {
  const navigate = useNavigate();

  onMount(() => {
    // isLoggedIn cookie trick for quick login navigation
    const cookies = parse(document.cookie);
    if (cookies.isLoggedIn !== "true") {
      navigate("/login");
    }
  });

  // TODO: Use the auth cookie trick for better UX
  const me = trpc.auth.me.useQuery(void 0, () => ({
    // This will *always* stay in the cache. Avoids need for `localStorage` shenanigans.
    // gcTime: Infinity,
  }));

  return (
    <ErrorBoundary
      fallback={(err) => {
        console.error(err);

        return (
          <div class="p-2">
            <h1>Error</h1>
            <pre>{err.message}</pre>
          </div>
        );
      }}
    >
      <Suspense>
        <Show when={me.data}>
          {(meData) => (
            <AuthContextProvider me={meData()} meQuery={me}>
              {props.children}
            </AuthContextProvider>
          )}
        </Show>
      </Suspense>
    </ErrorBoundary>
  );
}

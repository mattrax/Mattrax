import { ErrorBoundary, ParentProps, Show } from "solid-js";
import { createContextProvider } from "@solid-primitives/context";
import { RouterOutput } from "@mattrax/api";

import { trpc } from "~/lib";

export const [AuthContextProvider, useAuthContext] = createContextProvider(
  (props: {
    meQuery: ReturnType<typeof trpc.auth.me.useQuery>;
    me: RouterOutput["auth"]["me"];
  }) => props,
  null!
);

export default function Layout(props: ParentProps) {
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
      <Show when={me.data}>
        {(meData) => (
          <AuthContextProvider me={meData()} meQuery={me}>
            {props.children}
          </AuthContextProvider>
        )}
      </Show>
    </ErrorBoundary>
  );
}

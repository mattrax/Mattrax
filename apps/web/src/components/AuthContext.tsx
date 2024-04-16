import { useNavigate } from "@solidjs/router";
import { ParentProps, Show, onMount } from "solid-js";
import { parse } from "cookie-es";
import { createContextProvider } from "@solid-primitives/context";

import { trpc } from "~/lib";
import { RouterOutput } from "~/api";

const [AuthContextProvider, useAuth] = createContextProvider(
  (props: {
    query: ReturnType<typeof trpc.auth.me.useQuery>;
    me: RouterOutput["auth"]["me"];
  }) => Object.assign(() => props.me, { query: props.query }),
  null!,
);

export { useAuth };

export function AuthContext(props: ParentProps) {
  const navigate = useNavigate();

  onMount(() => {
    // isLoggedIn cookie trick for quick login navigation
    const cookies = parse(document.cookie);
    if (cookies.isLoggedIn !== "true") {
      navigate("/login");
    }
  });

  // TODO: Use the auth cookie trick for better UX
  const meQuery = trpc.auth.me.useQuery(void 0, () => ({
    // This will *always* stay in the cache. Avoids need for `localStorage` shenanigans.
    gcTime: Infinity,
  }));

  return (
    <Show when={meQuery.data}>
      {(me) => (
        <AuthContextProvider me={me()} query={meQuery}>
          {props.children}
        </AuthContextProvider>
      )}
    </Show>
  );
}

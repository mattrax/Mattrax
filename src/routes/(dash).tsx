import { createAsync } from "@solidjs/router";
import { ParentProps, Show, Suspense } from "solid-js";
import LeftSidebar from "~/components/LeftSidebar";
import { dashboardLayoutLoader } from "~/server/session";
import { sessionCtx } from "~/server/session";

export default function Layout(props: ParentProps) {
  const session = createAsync(dashboardLayoutLoader, {
    // TODO: This is required for the `throw redirect` to work, however it blocks the page load on loading the tenants
    // deferStream: true,
  });

  // TODO: Render sidebar in loading state while waiting for session

  return (
    <Suspense>
      <Show when={session()} fallback={<h1>Not Authed</h1>}>
        {(session) => (
          <>
            <sessionCtx.Provider value={session()}>
              <LeftSidebar />
              {props.children}
            </sessionCtx.Provider>
          </>
        )}
      </Show>
    </Suspense>
  );
}

import { createAsync, redirect } from "@solidjs/router";
import { ParentProps, Show, Suspense } from "solid-js";
import LeftSidebar from "~/components/LeftSidebar";
import { getSession } from "~/server/session";

export default function Layout(props: ParentProps) {
  const session = createAsync(
    async () => {
      "use server";

      const session = await getSession();
      if (!session?.data?.email) throw redirect("/login");
      return {};
    },
    {
      deferStream: true,
    }
  );

  return (
    <Suspense>
      <Show when={() => session()} fallback={<h1>Not Authed</h1>}>
        {(email) => (
          <>
            <LeftSidebar />
            {props.children}
          </>
        )}
      </Show>
    </Suspense>
  );
}

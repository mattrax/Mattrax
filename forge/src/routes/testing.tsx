import { createAsync } from "@solidjs/router";
import { Suspense } from "solid-js";
import { hc } from "hono/client";
import { type AppType } from "./api/[...api]";

const client = hc<AppType>("");

export default function Page() {
  const demo = createAsync(async () =>
    // TODO: Handle unauthenticated error (redirect to login) or internal server error (toast)
    client.api.auth.me.$get().then((r) => r.json())
  );

  // TODO: Mutation example

  return (
    <main class="text-center mx-auto text-gray-700 p-4 flex flex-col">
      <Suspense fallback={<div>Loading...</div>}>
        <p>{JSON.stringify(demo())}</p>

        <button
          onClick={() => {
            // TODO: Loading states + error handling
            client.api.auth.update
              .$post({ json: { name: "Oscar" } })
              .then((r) => r.json())
              .then((r) => console.log(r));
          }}
        >
          Update Name
        </button>
      </Suspense>
    </main>
  );
}

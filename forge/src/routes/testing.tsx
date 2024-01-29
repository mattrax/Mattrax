import { ErrorBoundary, Suspense } from "solid-js";
import { client } from "~/lib";
import { createResource } from "~/lib/resource";

export default function Page() {
  const me = createResource(client.api.auth.me);
  // const willError = createResource(client.api.error); // TODO: hit error boundary?
  // const willErrorAgain = createResource(client.api.error); // TODO: hit error boundary?

  // const demo = createAsync(async () =>
  //   // TODO: Handle unauthenticated error (redirect to login) or internal server error (toast)
  //   client.api.auth.me.$get().then((r) => r.json())
  // );

  // TODO: Mutation example

  return (
    <main class="text-center mx-auto text-gray-700 p-4 flex flex-col">
      <Suspense fallback={<div>Loading...</div>}>
        <p>{JSON.stringify(me())}</p>

        {/* <ErrorBoundary fallback={<div>Oops!</div>}>
          <p>{JSON.stringify(willError())}</p>
        </ErrorBoundary>

        <ErrorBoundary fallback={<div>Oops again!</div>}>
          <p>{JSON.stringify(willErrorAgain())}</p>
        </ErrorBoundary> */}

        {/* <button
          onClick={() => {
            // TODO: Loading states + error handling
            client.api.auth.update
              .$post({ json: { name: "Oscar" } })
              .then((r) => r.json())
              .then((r) => console.log(r));
          }}
        >
          Update Name
        </button> */}
      </Suspense>
    </main>
  );
}

// @refresh reload
import { Router, useNavigate } from "@solidjs/router";
import { ErrorBoundary, Suspense, lazy, onCleanup } from "solid-js";
import { QueryCache, QueryClient, onlineManager } from "@tanstack/solid-query";
import { Toaster, toast } from "solid-sonner";
import { broadcastQueryClient } from "@tanstack/query-broadcast-client-experimental";
import { PersistQueryClientProvider } from "@tanstack/solid-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { TRPCClientError } from "@trpc/client";
import { routes } from "./routes";
import { SuspenseError } from "./lib";
import "./app.css";
import "./sonner.css";

const createQueryClient = (navigate: (to: string) => void) => {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (
          error instanceof TRPCClientError &&
          "code" in error.data &&
          error.data.code === "UNAUTHORIZED"
        ) {
          navigate("/login");
          return;
        }

        // TODO: Prevent this for auth errors
        toast.error(
          [
            "Error fetching data from server!",
            document.createElement("br"),
            "Please reload to try again!",
          ],
          {
            id: "network-error",
          }
        );
      },
    }),
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 1000 * 60 * 60 * 24, // 24 hours
        refetchInterval: 1000 * 60, // 1 minute
      },
    },
  });

  broadcastQueryClient({
    queryClient,
    broadcastChannel: "rq",
  });

  const persister = createSyncStoragePersister({
    // TODO: IndexedDB
    storage: window.localStorage,
  });

  return [queryClient, persister] as const;
};

const SolidQueryDevtools = lazy(() =>
  import("@tanstack/solid-query-devtools").then((m) => ({
    default: m.SolidQueryDevtools,
  }))
);

export default function App() {
  return (
    <Router
      root={(props) => {
        const navigate = useNavigate();
        const [queryClient, persister] = createQueryClient(navigate);

        const unsubscribe = onlineManager.subscribe((isOnline) => {
          if (isOnline) {
            // TODO: This dismiss doesn't animate the toast close which is ugly.
            toast.dismiss("network-offline");
            return;
          }

          toast.error(
            [
              "You are offline!",
              document.createElement("br"),
              "Please reconnect to continue!",
            ],
            {
              id: "network-offline",
              duration: Infinity,
            }
          );
        });
        onCleanup(() => unsubscribe());

        return (
          <PersistQueryClientProvider
            client={queryClient}
            persistOptions={{ persister }}
          >
            {import.meta.env.DEV && localStorage.getItem("debug") !== null ? (
              <SolidQueryDevtools />
            ) : null}
            <ErrorBoundary
              fallback={(err, reset) => {
                // Solid Start + HMR is buggy as all hell so this hacks around it.
                if (
                  import.meta.env.DEV &&
                  err.toString() ===
                    "Error: Make sure your app is wrapped in a <Router />" &&
                  typeof document !== "undefined"
                ) {
                  console.error(
                    "Automatically resetting error boundary due to HMR-related router context error."
                  );
                  reset();
                }

                console.error(err);

                return (
                  <div>
                    <div>Error:</div>
                    <p>{err.toString()}</p>
                    <button onClick={reset}>Reset</button>
                  </div>
                );
              }}
            >
              <Toaster />
              <Suspense fallback={<SuspenseError name="Root" />}>
                {props.children}
              </Suspense>
            </ErrorBoundary>
          </PersistQueryClientProvider>
        );
      }}
    >
      {routes}
    </Router>
  );
}

// @refresh reload
import { Router, useNavigate } from "@solidjs/router";
import { ErrorBoundary, Suspense, lazy, onCleanup } from "solid-js";
import { QueryCache, QueryClient, onlineManager } from "@tanstack/solid-query";
import { Toaster, toast } from "solid-sonner";
import { broadcastQueryClient } from "@tanstack/query-broadcast-client-experimental";
import {
  PersistQueryClientOptions,
  PersistQueryClientProvider,
} from "@tanstack/solid-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { routes } from "./routes";
import { SuspenseError, tRPCErrorCode } from "./lib";
import * as dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "./app.css";
import "./sonner.css";

dayjs.extend(relativeTime);

// TODO: Maybe PR this back to Solid DND???
declare module "solid-js" {
  namespace JSX {
    interface Directives {
      sortable: true;
    }
  }
}

// Which Tanstack Query keys to persist to `localStorage`
const keysToPersist = [`[["auth","me"]]`];

const createQueryClient = (navigate: (to: string) => void) => {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        let errorMsg = [
          "Error fetching data from server!",
          document.createElement("br"),
          "Please reload to try again!",
        ];

        const trpcErrorCode = tRPCErrorCode(error);
        if (trpcErrorCode) {
          if (trpcErrorCode === "UNAUTHORIZED") {
            navigate("/login");
            return;
          } else if (trpcErrorCode === "FORBIDDEN") {
            errorMsg = ["You are not allowed to access this resource!"];
          }
        }

        // TODO: Prevent this for auth errors
        toast.error(errorMsg, {
          id: "network-error",
        });
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

  return [
    queryClient,
    {
      persister,
      dehydrateOptions: {
        shouldDehydrateQuery: (q) => keysToPersist.includes(q.queryHash),
      },
    } satisfies Omit<PersistQueryClientOptions, "queryClient">,
  ] as const;
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
        const [queryClient, persistOptions] = createQueryClient(navigate);

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
            persistOptions={persistOptions}
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

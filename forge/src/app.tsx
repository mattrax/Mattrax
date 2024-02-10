// @refresh reload
import { Router, useNavigate, Navigator } from "@solidjs/router";
import {
  ErrorBoundary,
  Suspense,
  lazy,
  onCleanup,
  startTransition,
} from "solid-js";
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
  keepPreviousData,
  onlineManager,
} from "@tanstack/solid-query";
import { Toaster, toast } from "solid-sonner";
import { broadcastQueryClient } from "@tanstack/query-broadcast-client-experimental";
// import {
//   PersistQueryClientOptions,
//   PersistQueryClientProvider,
// } from "@tanstack/solid-query-persist-client";
// import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { routes } from "./routes";
import { isTRPCClientError, trpc } from "./lib";
import dayjs from "dayjs";
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

function createQueryClient() {
  const navigate = useNavigate();

  const onError = (scopeMsg: string) => (error: unknown) => {
    let errorMsg = [
      scopeMsg,
      document.createElement("br"),
      "Please reload to try again!",
    ];

    if (isTRPCClientError(error)) {
      if (error.data?.code === "UNAUTHORIZED") {
        startTransition(() => navigate("/login"));
        return;
      } else if (error.data?.code === "FORBIDDEN") {
        if (error.message === "tenant") navigate("/");
        else errorMsg = ["You are not allowed to access this resource!"];
      }
    }

    // TODO: Prevent this for auth errors
    toast.error(errorMsg, {
      id: "network-error",
    });
  };

  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: onError("Error fetching data from server!"),
    }),
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 1000 * 60 * 60 * 24, // 24 hours
        refetchInterval: 1000 * 60, // 1 minute
        placeholderData: keepPreviousData,
      },
      mutations: {
        onError: onError("Error sending operation to the server!"),
      },
    },
  });

  broadcastQueryClient({
    queryClient,
    broadcastChannel: "rq",
  });

  // const persister = createSyncStoragePersister({
  //   // TODO: IndexedDB
  //   storage: window.localStorage,
  // });

  return [
    queryClient,
    // {
    //   persister,
    //   dehydrateOptions: {
    //     shouldDehydrateQuery: (q) => keysToPersist.includes(q.queryHash),
    //   },
    // } satisfies Omit<PersistQueryClientOptions, "queryClient">,
  ] as const;
}

const SolidQueryDevtools = lazy(() =>
  import("@tanstack/solid-query-devtools").then((m) => ({
    default: m.SolidQueryDevtools,
  }))
);

export default function App() {
  return (
    <Router
      root={(props) => {
        const [queryClient /* persistOptions */] = createQueryClient();

        onCleanup(
          onlineManager.subscribe((isOnline) => {
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
          })
        );

        return (
          // <PersistQueryClientProvider
          //   client={queryClient}
          //   persistOptions={persistOptions}
          // >
          <trpc.Provider queryClient={queryClient}>
            <QueryClientProvider client={queryClient}>
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
                <Suspense>{props.children}</Suspense>
              </ErrorBoundary>
            </QueryClientProvider>
          </trpc.Provider>
          // </PersistQueryClientProvider>
        );
      }}
    >
      {routes}
    </Router>
  );
}

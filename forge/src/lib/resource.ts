import {
  createEffect,
  createSignal,
  createResource as createSolidResource,
  NoInfer,
  onCleanup,
} from "solid-js";
import { type ClientRequest } from "hono/client";
import { cache, useNavigate } from "@solidjs/router";
import { makeEventListener } from "@solid-primitives/event-listener";
import { toast } from "solid-sonner";

// A resource fetching primitive that handles all the complexity.
//
// What it does?
// - Deduplicates requests
// - Toast message when network error occurs
// - Toast message when network is offline
// - Refetch data when:
//    - The tab becomes active
//    - After a certain amount of time
//    - The network connection is restored
//
// TODO:
// - Caches data and shares between tabs
// - Clearing out stale data (when subscribers are active keep it only in IndexedDB)
export function createResource<T>(
  query: ClientRequest<{
    $get: {
      input: {};
      output: T;
    };
  }>,
  opts?: {
    initialValue?: NoInfer<T>;
    onError?: (
      err: Error,
      e: { preventDefault(): void }
    ) => void | Promise<void>;
  }
) {
  const navigate = useNavigate();
  const [isOnline, setIsOnline] = createSignal(navigator.onLine);
  const [resource, { refetch }] = createSolidResource(
    cache(async () => {
      const resp = await query.$get({});

      if (!resp.ok) {
        if (resp.status === 401) navigate("/login");

        let body = "";
        try {
          body = await resp.text();
        } catch (e) {}

        const err = new Error(
          `Error fetching '${query.$url()}', got status '${
            resp.status
          }' with body '${body}'`
        );

        let preventDefault = false;
        await opts?.onError?.(err, {
          preventDefault() {
            preventDefault = true;
          },
        });

        if (!preventDefault && isOnline())
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

        throw err;
      }

      return await resp.json();
    }, query.$url().toString())
  );

  makeEventListener(document, "visibilitychange", () => {
    if (document.visibilityState == "visible") refetch();
  });
  makeEventListener(window, "online", () => {
    setIsOnline(true);
    refetch();
  });
  // TODO: On page load this may already be false so call the handler anyway
  makeEventListener(window, "offline", () => {
    toast.dismiss("network-error");
    setIsOnline(false);
  });

  createEffect(() => {
    if (isOnline()) {
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

  const interval = setInterval(() => refetch(), 1000 * 60 * 5);
  onCleanup(() => clearInterval(interval));

  // TODO: Sharing state between tabs + caching in IndexedDB

  const result = () =>
    // If we already have data then return it without triggering `Suspense`, otherwise trigger `Suspense`.
    resource.latest === undefined ? resource() : resource.latest;

  Object.defineProperties(result, {
    latest: {
      get: () => resource.latest,
    },
    loading: {
      get: () => resource.loading,
    },
    error: {
      get: () => resource.error,
    },
  });
  result.refetch = refetch;

  // result.stale = false; // TODO: Set to true when data is stale (from cache or we are offline)

  return result;
}

// export function refetch() {}

// export function getQueryData() {}

// TODO: Disable when no network
// TODO: Error toast + auth handling
// function createAction() {}

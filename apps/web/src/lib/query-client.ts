import { isServer } from "@solidjs/web";
import { MutationCache, QueryClient } from "@tanstack/solid-query";
import { Option, Schema } from "effect";
import { createSignal, onHydrationEnd } from "solid-js";
import { broadcastInvalidation, crossTabTenant, installCrossTabSync } from "~/lib/cross-tab-sync";
import { errorTag } from "~/lib/errors";
import { reportGlobalError } from "~/lib/global-errors";

// Data lives behind the API Worker's auth and only the browser has the session
// it expects. Keeping queries idle during SSR avoids holding the document open
// (and serializing transport errors) while the client fetches after hydration.
//
// Queries also stay idle *during* hydration. If a cached response resolves
// while the server's markup is still being claimed, the client renders rows,
// counts and controls the server never emitted, and hydration silently detaches
// that subtree (no handlers on sort, filter or column menus). Flipping this
// signal once hydration ends gives every page the same first render the server
// produced, then loads data on the next tick.
//
// This module is imported by the layouts that actually query (the dashboard and
// the public enrollment page), not by the root app shell, so the landing and
// auth pages never download the query client.
const [hydrationComplete, setHydrationComplete] = createSignal(isServer);

if (!isServer) onHydrationEnd(() => setHydrationComplete(true));

/** `false` until the initial server markup has been claimed by the client. */
export const isHydrated = hydrationComplete;

/** The only `meta.crossTab` shape that overrides the active tenant. */
const CrossTabMeta = Schema.Struct({ tenantId: Schema.optional(Schema.String) });

export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      // Mutations that render their own inline error opt out with
      // `meta: { inlineError: true }` to avoid showing the same failure twice.
      if (mutation.meta?.inlineError) return;
      reportGlobalError(error);
    },
    onSuccess: (_data, _variables, _context, mutation) => {
      // Other tabs share this cache's truth. `meta.crossTab: false` opts a
      // mutation out (for example a local-only UI preference); otherwise the
      // active tenant is invalidated once, coalesced with any sibling mutation
      // in the same flush window. Query lists stay correct without every call
      // site remembering to broadcast.
      const meta = mutation.meta?.crossTab;

      if (meta === false) return;

      // `meta.crossTab` is caller-supplied and untyped, so decode the one shape
      // the sync layer understands instead of narrowing it by hand.
      const sync = Option.getOrUndefined(Schema.decodeUnknownOption(CrossTabMeta)(meta));
      const tenantId = sync?.tenantId ?? crossTabTenant();

      if (!tenantId) return;

      broadcastInvalidation(tenantId, []);
    },
  }),
  defaultOptions: {
    queries: {
      enabled: !isServer,
      retry: (count, error) => {
        // Client errors (4xx) will not get better by retrying.
        const tag = errorTag(error);

        if (
          tag &&
          (tag.startsWith("Enterprise") ||
            tag.startsWith("Platform") ||
            tag.startsWith("Password") ||
            tag.startsWith("Session"))
        )
          return false;

        return count < 1;
      },
    },
  },
});

// The dashboard and enrollment pages are the only routes that import this
// module, so installing the listener here keeps it off the landing and auth
// bundles. On the server the call is a no-op.
installCrossTabSync(queryClient);

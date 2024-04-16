import { createContextProvider } from "@solid-primitives/context";
import { A, Navigate, type RouteDefinition } from "@solidjs/router";
import { type ParentProps, Show } from "solid-js";
import { toast } from "solid-sonner";
import { Badge } from "@mattrax/ui";
import { z } from "zod";

import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";
import type { RouterOutput } from "~/api";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";

// const NAV_ITEMS = [{ title: "Application", href: "" }];

export const route = {
  load: ({ params }) =>
    trpc.useContext().app.get.ensureData({
      id: params.appId!,
    }),
  info: {
    // NAV_ITEMS,
    BREADCRUMB: {
      Component: () => {
        const params = useZodParams({ appId: z.string() });

        const query = trpc.app.get.createQuery(() => ({
          id: params.appId,
        }));

        return (
          <>
            <span>{query.data?.name}</span>
            <Badge variant="outline">App</Badge>
          </>
        );
      },
    },
  },
} satisfies RouteDefinition;

export const [AppContextProvider, useApp] = createContextProvider(
  (props: {
    app: NonNullable<RouterOutput["app"]["get"]>;
    query: ReturnType<typeof trpc.app.get.createQuery>;
  }) => {
    return Object.assign(() => props.app, { query: props.query });
  },
  null!,
);

export default function Layout(props: ParentProps) {
  const params = useZodParams({ appId: z.string() });

  const query = trpc.app.get.createQuery(() => ({
    id: params.appId,
  }));

  return (
    <Show when={query.data !== undefined}>
      <Show when={query.data} fallback={<NotFound />}>
        {(data) => (
          <AppContextProvider app={data()} query={query}>
            <MErrorBoundary>{props.children}</MErrorBoundary>
          </AppContextProvider>
        )}
      </Show>
    </Show>
  );
}

function NotFound() {
  toast.error("Application not found");
  // necessary since '..' adds trailing slash -_-
  return <Navigate href="../../apps" />;
}

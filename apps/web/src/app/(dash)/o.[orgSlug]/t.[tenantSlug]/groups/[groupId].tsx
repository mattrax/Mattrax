import { Navigate, type RouteDefinition } from "@solidjs/router";
import { type ParentProps, Show, Match, Switch } from "solid-js";
import { toast } from "solid-sonner";
import { Badge } from "@mattrax/ui";
import { z } from "zod";

import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { GroupContextProvider } from "./[groupId]/Context";
import { useZodParams } from "~/lib/useZodParams";
import { trpc } from "~/lib";

// const NAV_ITEMS = [{ title: "Group", href: "" }];

export const route = {
  load: ({ params }) =>
    trpc.useContext().group.get.ensureData({
      id: params.groupId!,
    }),
  info: {
    // NAV_ITEMS
    BREADCRUMB: {
      Component: () => {
        const params = useZodParams({ groupId: z.string() });
        const query = trpc.group.get.useQuery(() => ({
          id: params.groupId,
        }));

        return (
          <>
            <span>{query.data?.name}</span>
            <Badge variant="outline">Group</Badge>
          </>
        );
      },
    },
  },
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
  const params = useZodParams({ groupId: z.string() });
  const query = trpc.group.get.useQuery(() => ({
    id: params.groupId,
  }));

  return (
    <Switch>
      <Match when={query.data === null}>
        <NotFound />
      </Match>
      <Match when={query.data}>
        {(data) => (
          <GroupContextProvider group={data()} query={query}>
            <MErrorBoundary>{props.children}</MErrorBoundary>
          </GroupContextProvider>
        )}
      </Match>
    </Switch>
  );
}

function NotFound() {
  toast.error("Group not found");
  // necessary since '..' adds trailing slash -_-
  return <Navigate href="../../groups" />;
}

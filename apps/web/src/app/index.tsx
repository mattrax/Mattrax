import { Navigate } from "@solidjs/router";
import { Show } from "solid-js";

import { AuthContext, useAuth } from "~c/AuthContext";
import { trpc } from "~/lib";

export const route = {
  load: () => trpc.useContext().auth.me.ensureData(),
};

export default function Page() {
  const defaultOrg = () => {
    const orgs = useAuth()().orgs;
    if (orgs.length < 1) return;

    return orgs[0];
  };

  const defaultTenant = () => {
    const tenants = useAuth()().tenants;
    if (tenants.length < 1) return;

    return tenants[0];
  };

  return (
    <AuthContext>
      <Show
        when={defaultOrg()}
        fallback={
          (() => {
            throw new Error(
              "No organisations found, re-login to create a default one.",
            );
          }) as any
        }
      >
        {(
          org, // If we have an active tenant, send the user to it
        ) => (
          <Show
            when={defaultTenant()}
            fallback={<Navigate href={`/o/${org().slug}`} />}
          >
            {(tenant) => (
              <Navigate href={`/o/${org().slug}/t/${tenant().slug}`} />
            )}
          </Show>
        )}
      </Show>
    </AuthContext>
  );
}

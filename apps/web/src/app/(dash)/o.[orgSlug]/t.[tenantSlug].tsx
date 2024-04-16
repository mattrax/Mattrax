import { type ParentProps, Show, Suspense, startTransition } from "solid-js";
import { type RouteDefinition, useNavigate, A } from "@solidjs/router";
import { z } from "zod";

import { useZodParams } from "~/lib/useZodParams";
import { MErrorBoundary } from "~c/MattraxErrorBoundary";
import { AuthContext } from "~c/AuthContext";
import IconPhCaretUpDown from "~icons/ph/caret-up-down.jsx";
import { TenantContext, useTenant } from "./t.[tenantSlug]/Context";
import { MultiSwitcher } from "../MultiSwitcher";
import { As } from "@kobalte/core";
import { Button } from "@mattrax/ui";

export function useTenantSlug() {
  const params = useZodParams({ tenantSlug: z.string() });
  return () => params.tenantSlug;
}

const NAV_ITEMS = [
  { title: "Dashboard", href: "" },
  { title: "Users", href: "users" },
  { title: "Devices", href: "devices" },
  { title: "Policies", href: "policies" },
  { title: "Applications", href: "apps" },
  { title: "Groups", href: "groups" },
  { title: "Settings", href: "settings" },
];

export const route = {
  info: {
    NAV_ITEMS,
    BREADCRUMB: {
      hasNestedSegments: true,
      Component: (props: { href: string }) => {
        return (
          <AuthContext>
            <TenantContext>
              <div class="flex flex-row items-center py-1 gap-2">
                <A href={props.href}>{useTenant()().name}</A>
                <MultiSwitcher>
                  <As component={Button} variant="ghost" size="iconSmall">
                    <IconPhCaretUpDown class="h-5 w-5 -mx-1" />
                  </As>
                </MultiSwitcher>
              </div>
            </TenantContext>
          </AuthContext>
        );
      },
    },
  },
} satisfies RouteDefinition;

export default function Layout(props: ParentProps) {
  const params = useZodParams({ tenantSlug: z.string() });

  return (
    <>
      <MErrorBoundary>
        {/* we key here on purpose - tenants are the root-most unit of isolation */}
        <Show when={params.tenantSlug} keyed>
          <Suspense>{props.children}</Suspense>
        </Show>
      </MErrorBoundary>
    </>
  );
}

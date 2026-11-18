import { useSearchParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { useMutation, useQuery } from "@tanstack/solid-query";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import { readLastTenant } from "~/components/app-shell";
import { resolveLandingTenant } from "~/lib/tenant";
import { Page } from "~/components/mdm/common";
import { Button, Card } from "@mattrax/ui";
import { Sparkles } from "~/components/ui/icons";
import { errorMessage } from "~/lib/errors";
import { enterprise, meQueryOptions } from "~/lib/enterprise";
import { authClient } from "~/lib/auth";
import {
  parsePolicyDraft,
  policyPlatforms,
  policySelectionCount,
  policyToConfigurations,
  type PolicyDraft,
} from "~/lib/policy-designer/build";

const parseDraft = (value: string | null): PolicyDraft | undefined => parsePolicyDraft(value);

/**
 * `/dashboard` is the stable post-sign-in URL, not a tenant picker. Tenants are
 * chosen from the top-bar switcher. When the public designer hands over a
 * draft we pause here to deploy it into the current tenant; every other visit
 * redirects straight to the remembered tenant.
 */
export default function DashboardRedirectPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const session = authClient.useSession();
  const me = useQuery(() => meQueryOptions(session().data?.user?.id));
  const [draft, setDraft] = createSignal<PolicyDraft | undefined>();
  const [draftChecked, setDraftChecked] = createSignal(false);
  const [tenantId, setTenantId] = createSignal("");

  onSettled(() => {
    const wantsDraft = Boolean(searchParams.designerDraft);

    if (wantsDraft) setDraft(parseDraft(localStorage.getItem("mattrax:designer-draft")));
    setDraftChecked(true);
  });

  createEffect(
    () => ({
      tenants: me.data?.tenants,
      defaultTenantId: me.data?.account.defaultTenantId,
    }),
    ({ tenants, defaultTenantId }) => {
      if (tenantId() || !tenants?.length) return;

      const landing = resolveLandingTenant(tenants, {
        defaultTenantId,
        lastTenantId: readLastTenant(),
      });

      if (landing) setTenantId(landing.id);
    },
  );

  // Wait for both the local draft check and the tenant list before redirecting.
  createEffect(
    () => ({
      ready: draftChecked(),
      loading: me.isPending && !me.data,
      draft: draft(),
      tenants: me.data?.tenants,
    }),
    ({ ready, loading, draft: current, tenants }) => {
      if (!ready || loading) return;

      if (current && (tenants?.length ?? 0) > 0) return;
      const tenant = tenants?.find((item) => item.id === tenantId()) ?? tenants?.[0];
      navigate(tenant ? `/t/${tenant.slug || tenant.id}` : "/tenants/new", { replace: true });
    },
  );

  const deployDraft = useMutation(() => ({
    mutationFn: async () => {
      const current = draft();
      const tenant = tenantId() || me.data?.tenants[0]?.id;

      if (!current || !tenant) throw new Error("Choose a tenant first");
      const policy = await enterprise.createPolicy(tenant, { name: current.name });

      try {
        await enterprise.patchPolicy(tenant, policy.id, {
          configurations: policyToConfigurations(current),
        });
      } catch (error) {
        await enterprise.deletePolicies(tenant, [policy.id]).catch(() => undefined);
        throw error;
      }

      localStorage.setItem(`mattrax:designer:${policy.id}`, JSON.stringify(current));
      localStorage.removeItem("mattrax:designer-draft");

      return { tenant, policyId: policy.id };
    },
    onSuccess: ({ tenant, policyId }) => {
      navigate(`/t/${tenant}/policies/${policyId}/design`);
    },
  }));

  return (
    <Show
      when={draft()}
      fallback={
        <div class="flex flex-1 items-center justify-center py-24">
          <p class="text-[12px] text-muted-foreground">Opening your tenant…</p>
        </div>
      }
    >
      {(current) => (
        <Page class="max-w-[560px]">
          <Card class="relative overflow-hidden">
            <div class="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[radial-gradient(70%_100%_at_30%_0%,var(--brand-muted),transparent_75%)]" />
            <div class="relative p-5 sm:p-6">
              <span class="label-caps inline-flex items-center gap-1.5 text-brand">
                <Sparkles class="size-3" />
                Designer handoff
              </span>
              <h1 class="mt-2 text-[20px] font-[560] leading-tight tracking-[-0.026em]">
                Policy draft ready
              </h1>
              <p class="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                {current().name} ·{" "}
                {policyPlatforms(current())
                  .map((platform) => platform[0]!.toUpperCase() + platform.slice(1))
                  .join(", ")}{" "}
                · {policySelectionCount(current())} collections ·{" "}
                {Object.values(current().platforms)
                  .flat()
                  .reduce(
                    (total, selection) => total + Object.keys(selection?.values ?? {}).length,
                    0,
                  )}{" "}
                settings
              </p>

              <Show
                when={(me.data?.tenants.length ?? 0) > 0}
                fallback={
                  <div class="mt-5 rounded-lg border border-warning/25 bg-warning/[0.07] p-3 text-[12.5px] text-warning-foreground">
                    Create a tenant before deploying this draft.{" "}
                    <a href="/tenants/new" class="font-medium underline underline-offset-2">
                      Create tenant
                    </a>
                  </div>
                }
              >
                <div class="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <label class="sr-only" for="draft-tenant">
                    Tenant
                  </label>
                  <select
                    id="draft-tenant"
                    class="h-8 rounded-md border border-input bg-card px-2.5 text-[12.5px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
                    value={tenantId()}
                    onChange={(event) => setTenantId(event.currentTarget.value)}
                  >
                    <For each={me.data?.tenants ?? []}>
                      {(tenant) => <option value={tenant.id}>{tenant.name}</option>}
                    </For>
                  </select>
                  <Button disabled={deployDraft.isPending} onClick={() => deployDraft.mutate()}>
                    {deployDraft.isPending ? "Creating policy…" : "Create policy & continue"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      localStorage.removeItem("mattrax:designer-draft");
                      setDraft(undefined);
                    }}
                  >
                    Discard
                  </Button>
                  <a
                    href="/designer"
                    class="text-[12px] text-muted-foreground underline underline-offset-2 transition-colors duration-[var(--duration-hover)] ease-swift hover:text-foreground"
                  >
                    Edit draft
                  </a>
                </div>
              </Show>
              <Show when={deployDraft.error}>
                {(error) => (
                  <p role="alert" class="mt-3 text-[12.5px] text-destructive">
                    {errorMessage(error())}
                  </p>
                )}
              </Show>
            </div>
          </Card>
        </Page>
      )}
    </Show>
  );
}

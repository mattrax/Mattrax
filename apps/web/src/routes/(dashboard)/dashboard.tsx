import { useNavigate, useSearchParams } from "@solidjs/router";
import { useMutation, useQuery } from "@tanstack/solid-query";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import { readLastTenant } from "~/components/app-shell";
import { Page, Panel } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
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
    () => me.data?.tenants,
    (tenants) => {
      if (tenantId() || !tenants?.length) return;
      const remembered = readLastTenant();
      setTenantId(tenants.find((tenant) => tenant.id === remembered)?.id ?? tenants[0]!.id);
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
        <Page class="max-w-[640px]">
          <Panel class="overflow-hidden">
            <div class="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(70%_100%_at_30%_0%,var(--brand-glow),transparent_75%)]" />
            <div class="relative p-5 sm:p-6">
              <span class="inline-flex items-center gap-1.5 rounded-full border border-brand/25 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-brand">
                <Sparkles class="size-3" />
                Designer handoff
              </span>
              <h1 class="mt-3 text-[22px] font-semibold tracking-[-0.02em]">Policy draft ready</h1>
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
                    class="h-9 rounded-lg border border-input bg-background px-3 text-[13px] text-foreground"
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
                    class="text-[12px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
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
          </Panel>
        </Page>
      )}
    </Show>
  );
}

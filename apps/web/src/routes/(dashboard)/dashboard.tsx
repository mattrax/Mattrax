import { useNavigate } from "@solidjs/router";
import { useMutation, useQuery } from "@tanstack/solid-query";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import { EmptyState, PageHeader } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Building2, Plus } from "~/components/ui/icons";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { artifactToConfigurations, type Draft } from "~/lib/policy-designer/build";

const parseDraft = (value: string | null): Draft | undefined => {
  if (!value) return undefined;
  try {
    const draft = JSON.parse(value) as Draft;
    return draft.version === 1 ? draft : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Workspace picker. Tenant ids always travel in the URL (`/t/:tenantId/...`),
 * so this page never stores a selection; choosing a workspace navigates to its
 * tenant-scoped route.
 */
export default function DashboardPage() {
  const navigate = useNavigate();
  const me = useQuery(() => ({ queryKey: enterpriseKeys.me(), queryFn: enterprise.me }));
  const [draft, setDraft] = createSignal<Draft | undefined>();
  const [tenantId, setTenantId] = createSignal<string>("");

  onSettled(() => {
    const stored = parseDraft(localStorage.getItem("mattrax:designer-draft"));
    if (stored) setDraft(stored);
  });
  createEffect(
    () => me.data?.tenants,
    (tenants) => {
      if (!tenantId() && tenants?.[0]) setTenantId(tenants[0].id);
    },
  );

  const deployDraft = useMutation(() => ({
    mutationFn: async () => {
      const current = draft();
      const tenant = tenantId() || me.data?.tenants[0]?.id;
      if (!current || !tenant) throw new Error("Choose a workspace first");
      const policy = await enterprise.createPolicy(tenant, { name: current.name });
      try {
        await enterprise.patchPolicy(tenant, policy.id, {
          configurations: artifactToConfigurations(current),
        });
      } catch (error) {
        // Do not leave an empty policy behind when the draft cannot be saved.
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
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Workspaces"
        description="Choose a tenant to manage its devices, groups and policies."
        actions={
          <Show when={me.data?.tenants.length}>
            <Button onClick={() => navigate("/tenants/new")}>
              <Plus class="size-4" />
              Create tenant
            </Button>
          </Show>
        }
      />

      <Show when={draft()}>
        {(current) => (
          <div class="rounded-xl border border-stone-900 bg-stone-900 p-5 text-white">
            <p class="text-xs uppercase tracking-[0.16em] text-stone-400">Policy draft ready</p>
            <h2 class="mt-1 text-lg font-semibold">{current().name}</h2>
            <p class="mt-1 text-sm text-stone-300">
              {current().platform} · {current().selections.length} collections ·{" "}
              {current().selections.reduce(
                (total, selection) => total + Object.keys(selection.values).length,
                0,
              )}{" "}
              settings
            </p>
            <Show
              when={me.data?.tenants.length}
              fallback={
                <p class="mt-4 text-sm text-stone-300">
                  Create a workspace first and your draft will be waiting here.{" "}
                  <a href="/tenants/new" class="underline hover:text-white">
                    Create a workspace
                  </a>
                </p>
              }
            >
              <div class="mt-4 flex flex-wrap items-center gap-2">
                <label class="sr-only" for="draft-tenant">
                  Workspace
                </label>
                <select
                  id="draft-tenant"
                  class="h-9 rounded-lg border border-stone-700 bg-stone-800 px-3 text-sm text-white"
                  value={tenantId()}
                  onChange={(event) => setTenantId(event.currentTarget.value)}
                >
                  <For each={me.data?.tenants ?? []}>
                    {(tenant) => <option value={tenant.id}>{tenant.name}</option>}
                  </For>
                </select>
                <Button
                  variant="secondary"
                  disabled={deployDraft.isPending}
                  onClick={() => deployDraft.mutate()}
                >
                  {deployDraft.isPending ? "Creating policy…" : "Create policy & continue"}
                </Button>
                <Button
                  variant="ghost"
                  class="text-stone-300 hover:text-white"
                  onClick={() => {
                    localStorage.removeItem("mattrax:designer-draft");
                    setDraft(undefined);
                  }}
                >
                  Discard
                </Button>
                <a href="/designer" class="text-xs text-stone-300 underline hover:text-white">
                  Edit draft
                </a>
              </div>
            </Show>
            <Show when={deployDraft.error}>
              {(error) => (
                <p class="mt-2 text-sm text-red-300">
                  {error() instanceof Error ? error().message : String(error())}
                </p>
              )}
            </Show>
          </div>
        )}
      </Show>

      <Show
        when={(me.data?.tenants.length ?? 0) > 0}
        fallback={
          <Show when={me.isSuccess}>
            <EmptyState
              title="No tenant yet"
              description="Tenants hold your devices, groups, policies, and team. Create one to get started."
              action={
                <Button onClick={() => navigate("/tenants/new")}>
                  <Plus class="size-4" />
                  Create tenant
                </Button>
              }
            />
          </Show>
        }
      >
        <div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <For each={me.data?.tenants ?? []}>
            {(tenant) => (
              <button
                type="button"
                onClick={() => navigate(`/t/${tenant.id}`)}
                class="flex items-start gap-4 rounded-xl border bg-card p-5 text-left transition-colors hover:bg-muted/40"
              >
                <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-stone-900 text-white">
                  <Building2 class="size-5" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-semibold text-stone-900">
                    {tenant.name}
                  </span>
                  <span class="block truncate text-xs text-muted-foreground">{tenant.slug}</span>
                  <Badge variant="outline" class="mt-2 capitalize">
                    {tenant.role}
                  </Badge>
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

import { useNavigate } from "@solidjs/router";
import { useMutation, useQuery } from "@tanstack/solid-query";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import { EmptyState, Page, PageHeader, Panel, QueryError } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { ArrowUpRight, Building2, Plus, Sparkles } from "~/components/ui/icons";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { errorMessage } from "~/lib/errors";
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

const workspaceInitials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

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

  const workspaceCount = () => me.data?.tenants.length ?? 0;

  return (
    <Page>
      <PageHeader
        eyebrow="Mattrax console"
        title="Workspaces"
        description="Choose a tenant to manage its devices, groups and policies."
        meta={
          <Show when={me.data}>
            {(data) => (
              <>
                <span class="break-all text-muted-foreground">{data().user.email}</span>
                <span class="text-muted-foreground/40" aria-hidden="true">
                  ·
                </span>
                <span>
                  {data().tenants.length} workspace
                  {data().tenants.length === 1 ? "" : "s"}
                </span>
              </>
            )}
          </Show>
        }
        actions={
          <Show when={workspaceCount() > 0}>
            <Button onClick={() => navigate("/tenants/new")}>
              <Plus class="size-4" />
              Create tenant
            </Button>
          </Show>
        }
      />

      <QueryError error={me.error} onRetry={() => void me.refetch()} />

      <Show when={draft()}>
        {(current) => (
          <Panel class="border-brand/25 bg-[radial-gradient(120%_120%_at_0%_0%,rgba(91,100,255,0.13),transparent_62%)]">
            <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div class="min-w-0">
                <p class="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-brand">
                  <Sparkles class="size-3" />
                  Policy draft ready
                </p>
                <h2 class="mt-2 truncate text-[15px] font-semibold tracking-[-0.01em] text-foreground">
                  {current().name}
                </h2>
                <p class="mt-1 text-[12.5px] text-muted-foreground">
                  {current().platform} · {current().selections.length} collections ·{" "}
                  {current().selections.reduce(
                    (total, selection) => total + Object.keys(selection.values).length,
                    0,
                  )}{" "}
                  settings
                </p>
              </div>
              <a
                href="/designer"
                class="shrink-0 text-[11.5px] font-medium text-muted-foreground underline decoration-white/20 underline-offset-4 transition-colors hover:text-foreground"
              >
                Edit draft
              </a>
            </div>

            <Show
              when={workspaceCount() > 0}
              fallback={
                <p class="mt-4 text-[12.5px] text-muted-foreground">
                  Create a workspace first and your draft will be waiting here.{" "}
                  <a
                    href="/tenants/new"
                    class="font-medium text-foreground underline decoration-white/25 underline-offset-4 hover:text-brand"
                  >
                    Create a workspace
                  </a>
                </p>
              }
            >
              <div class="mt-4 flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-4">
                <label class="sr-only" for="draft-tenant">
                  Workspace
                </label>
                <select
                  id="draft-tenant"
                  class="h-8 min-w-0 max-w-full rounded-lg border bg-card px-2.5 text-[13px] text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
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
                  class="text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    localStorage.removeItem("mattrax:designer-draft");
                    setDraft(undefined);
                  }}
                >
                  Discard
                </Button>
              </div>
            </Show>
            <Show when={deployDraft.error}>
              {(error) => (
                <p role="alert" class="mt-2 text-[12.5px] text-destructive">
                  {errorMessage(error())}
                </p>
              )}
            </Show>
          </Panel>
        )}
      </Show>

      <Show
        when={workspaceCount() > 0}
        fallback={
          <Show when={me.isSuccess}>
            <EmptyState
              title="No tenant yet"
              description="Tenants hold your devices, groups, policies, and team. Create one to get started."
              icon={Building2}
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
        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <For each={me.data?.tenants ?? []}>
            {(tenant) => (
              <button
                type="button"
                onClick={() => navigate(`/t/${tenant.id}`)}
                class="group flex min-w-0 flex-col gap-3.5 rounded-xl border border-white/[0.07] bg-card p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-all duration-200 hover:border-white/[0.14] hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <div class="flex min-w-0 items-start gap-3">
                  <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand text-[11px] font-semibold text-brand-foreground shadow-[inset_0_1px_0_rgba(255,255,255,.22)]">
                    {workspaceInitials(tenant.name)}
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-[13.5px] font-semibold text-foreground">
                      {tenant.name}
                    </span>
                    <span class="mt-0.5 block truncate font-mono text-[11px] text-muted-foreground">
                      {tenant.slug}
                    </span>
                  </span>
                  <ArrowUpRight class="size-3.5 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
                </div>
                <div class="flex items-center justify-between gap-2 border-t border-white/[0.06] pt-3">
                  <Badge variant="outline" class="capitalize text-muted-foreground">
                    {tenant.role}
                  </Badge>
                  <span class="text-[11.5px] font-medium text-muted-foreground transition-colors group-hover:text-brand">
                    Open
                  </span>
                </div>
              </button>
            )}
          </For>
        </div>
      </Show>
    </Page>
  );
}

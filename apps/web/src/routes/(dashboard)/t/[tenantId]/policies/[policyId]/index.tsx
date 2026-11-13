import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show } from "solid-js";
import {
  ErrorText,
  Field,
  formatDate,
  LinkButton,
  Page,
  PageHeader,
  Panel,
  QueryError,
  relativeTime,
} from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Activity, CircleAlert, SlidersHorizontal } from "~/components/ui/icons";
import { enterprise, enterpriseKeys, type PolicyRow } from "~/lib/enterprise";

const textareaClass =
  "min-h-28 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

const kindLabel = (kind: string) => {
  if (kind === "mttx.apple.device") return "Device restrictions";
  if (kind.startsWith("mttx.apple.certificate")) return "Certificate";
  if (kind.startsWith("mttx.apple.custom")) return "Custom profile";
  if (kind.startsWith("mttx.apple.application")) return "Application";
  if (kind.startsWith("mttx.apple.declaration")) return "Declaration";
  if (kind.startsWith("mttx.windows.custom")) return "Windows configuration";
  if (kind.startsWith("mttx.android.policy")) return "Android policy";
  return kind;
};

/** Links to the alternate policy surfaces, styled as a console tab strip. */
function ViewTabs(props: { base: string; active: "overview" | "assignments" }) {
  const tabs = () => [
    { id: "overview" as const, label: "Overview", href: props.base },
    { id: "assignments" as const, label: "Assignments", href: `${props.base}/assignments` },
    { id: "designer" as const, label: "Designer", href: `${props.base}/design` },
    { id: "editor" as const, label: "Advanced editor", href: `${props.base}/editor` },
  ];
  return (
    <nav
      aria-label="Policy views"
      class="no-scrollbar -mb-px flex items-center gap-0.5 overflow-x-auto border-b border-border"
    >
      <For each={tabs()}>
        {(tab) => {
          const current = tab.id === props.active;
          return (
            <a
              href={tab.href}
              aria-current={current ? "page" : undefined}
              class={
                current
                  ? "relative flex h-8 shrink-0 items-center gap-1.5 rounded-t-md border-b-2 border-brand px-2.5 text-[12.5px] font-medium text-foreground"
                  : "relative flex h-8 shrink-0 items-center gap-1.5 rounded-t-md border-b-2 border-transparent px-2.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              }
            >
              {tab.label}
            </a>
          );
        }}
      </For>
    </nav>
  );
}

export default function PolicyDetailPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const policy = useQuery(() => ({
    queryKey: enterpriseKeys.item(params.tenantId, "policy", params.policyId),
    queryFn: () => enterprise.get(params.tenantId, "policy", params.policyId),
  }));
  const row = () => policy.data as PolicyRow | undefined;
  const [name, setName] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [priority, setPriority] = createSignal("0");
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [confirm, setConfirm] = createSignal("");
  createEffect(
    () => row()?.id,
    () => {
      const policy = row();
      if (policy) {
        setName(policy.name);
        setNotes(policy.notes ?? "");
        setPriority(String(policy.priority ?? 0));
      }
    },
  );
  const invalidate = async () => {
    await qc.invalidateQueries({
      queryKey: enterpriseKeys.item(params.tenantId, "policy", params.policyId),
    });
    await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "policy") });
  };
  const save = useMutation(() => ({
    mutationFn: () =>
      enterprise.patchPolicy(params.tenantId, params.policyId, {
        name: name(),
        notes: notes() || null,
        priority: Number(priority()) || 0,
      }),
    onSuccess: invalidate,
  }));
  const dup = useMutation(() => ({
    mutationFn: () => enterprise.duplicatePolicy(params.tenantId, params.policyId),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "policy") });
      navigate(`/t/${params.tenantId}/policies/${id}`);
    },
  }));
  const del = useMutation(() => ({
    mutationFn: () =>
      enterprise.deletePolicies(params.tenantId, params.policyId ? [params.policyId] : []),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "policy") });
      navigate(`/t/${params.tenantId}/policies`);
    },
  }));
  const deployments = useQuery(() => ({
    queryKey: [...enterpriseKeys.item(params.tenantId, "policy", params.policyId), "deployments"],
    queryFn: () => enterprise.listPolicyDeployments(params.tenantId, params.policyId),
  }));
  const rollback = useMutation(() => ({
    mutationFn: (deploymentId: string) =>
      enterprise.rollbackPolicy(params.tenantId, params.policyId, deploymentId),
    onSuccess: async () => {
      await invalidate();
      await qc.invalidateQueries({
        queryKey: [
          ...enterpriseKeys.item(params.tenantId, "policy", params.policyId),
          "deployments",
        ],
      });
    },
  }));
  const sync = useMutation(() => ({
    mutationFn: () => enterprise.syncPolicies(params.tenantId, [params.policyId!]),
  }));

  const configurations = () => Object.entries(row()?.configurations ?? {});

  return (
    <Page>
      <QueryError error={policy.error} onRetry={() => void policy.refetch()} />

      <PageHeader
        eyebrow="Policy"
        title={row()?.name ?? "Policy"}
        description="Configure what this policy deploys to its device scope."
        meta={
          <Show when={row()}>
            <Badge variant="outline" class="gap-1.5 text-muted-foreground">
              <SlidersHorizontal class="size-3" />
              {configurations().length} configuration{configurations().length === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline" class="gap-1.5 text-muted-foreground">
              Priority <span class="tabular-nums text-foreground">{row()?.priority ?? 0}</span>
            </Badge>
            <span class="text-[11.5px]">Updated {relativeTime(row()?.updatedAt)}</span>
          </Show>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
              {sync.isPending ? "Syncing…" : "Sync"}
            </Button>
            <Button variant="outline" onClick={() => dup.mutate()} disabled={dup.isPending}>
              Duplicate
            </Button>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              Delete
            </Button>
          </>
        }
      />

      <ViewTabs base={`/t/${params.tenantId}/policies/${params.policyId}`} active="overview" />

      <ErrorText error={sync.error} />

      <div class="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Panel title="Details" description="Metadata saved with this policy.">
          <form
            class="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <Field label="Name">
              <Input value={name()} onInput={(e) => setName(e.currentTarget.value)} />
            </Field>
            <Field label="Notes">
              <textarea
                class={textareaClass}
                value={notes()}
                onInput={(e) => setNotes(e.currentTarget.value)}
                placeholder="What does this policy do?"
              />
            </Field>
            <Field label="Conflict priority">
              <Input
                type="number"
                step="1"
                value={priority()}
                onInput={(e) => setPriority(e.currentTarget.value)}
              />
              <p class="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
                Higher numbers win when included policies provide the same configuration kind.
                Direct device assignments beat group assignments first; ties fall back to the most
                recently updated policy, then the smallest id.
              </p>
            </Field>
            <ErrorText error={save.error} />
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save changes"}
            </Button>
          </form>
        </Panel>

        <Panel
          title="Configurations"
          description="Payloads delivered to devices in this policy's scope."
          actions={
            <Badge variant="secondary" class="tabular-nums">
              {configurations().length}
            </Badge>
          }
        >
          <Show
            when={configurations().length > 0}
            fallback={
              <div class="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6">
                <p class="text-[12.5px] leading-relaxed text-muted-foreground">
                  This policy has no configurations yet. Open the editor to add restrictions,
                  certificates, or a custom profile.
                </p>
                <LinkButton
                  href={`/t/${params.tenantId}/policies/${params.policyId}/editor`}
                  variant="outline"
                  size="sm"
                >
                  Open the editor
                </LinkButton>
              </div>
            }
          >
            <div class="space-y-2">
              <Show
                when={configurations().some(([kind]) => kind.startsWith("mttx.android.policy"))}
              >
                <div class="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/[0.07] px-3 py-2.5 text-[12px] leading-relaxed text-warning-foreground">
                  <CircleAlert class="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    Android delivery is not configured. This policy is saved, but no Android device
                    will receive it until the workspace is connected to Android Enterprise.
                  </span>
                </div>
              </Show>
              <For each={configurations()}>
                {([kind, data]) => {
                  const entries = () =>
                    typeof data === "object" && data !== null && !Array.isArray(data)
                      ? Object.keys(data as Record<string, unknown>).length
                      : 0;
                  return (
                    <details class="group overflow-hidden rounded-lg border border-border bg-muted/15">
                      <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-[13px] transition-colors hover:bg-muted/40">
                        <span class="flex min-w-0 items-center gap-2">
                          <span class="truncate font-medium text-foreground">
                            {kindLabel(kind)}
                          </span>
                          <Show when={entries() > 0}>
                            <span class="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                              {entries()} field{entries() === 1 ? "" : "s"}
                            </span>
                          </Show>
                        </span>
                        <Badge
                          variant="outline"
                          class="hidden max-w-[50%] truncate font-mono text-[10px] text-muted-foreground sm:inline-flex"
                        >
                          {kind}
                        </Badge>
                      </summary>
                      <pre class="max-h-64 overflow-auto border-t border-border bg-background/60 p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
                        {JSON.stringify(data, null, 2)}
                      </pre>
                    </details>
                  );
                }}
              </For>
            </div>
          </Show>
        </Panel>

        <Panel
          class="lg:col-span-2"
          title="Deployment history"
          description="Every save produces a versioned deployment that can be restored."
          actions={
            <Badge variant="outline" class="gap-1.5 text-muted-foreground">
              <Activity class="size-3" />
              {deployments.data?.deployments.length ?? 0} version
              {(deployments.data?.deployments.length ?? 0) === 1 ? "" : "s"}
            </Badge>
          }
        >
          <Show
            when={(deployments.data?.deployments.length ?? 0) > 0}
            fallback={
              <p class="rounded-lg border border-dashed border-border bg-muted/20 px-4 py-5 text-[12.5px] text-muted-foreground">
                No deployments yet.
              </p>
            }
          >
            <div class="divide-y divide-border/60 overflow-hidden rounded-lg border border-border">
              <For each={deployments.data?.deployments ?? []}>
                {(deployment) => (
                  <div class="flex flex-wrap items-center justify-between gap-3 bg-muted/10 px-3 py-2.5 text-[13px]">
                    <span class="flex min-w-0 items-center gap-2">
                      <Badge variant="secondary" class="text-[10px] tabular-nums">
                        Version {deployment.version}
                      </Badge>
                      <span class="truncate text-muted-foreground">
                        {formatDate(deployment.createdAt)}
                      </span>
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={rollback.isPending}
                      onClick={() => rollback.mutate(deployment.id)}
                    >
                      Restore
                    </Button>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <ErrorText error={deployments.error || rollback.error} />
        </Panel>
      </div>

      <Dialog open={deleteOpen()} onOpenChange={setDeleteOpen}>
        <DialogContent class="max-w-md rounded-xl p-6">
          <DialogHeader>
            <DialogTitle>Delete {row()?.name ?? "policy"}?</DialogTitle>
          </DialogHeader>
          <p class="text-sm text-muted-foreground">
            Type <span class="font-mono font-medium">{row()?.name}</span> to confirm.
          </p>
          <Input value={confirm()} onInput={(e) => setConfirm(e.currentTarget.value)} />
          <ErrorText error={del.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirm() !== row()?.name || del.isPending}
              onClick={() => del.mutate()}
            >
              Delete policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}

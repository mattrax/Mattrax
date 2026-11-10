import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show } from "solid-js";
import { ErrorText, Field, LinkButton, PageHeader } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { enterprise, enterpriseKeys, type PolicyRow } from "~/lib/enterprise";

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
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [confirm, setConfirm] = createSignal("");
  createEffect(
    () => row(),
    (row) => {
      if (row) {
        setName(row.name);
        setNotes(row.notes ?? "");
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
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title={row()?.name ?? "Policy"}
        description="Configure what this policy deploys to its device scope."
        actions={
          <>
            <LinkButton
              href={`/t/${params.tenantId}/policies/${params.policyId}/assignments`}
              variant="outline"
            >
              Assignments
            </LinkButton>
            <LinkButton
              href={`/t/${params.tenantId}/policies/${params.policyId}/design`}
              variant="outline"
            >
              Designer
            </LinkButton>
            <LinkButton
              href={`/t/${params.tenantId}/policies/${params.policyId}/editor`}
              variant="outline"
            >
              Advanced editor
            </LinkButton>
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
      <ErrorText error={sync.error} />
      <div class="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
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
                  class="min-h-28 rounded-lg border bg-white px-3 py-2 text-sm"
                  value={notes()}
                  onInput={(e) => setNotes(e.currentTarget.value)}
                  placeholder="What does this policy do?"
                />
              </Field>
              <ErrorText error={save.error} />
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save changes"}
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Configurations</CardTitle>
          </CardHeader>
          <CardContent class="space-y-3">
            <Show
              when={configurations().length > 0}
              fallback={
                <div class="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  This policy has no configurations yet. Open the editor to add restrictions,
                  certificates, or a custom profile.
                </div>
              }
            >
              <For each={configurations()}>
                {([kind, data]) => (
                  <details class="rounded-lg border">
                    <summary class="flex cursor-pointer items-center justify-between p-3 text-sm">
                      <span class="font-medium">{kindLabel(kind)}</span>
                      <Badge variant="outline" class="font-mono text-[10px]">
                        {kind}
                      </Badge>
                    </summary>
                    <pre class="max-h-64 overflow-auto border-t bg-muted/30 p-3 text-xs">
                      {JSON.stringify(data, null, 2)}
                    </pre>
                  </details>
                )}
              </For>
            </Show>
          </CardContent>
        </Card>
        <Card class="lg:col-span-2">
          <CardHeader>
            <CardTitle>Deployment history</CardTitle>
          </CardHeader>
          <CardContent class="space-y-2">
            <Show
              when={(deployments.data?.deployments.length ?? 0) > 0}
              fallback={<p class="text-sm text-muted-foreground">No deployments yet.</p>}
            >
              <For each={deployments.data?.deployments ?? []}>
                {(deployment) => (
                  <div class="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                    <span>
                      <strong>Version {deployment.version}</strong>
                      <span class="ml-2 text-xs text-muted-foreground">
                        {new Date(deployment.createdAt).toLocaleString()}
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
            </Show>
            <ErrorText error={deployments.error || rollback.error} />
          </CardContent>
        </Card>
      </div>

      <Dialog open={deleteOpen()} onOpenChange={setDeleteOpen}>
        <DialogContent class="max-w-md rounded-xl bg-white p-6">
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
    </div>
  );
}

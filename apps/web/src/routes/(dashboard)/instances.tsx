import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import {
  EmptyState,
  ErrorText,
  Field,
  formatDate,
  PageHeader,
  QueryError,
} from "~/components/mdm/common";
import { errorMessage } from "~/lib/errors";
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
import { Boxes, Plus } from "~/components/ui/icons";

type Instance = {
  id: string;
  keyPrefix: string;
  description?: string | null;
  userCount: number;
  deviceCount: number;
  status: "active" | "inactive" | "revoked";
  createdAt: string;
  lastSeenAt?: string | null;
  revokedAt?: string | null;
};

const json = { "content-type": "application/json", "x-effect-auth-csrf": "1" };

async function platformFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/platform${path}`, {
    credentials: "include",
    headers: { ...json, ...(init?.headers as Record<string, string> | undefined) },
    ...init,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => undefined);
    throw new Error(errorMessage(body, `Request failed (${response.status})`));
  }
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export default function InstancesPage() {
  const qc = useQueryClient();
  const instances = useQuery(() => ({
    queryKey: ["platform", "instances"],
    queryFn: () => platformFetch<{ instances: Instance[] }>("/instances"),
  }));
  const [createOpen, setCreateOpen] = createSignal(false);
  const [description, setDescription] = createSignal("");
  const [newKey, setNewKey] = createSignal<string | null>(null);
  const [edit, setEdit] = createSignal<Instance | null>(null);
  const [editDescription, setEditDescription] = createSignal("");
  const [revoke, setRevoke] = createSignal<Instance | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["platform", "instances"] });
  const create = useMutation(() => ({
    mutationFn: () =>
      platformFetch<{ key: string }>("/instances", {
        method: "POST",
        body: JSON.stringify({ description: description() || null }),
      }),
    onSuccess: async (data) => {
      setNewKey(data.key);
      setDescription("");
      setCreateOpen(false);
      await invalidate();
    },
  }));
  const saveDescription = useMutation(() => ({
    mutationFn: (instance: Instance) =>
      platformFetch(`/instances/${instance.id}`, {
        method: "PATCH",
        body: JSON.stringify({ description: editDescription() || null }),
      }),
    onSuccess: async () => {
      setEdit(null);
      await invalidate();
    },
  }));
  const revokeInstance = useMutation(() => ({
    mutationFn: (instance: Instance) =>
      platformFetch(`/instances/${instance.id}`, { method: "DELETE" }),
    onSuccess: async () => {
      setRevoke(null);
      await invalidate();
    },
  }));

  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Instances"
        description="Product keys for self-hosted and whitelabel Mattrax deployments."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus class="size-4" />
            Register instance
          </Button>
        }
      />

      <Show when={newKey()}>
        <Card class="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle>Copy this product key now</CardTitle>
          </CardHeader>
          <CardContent class="space-y-2 text-sm text-amber-900">
            <p>It is only shown once. Store it in the instance's secret manager.</p>
            <code class="block break-all rounded-lg bg-white p-3 font-mono text-xs">
              {newKey()}
            </code>
            <div class="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigator.clipboard.writeText(newKey()!)}
              >
                Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setNewKey(null)}>
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      </Show>

      <QueryError error={instances.error} onRetry={() => void instances.refetch()} />

      <Show
        when={(instances.data?.instances.length ?? 0) > 0}
        fallback={
          <EmptyState
            title="No instances"
            description="Register a self-hosted deployment to issue it a product key."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus class="size-4" />
                Register instance
              </Button>
            }
          />
        }
      >
        <div class="overflow-hidden rounded-xl border bg-card">
          <table class="w-full text-sm">
            <thead class="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th class="px-4 py-3">Key</th>
                <th class="px-4 py-3">Description</th>
                <th class="px-4 py-3">Users</th>
                <th class="px-4 py-3">Devices</th>
                <th class="px-4 py-3">Status</th>
                <th class="px-4 py-3">Last seen</th>
                <th class="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y">
              <For each={instances.data?.instances ?? []}>
                {(instance) => (
                  <tr class="hover:bg-muted/25">
                    <td class="px-4 py-3 font-mono text-xs">{instance.keyPrefix}…</td>
                    <td class="px-4 py-3">{instance.description || "—"}</td>
                    <td class="px-4 py-3">{instance.userCount}</td>
                    <td class="px-4 py-3">{instance.deviceCount}</td>
                    <td class="px-4 py-3">
                      <Badge
                        variant={
                          instance.status === "active"
                            ? "default"
                            : instance.status === "revoked"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {instance.status}
                      </Badge>
                    </td>
                    <td class="px-4 py-3 text-muted-foreground">
                      {formatDate(instance.lastSeenAt)}
                    </td>
                    <td class="px-4 py-3 text-right">
                      <div class="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEdit(instance);
                            setEditDescription(instance.description ?? "");
                          }}
                          disabled={Boolean(instance.revokedAt)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setRevoke(instance)}
                          disabled={Boolean(instance.revokedAt)}
                        >
                          Revoke
                        </Button>
                      </div>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

      <Dialog open={createOpen()} onOpenChange={setCreateOpen}>
        <DialogContent class="max-w-md rounded-xl bg-white p-6">
          <DialogHeader>
            <DialogTitle>Register a self-hosted instance</DialogTitle>
          </DialogHeader>
          <Field label="Description">
            <Input
              value={description()}
              onInput={(event) => setDescription(event.currentTarget.value)}
              placeholder="Production EU cluster"
            />
          </Field>
          <ErrorText error={create.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={edit() !== null} onOpenChange={(open) => !open && setEdit(null)}>
        <DialogContent class="max-w-md rounded-xl bg-white p-6">
          <DialogHeader>
            <DialogTitle>Edit instance</DialogTitle>
          </DialogHeader>
          <Field label="Description">
            <Input
              value={editDescription()}
              onInput={(event) => setEditDescription(event.currentTarget.value)}
            />
          </Field>
          <ErrorText error={saveDescription.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => edit() && saveDescription.mutate(edit()!)}
              disabled={saveDescription.isPending}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revoke() !== null} onOpenChange={(open) => !open && setRevoke(null)}>
        <DialogContent class="max-w-md rounded-xl bg-white p-6">
          <DialogHeader>
            <DialogTitle>Revoke this instance?</DialogTitle>
          </DialogHeader>
          <p class="text-sm text-muted-foreground">
            The instance's licence checks will fail after its next monitor run. This cannot be
            undone.
          </p>
          <ErrorText error={revokeInstance.error} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevoke(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => revoke() && revokeInstance.mutate(revoke()!)}
              disabled={revokeInstance.isPending}
            >
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

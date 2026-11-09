import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import { ErrorText, Field, PageHeader } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";

export default function NewGroupPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [devices, setDevices] = createSignal<Set<string>>(new Set());
  const [policies, setPolicies] = createSignal<Set<string>>(new Set());
  const deviceList = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "device"),
    queryFn: () => enterprise.list(params.tenantId, "device"),
  }));
  const policyList = useQuery(() => ({
    queryKey: enterpriseKeys.list(params.tenantId, "policy"),
    queryFn: () => enterprise.list(params.tenantId, "policy"),
  }));
  const create = useMutation(() => ({
    mutationFn: () =>
      enterprise.createGroup(params.tenantId, {
        name: name(),
        notes: notes() || null,
        devices: [...devices()],
        policies: [...policies()],
      }),
    onSuccess: async ({ id }) => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "group") });
      navigate(`/t/${params.tenantId}/groups/${id}`);
    },
  }));
  const toggle = (set: () => Set<string>, update: (v: Set<string>) => void, id: string) => {
    const next = new Set(set());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };
  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader
        title="Create group"
        description="Create a reusable deployment target and optionally scope it now."
      />
      <form
        class="grid max-w-4xl gap-6 lg:grid-cols-[1fr_320px]"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <Card>
          <CardContent class="space-y-4">
            <Field label="Name">
              <Input required value={name()} onInput={(e) => setName(e.currentTarget.value)} />
            </Field>
            <Field label="Notes">
              <textarea
                class="min-h-28 rounded-lg border bg-white px-3 py-2 text-sm"
                value={notes()}
                onInput={(e) => setNotes(e.currentTarget.value)}
                placeholder="What is this group for?"
              />
            </Field>
            <ErrorText error={create.error} />
            <div class="flex gap-2">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Creating…" : "Create group"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate(`/t/${params.tenantId}/groups`)}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>

        <div class="space-y-6">
          <Card>
            <CardContent class="space-y-2">
              <p class="text-sm font-medium">
                Devices <Badge variant="secondary">{devices().size}</Badge>
              </p>
              <Show
                when={(deviceList.data?.rows.length ?? 0) > 0}
                fallback={<p class="text-sm text-muted-foreground">No devices enrolled yet.</p>}
              >
                <div class="max-h-48 space-y-1 overflow-auto">
                  <For each={deviceList.data?.rows ?? []}>
                    {(device) => (
                      <label class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/40">
                        <input
                          type="checkbox"
                          checked={devices().has(device.id)}
                          onChange={() => toggle(devices, setDevices, device.id)}
                        />
                        <span class="truncate">{device.name}</span>
                      </label>
                    )}
                  </For>
                </div>
              </Show>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="space-y-2">
              <p class="text-sm font-medium">
                Policies <Badge variant="secondary">{policies().size}</Badge>
              </p>
              <Show
                when={(policyList.data?.rows.length ?? 0) > 0}
                fallback={<p class="text-sm text-muted-foreground">No policies yet.</p>}
              >
                <div class="max-h-48 space-y-1 overflow-auto">
                  <For each={policyList.data?.rows ?? []}>
                    {(policy) => (
                      <label class="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/40">
                        <input
                          type="checkbox"
                          checked={policies().has(policy.id)}
                          onChange={() => toggle(policies, setPolicies, policy.id)}
                        />
                        <span class="truncate">{policy.name}</span>
                      </label>
                    )}
                  </For>
                </div>
              </Show>
            </CardContent>
          </Card>
        </div>
      </form>
    </div>
  );
}

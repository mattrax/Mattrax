import { useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { Option, Schema } from "effect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import { ErrorText, Field, Page, PageHeader, Panel, QueryError } from "~/components/mdm/common";
import GroupRuleBuilder from "~/components/mdm/group-rules";
import { Badge } from "@mattrax/ui";
import { Button } from "@mattrax/ui";
import { Input } from "@mattrax/ui";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import type { DynamicGroupKind, DynamicGroupRules } from "~/lib/enterprise";
import { preloadPage } from "~/lib/page-data";
import { AccessDenied, useCan } from "~/lib/permissions";
import { ScopeTagSelect } from "~/components/scope-tags/scope-tag-select";
import { queryClient } from "~/lib/query-client";

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.list(params.tenantId, "device")),
      () => queryClient.ensureQueryData(enterpriseQueries.list(params.tenantId, "policy")),
      () => queryClient.ensureQueryData(enterpriseQueries.list(params.tenantId, "group")),
      () => queryClient.ensureQueryData(enterpriseQueries.directory(params.tenantId)),
    ]);
  },
};

export default function NewGroupPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCan();
  const [name, setName] = createSignal("");
  const [notes, setNotes] = createSignal("");
  const [kind, setKind] = createSignal<DynamicGroupKind>("manual");
  const [directoryGroupId, setDirectoryGroupId] = createSignal<string | null>(null);
  const [rules, setRules] = createSignal<DynamicGroupRules>({ version: 1 });
  const [devices, setDevices] = createSignal<Set<string>>(new Set());
  const [policies, setPolicies] = createSignal<Set<string>>(new Set());
  const [scopeTags, setScopeTags] = createSignal<Array<string>>([]);

  const deviceList = useQuery(() => enterpriseQueries.list(params.tenantId, "device"));

  const policyList = useQuery(() => enterpriseQueries.list(params.tenantId, "policy"));

  // Offered by the group criterion picker. A new group has no id yet, so there
  // is nothing to exclude from the list.
  const groupList = useQuery(() => enterpriseQueries.list(params.tenantId, "group"));

  const directory = useQuery(() => enterpriseQueries.directory(params.tenantId));

  const membershipMode = () => (directoryGroupId() ? "directory" : kind());

  const create = useMutation(() => ({
    mutationFn: () =>
      enterprise.createGroup(params.tenantId, {
        name: name(),
        notes: notes() || null,
        kind: kind(),
        rules: kind() === "dynamic" ? rules() : null,
        directoryGroupId: directoryGroupId(),
        devices: membershipMode() === "manual" ? [...devices()] : [],
        policies: [...policies()],
      }),
    onSuccess: async ({ id }) => {
      // Tagging is a second request. If it fails, keep the created resource
      // and let the detail page's tag editor retry rather than leaving the
      // form ready to create a duplicate on the next click.
      if (scopeTags().length > 0) {
        try {
          await enterprise.setScopeTagAssignments(params.tenantId, {
            resourceType: "group",
            resourceIds: [id],
            tagIds: scopeTags(),
          });
        } catch {
          // The resource exists; its tag editor remains available.
        }
      }

      await qc.invalidateQueries({ queryKey: enterpriseKeys.list(params.tenantId, "group") });
      await qc.invalidateQueries({
        queryKey: enterpriseKeys.scopeTagAssignmentsPrefix(params.tenantId),
      });
      await qc.invalidateQueries({
        queryKey: enterpriseKeys.entitySearchPrefix(params.tenantId, "group"),
      });
      navigate(`/t/${params.tenantId}/groups/${id}`);
    },
  }));

  const toggle = (set: () => Set<string>, update: (v: Set<string>) => void, id: string) => {
    const next = new Set(set());

    if (next.has(id)) next.delete(id);
    else next.add(id);
    update(next);
  };

  const devicesDescription = () => {
    if (membershipMode() === "dynamic") return "Membership is computed from the rules.";

    if (membershipMode() === "directory") return "Membership is derived from the directory group.";

    return "Pick devices to include now.";
  };

  return (
    <Show when={can("groups.write")} fallback={<AccessDenied />}>
      <Page>
        <PageHeader
          title="Create group"
          description="Create a reusable deployment target and optionally scope it now."
        />
        <form
          class="flex flex-col items-start gap-5 lg:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <Panel
            title="Group details"
            description="Name the target, then choose how devices become members."
            class="min-w-0 flex-1"
          >
            <div class="space-y-4">
              <Field label="Name">
                <Input required value={name()} onInput={(e) => setName(e.currentTarget.value)} />
              </Field>
              <Field label="Notes" hint="Optional context for other administrators.">
                <textarea
                  class="min-h-28 rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                  value={notes()}
                  onInput={(e) => setNotes(e.currentTarget.value)}
                  placeholder="What is this group for?"
                />
              </Field>
              <Field label="Membership">
                <select
                  class="h-8 rounded-lg px-2.5 pr-8 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30"
                  value={membershipMode()}
                  onChange={(e) => {
                    const value = Option.getOrUndefined(
                      Schema.decodeUnknownOption(
                        Schema.Literals(["manual", "dynamic", "directory"]),
                      )(e.currentTarget.value),
                    );

                    if (value === "dynamic") {
                      setDirectoryGroupId(null);
                      setDevices(new Set<string>());
                      setKind("dynamic");
                    } else if (value === "directory") {
                      setKind("manual");
                      setDevices(new Set<string>());
                      setDirectoryGroupId((directory.data?.groups ?? [])[0]?.id ?? "");
                    } else if (value === "manual") {
                      setDirectoryGroupId(null);
                      setKind("manual");
                    }
                  }}
                >
                  <option value="manual">Manual — choose devices</option>
                  <option value="dynamic">Dynamic — match device rules</option>
                  <option value="directory">Linked directory group — follow IdP membership</option>
                </select>
              </Field>
              <Show when={membershipMode() === "directory"}>
                <Field
                  label="Directory group"
                  hint="Devices are derived from each member's linked devices."
                >
                  <select
                    class="h-8 rounded-lg px-2.5 pr-8 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/30"
                    value={directoryGroupId() ?? ""}
                    onChange={(e) => setDirectoryGroupId(e.currentTarget.value || null)}
                  >
                    <option value="">Choose a directory group</option>
                    <For each={directory.data?.groups ?? []}>
                      {(group) => (
                        <option value={group.id}>
                          {group.name} ({group.memberCount} member
                          {group.memberCount === 1 ? "" : "s"})
                        </option>
                      )}
                    </For>
                  </select>
                </Field>
                <p class="rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  Membership is recomputed whenever the directory group's members or a member's
                  linked devices change. Add devices by linking them to directory users on the
                  device page; the group's device list is read-only.
                </p>
                <Show when={(directory.data?.groups.length ?? 0) === 0}>
                  <p class="text-xs text-muted-foreground">
                    No directory groups are synced yet. Connect Entra ID or SCIM in Settings first.
                  </p>
                </Show>
              </Show>
              <Show when={kind() === "dynamic"}>
                <div class="animate-in rounded-lg border border-border bg-surface p-3 motion-reduce:animate-none fade-in-0 slide-in-from-top-1 duration-150 ease-swift">
                  <GroupRuleBuilder
                    rules={rules()}
                    onChange={setRules}
                    groups={groupList.data?.rows ?? []}
                  />
                </div>
              </Show>
              <ScopeTagSelect
                tenantId={params.tenantId!}
                value={scopeTags()}
                onChange={setScopeTags}
              />
              <ErrorText error={create.error} />
              <div class="flex flex-wrap items-center gap-2 border-t border-border pt-4">
                <Button
                  type="submit"
                  disabled={
                    create.isPending || (membershipMode() === "directory" && !directoryGroupId())
                  }
                >
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
            </div>
          </Panel>

          <div class="min-w-0 w-full shrink-0 space-y-5 lg:w-82">
            <Panel
              flush
              title="Devices"
              description={devicesDescription()}
              actions={
                <Badge variant="secondary" data-numeric>
                  {membershipMode() === "manual" ? devices().size : "derived"}
                </Badge>
              }
            >
              <Show
                when={membershipMode() === "manual"}
                fallback={
                  <p class="px-4 py-4 text-xs leading-relaxed text-muted-foreground sm:px-5">
                    {membershipMode() === "directory"
                      ? "Devices are added automatically from the linked directory group's members and their linked devices. You can review the derived membership after the group is created."
                      : "Membership is computed from the rules above. You can preview matches after the group is created."}
                  </p>
                }
              >
                <Show
                  when={(deviceList.data?.rows.length ?? 0) > 0}
                  fallback={
                    <Show
                      when={deviceList.isError}
                      fallback={
                        <p class="px-4 py-4 text-xs text-muted-foreground sm:px-5">
                          No devices enrolled yet.
                        </p>
                      }
                    >
                      <div class="p-4 sm:p-5">
                        <QueryError
                          error={deviceList.error}
                          onRetry={() => void deviceList.refetch()}
                        />
                      </div>
                    </Show>
                  }
                >
                  <div class="max-h-64 divide-y divide-border overflow-auto">
                    <For each={deviceList.data?.rows ?? []}>
                      {(device) => (
                        <label class="flex cursor-pointer items-center gap-2.5 accent-brand-solid px-4 py-2 text-xs transition-colors duration-150 ease-swift hover:bg-hover sm:px-5">
                          <Input
                            type="checkbox"
                            class="size-3.5 shrink-0"
                            checked={devices().has(device.id)}
                            onChange={() => toggle(devices, setDevices, device.id)}
                          />
                          <span class="min-w-0 flex-1 truncate">{device.name}</span>
                          <span class="shrink-0 font-mono text-xs text-muted-foreground">
                            {device.serial ?? ""}
                          </span>
                        </label>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </Panel>
            <Panel
              flush
              title="Policies"
              description="Attach policies to deploy to members."
              actions={
                <Badge variant="secondary" data-numeric>
                  {policies().size}
                </Badge>
              }
            >
              <Show
                when={(policyList.data?.rows.length ?? 0) > 0}
                fallback={
                  <Show
                    when={policyList.isError}
                    fallback={
                      <p class="px-4 py-4 text-xs text-muted-foreground sm:px-5">
                        No policies yet.
                      </p>
                    }
                  >
                    <div class="p-4 sm:p-5">
                      <QueryError
                        error={policyList.error}
                        onRetry={() => void policyList.refetch()}
                      />
                    </div>
                  </Show>
                }
              >
                <div class="max-h-64 divide-y divide-border overflow-auto">
                  <For each={policyList.data?.rows ?? []}>
                    {(policy) => (
                      <label class="flex cursor-pointer items-center gap-2.5 accent-brand-solid px-4 py-2 text-xs transition-colors duration-150 ease-swift hover:bg-hover sm:px-5">
                        <Input
                          type="checkbox"
                          class="size-3.5 shrink-0"
                          checked={policies().has(policy.id)}
                          onChange={() => toggle(policies, setPolicies, policy.id)}
                        />
                        <span class="min-w-0 flex-1 truncate">{policy.name}</span>
                        <span class="shrink-0 text-xs tabular-nums text-muted-foreground">
                          priority {policy.priority}
                        </span>
                      </label>
                    )}
                  </For>
                </div>
              </Show>
            </Panel>
          </div>
        </form>
      </Page>
    </Show>
  );
}

import { useParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { PolicyRow } from "@mattrax/enterprise-domain/client";
import { Option, Schema } from "effect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import {
  ErrorText,
  LinkButton,
  Page,
  PageBreadcrumbs,
  PageHeader,
  Panel,
  QueryError,
} from "~/components/mdm/common";
import PolicyViewTabs from "~/components/mdm/policy-view-tabs";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Search } from "~/components/ui/icons";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import type { DeviceRow } from "~/lib/enterprise";
import { isPolicyEnabled, policyStatePresentation } from "~/lib/policy-delivery";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";
import { ReadOnlyNotice, useCan } from "~/lib/permissions";

const precedence = [
  "A direct device exclude removes the policy, including group and user assignments.",
  "A direct device include beats any group include or group exclude.",
  "A group exclude vetoes that policy for the device, including user assignments.",
  "Device-scoped settings are delivered on the device channel to every user of the device.",
  "User-scoped settings are delivered only on the user channel of a linked, verified login.",
  "A device assignment beats a user assignment for the same setting.",
  "A direct user assignment beats that user's directory group assignments.",
  "Between included policies providing the same kind, highest priority wins.",
];

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () =>
        queryClient.ensureQueryData(
          enterpriseQueries.item(params.tenantId, "policy", params.policyId),
        ),
      () =>
        queryClient.ensureQueryData(
          enterpriseQueries.policyAssignments(params.tenantId, params.policyId),
        ),
      () => queryClient.ensureQueryData(enterpriseQueries.list(params.tenantId, "device")),
    ]);
  },
};

export default function PolicyAssignmentsPage() {
  const params = useParams();
  const qc = useQueryClient();
  const { can } = useCan();
  const writable = () => can("policies.write");
  const policy = useQuery(() => enterpriseQueries.item(params.tenantId, "policy", params.policyId));

  const assignments = useQuery(() =>
    enterpriseQueries.policyAssignments(params.tenantId, params.policyId),
  );

  const devices = useQuery(() => enterpriseQueries.list(params.tenantId, "device"));

  const directory = useQuery(() => enterpriseQueries.directory(params.tenantId));

  const [modes, setModes] = createSignal<Map<string, "include" | "exclude">>(new Map());
  const [userModes, setUserModes] = createSignal<Map<string, "include" | "exclude">>(new Map());

  const [userGroupModes, setUserGroupModes] = createSignal<Map<string, "include" | "exclude">>(
    new Map(),
  );

  const [message, setMessage] = createSignal<string | null>(null);
  const [filter, setFilter] = createSignal("");
  const [dirty, setDirty] = createSignal(false);
  let seededPolicyId: string | undefined;
  createEffect(
    () => ({ policyId: params.policyId, data: assignments.data }),
    ({ policyId, data }) => {
      if (!data) return;

      // Re-seed when the server list changes unless the admin has unsaved
      // edits, so a refetch cannot silently discard or resurrect assignments.
      if (seededPolicyId === policyId && dirty()) return;
      seededPolicyId = policyId;
      setModes(new Map(data.devices.map((device) => [device.id, device.mode])));
      setUserModes(new Map(data.users.map((user) => [user.id, user.mode])));
      setUserGroupModes(new Map(data.userGroups.map((group) => [group.id, group.mode])));
      setDirty(false);
    },
  );

  const assignmentChanges = (
    previousEntries: ReadonlyArray<readonly [string, "include" | "exclude"]>,
    next: ReadonlyMap<string, "include" | "exclude">,
  ) => {
    const previous = new Map(previousEntries);

    return {
      assign: [...next].flatMap(([id, mode]) => (previous.get(id) === mode ? [] : [{ id, mode }])),
      unassign: [...previous.keys()].filter((id) => !next.has(id)),
    };
  };

  const save = useMutation(() => ({
    mutationFn: () => {
      const deviceChanges = assignmentChanges(
        (assignments.data?.devices ?? []).map((device) => [device.id, device.mode] as const),
        modes(),
      );

      const userChanges = assignmentChanges(
        (assignments.data?.users ?? []).map((user) => [user.id, user.mode] as const),
        userModes(),
      );

      const userGroupChanges = assignmentChanges(
        (assignments.data?.userGroups ?? []).map((group) => [group.id, group.mode] as const),
        userGroupModes(),
      );

      return enterprise.patchPolicyAssignments(params.tenantId, params.policyId, {
        ...deviceChanges,
        assignUsers: userChanges.assign,
        unassignUsers: userChanges.unassign,
        assignUserGroups: userGroupChanges.assign,
        unassignUserGroups: userGroupChanges.unassign,
      });
    },
    onSuccess: async () => {
      setMessage("Assignments saved.");
      setDirty(false);
      await qc.invalidateQueries({
        queryKey: enterpriseKeys.policyAssignments(params.tenantId, params.policyId),
      });
    },
  }));

  const setMode = (
    setter: (value: Map<string, "include" | "exclude">) => void,
    current: ReadonlyMap<string, "include" | "exclude">,
    id: string,
    mode: "include" | "exclude" | "",
  ) => {
    const next = new Map(current);

    if (mode) next.set(id, mode);
    else next.delete(id);
    setter(next);
    setDirty(true);
  };

  const setDeviceMode = (id: string, mode: "include" | "exclude" | "") =>
    setMode(setModes, modes(), id, mode);

  const setUserMode = (id: string, mode: "include" | "exclude" | "") =>
    setMode(setUserModes, userModes(), id, mode);

  const setUserGroupMode = (id: string, mode: "include" | "exclude" | "") =>
    setMode(setUserGroupModes, userGroupModes(), id, mode);

  const assignableUsers = createMemo(() => {
    const users = (directory.data?.users ?? []).filter((user) => !user.disabled);
    const known = new Set(users.map((user) => user.id));

    // Keep assigned users visible even when they are no longer in the
    // directory, otherwise the assignment can only be changed through the API.
    const stale = (assignments.data?.users ?? [])
      .filter((user) => !known.has(user.id))
      .map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        source: "inactive" as const,
        disabled: false,
      }));

    return [...users, ...stale];
  });

  const assignableUserGroups = createMemo(() => directory.data?.groups ?? []);

  const includedCount = () => [...modes().values()].filter((mode) => mode === "include").length;
  const excludedCount = () => [...modes().values()].filter((mode) => mode === "exclude").length;

  const includedUserCount = () =>
    [...userModes().values()].filter((mode) => mode === "include").length;

  const excludedUserCount = () =>
    [...userModes().values()].filter((mode) => mode === "exclude").length;

  const row = () => Option.getOrUndefined(Schema.decodeUnknownOption(PolicyRow)(policy.data));

  const userScopedKinds = () =>
    Object.entries(row()?.configurationScopes ?? {}).flatMap(([kind, scope]) =>
      scope === "user" ? [kind] : [],
    );

  /**
   * A policy with no user-scoped settings keeps the device-channel warning even
   * when it is empty: an empty policy will still be filled with device scope.
   */
  const hasDeviceScopedSettings = () => {
    const configurations = Object.keys(row()?.configurations ?? {});
    const userScoped = new Set(userScopedKinds());

    return userScoped.size === 0 || configurations.some((kind) => !userScoped.has(kind));
  };

  const deviceRows = createMemo(() => {
    const term = filter().trim().toLowerCase();
    const rows = devices.data?.rows ?? [];

    if (!term) return rows;

    return rows.filter((device) => device.name.toLowerCase().includes(term));
  });

  return (
    <Page>
      <PageBreadcrumbs resourceName={row()?.name} />
      <PageHeader
        eyebrow="Policy"
        title={`Assignments — ${row()?.name ?? "Policy"}`}
        description="Direct device assignments beat group assignments. Excludes veto a policy; group excludes can only be overridden by a direct include of that same policy."
        meta={
          <Show when={row()}>
            <Show when={!isPolicyEnabled(row()!)}>
              <Badge variant={policyStatePresentation(row()!).tone} dot="warning">
                Disabled
              </Badge>
            </Show>
            <span class="tabular-nums">
              Priority <span class="text-foreground">{row()?.priority ?? 0}</span>
            </span>
            <span class="text-muted-foreground/40" aria-hidden="true">
              ·
            </span>
            <span class="tabular-nums">{includedCount()} included</span>
            <Show when={excludedCount() > 0}>
              <span class="text-muted-foreground/40" aria-hidden="true">
                ·
              </span>
              <span class="tabular-nums text-destructive">{excludedCount()} excluded</span>
            </Show>
          </Show>
        }
        actions={
          <LinkButton href={`/t/${params.tenantId}/policies/${params.policyId}`} variant="outline">
            Back to {row()?.name ?? "policy"}
          </LinkButton>
        }
      />

      <PolicyViewTabs
        base={`/t/${params.tenantId}/policies/${params.policyId}`}
        active="assignments"
      />

      <QueryError error={policy.error} onRetry={() => void policy.refetch()} />

      <div class="rounded-lg border border-border bg-surface p-4">
        <p class="text-xs font-semibold text-foreground">Precedence</p>
        <ol class="mt-1.5 list-decimal space-y-0.5 pl-5 text-xs leading-relaxed text-muted-foreground">
          <For each={precedence}>{(item) => <li>{item}</li>}</For>
        </ol>
        <p class="mt-2 text-xs text-muted-foreground">
          Ties go to the most recently updated policy, then the smallest id. This policy has
          priority {row()?.priority ?? 0}.
        </p>
      </div>

      <Show
        when={assignments.data}
        fallback={
          <Panel>
            <Show
              when={assignments.isError}
              fallback={
                <div class="space-y-2">
                  <div class="h-4 w-40 animate-pulse rounded bg-muted/60" />
                  <div class="h-24 animate-pulse rounded-lg bg-muted/40" />
                </div>
              }
            >
              <ErrorText error={assignments.error} />
            </Show>
          </Panel>
        }
      >
        {(value) => (
          <div
            class="grid gap-5 lg:grid-cols-(--assignments-grid) lg:items-start"
            style={{ "--assignments-grid": "360px minmax(0,1fr)" }}
          >
            <Panel
              title="Groups"
              description="Assigned from each group's policy list."
              actions={
                <Badge variant="secondary">
                  {value().groups.length}
                </Badge>
              }
            >
              <Show
                when={value().groups.length > 0}
                fallback={
                  <p class="text-xs leading-relaxed text-muted-foreground">
                    This policy is not assigned to a group. Assign it from a group page.
                  </p>
                }
              >
                <div class="space-y-1.5">
                  <For each={value().groups}>
                    {(group) => (
                      <a
                        class="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/15 px-2.5 py-2 text-xs transition-colors duration-140 ease-swift hover:border-input hover:bg-muted/40 active:bg-muted/60"
                        href={`/t/${params.tenantId}/groups/${group.id}`}
                      >
                        <span class="min-w-0 truncate">{group.name}</span>
                        <Badge
                          variant={group.mode === "exclude" ? "destructive" : "secondary"}
                          class="shrink-0"
                        >
                          {group.mode === "exclude" ? "Group exclude" : "Group include"}
                        </Badge>
                      </a>
                    )}
                  </For>
                </div>
              </Show>
            </Panel>

            <Panel
              title="Direct devices"
              description="Per-device overrides applied before group assignments."
              actions={
                <div class="flex items-center gap-1.5">
                  <Badge variant="secondary">
                    {includedCount()} included
                  </Badge>
                  <Show when={excludedCount() > 0}>
                    <Badge variant="destructive">
                      {excludedCount()} excluded
                    </Badge>
                  </Show>
                </div>
              }
            >
              <div class="space-y-3">
                <Show
                  when={(devices.data?.rows.length ?? 0) > 0}
                  fallback={
                    <Show
                      when={devices.isError}
                      fallback={
                        <p class="text-xs text-muted-foreground">No devices enrolled yet.</p>
                      }
                    >
                      <QueryError error={devices.error} onRetry={() => void devices.refetch()} />
                    </Show>
                  }
                >
                  <div class="relative max-w-xs">
                    <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2" />
                    <div class="pl-8">
                      <Input
                        value={filter()}
                        onInput={(event) => setFilter(event.currentTarget.value)}
                        placeholder="Filter devices…"
                        aria-label="Filter devices"
                        class="h-8"
                      />
                    </div>
                  </div>
                  <div class="max-h-96 divide-y divide-border/60 overflow-auto rounded-lg border border-border">
                    <For each={deviceRows()}>
                      {(device: DeviceRow) => (
                        <label class="flex items-center gap-2 px-2.5 py-1.5 text-xs transition-colors duration-140 ease-swift hover:bg-muted/30">
                          <span class="min-w-0 flex-1 truncate">{device.name}</span>
                          <span class="shrink-0 text-xs uppercase tracking-widest text-muted-foreground">
                            {device.proto}
                          </span>
                          <select
                            class="h-7 shrink-0 rounded-lg px-2 text-xs"
                            disabled={!writable()}
                            value={modes().get(device.id) ?? ""}
                            onChange={(event) =>
                              setDeviceMode(
                                device.id,
                                Option.getOrUndefined(
                                  Schema.decodeUnknownOption(
                                    Schema.Literals(["include", "exclude"]),
                                  )(event.currentTarget.value),
                                ) ?? "",
                              )
                            }
                          >
                            <option value="">Not assigned</option>
                            <option value="include">Include</option>
                            <option value="exclude">Exclude</option>
                          </select>
                        </label>
                      )}
                    </For>
                    <Show when={deviceRows().length === 0}>
                      <p class="px-2.5 py-3 text-xs text-muted-foreground">
                        No devices match that filter.
                      </p>
                    </Show>
                  </div>
                </Show>
                <ErrorText error={save.error} />
                <Show when={message()}>
                  {(text) => (
                    <p
                      role="status"
                      class="animate-in rounded-lg border border-success/25 bg-success/[0.07] px-3 py-2 text-xs text-success-foreground motion-reduce:animate-none fade-in-0 duration-140 ease-swift"
                    >
                      {text()}
                    </p>
                  )}
                </Show>
                <Show
                  when={writable()}
                  fallback={
                    <ReadOnlyNotice>
                      Your role can view assignments but not change them.
                    </ReadOnlyNotice>
                  }
                >
                  <Button disabled={save.isPending} onClick={() => save.mutate()}>
                    {save.isPending ? "Saving…" : "Save assignments"}
                  </Button>
                </Show>
              </div>
            </Panel>

            <Panel
              title="Users"
              description="A user policy follows that user to every linked device. Link users to devices from a device's page."
              actions={
                <div class="flex items-center gap-1.5">
                  <Badge variant="secondary">
                    {includedUserCount()} included
                  </Badge>
                  <Show when={excludedUserCount() > 0}>
                    <Badge variant="destructive">
                      {excludedUserCount()} excluded
                    </Badge>
                  </Show>
                </div>
              }
            >
              <div class="space-y-3">
                <Show when={hasDeviceScopedSettings()}>
                  <p class="rounded-lg border border-warning/30 bg-warning/[0.06] px-3 py-2 text-xs leading-relaxed text-warning-foreground">
                    This policy contains device-scoped settings. Assigning it to a user applies it
                    to every device linked to that user, and every user of those devices receives
                    it. Windows devices converge on their next scheduled check-in; Apple and Android
                    are notified immediately.
                  </p>
                </Show>
                <Show when={userScopedKinds().length > 0}>
                  <p class="rounded-lg border border-border bg-surface px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                    {userScopedKinds().length} user-scoped{" "}
                    {userScopedKinds().length === 1 ? "setting is" : "settings are"} delivered only
                    to a linked, identity-verified Apple user channel (macOS 13+ or Shared iPad).
                    Windows has no per-login channel, so its user scope applies to every user of the
                    device; Android rejects user scope.
                  </p>
                </Show>
                <Show
                  when={directory.data}
                  fallback={
                    <Show
                      when={directory.isError}
                      fallback={<div class="h-20 animate-pulse rounded-lg bg-muted/40" />}
                    >
                      <QueryError
                        error={directory.error}
                        onRetry={() => void directory.refetch()}
                      />
                    </Show>
                  }
                >
                  <Show
                    when={assignableUsers().length > 0}
                    fallback={
                      <p class="text-xs text-muted-foreground">
                        No directory users yet. Sync a directory provider to add people.
                      </p>
                    }
                  >
                    <div class="max-h-80 divide-y divide-border/60 overflow-auto rounded-lg border border-border">
                      <For each={assignableUsers()}>
                        {(user) => (
                          <label class="flex items-center gap-3 px-2.5 py-1.5 text-xs transition-colors duration-140 ease-swift hover:bg-muted/30">
                            <span class="min-w-0 flex-1">
                              <span class="block truncate text-foreground">{user.name}</span>
                              <span class="block truncate text-xs text-muted-foreground">
                                {user.email}
                              </span>
                            </span>
                            <Badge variant="outline" class="shrink-0">
                              {user.source}
                            </Badge>
                            <select
                              class="h-7 shrink-0 rounded-lg px-2 text-xs"
                              disabled={!writable()}
                              value={userModes().get(user.id) ?? ""}
                              onChange={(event) =>
                                setUserMode(
                                  user.id,
                                  Option.getOrUndefined(
                                    Schema.decodeUnknownOption(
                                      Schema.Literals(["include", "exclude"]),
                                    )(event.currentTarget.value),
                                  ) ?? "",
                                )
                              }
                            >
                              <option value="">Not assigned</option>
                              <option value="include">Include</option>
                              <option value="exclude">Exclude</option>
                            </select>
                          </label>
                        )}
                      </For>
                    </div>
                  </Show>
                </Show>
              </div>
            </Panel>

            <Panel
              title="Directory groups"
              description="Policies assigned to an Entra or SCIM group apply to every linked user in it."
              actions={
                <Badge variant="secondary">
                  {userGroupModes().size}
                </Badge>
              }
            >
              <Show
                when={directory.data}
                fallback={
                  <Show
                    when={directory.isError}
                    fallback={<div class="h-20 animate-pulse rounded-lg bg-muted/40" />}
                  >
                    <QueryError error={directory.error} onRetry={() => void directory.refetch()} />
                  </Show>
                }
              >
                <Show
                  when={assignableUserGroups().length > 0}
                  fallback={
                    <p class="text-xs text-muted-foreground">
                      No directory groups yet. Sync a directory provider to import groups.
                    </p>
                  }
                >
                  <div class="max-h-80 divide-y divide-border/60 overflow-auto rounded-lg border border-border">
                    <For each={assignableUserGroups()}>
                      {(group) => (
                        <label class="flex items-center gap-3 px-2.5 py-1.5 text-xs transition-colors duration-140 ease-swift hover:bg-muted/30">
                          <span class="min-w-0 flex-1 truncate">{group.name}</span>
                          <span class="shrink-0 text-xs text-muted-foreground">
                            {group.memberCount} members
                          </span>
                          <select
                            class="h-7 shrink-0 rounded-lg px-2 text-xs"
                            disabled={!writable()}
                            value={userGroupModes().get(group.id) ?? ""}
                            onChange={(event) =>
                              setUserGroupMode(
                                group.id,
                                Option.getOrUndefined(
                                  Schema.decodeUnknownOption(
                                    Schema.Literals(["include", "exclude"]),
                                  )(event.currentTarget.value),
                                ) ?? "",
                              )
                            }
                          >
                            <option value="">Not assigned</option>
                            <option value="include">Include</option>
                            <option value="exclude">Exclude</option>
                          </select>
                        </label>
                      )}
                    </For>
                  </div>
                </Show>
              </Show>
            </Panel>
          </div>
        )}
      </Show>
    </Page>
  );
}

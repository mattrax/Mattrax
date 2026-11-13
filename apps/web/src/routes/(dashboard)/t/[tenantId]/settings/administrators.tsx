import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createMemo, createSignal, For, Show } from "solid-js";
import { PERMISSION_GROUPS, type Permission } from "@mattrax/enterprise-domain";
import type { JSX } from "@solidjs/web";
import { ErrorText, Panel, QueryError } from "~/components/mdm/common";
import { errorMessage } from "~/lib/errors";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { UsersRound } from "~/components/ui/icons";
import { authClient } from "~/lib/auth";
import { enterprise, enterpriseKeys, enterpriseQueries, type TenantRole } from "~/lib/enterprise";
import { cn } from "~/lib/utils";

const fallbackRoleOptions = [
  { value: "builtin:member", label: "Member" },
  { value: "builtin:auditor", label: "Auditor (read-only)" },
  { value: "builtin:admin", label: "Administrator" },
  { value: "builtin:owner", label: "Owner" },
];

const roleValue = (user: { role: string; roleId?: string | null }) =>
  user.roleId ? `role:${user.roleId}` : `builtin:${user.role}`;

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-white/[0.02] px-2.5 text-base text-foreground sm:text-[12.5px] outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 sm:w-auto";

function initials(name: string | undefined | null) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return parts[0]?.[0]?.toUpperCase() ?? "?";
}

export default function AdministratorsSettingsPage() {
  const params = useParams();
  const qc = useQueryClient();
  const session = authClient.useSession();
  const users = useQuery(() => ({
    queryKey: enterpriseKeys.users(params.tenantId),
    queryFn: () => enterprise.listUsers(params.tenantId),
  }));
  const invitations = useQuery(() => ({
    queryKey: enterpriseKeys.invitations(params.tenantId),
    queryFn: () => enterprise.listInvitations(params.tenantId),
  }));
  const roles = useQuery(() => enterpriseQueries.roles(params.tenantId));
  const roleOptions = createMemo(() => {
    const list = roles.data?.roles;
    if (!list) return fallbackRoleOptions;
    return list.map((item) => ({
      value: item.builtIn ? `builtin:${item.id.replace("builtin:", "")}` : `role:${item.id}`,
      label: item.name,
    }));
  });
  const [email, setEmail] = createSignal("");
  const [role, setRole] = createSignal("builtin:member");
  const [roleEditing, setRoleEditing] = createSignal<TenantRole | null>(null);
  const [roleFormOpen, setRoleFormOpen] = createSignal(false);
  const [roleName, setRoleName] = createSignal("");
  const [roleDescription, setRoleDescription] = createSignal("");
  const [rolePermissions, setRolePermissions] = createSignal<Set<string>>(new Set(["tenant.read"]));
  const [roleError, setRoleError] = createSignal<string | null>(null);
  const [inviteUrl, setInviteUrl] = createSignal<string | null>(null);

  const invite = useMutation(() => ({
    mutationFn: () => enterprise.inviteUser(params.tenantId, { email: email(), role: role() }),
    onSuccess: async (result) => {
      setEmail("");
      setInviteUrl(result.inviteUrl ?? null);
      await qc.invalidateQueries({ queryKey: enterpriseKeys.invitations(params.tenantId) });
    },
  }));
  const removeUser = useMutation(() => ({
    mutationFn: (memberId: string) => enterprise.removeUser(params.tenantId, memberId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.users(params.tenantId) });
      await qc.invalidateQueries({ queryKey: enterpriseKeys.me() });
    },
  }));
  const changeRole = useMutation(() => ({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
      enterprise.patchUser(
        params.tenantId,
        memberId,
        role.startsWith("role:")
          ? { roleId: role.slice(5), role: "member" }
          : { role: role.slice(8), roleId: null },
      ),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.users(params.tenantId) });
    },
  }));
  const cancelInvitation = useMutation(() => ({
    mutationFn: (invitationId: string) =>
      enterprise.cancelInvitation(params.tenantId, invitationId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.invitations(params.tenantId) });
    },
  }));

  const invalidateRoles = async () => {
    await qc.invalidateQueries({ queryKey: enterpriseKeys.roles(params.tenantId) });
    await qc.invalidateQueries({ queryKey: enterpriseKeys.users(params.tenantId) });
    await qc.invalidateQueries({ queryKey: enterpriseKeys.invitations(params.tenantId) });
  };
  const saveRole = useMutation(() => ({
    mutationFn: async (): Promise<{ status: "ok" }> => {
      if (rolePermissions().size === 0) throw new Error("Choose at least one permission");
      const payload = {
        name: roleName().trim(),
        description: roleDescription().trim() || null,
        permissions: [...rolePermissions()] as Permission[],
      };
      if (!payload.name) throw new Error("Give the role a name");
      if (roleEditing()) {
        await enterprise.patchRole(params.tenantId, roleEditing()!.id, payload);
      } else {
        await enterprise.createRole(params.tenantId, payload);
      }
      return { status: "ok" };
    },
    onSuccess: async () => {
      setRoleError(null);
      setRoleFormOpen(false);
      setRoleEditing(null);
      await invalidateRoles();
    },
    onError: (error) => setRoleError(errorMessage(error)),
  }));
  const removeRole = useMutation(() => ({
    mutationFn: (roleId: string) => enterprise.deleteRole(params.tenantId, roleId),
    onSuccess: invalidateRoles,
    onError: (error) => setRoleError(errorMessage(error)),
  }));
  const openCreateRole = () => {
    setRoleEditing(null);
    setRoleName("");
    setRoleDescription("");
    setRolePermissions(new Set(["tenant.read"]));
    setRoleError(null);
    setRoleFormOpen(true);
  };
  const openEditRole = (role: TenantRole) => {
    setRoleEditing(role);
    setRoleName(role.name);
    setRoleDescription(role.description ?? "");
    setRolePermissions(new Set(role.permissions));
    setRoleError(null);
    setRoleFormOpen(true);
  };
  const togglePermission = (permission: string) => {
    setRolePermissions((current) => {
      const next = new Set(current);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  };

  const memberCount = () => users.data?.users.length ?? 0;

  return (
    <div class="grid gap-5 xl:grid-cols-2">
      <QueryError
        class="xl:col-span-2"
        error={users.error ?? invitations.error}
        onRetry={() => {
          void users.refetch();
          void invitations.refetch();
        }}
      />

      <Panel
        class="xl:col-span-2"
        title="Invite an administrator"
        description="Send a one-time invitation link. New members join with the role you choose."
      >
        <form
          class="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            invite.mutate();
          }}
        >
          <Input
            type="email"
            required
            aria-label="Invitee email address"
            placeholder="teammate@example.com"
            value={email()}
            onInput={(e) => setEmail(e.currentTarget.value)}
            class="min-w-0 flex-1"
          />
          <select
            class={cn(selectClass, "shrink-0")}
            value={role()}
            onChange={(e) => setRole(e.currentTarget.value)}
            aria-label="Invitation role"
          >
            <For each={roleOptions()}>
              {(option) => <option value={option.value}>{option.label}</option>}
            </For>
          </select>
          <Button type="submit" class="shrink-0" disabled={invite.isPending}>
            Send invitation
          </Button>
        </form>
        <ErrorText error={invite.error} />

        <Show when={inviteUrl()}>
          <div class="mt-4 rounded-lg border border-success/25 bg-success/[0.06] p-3 text-sm">
            <p class="font-medium text-foreground">
              Share this invitation link with the new administrator
            </p>
            <code class="mt-2 block break-all rounded-md border border-white/[0.07] bg-black/25 p-2 font-mono text-xs text-muted-foreground">
              {inviteUrl()}
            </code>
            <Button
              size="sm"
              class="mt-2"
              variant="outline"
              onClick={() => navigator.clipboard.writeText(inviteUrl()!)}
            >
              Copy link
            </Button>
          </div>
        </Show>

        <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
          Invitations expire after 7 days. The recipient must sign in with the invited email
          address. Members and auditors have read-only access; administrators can manage devices,
          policies and the team; owners can also manage billing and delete the tenant.
        </p>
      </Panel>

      <Panel
        class="xl:col-span-2"
        title="Roles"
        description="Create custom roles with a precise set of tenant permissions, then assign them to members. Built-in roles are fixed."
        actions={<Button onClick={openCreateRole}>Create role</Button>}
      >
        <QueryError error={roles.error} onRetry={() => void roles.refetch()} />
        <Show when={roleFormOpen()}>
          <form
            class="mb-4 space-y-3 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3"
            onSubmit={(event) => {
              event.preventDefault();
              saveRole.mutate();
            }}
          >
            <div class="grid gap-2 sm:grid-cols-2">
              <label>
                <span class="mb-1 block text-[11px] font-medium text-muted-foreground">Name</span>
                <Input
                  value={roleName()}
                  onInput={(event) => setRoleName(event.currentTarget.value)}
                  placeholder="Helpdesk"
                />
              </label>
              <label>
                <span class="mb-1 block text-[11px] font-medium text-muted-foreground">
                  Description
                </span>
                <Input
                  value={roleDescription()}
                  onInput={(event) => setRoleDescription(event.currentTarget.value)}
                  placeholder="What this role is for"
                />
              </label>
            </div>
            <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <For each={PERMISSION_GROUPS}>
                {(group) => (
                  <div class="min-w-0">
                    <p class="mb-1 text-[11px] font-medium text-foreground">{group.label}</p>
                    <div class="space-y-1">
                      <For each={group.permissions}>
                        {(permission) => (
                          <label class="flex cursor-pointer items-start gap-2 text-[11.5px] text-muted-foreground">
                            <input
                              type="checkbox"
                              class="mt-0.5 size-3.5 accent-[var(--brand)]"
                              checked={rolePermissions().has(permission.id)}
                              onChange={() => togglePermission(permission.id)}
                            />
                            <span>{permission.label}</span>
                          </label>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
            <ErrorText error={roleError() || saveRole.error} />
            <div class="flex gap-2">
              <Button type="submit" size="sm" disabled={saveRole.isPending}>
                {saveRole.isPending ? "Saving…" : roleEditing() ? "Save role" : "Create role"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setRoleFormOpen(false);
                  setRoleEditing(null);
                  setRoleError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Show>
        <div class="space-y-2">
          <For each={roles.data?.roles ?? []}>
            {(item) => (
              <div class="flex flex-col gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 sm:flex-row sm:items-center sm:justify-between">
                <div class="min-w-0">
                  <p class="text-[12.5px] font-medium text-foreground">
                    {item.name}
                    <Show when={item.builtIn}>
                      <span class="ml-2 rounded-full border border-white/[0.08] px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                        Built-in
                      </span>
                    </Show>
                  </p>
                  <p class="mt-0.5 text-[11px] text-muted-foreground">
                    {item.memberCount} member{item.memberCount === 1 ? "" : "s"} ·{" "}
                    {item.permissions.length} permission{item.permissions.length === 1 ? "" : "s"}
                    {item.description ? ` · ${item.description}` : ""}
                  </p>
                </div>
                <Show when={!item.builtIn}>
                  <div class="flex shrink-0 gap-1.5">
                    <Button size="xs" variant="outline" onClick={() => openEditRole(item)}>
                      Edit
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      class="text-muted-foreground hover:text-destructive"
                      disabled={removeRole.isPending || item.memberCount > 0}
                      title={
                        item.memberCount > 0
                          ? "Reassign members before deleting this role"
                          : undefined
                      }
                      onClick={() => {
                        if (window.confirm(`Delete “${item.name}”?`)) removeRole.mutate(item.id);
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
        <ErrorText error={removeRole.error} />
      </Panel>

      <Panel
        title="Administrators"
        description="Everyone with access to this tenant."
        actions={
          <span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <UsersRound class="size-3.5" />
            {memberCount()} {memberCount() === 1 ? "member" : "members"}
          </span>
        }
        flush
      >
        <Show
          when={memberCount() > 0}
          fallback={
            <p class="px-4 py-6 text-[13px] text-muted-foreground sm:px-5">No members yet.</p>
          }
        >
          <ul class="divide-y divide-white/[0.05]">
            <For each={users.data?.users ?? []}>
              {(user) => (
                <li class="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div class="flex min-w-0 items-center gap-3">
                    <span
                      class="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[10px] font-semibold text-foreground ring-1 ring-inset ring-white/[0.06]"
                      aria-hidden="true"
                    >
                      {initials(user.name)}
                    </span>
                    <div class="min-w-0">
                      <strong class="block truncate text-[13px] font-medium text-foreground">
                        {user.name}
                      </strong>
                      <span class="block truncate text-xs text-muted-foreground">{user.email}</span>
                    </div>
                  </div>
                  <div class="flex shrink-0 flex-wrap items-center gap-2">
                    <Show
                      when={user.userId !== session().data?.user?.id}
                      fallback={<Chip tone="neutral">You</Chip>}
                    >
                      <select
                        class={selectClass}
                        value={roleValue(user)}
                        onChange={(e) =>
                          changeRole.mutate({
                            memberId: user.memberId,
                            role: e.currentTarget.value,
                          })
                        }
                        disabled={changeRole.isPending}
                        aria-label={`Role for ${user.name}`}
                      >
                        <For each={roleOptions()}>
                          {(option) => <option value={option.value}>{option.label}</option>}
                        </For>
                      </select>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => removeUser.mutate(user.memberId)}
                        disabled={removeUser.isPending}
                      >
                        Remove
                      </Button>
                    </Show>
                  </div>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <div class="px-4 pb-4 sm:px-5">
          <ErrorText error={removeUser.error || changeRole.error} />
        </div>
      </Panel>

      <Panel
        title="Pending invitations"
        description="Invitations that have not been accepted yet."
        flush
      >
        <Show
          when={(invitations.data?.invitations.length ?? 0) > 0}
          fallback={
            <p class="px-4 py-6 text-[13px] text-muted-foreground sm:px-5">
              No pending invitations.
            </p>
          }
        >
          <ul class="divide-y divide-white/[0.05]">
            <For each={invitations.data?.invitations ?? []}>
              {(item) => (
                <li class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <span class="min-w-0 break-all text-[13px] text-foreground">{item.email}</span>
                  <span class="flex shrink-0 items-center gap-2">
                    <Chip tone="neutral">{item.status}</Chip>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => cancelInvitation.mutate(item.id)}
                      disabled={cancelInvitation.isPending}
                    >
                      Cancel
                    </Button>
                  </span>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <div class="px-4 pb-4 sm:px-5">
          <ErrorText error={cancelInvitation.error} />
        </div>
      </Panel>
    </div>
  );
}

const chipTones = {
  neutral: "border-white/[0.08] bg-white/[0.03] text-muted-foreground",
  success: "border-success/25 bg-success/10 text-success-foreground",
  warning: "border-warning/25 bg-warning/10 text-warning-foreground",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
} as const;

function Chip(props: { tone: keyof typeof chipTones; children: JSX.Element }) {
  return (
    <span
      class={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        chipTones[props.tone],
      )}
    >
      <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {props.children}
    </span>
  );
}

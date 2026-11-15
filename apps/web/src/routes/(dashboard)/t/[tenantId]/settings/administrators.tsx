import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { PERMISSION_GROUPS, type Permission } from "@mattrax/enterprise-domain/client";
import type { JSX } from "@solidjs/web";
import { ErrorText, Panel, QueryError, formatDate, relativeTime } from "~/components/mdm/common";
import { errorMessage } from "~/lib/errors";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { UsersRound } from "~/components/ui/icons";
import { authClient } from "~/lib/auth";
import {
  enterprise,
  enterpriseKeys,
  enterpriseQueries,
  type TenantInvitation,
  type TenantRole,
} from "~/lib/enterprise";
import { ReadOnlyNotice, useTenantPermissions } from "~/lib/permissions";
import { cn } from "~/lib/utils";

/**
 * Owner-only permissions mirror the API ceiling (`OWNER_ONLY_PERMISSIONS`).
 * They may appear in a custom role, but only a built-in owner can grant them.
 */
const OWNER_ONLY_PERMISSIONS: ReadonlySet<Permission> = new Set([
  "tenant.delete",
  "tenant.export",
  "backups.read",
  "backups.write",
]);

type RoleChoice = {
  value: string;
  label: string;
  role?: string;
  roleId?: string;
  assignable: boolean;
  blockedReason: string | null;
};

const roleValue = (user: { role: string; roleId?: string | null }) =>
  user.roleId ? `role:${user.roleId}` : `builtin:${user.role}`;

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-white/[0.02] px-2.5 text-base text-foreground sm:h-8 sm:text-[12.5px] outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 sm:w-auto";

const statusLabels: Record<TenantInvitation["status"], string> = {
  pending: "Pending",
  accepted: "Accepted",
  canceled: "Canceled",
  expired: "Expired",
  superseded: "Replaced",
};

/** A pending invitation past its expiry is displayed and treated as expired. */
const effectiveStatus = (item: TenantInvitation): TenantInvitation["status"] =>
  item.status === "pending" && item.isExpired ? "expired" : item.status;

const statusTone = (item: TenantInvitation) => {
  switch (effectiveStatus(item)) {
    case "accepted":
      return "success" as const;
    case "expired":
      return "warning" as const;
    case "canceled":
      return "danger" as const;
    default:
      return "neutral" as const;
  }
};

/** Future dates read better as "in 6d"; past ones use the shared relative helper. */
function relativeExpiry(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;
  const diff = date.getTime() - Date.now();
  const magnitude = Math.abs(diff);

  if (magnitude < 60_000) return diff >= 0 ? "in a moment" : "just now";
  const minutes = Math.round(magnitude / 60_000);

  if (minutes < 60) return diff > 0 ? `in ${minutes}m` : `${minutes}m ago`;
  const hours = Math.round(minutes / 60);

  if (hours < 24) return diff > 0 ? `in ${hours}h` : `${hours}h ago`;
  const days = Math.round(hours / 24);

  if (days < 30) return diff > 0 ? `in ${days}d` : `${days}d ago`;

  return formatDate(value);
}

async function copyToClipboard(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);

      return true;
    } catch {
      // Permission can be denied outside a user gesture; fall through.
    }
  }

  if (typeof document === "undefined") return false;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  return copied;
}

function initials(name: string | undefined | null) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);

  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();

  return parts[0]?.[0]?.toUpperCase() ?? "?";
}

type InviteResult = {
  id: string;
  email: string;
  roleName: string;
  inviteUrl: string;
  expiresAt: string;
  emailSent: boolean;
};

type ResendNotice = {
  email: string;
  inviteUrl: string;
  expiresAt: string;
  emailSent: boolean;
};

type InvitationFilter = "active" | "accepted" | "canceled" | "all";

const matchesFilter = (item: TenantInvitation, filter: InvitationFilter) => {
  const status = effectiveStatus(item);

  switch (filter) {
    case "active":
      return status === "pending" || status === "expired";
    case "accepted":
      return status === "accepted";
    case "canceled":
      return status === "canceled" || status === "superseded";
    case "all":
      return true;
  }
};

export default function AdministratorsSettingsPage() {
  const params = useParams();
  const qc = useQueryClient();
  const session = authClient.useSession();
  const permissionsApi = useTenantPermissions();
  const can = permissionsApi.can;
  const permissions = permissionsApi.permissions;

  const isOwner = () =>
    (permissionsApi.role() ?? "")
      .split(",")
      .map((role) => role.trim())
      .includes("owner");

  const users = useQuery(() => ({
    queryKey: enterpriseKeys.users(params.tenantId),
    queryFn: () => enterprise.listUsers(params.tenantId),
  }));

  const invitations = useQuery(() => ({
    queryKey: enterpriseKeys.invitations(params.tenantId),
    queryFn: () => enterprise.listInvitations(params.tenantId),
  }));

  const roles = useQuery(() => enterpriseQueries.roles(params.tenantId));

  const invitationOptions = useQuery(() => enterpriseQueries.invitationOptions(params.tenantId));

  const roleChoices = createMemo<RoleChoice[]>(() =>
    (invitationOptions.data?.roles ?? []).flatMap((option) => {
      const value = option.roleId
        ? `role:${option.roleId}`
        : option.role
          ? `builtin:${option.role}`
          : undefined;

      if (!value) return [];

      return [
        {
          value,
          label: option.label,
          role: option.role ?? undefined,
          roleId: option.roleId ?? undefined,
          assignable: option.assignable,
          blockedReason: option.blockedReason ?? null,
        },
      ];
    }),
  );

  const memberChoices = createMemo<RoleChoice[]>(() => {
    const choices = roleChoices();
    const seen = new Set(choices.map((choice) => choice.value));
    const extras: RoleChoice[] = [];

    for (const user of users.data?.users ?? []) {
      const value = roleValue(user);

      if (seen.has(value)) continue;
      seen.add(value);
      extras.push({
        value,
        label: user.roleName ?? value,
        assignable: false,
        blockedReason: "Your role can't assign this role",
      });
    }

    return [...choices, ...extras];
  });

  const unavailableChoices = createMemo(() => roleChoices().filter((choice) => !choice.assignable));

  const [email, setEmail] = createSignal("");
  const [role, setRole] = createSignal("builtin:member");
  const [inviteResult, setInviteResult] = createSignal<InviteResult | null>(null);
  const [copied, setCopied] = createSignal<string | null>(null);
  const [mintedLinks, setMintedLinks] = createSignal<Record<string, string>>({});
  const [rowError, setRowError] = createSignal<{ id: string; error: unknown } | null>(null);
  const [resendNotice, setResendNotice] = createSignal<ResendNotice | null>(null);
  const [resendTarget, setResendTarget] = createSignal<TenantInvitation | null>(null);
  const [cancelTarget, setCancelTarget] = createSignal<TenantInvitation | null>(null);
  const [filter, setFilter] = createSignal<InvitationFilter>("active");

  const [roleEditing, setRoleEditing] = createSignal<TenantRole | null>(null);
  const [roleFormOpen, setRoleFormOpen] = createSignal(false);
  const [roleName, setRoleName] = createSignal("");
  const [roleDescription, setRoleDescription] = createSignal("");
  const [rolePermissions, setRolePermissions] = createSignal<Set<Permission>>(new Set());
  const [roleBlocked, setRoleBlocked] = createSignal(false);
  const [roleError, setRoleError] = createSignal<string | null>(null);

  const selectedChoice = () => roleChoices().find((choice) => choice.value === role());

  // Keep the invite form on an assignable option whenever the actor's ceiling
  // changes (for example after a role edit) or the initial default is blocked.
  createEffect(
    () => {
      const choices = roleChoices();

      if (choices.length === 0) return null;
      const current = choices.find((choice) => choice.value === role());

      if (current?.assignable) return null;

      return choices.find((choice) => choice.assignable)?.value ?? null;
    },
    (next) => {
      if (next) setRole(next);
    },
  );

  const canInvite = () =>
    can("members.write") &&
    invitationOptions.data !== undefined &&
    selectedChoice()?.assignable === true;

  const copyLink = async (value: string, key: string) => {
    if (await copyToClipboard(value)) setCopied(key);
  };

  const refreshAccess = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: enterpriseKeys.users(params.tenantId) }),
      qc.invalidateQueries({ queryKey: enterpriseKeys.me() }),
      qc.invalidateQueries({ queryKey: enterpriseKeys.tenant(params.tenantId) }),
    ]);
  };

  const invalidateRoleData = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: enterpriseKeys.roles(params.tenantId) }),
      qc.invalidateQueries({ queryKey: enterpriseKeys.users(params.tenantId) }),
      qc.invalidateQueries({ queryKey: enterpriseKeys.invitations(params.tenantId) }),
      qc.invalidateQueries({ queryKey: enterpriseKeys.invitationOptions(params.tenantId) }),
      qc.invalidateQueries({ queryKey: enterpriseKeys.me() }),
      qc.invalidateQueries({ queryKey: enterpriseKeys.tenant(params.tenantId) }),
    ]);
  };

  const invite = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: () => {
      const choice = selectedChoice();

      if (!choice) throw new Error("Choose a role for this invitation");

      if (!choice.assignable)
        throw new Error(choice.blockedReason ?? "Your role can't assign that role");

      // The API takes a built-in role name or `roleId` with `member` as the
      // fallback. `builtin:` tokens are a UI-only representation.
      const invitation = choice.roleId
        ? { roleId: choice.roleId, role: "member" as const }
        : { role: choice.role ?? "member" };

      return enterprise.inviteUser(params.tenantId, {
        email: email().trim(),
        ...invitation,
      });
    },
    onSuccess: async (result) => {
      const sentTo = email().trim();
      const roleName = selectedChoice()?.label ?? "Member";

      setInviteResult({
        id: result.id,
        email: sentTo,
        roleName,
        inviteUrl: result.inviteUrl,
        expiresAt: result.expiresAt,
        emailSent: result.emailSent,
      });
      setMintedLinks((current) => ({ ...current, [result.id]: result.inviteUrl }));
      setCopied(null);
      setEmail("");
      await qc.invalidateQueries({ queryKey: enterpriseKeys.invitations(params.tenantId) });
    },
  }));

  const resend = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: (item: TenantInvitation) => enterprise.resendInvitation(params.tenantId, item.id),
    onSuccess: async (result, item) => {
      setRowError(null);
      setMintedLinks((current) => ({ ...current, [item.id]: result.inviteUrl }));
      setResendNotice({
        email: item.email,
        inviteUrl: result.inviteUrl,
        expiresAt: result.expiresAt,
        emailSent: result.emailSent,
      });
      await qc.invalidateQueries({ queryKey: enterpriseKeys.invitations(params.tenantId) });
    },
    onError: (error, item) => setRowError({ id: item.id, error }),
  }));

  const cancelInvitation = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: (item: TenantInvitation) => enterprise.cancelInvitation(params.tenantId, item.id),
    onSuccess: async (_result, item) => {
      setRowError(null);

      if (copied() === item.id) setCopied(null);
      await qc.invalidateQueries({ queryKey: enterpriseKeys.invitations(params.tenantId) });
    },
    onError: (error, item) => setRowError({ id: item.id, error }),
  }));

  const removeUser = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: (memberId: string) => enterprise.removeUser(params.tenantId, memberId),
    onSuccess: refreshAccess,
  }));

  const changeRole = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
      enterprise.patchUser(
        params.tenantId,
        memberId,
        role.startsWith("role:")
          ? { roleId: role.slice(5), role: "member" }
          : { role: role.slice(8), roleId: null },
      ),
    onSuccess: refreshAccess,
  }));

  const visiblePermissionGroups = createMemo(() =>
    PERMISSION_GROUPS.map((group) => ({
      ...group,
      permissions: group.permissions.filter((permission) => permissions().has(permission.id)),
    })).filter((group) => group.permissions.length > 0),
  );

  const defaultRolePermissions = () => {
    const held = [...permissions()];

    return new Set<Permission>(held.includes("tenant.read") ? ["tenant.read"] : held.slice(0, 1));
  };

  const blockedRolePermissions = () =>
    [...rolePermissions()].filter(
      (permission) =>
        !permissions().has(permission) || (OWNER_ONLY_PERMISSIONS.has(permission) && !isOwner()),
    );

  const saveRole = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: async (): Promise<{ status: "ok" }> => {
      if (roleBlocked())
        throw new Error(
          "This role includes permissions your own role doesn't hold. Ask an owner to edit it.",
        );

      const blocked = blockedRolePermissions();

      if (blocked.length > 0) throw new Error(`You can't grant: ${blocked.join(", ")}`);

      if (rolePermissions().size === 0) throw new Error("Choose at least one permission");

      const payload = {
        name: roleName().trim(),
        description: roleDescription().trim() || null,
        permissions: [...rolePermissions()],
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
      setRoleBlocked(false);
      await invalidateRoleData();
    },
    onError: (error) => setRoleError(errorMessage(error)),
  }));

  const [roleToDelete, setRoleToDelete] = createSignal<{ id: string; name: string } | null>(null);

  const removeRole = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: (roleId: string) => enterprise.deleteRole(params.tenantId, roleId),
    onSuccess: async () => {
      setRoleToDelete(null);
      await invalidateRoleData();
    },
    onError: (error) => setRoleError(errorMessage(error)),
  }));

  const openCreateRole = () => {
    setRoleEditing(null);
    setRoleName("");
    setRoleDescription("");
    setRolePermissions(defaultRolePermissions());
    setRoleBlocked(false);
    setRoleError(null);
    setRoleFormOpen(true);
  };

  const openEditRole = (role: TenantRole) => {
    const allowed = new Set(
      role.permissions.filter(
        (permission) =>
          permissions().has(permission) && (!OWNER_ONLY_PERMISSIONS.has(permission) || isOwner()),
      ),
    );

    setRoleEditing(role);
    setRoleName(role.name);
    setRoleDescription(role.description ?? "");
    setRolePermissions(allowed);
    setRoleBlocked(allowed.size !== role.permissions.length);
    setRoleError(
      allowed.size !== role.permissions.length
        ? "This role includes permissions your own role doesn't hold. Ask an owner to edit it."
        : null,
    );
    setRoleFormOpen(true);
  };

  const togglePermission = (permission: Permission) => {
    setRolePermissions((current) => {
      const next = new Set(current);

      if (next.has(permission)) next.delete(permission);
      else next.add(permission);

      return next;
    });
  };

  const filteredInvitations = createMemo(() =>
    (invitations.data?.invitations ?? []).filter((item) => matchesFilter(item, filter())),
  );

  const memberCount = () => users.data?.users.length ?? 0;

  return (
    <div class="grid gap-5 xl:grid-cols-2">
      <QueryError
        class="xl:col-span-2"
        error={users.error ?? invitations.error ?? invitationOptions.error}
        onRetry={() => {
          void users.refetch();
          void invitations.refetch();
          void invitationOptions.refetch();
        }}
      />

      <Show when={can("members.write")}>
        <Panel
          class="xl:col-span-2"
          title="Invite a member"
          description="Send a one-time invitation link. New members join with the role you choose."
        >
          <form
            class="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              setInviteResult(null);
              setCopied(null);
              invite.mutate();
            }}
          >
            <Input
              type="email"
              required
              autocomplete="email"
              aria-label="Invitee email address"
              placeholder="teammate@example.com"
              value={email()}
              onInput={(event) => setEmail(event.currentTarget.value)}
              class="min-w-0 flex-1"
            />
            <select
              class={cn(selectClass, "shrink-0")}
              value={role()}
              onChange={(event) => setRole(event.currentTarget.value)}
              aria-label="Invitation role"
              disabled={invitationOptions.isPending || roleChoices().length === 0}
            >
              <Show
                when={!invitationOptions.isPending}
                fallback={<option value={role()}>Loading roles…</option>}
              >
                <For each={roleChoices()}>
                  {(option) => (
                    <option
                      value={option.value}
                      disabled={!option.assignable}
                      selected={option.value === role()}
                    >
                      {option.assignable
                        ? option.label
                        : `${option.label} — ${option.blockedReason ?? "Not available"}`}
                    </option>
                  )}
                </For>
              </Show>
            </select>
            <Button
              type="submit"
              class="min-h-11 shrink-0"
              disabled={!canInvite() || invite.isPending}
            >
              {invite.isPending ? "Sending…" : "Send invitation"}
            </Button>
          </form>
          <ErrorText error={invite.error} />

          <Show when={invitationOptions.data && !roleChoices().some((choice) => choice.assignable)}>
            <p role="status" class="mt-2 text-xs text-muted-foreground">
              Your role doesn't include the permissions needed to invite anyone. Ask a tenant owner
              to invite members or raise your role's ceiling.
            </p>
          </Show>

          <Show when={unavailableChoices().length > 0}>
            <details class="mt-3 text-xs leading-relaxed text-muted-foreground">
              <summary class="w-fit cursor-pointer rounded text-[12px] font-medium text-muted-foreground hover:text-foreground">
                Why some roles are unavailable
              </summary>
              <ul class="mt-2 space-y-1">
                <For each={unavailableChoices()}>
                  {(choice) => (
                    <li>
                      <span class="font-medium text-foreground">{choice.label}</span>
                      {" — "}
                      {choice.blockedReason ?? "Not available for your role"}
                    </li>
                  )}
                </For>
              </ul>
            </details>
          </Show>

          <Show when={inviteResult()}>
            {(result) => (
              <div class="mt-4 rounded-lg border border-success/25 bg-success/[0.06] p-3 text-sm">
                <p role="status" aria-live="polite" class="font-medium text-foreground">
                  {result().emailSent ? "Email sent" : "Email could not be sent — copy this link"}
                </p>
                <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Sent to <span class="font-medium text-foreground">{result().email}</span> as{" "}
                  <span class="font-medium text-foreground">{result().roleName}</span>. Expires{" "}
                  <time datetime={result().expiresAt}>{formatDate(result().expiresAt)}</time>.
                </p>
                <code class="mt-2 block break-all rounded-md border border-white/[0.07] bg-black/25 p-2 font-mono text-xs text-muted-foreground">
                  {result().inviteUrl}
                </code>
                <div class="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    class="min-h-11 sm:min-h-0"
                    variant="outline"
                    aria-label={`Copy invitation link for ${result().email}`}
                    onClick={() => void copyLink(result().inviteUrl, "invite")}
                  >
                    Copy link
                  </Button>
                  <span role="status" aria-live="polite" class="text-xs text-success-foreground">
                    {copied() === "invite" ? "Link copied to clipboard." : ""}
                  </span>
                </div>
              </div>
            )}
          </Show>

          <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
            Invitations expire after 7 days. The recipient must sign in with the invited email
            address. Members and auditors have read-only access; administrators can manage devices,
            policies and the team; owners can also manage billing and delete the tenant.
          </p>
        </Panel>
      </Show>

      <Show when={can("roles.read")}>
        <Panel
          class="xl:col-span-2"
          title="Roles"
          description="Create custom roles with a precise set of tenant permissions, then assign them to members. Built-in roles are fixed."
          actions={
            <Show when={can("roles.write")}>
              <Button onClick={openCreateRole}>Create role</Button>
            </Show>
          }
        >
          <QueryError error={roles.error} onRetry={() => void roles.refetch()} />
          <Show when={!can("roles.write")}>
            <ReadOnlyNotice class="mb-3">
              You can review roles, but creating and editing them requires the roles.write
              permission.
            </ReadOnlyNotice>
          </Show>
          <Show when={roleFormOpen() && can("roles.write")}>
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
              <p class="text-[11px] leading-relaxed text-muted-foreground">
                Only permissions your own role holds are shown. Your role is the ceiling: a custom
                role can never grant more than you already have.
              </p>
              <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <For each={visiblePermissionGroups()}>
                  {(group) => (
                    <div class="min-w-0">
                      <p class="mb-1 text-[11px] font-medium text-foreground">{group.label}</p>
                      <div class="space-y-1">
                        <For each={group.permissions}>
                          {(permission) => {
                            const ownerOnly = () => OWNER_ONLY_PERMISSIONS.has(permission.id);
                            const disabled = () => ownerOnly() && !isOwner();

                            return (
                              <label
                                class="flex cursor-pointer items-start gap-2 text-[11.5px] text-muted-foreground"
                                title={
                                  disabled()
                                    ? "Only a tenant owner can grant owner-only permissions"
                                    : undefined
                                }
                              >
                                <input
                                  type="checkbox"
                                  class="mt-0.5 size-4 accent-[var(--brand)]"
                                  checked={rolePermissions().has(permission.id)}
                                  disabled={disabled()}
                                  onChange={() => togglePermission(permission.id)}
                                />
                                <span>
                                  {permission.label}
                                  <Show when={ownerOnly()}>
                                    <span class="ml-1 text-[10px] text-muted-foreground">
                                      (owner only)
                                    </span>
                                  </Show>
                                </span>
                              </label>
                            );
                          }}
                        </For>
                      </div>
                    </div>
                  )}
                </For>
              </div>
              <Show when={visiblePermissionGroups().length === 0}>
                <p role="status" class="text-xs text-muted-foreground">
                  Your role doesn't include any permissions you can grant.
                </p>
              </Show>
              <ErrorText error={roleError() || saveRole.error} />
              <div class="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  class="min-h-11 sm:min-h-0"
                  disabled={saveRole.isPending || roleBlocked()}
                >
                  {saveRole.isPending ? "Saving…" : roleEditing() ? "Save role" : "Create role"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  class="min-h-11 sm:min-h-0"
                  variant="ghost"
                  onClick={() => {
                    setRoleFormOpen(false);
                    setRoleEditing(null);
                    setRoleBlocked(false);
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
                      {item.permissions.length} permission
                      {item.permissions.length === 1 ? "" : "s"}
                      {item.description ? ` · ${item.description}` : ""}
                    </p>
                  </div>
                  <Show when={!item.builtIn && can("roles.write")}>
                    <div class="flex shrink-0 gap-1.5">
                      <Button
                        size="xs"
                        class="min-h-11 sm:min-h-0"
                        variant="outline"
                        onClick={() => openEditRole(item)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="xs"
                        class="min-h-11 sm:min-h-0"
                        variant="destructive"
                        disabled={removeRole.isPending || item.memberCount > 0}
                        title={
                          item.memberCount > 0
                            ? "Reassign members before deleting this role"
                            : undefined
                        }
                        onClick={() => setRoleToDelete({ id: item.id, name: item.name })}
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
      </Show>

      <Panel
        title="Current members"
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
              {(user) => {
                const isSelf = () => user.userId === session().data?.user?.id;

                const targetIsOwner = () =>
                  !user.roleId &&
                  user.role
                    .split(",")
                    .map((value) => value.trim())
                    .includes("owner");

                const ownerLocked = () => targetIsOwner() && !isOwner();

                return (
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
                        <span class="block truncate text-xs text-muted-foreground">
                          {user.email}
                        </span>
                        <span class="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {user.roleName ?? user.role}
                        </span>
                      </div>
                    </div>
                    <div class="flex shrink-0 flex-wrap items-center gap-2">
                      <Show
                        when={!isSelf() && can("members.write")}
                        fallback={
                          <Chip tone="neutral">
                            {isSelf() ? "You" : (user.roleName ?? user.role)}
                          </Chip>
                        }
                      >
                        <select
                          class={selectClass}
                          value={roleValue(user)}
                          onChange={(event) =>
                            changeRole.mutate({
                              memberId: user.memberId,
                              role: event.currentTarget.value,
                            })
                          }
                          disabled={changeRole.isPending || ownerLocked()}
                          aria-label={`Role for ${user.name} (${user.email})`}
                          title={
                            ownerLocked()
                              ? "Only a tenant owner can change the owner role"
                              : undefined
                          }
                        >
                          <For each={memberChoices()}>
                            {(option) => (
                              <option
                                value={option.value}
                                disabled={!option.assignable}
                                selected={option.value === roleValue(user)}
                              >
                                {option.assignable
                                  ? option.label
                                  : `${option.label} — ${option.blockedReason ?? "Not available"}`}
                              </option>
                            )}
                          </For>
                        </select>
                        <Button
                          size="sm"
                          class="min-h-11 sm:min-h-0"
                          variant="destructive"
                          aria-label={`Remove ${user.name} (${user.email})`}
                          onClick={() => removeUser.mutate(user.memberId)}
                          disabled={removeUser.isPending || ownerLocked()}
                          title={
                            ownerLocked() ? "Only a tenant owner can remove an owner" : undefined
                          }
                        >
                          Remove
                        </Button>
                      </Show>
                    </div>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
        <div class="px-4 pb-4 sm:px-5">
          <ErrorText error={removeUser.error || changeRole.error} />
        </div>
      </Panel>

      <Panel
        title="Invitations"
        description="Pending invitations and their delivery history."
        flush
      >
        <Show when={resendNotice()}>
          {(notice) => (
            <div
              role="status"
              aria-live="polite"
              class="mx-4 mt-3 rounded-lg border border-warning/25 bg-warning/[0.06] p-3 text-xs"
            >
              <p class="font-medium text-foreground">
                A new invitation link was created. The previous link no longer works.
              </p>
              <p class="mt-1 text-muted-foreground">
                {notice().emailSent
                  ? "Email sent to "
                  : "Email could not be sent — copy this link for "}
                <span class="font-medium text-foreground">{notice().email}</span>. Expires{" "}
                <time datetime={notice().expiresAt}>{formatDate(notice().expiresAt)}</time>.
              </p>
              <code class="mt-2 block break-all rounded-md border border-white/[0.07] bg-black/25 p-2 font-mono text-[11px] text-muted-foreground">
                {notice().inviteUrl}
              </code>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  class="min-h-11 sm:min-h-0"
                  variant="outline"
                  aria-label={`Copy rotated invitation link for ${notice().email}`}
                  onClick={() => void copyLink(notice().inviteUrl, "resend")}
                >
                  Copy link
                </Button>
                <span role="status" aria-live="polite" class="text-success-foreground">
                  {copied() === "resend" ? "Link copied to clipboard." : ""}
                </span>
              </div>
            </div>
          )}
        </Show>

        <div class="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-2.5 sm:px-5">
          <label
            class="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground"
            for="invitation-filter"
          >
            Status
          </label>
          <select
            id="invitation-filter"
            class={cn(selectClass, "w-auto max-w-[60%]")}
            value={filter()}
            onChange={(event) => {
              const value = event.currentTarget.value;

              if (
                value === "active" ||
                value === "accepted" ||
                value === "canceled" ||
                value === "all"
              )
                setFilter(value);
            }}
          >
            <option value="active">Pending and expired</option>
            <option value="accepted">Accepted</option>
            <option value="canceled">Canceled and replaced</option>
            <option value="all">All invitations</option>
          </select>
        </div>

        <Show
          when={filteredInvitations().length > 0}
          fallback={
            <p class="px-4 py-6 text-[13px] text-muted-foreground sm:px-5">
              {filter() === "active"
                ? "No pending invitations."
                : "No invitations match this filter."}
            </p>
          }
        >
          <ul class="divide-y divide-white/[0.05]">
            <For each={filteredInvitations()}>
              {(item) => {
                const status = () => effectiveStatus(item);

                const canResend = () =>
                  can("members.write") &&
                  (status() === "pending" || status() === "expired" || status() === "superseded");

                const canCancel = () =>
                  can("members.write") && (status() === "pending" || status() === "expired");

                return (
                  <li class="flex flex-col gap-3 px-4 py-3 sm:px-5">
                    <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div class="min-w-0">
                        <p class="break-all text-[13px] font-medium text-foreground">
                          {item.email}
                        </p>
                        <p class="mt-0.5 text-[11px] text-muted-foreground">
                          {item.roleName}
                          <Show when={item.invitedBy}>
                            {(inviter) => (
                              <>
                                {" · Invited by "}
                                <span title={inviter().email}>{inviter().name}</span>
                              </>
                            )}
                          </Show>
                        </p>
                        <p class="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span>
                            Created{" "}
                            <time datetime={item.createdAt} title={formatDate(item.createdAt)}>
                              {relativeTime(item.createdAt)}
                            </time>
                          </span>
                          <span>
                            Sent{" "}
                            <time datetime={item.lastSentAt} title={formatDate(item.lastSentAt)}>
                              {relativeTime(item.lastSentAt)}
                            </time>
                            <Show when={item.sendCount > 1}> · {item.sendCount} times</Show>
                          </span>
                          <span>
                            Expires{" "}
                            <time datetime={item.expiresAt} title={formatDate(item.expiresAt)}>
                              {relativeExpiry(item.expiresAt)}
                            </time>
                          </span>
                        </p>
                      </div>
                      <div class="flex shrink-0 flex-wrap items-center gap-1.5">
                        <Chip tone={statusTone(item)}>{statusLabels[status()]}</Chip>
                        <Show when={mintedLinks()[item.id]}>
                          {(link) => (
                            <Button
                              size="sm"
                              class="min-h-11 sm:min-h-0"
                              variant="outline"
                              aria-label={`Copy invitation link for ${item.email}`}
                              onClick={() => void copyLink(link(), item.id)}
                            >
                              Copy link
                            </Button>
                          )}
                        </Show>
                        <Show when={canResend()}>
                          <Button
                            size="sm"
                            class="min-h-11 sm:min-h-0"
                            variant="outline"
                            aria-label={`Resend invitation for ${item.email}`}
                            disabled={resend.isPending}
                            onClick={() => setResendTarget(item)}
                          >
                            Resend
                          </Button>
                        </Show>
                        <Show when={canCancel()}>
                          <Button
                            size="sm"
                            class="min-h-11 sm:min-h-0"
                            variant="ghost"
                            aria-label={`Cancel invitation for ${item.email}`}
                            disabled={cancelInvitation.isPending}
                            onClick={() => setCancelTarget(item)}
                          >
                            Cancel
                          </Button>
                        </Show>
                      </div>
                    </div>
                    <Show when={copied() === item.id}>
                      <p
                        role="status"
                        aria-live="polite"
                        class="text-[11px] text-success-foreground"
                      >
                        Link copied to clipboard.
                      </p>
                    </Show>
                    <Show when={rowError()?.id === item.id}>
                      <ErrorText error={rowError()!.error} />
                    </Show>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
        <div class="px-4 pb-4 sm:px-5">
          <ErrorText error={cancelInvitation.error} />
        </div>
      </Panel>

      <Dialog
        open={Boolean(resendTarget())}
        onOpenChange={(open) => {
          if (!open) setResendTarget(null);
        }}
      >
        <DialogContent class="max-w-md">
          <DialogHeader class="gap-1.5">
            <DialogTitle class="text-[15px] font-semibold">Resend invitation?</DialogTitle>
            <DialogDescription class="text-[12.5px] leading-relaxed text-muted-foreground">
              Resending creates a brand-new link for{" "}
              <span class="font-medium text-foreground">{resendTarget()?.email}</span>. The previous
              link stops working immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter class="mt-4">
            <Button
              variant="outline"
              class="min-h-11 sm:min-h-0"
              onClick={() => setResendTarget(null)}
            >
              Keep old link
            </Button>
            <Button
              class="min-h-11 sm:min-h-0"
              disabled={resend.isPending}
              onClick={() => {
                const target = resendTarget();

                if (!target) return;
                setResendTarget(null);
                resend.mutate(target);
              }}
            >
              {resend.isPending ? "Resending…" : "Resend invitation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(cancelTarget())}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
      >
        <DialogContent class="max-w-md">
          <DialogHeader class="gap-1.5">
            <DialogTitle class="text-[15px] font-semibold">Cancel invitation?</DialogTitle>
            <DialogDescription class="text-[12.5px] leading-relaxed text-muted-foreground">
              The invitation for{" "}
              <span class="font-medium text-foreground">{cancelTarget()?.email}</span> will stop
              working. You can send a new invitation later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter class="mt-4">
            <Button
              variant="outline"
              class="min-h-11 sm:min-h-0"
              onClick={() => setCancelTarget(null)}
            >
              Keep invitation
            </Button>
            <Button
              variant="destructive"
              class="min-h-11 sm:min-h-0"
              disabled={cancelInvitation.isPending}
              onClick={() => {
                const target = cancelTarget();

                if (!target) return;
                setCancelTarget(null);
                cancelInvitation.mutate(target);
              }}
            >
              {cancelInvitation.isPending ? "Canceling…" : "Cancel invitation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={roleToDelete() !== null}
        onOpenChange={(open) => {
          if (!open) setRoleToDelete(null);
        }}
        title={`Delete “${roleToDelete()?.name ?? "this role"}”?`}
        description="Members assigned to this role lose the permissions it grants. This cannot be undone."
        confirmLabel="Delete role"
        destructive
        pending={removeRole.isPending}
        onConfirm={() => {
          const role = roleToDelete();

          if (role) removeRole.mutate(role.id);
        }}
      />
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

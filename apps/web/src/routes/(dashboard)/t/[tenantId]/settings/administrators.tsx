import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { PERMISSION_GROUPS, BULK_MEMBER_LIMIT } from "@mattrax/enterprise-domain/client";
import type { Permission } from "@mattrax/enterprise-domain/client";
import { ErrorText, Panel, QueryError, formatDate, relativeTime } from "~/components/mdm/common";
import { toast } from "~/components/toast";
import { errorMessage } from "~/lib/errors";
import { bulkFailureReason, bulkReport, runBulkBatches, rolePatch } from "~/lib/bulk-members";
import type { BulkFailure } from "~/lib/bulk-members";
import { Button } from "~/components/ui/button";
import { Checkbox, FilterBar } from "@mattrax/ui";
import type { FilterField } from "@mattrax/ui";
import ConfirmDialog from "~/components/ui/confirm-dialog";
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
import EntityHoverCard from "~/components/entity-hover-card";
import { authClient } from "~/lib/auth";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import type {
  RequestTenantOwnershipTransferResponse,
  TenantAccount,
  TenantInvitation,
  TenantOwnershipTransfer,
  TenantRole,
} from "~/lib/enterprise";
import { ReadOnlyNotice, useTenantPermissions } from "~/lib/permissions";
import { ScopeTagBadges, ScopeTagSelect } from "~/components/scope-tags/scope-tag-select";
import {
  optimisticallyRemoveCollectionItems,
  optimisticallyUpdateCollection,
  optimisticUpdate,
} from "~/lib/optimistic";
import { initials } from "~/lib/names";
import { cn } from "~/lib/utils";
import Chip from "~/components/settings/status-chip";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";

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

const roleValue = (account: { role: string; roleId?: string | null }) =>
  account.roleId ? `role:${account.roleId}` : `builtin:${account.role}`;

/** Owner authority is the built-in role only, never a custom-role delegation. */
const isBuiltInOwnerUser = (account: { role: string; roleId?: string | null }) =>
  !account.roleId &&
  account.role
    .split(",")
    .map((value) => value.trim())
    .includes("owner");

const selectClass =
  "h-11 w-full rounded-lg border border-input bg-surface px-2.5 text-base text-foreground sm:h-8 sm:text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 sm:w-auto";

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

/**
 * Rows created optimistically have no server id yet. They are shown until the
 * settled refetch replaces them, but never offer row actions that need an id.
 */
const OPTIMISTIC_ROW_PREFIX = "optimistic:";

const isOptimisticRow = (id: string) => id.startsWith(OPTIMISTIC_ROW_PREFIX);

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

const invitationFilterFields: FilterField[] = [
  {
    id: "invitationStatus",
    label: "Invitation status",
    kind: "select",
    operators: [{ value: "is", label: "is" }],
    options: [
      { value: "active", label: "Pending and expired" },
      { value: "accepted", label: "Accepted" },
      { value: "canceled", label: "Canceled and replaced" },
    ],
  },
];

export const route = {
  preload: ({ params, intent }: { params: { tenantId?: string }; intent: string }) => {
    const tenantId = params.tenantId;

    if (intent === "initial" || !tenantId) return;

    return preloadPage([
      () =>
        queryClient.ensureQueryData({
          queryKey: enterpriseKeys.accounts(tenantId),
          queryFn: () => enterprise.listAccounts(tenantId),
        }),
      () => queryClient.ensureQueryData(enterpriseQueries.invitations(tenantId)),
      () => queryClient.ensureQueryData(enterpriseQueries.roles(tenantId)),
      () => queryClient.ensureQueryData(enterpriseQueries.invitationOptions(tenantId)),
      () => queryClient.ensureQueryData(enterpriseQueries.ownershipTransfer(tenantId)),
    ]);
  },
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

  const canChangeAccountRole = (account: TenantAccount) =>
    can("members.write") &&
    account.accountId !== session().data?.user?.id &&
    (!isBuiltInOwnerUser(account) || isOwner());

  const accounts = useQuery(() => ({
    queryKey: enterpriseKeys.accounts(params.tenantId),
    queryFn: () => enterprise.listAccounts(params.tenantId),
  }));

  const [tagTarget, setTagTarget] = createSignal<TenantAccount | null>(null);
  const [tagSelection, setTagSelection] = createSignal<Array<string>>([]);

  const saveScopeTags = useMutation(() => ({
    mutationFn: () => {
      const target = tagTarget();

      if (!target) throw new Error("No administrator selected");

      return enterprise.setMemberScopeTags(
        params.tenantId,
        target.accountId,
        tagSelection(),
      );
    },
    onSuccess: async () => {
      setTagTarget(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: enterpriseKeys.accounts(params.tenantId) }),
        qc.invalidateQueries({ queryKey: enterpriseKeys.scopeTags(params.tenantId) }),
      ]);
    },
  }));

  const invitations = useQuery(() => ({
    queryKey: enterpriseKeys.invitations(params.tenantId),
    queryFn: () => enterprise.listInvitations(params.tenantId),
  }));

  const ownershipTransfer = useQuery(() => enterpriseQueries.ownershipTransfer(params.tenantId));

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

  const accountRoleChoices = createMemo<RoleChoice[]>(() => {
    const choices = roleChoices();
    const seen = new Set(choices.map((choice) => choice.value));
    const extras: RoleChoice[] = [];

    for (const account of accounts.data?.accounts ?? []) {
      const value = roleValue(account);

      if (seen.has(value)) continue;
      seen.add(value);
      extras.push({
        value,
        label: account.roleName ?? value,
        assignable: false,
        blockedReason: "Your role can't assign this role",
      });
    }

    return [...choices, ...extras];
  });

  const unavailableChoices = createMemo(() => roleChoices().filter((choice) => !choice.assignable));

  const [email, setEmail] = createSignal("");
  const [inviteTags, setInviteTags] = createSignal<Array<string>>([]);
  const [role, setRole] = createSignal("builtin:member");
  const [inviteResult, setInviteResult] = createSignal<InviteResult | null>(null);
  const [copied, setCopied] = createSignal<string | null>(null);
  const [mintedLinks, setMintedLinks] = createSignal<Record<string, string>>({});
  const [rowError, setRowError] = createSignal<{ id: string; error: unknown } | null>(null);
  const [resendNotice, setResendNotice] = createSignal<ResendNotice | null>(null);
  const [resendTarget, setResendTarget] = createSignal<TenantInvitation | null>(null);
  const [cancelTarget, setCancelTarget] = createSignal<TenantInvitation | null>(null);
  const [filter, setFilter] = createSignal<InvitationFilter>("active");
  const [selectedAccountIds, setSelectedAccountIds] = createSignal<ReadonlySet<string>>(new Set());
  const [bulkRole, setBulkRole] = createSignal("builtin:member");

  const [transferTarget, setTransferTarget] = createSignal("");
  const [transferConfirm, setTransferConfirm] = createSignal(false);

  const [transferResult, setTransferResult] = createSignal<
    (RequestTenantOwnershipTransferResponse & { targetName: string; targetEmail: string }) | null
  >(null);

  const [transferToCancel, setTransferToCancel] = createSignal(false);

  const [roleEditing, setRoleEditing] = createSignal<TenantRole | null>(null);
  const [roleFormOpen, setRoleFormOpen] = createSignal(false);
  const [roleName, setRoleName] = createSignal("");
  const [roleDescription, setRoleDescription] = createSignal("");
  const [rolePermissions, setRolePermissions] = createSignal<Set<Permission>>(new Set());
  const [roleBlocked, setRoleBlocked] = createSignal(false);
  const [roleError, setRoleError] = createSignal<string | null>(null);

  const selectedChoice = () => roleChoices().find((choice) => choice.value === role());

  const transferCandidates = createMemo(() => {
    const selfId = session().data?.user?.id;

    return (accounts.data?.accounts ?? []).filter(
      (candidate) => candidate.accountId !== selfId && !isBuiltInOwnerUser(candidate),
    );
  });

  // Keep the transfer picker on a valid administrator as the list loads or changes.
  createEffect(
    () =>
      transferCandidates()
        .map((candidate) => candidate.accountId)
        .join(","),
    () => {
      const current = transferCandidates().find(
        (candidate) => candidate.accountId === transferTarget(),
      );

      if (!current) setTransferTarget(transferCandidates()[0]?.accountId ?? "");
    },
  );

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

  // The bulk picker follows the same ceiling as the invite form.
  createEffect(
    () => {
      const choices = roleChoices();

      if (choices.length === 0) return null;
      const current = choices.find((choice) => choice.value === bulkRole());

      if (current?.assignable) return null;

      return choices.find((choice) => choice.assignable)?.value ?? null;
    },
    (next) => {
      if (next) setBulkRole(next);
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
      qc.invalidateQueries({ queryKey: enterpriseKeys.accounts(params.tenantId) }),
      qc.invalidateQueries({ queryKey: enterpriseKeys.me() }),
      qc.invalidateQueries({ queryKey: enterpriseKeys.tenant(params.tenantId) }),
    ]);
  };

  /** The invitation row the invite form submitted, before the server answers. */
  const optimisticInvitation = (): TenantInvitation => {
    const choice = selectedChoice();
    const author = session().data?.user;
    const timestamp = new Date().toISOString();

    return {
      id: `${OPTIMISTIC_ROW_PREFIX}${timestamp}`,
      email: email().trim(),
      role: choice?.roleId ? "member" : (choice?.role ?? "member"),
      roleId: choice?.roleId ?? null,
      roleName: choice?.label ?? "Member",
      status: "pending",
      isExpired: false,
      invitedBy: author ? { id: author.id, name: author.name, email: author.email } : undefined,
      createdAt: timestamp,
      expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      lastSentAt: timestamp,
      sendCount: 1,
    };
  };

  const invalidateRoleData = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: enterpriseKeys.roles(params.tenantId) }),
      qc.invalidateQueries({ queryKey: enterpriseKeys.accounts(params.tenantId) }),
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

      return enterprise.inviteAccount(params.tenantId, {
        email: email().trim(),
        ...invitation,
        ...(inviteTags().length > 0 ? { scopeTagIds: inviteTags() } : {}),
      });
    },
    onMutate: async () => {
      const invitation = optimisticInvitation();

      return optimisticallyUpdateCollection(
        qc,
        enterpriseKeys.invitations(params.tenantId),
        "invitations",
        (rows: TenantInvitation[]) => [invitation, ...rows],
      );
    },
    onSuccess: (result) => {
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
      setInviteTags([]);
    },
    onError: (_error, _variables, restore) => restore?.(),
    onSettled: () =>
      void qc.invalidateQueries({ queryKey: enterpriseKeys.invitations(params.tenantId) }),
  }));

  const resend = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: (item: TenantInvitation) => enterprise.resendInvitation(params.tenantId, item.id),
    onMutate: async (item) => {
      const timestamp = new Date().toISOString();

      return optimisticallyUpdateCollection(
        qc,
        enterpriseKeys.invitations(params.tenantId),
        "invitations",
        (rows: TenantInvitation[]) =>
          rows.map((row): TenantInvitation =>
            row.id === item.id
              ? { ...row, lastSentAt: timestamp, sendCount: row.sendCount + 1 }
              : row,
          ),
      );
    },
    onSuccess: (result, item) => {
      setRowError(null);
      setMintedLinks((current) => ({ ...current, [item.id]: result.inviteUrl }));
      setResendNotice({
        email: item.email,
        inviteUrl: result.inviteUrl,
        expiresAt: result.expiresAt,
        emailSent: result.emailSent,
      });
    },
    onError: (error, item, restore) => {
      restore?.();
      setRowError({ id: item.id, error });
    },
    onSettled: () =>
      void qc.invalidateQueries({ queryKey: enterpriseKeys.invitations(params.tenantId) }),
  }));

  const cancelInvitation = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: (item: TenantInvitation) => enterprise.cancelInvitation(params.tenantId, item.id),
    onMutate: async (item) =>
      optimisticallyUpdateCollection(
        qc,
        enterpriseKeys.invitations(params.tenantId),
        "invitations",
        (rows: TenantInvitation[]) =>
          rows.map((row): TenantInvitation =>
            row.id === item.id ? { ...row, status: "canceled" } : row,
          ),
      ),
    onSuccess: (_result, item) => {
      setRowError(null);

      if (copied() === item.id) setCopied(null);

      // A cancelled invitation must not leave a copyable, already-dead link
      // on screen as if it still worked.
      if (inviteResult()?.id === item.id) setInviteResult(null);

      if (resendNotice()?.email === item.email) setResendNotice(null);
    },
    onError: (error, item, restore) => {
      restore?.();
      setRowError({ id: item.id, error });
    },
    onSettled: () =>
      void qc.invalidateQueries({ queryKey: enterpriseKeys.invitations(params.tenantId) }),
  }));

  const removeAccount = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: (accountId: string) => enterprise.removeAccount(params.tenantId, accountId),
    onMutate: async (accountId) =>
      optimisticallyUpdateCollection(
        qc,
        enterpriseKeys.accounts(params.tenantId),
        "accounts",
        (rows: TenantAccount[]) => rows.filter((row) => row.accountId !== accountId),
      ),
    onError: (_error, _accountId, restore) => restore?.(),
    onSettled: () => void refreshAccess(),
  }));

  const requestOwnershipTransfer = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: () => {
      const target = transferCandidates().find(
        (candidate) => candidate.accountId === transferTarget(),
      );

      if (!target) throw new Error("Choose an administrator to take over ownership");

      return enterprise.requestOwnershipTransfer(params.tenantId, target.accountId);
    },
    onSuccess: (result) => {
      const target = accounts.data?.accounts.find(
        (candidate) => candidate.accountId === result.targetAccountId,
      );

      setTransferResult({
        ...result,
        targetName: target?.name ?? "the new owner",
        targetEmail: target?.email ?? "",
      });
      setCopied(null);
      setTransferConfirm(false);
    },
    onSettled: () =>
      void qc.invalidateQueries({ queryKey: enterpriseKeys.ownershipTransfer(params.tenantId) }),
  }));

  const cancelOwnershipTransfer = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: () => enterprise.cancelOwnershipTransfer(params.tenantId),
    // The outcome is entirely predictable: there is no pending transfer left.
    onMutate: async () =>
      optimisticUpdate<{ transfer: TenantOwnershipTransfer | null }>(
        qc,
        enterpriseKeys.ownershipTransfer(params.tenantId),
        () => ({ transfer: null }),
      ),
    onSuccess: () => {
      setTransferResult(null);
      setTransferToCancel(false);
    },
    onError: (_error, _variables, restore) => restore?.(),
    onSettled: () =>
      void qc.invalidateQueries({ queryKey: enterpriseKeys.ownershipTransfer(params.tenantId) }),
  }));

  const changeRole = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: ({ accountId, role }: { accountId: string; role: string }) =>
      enterprise.patchAccount(params.tenantId, accountId, rolePatch(role)),
    onMutate: async ({ accountId, role }) => {
      const choice = accountRoleChoices().find((option) => option.value === role);

      return optimisticallyUpdateCollection(
        qc,
        enterpriseKeys.accounts(params.tenantId),
        "accounts",
        (rows: TenantAccount[]) =>
          rows.map((row): TenantAccount =>
            row.accountId === accountId
              ? {
                  ...row,
                  role: choice?.roleId ? "member" : (choice?.role ?? row.role),
                  roleId: choice?.roleId ?? null,
                  roleName: choice?.label ?? row.roleName,
                  roleKind: choice?.roleId ? "custom" : "built-in",
                }
              : row,
          ),
      );
    },
    onError: (_error, _variables, restore) => restore?.(),
    onSettled: () => void refreshAccess(),
  }));

  const selectableAccounts = createMemo(() =>
    (accounts.data?.accounts ?? []).filter(canChangeAccountRole),
  );

  const selectedAccounts = createMemo(() =>
    (accounts.data?.accounts ?? []).filter((account) =>
      selectedAccountIds().has(account.accountId),
    ),
  );

  const allSelectableSelected = () =>
    selectableAccounts().length > 0 && selectedAccounts().length === selectableAccounts().length;

  const someSelectableSelected = () => selectedAccounts().length > 0 && !allSelectableSelected();

  const toggleAccount = (accountId: string, selected: boolean) =>
    setSelectedAccountIds((current) => {
      const next = new Set(current);

      if (selected) next.add(accountId);
      else next.delete(accountId);

      return next;
    });

  const toggleAllAccounts = (selected: boolean) =>
    setSelectedAccountIds(
      selected
        ? new Set(selectableAccounts().map((account) => account.accountId))
        : new Set<string>(),
    );

  const changeRoles = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: async () => {
      const choice = roleChoices().find((option) => option.value === bulkRole());

      if (!choice) throw new Error("Choose a role for the selected administrators");

      if (!choice.assignable)
        throw new Error(choice.blockedReason ?? "Your role can't assign that role");

      const accountIds = selectedAccounts().map((account) => account.accountId);

      if (accountIds.length === 0) throw new Error("Select at least one administrator");

      return runBulkBatches(accountIds, BULK_MEMBER_LIMIT, (batch) =>
        enterprise.patchAccountRoles(params.tenantId, {
          accountIds: batch,
          ...rolePatch(choice.value),
        }),
      );
    },
    onMutate: async () => {
      const choice = roleChoices().find((option) => option.value === bulkRole());
      const accountIds = new Set(selectedAccounts().map((account) => account.accountId));

      if (!choice || accountIds.size === 0) return;

      return optimisticallyUpdateCollection(
        qc,
        enterpriseKeys.accounts(params.tenantId),
        "accounts",
        (rows: TenantAccount[]) =>
          rows.map((row): TenantAccount =>
            accountIds.has(row.accountId)
              ? {
                  ...row,
                  role: choice.roleId ? "member" : (choice.role ?? row.role),
                  roleId: choice.roleId ?? null,
                  roleName: choice.label,
                  roleKind: choice.roleId ? "custom" : "built-in",
                }
              : row,
          ),
      );
    },
    onSuccess: (result) => {
      const names = new Map(selectedAccounts().map((account) => [account.accountId, account.name]));

      const failures: BulkFailure[] = result.failed.map((row) => ({
        id: row.id,
        name: names.get(row.id) ?? row.id,
        reason: bulkFailureReason(row.reason),
      }));

      const report = bulkReport(
        { one: "administrator", many: "administrators" },
        { ok: "changed the role for", fail: "could not change the role for" },
        { succeeded: result.updated.length, failed: failures },
      );

      toast[report.tone](report.title, {
        description: report.description,
        details: report.details,
      });

      // Keep only the rows that still need attention selected.
      setSelectedAccountIds(new Set(failures.map((row) => row.id)));
    },
    onError: (_error, _variables, restore) => restore?.(),
    onSettled: () => void refreshAccess(),
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
    onMutate: async () => {
      const editing = roleEditing();

      // A create has no id until the server answers, so only an edit can be
      // written to the role list ahead of the response.
      if (!editing) return;

      return optimisticallyUpdateCollection(
        qc,
        enterpriseKeys.roles(params.tenantId),
        "roles",
        (rows: TenantRole[]) =>
          rows.map((row) =>
            row.id === editing.id
              ? {
                  ...row,
                  name: roleName().trim(),
                  description: roleDescription().trim() || null,
                  permissions: [...rolePermissions()],
                }
              : row,
          ),
      );
    },
    onSuccess: () => {
      setRoleError(null);
      setRoleFormOpen(false);
      setRoleEditing(null);
      setRoleBlocked(false);
      void invalidateRoleData();
    },
    onError: (error, _variables, restore) => {
      restore?.();
      setRoleError(errorMessage(error));
    },
  }));

  const [roleToDelete, setRoleToDelete] = createSignal<{ id: string; name: string } | null>(null);

  const removeRole = useMutation(() => ({
    meta: { inlineError: true },
    mutationFn: (roleId: string) => enterprise.deleteRole(params.tenantId, roleId),
    onMutate: async (roleId) =>
      optimisticallyRemoveCollectionItems(qc, enterpriseKeys.roles(params.tenantId), "roles", [
        roleId,
      ]),
    onSuccess: () => {
      setRoleToDelete(null);
      void invalidateRoleData();
    },
    onError: (error, _variables, restore) => {
      restore?.();
      setRoleError(errorMessage(error));
    },
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

  const accountCount = () => accounts.data?.accounts.length ?? 0;

  return (
    <div class="grid gap-5 xl:grid-cols-2">
      <QueryError
        class="xl:col-span-2"
        error={
          accounts.error ?? invitations.error ?? invitationOptions.error ?? ownershipTransfer.error
        }
        onRetry={() => {
          void accounts.refetch();
          void invitations.refetch();
          void invitationOptions.refetch();
          void ownershipTransfer.refetch();
        }}
      />

      <Show when={can("members.write")}>
        <Panel
          class="xl:col-span-2"
          title="Invite an administrator"
          description="Send a one-time invitation link. New administrators join with the role you choose."
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
          <Show when={can("scope_tags.write")}>
            <div class="mt-4 border-t border-border pt-4">
              <ScopeTagSelect
                tenantId={params.tenantId!}
                value={inviteTags()}
                onChange={setInviteTags}
                legend="Starting scope tags (optional)"
                hint="An unscoped administrator sees the whole tenant. Add at least one tag to start this invitee with a regional or team scope."
              />
            </div>
          </Show>
          <ErrorText error={invite.error} />

          <Show when={invitationOptions.data && !roleChoices().some((choice) => choice.assignable)}>
            <p role="status" class="mt-2 text-xs text-muted-foreground">
              Your role doesn't include the permissions needed to invite anyone. Ask a tenant owner
              to invite administrators or raise your role's ceiling.
            </p>
          </Show>

          <Show when={unavailableChoices().length > 0}>
            <details class="mt-3 text-xs leading-relaxed text-muted-foreground">
              <summary class="w-fit cursor-pointer rounded text-xs font-medium text-muted-foreground hover:text-foreground">
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
                <code class="mt-2 block break-all rounded-md border border-border bg-muted p-2 font-mono text-xs text-muted-foreground">
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
                  <span role="status" aria-live="polite" class="text-xs text-success">
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
          description="Create custom roles with a precise set of tenant permissions, then assign them to administrators. Built-in roles are fixed."
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
              class="mb-4 space-y-3 rounded-lg border border-border bg-surface p-3"
              onSubmit={(event) => {
                event.preventDefault();
                saveRole.mutate();
              }}
            >
              <div class="grid gap-2 sm:grid-cols-2">
                <label>
                  <span class="mb-1 block text-xs font-medium text-muted-foreground">Name</span>
                  <Input
                    value={roleName()}
                    onInput={(event) => setRoleName(event.currentTarget.value)}
                    placeholder="Helpdesk"
                  />
                </label>
                <label>
                  <span class="mb-1 block text-xs font-medium text-muted-foreground">
                    Description
                  </span>
                  <Input
                    value={roleDescription()}
                    onInput={(event) => setRoleDescription(event.currentTarget.value)}
                    placeholder="What this role is for"
                  />
                </label>
              </div>
              <p class="text-xs leading-relaxed text-muted-foreground">
                Only permissions your own role holds are shown. Your role is the ceiling: a custom
                role can never grant more than you already have.
              </p>
              <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <For each={visiblePermissionGroups()}>
                  {(group) => (
                    <div class="min-w-0">
                      <p class="mb-1 text-xs font-medium text-foreground">{group.label}</p>
                      <div class="space-y-1">
                        <For each={group.permissions}>
                          {(permission) => {
                            const ownerOnly = () => OWNER_ONLY_PERMISSIONS.has(permission.id);
                            const disabled = () => ownerOnly() && !isOwner();

                            return (
                              <label
                                class="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground"
                                title={
                                  disabled()
                                    ? "Only a tenant owner can grant owner-only permissions"
                                    : undefined
                                }
                              >
                                <Checkbox
                                  class="mt-0.5"
                                  checked={rolePermissions().has(permission.id)}
                                  disabled={disabled()}
                                  onCheckedChange={() => togglePermission(permission.id)}
                                />
                                <span>
                                  {permission.label}
                                  <Show when={ownerOnly()}>
                                    <span class="ml-1 text-xs text-muted-foreground">
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
                <div class="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div class="min-w-0">
                    <p class="text-xs font-medium text-foreground">
                      {item.name}
                      <Show when={item.builtIn}>
                        <span class="ml-2 rounded-full border border-border px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                          Built-in
                        </span>
                      </Show>
                    </p>
                    <p class="mt-0.5 text-xs text-muted-foreground">
                      {item.memberCount} administrator{item.memberCount === 1 ? "" : "s"} ·{" "}
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
                            ? "Reassign administrators before deleting this role"
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
        title="Current administrators"
        description="Everyone with access to this tenant."
        actions={
          <span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <UsersRound class="size-3.5" />
            {accountCount()} {accountCount() === 1 ? "administrator" : "administrators"}
          </span>
        }
        flush
      >
        <Show
          when={accountCount() > 0}
          fallback={
            <p class="px-4 py-6 text-xs text-muted-foreground sm:px-5">
              No administrators yet.
            </p>
          }
        >
          <Show when={can("members.write") && selectableAccounts().length > 0}>
            <div class="flex items-center gap-2 border-b border-border px-4 py-2 sm:px-5">
              <Checkbox
                id="select-all-administrators"
                checked={
                  allSelectableSelected()
                    ? true
                    : someSelectableSelected()
                      ? "indeterminate"
                      : false
                }
                onCheckedChange={(checked) => toggleAllAccounts(checked === true)}
                aria-label="Select all administrators whose role you can change"
              />
              <label
                for="select-all-administrators"
                class="cursor-pointer text-xs text-muted-foreground"
              >
                Select all changeable administrators
              </label>
            </div>
          </Show>
          <ul class="divide-y divide-border">
            <For each={accounts.data?.accounts ?? []}>
              {(account) => {
                const isSelf = () => account.accountId === session().data?.user?.id;

                const targetIsOwner = () =>
                  !account.roleId &&
                  account.role
                    .split(",")
                    .map((value) => value.trim())
                    .includes("owner");

                const ownerLocked = () => targetIsOwner() && !isOwner();

                const selectionTitle = () =>
                  isSelf()
                    ? "You can't change your own role here"
                    : ownerLocked()
                      ? "Only a tenant owner can change the owner role"
                      : undefined;

                return (
                  <li
                    class={cn(
                      "flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5",
                      selectedAccountIds().has(account.accountId) && "bg-surface",
                    )}
                  >
                    <Show when={can("members.write")}>
                      <Checkbox
                        checked={selectedAccountIds().has(account.accountId)}
                        onCheckedChange={(checked) =>
                          toggleAccount(account.accountId, checked === true)
                        }
                        disabled={!canChangeAccountRole(account)}
                        title={selectionTitle()}
                        aria-label={`Select ${account.name} (${account.email})`}
                      />
                    </Show>
                    <EntityHoverCard
                      preview={{ kind: "user", account }}
                      class="flex min-w-0 items-center gap-3"
                    >
                      <span
                        class="flex size-7 shrink-0 items-center justify-center rounded-full bg-hover text-xs font-semibold text-foreground ring-1 ring-inset ring-border"
                        aria-hidden="true"
                      >
                        {initials(account.name)}
                      </span>
                      <div class="min-w-0">
                        <strong class="block truncate text-xs font-medium text-foreground">
                          {account.name}
                        </strong>
                        <span class="block truncate text-xs text-muted-foreground">
                          {account.email}
                        </span>
                        <span class="mt-0.5 block truncate text-xs text-muted-foreground">
                          {account.roleName ?? account.role}
                        </span>
                      </div>
                    </EntityHoverCard>
                    <div class="flex shrink-0 flex-wrap items-center gap-2">
                      <div class="flex flex-col items-end gap-1">
                        <ScopeTagBadges
                          tenantId={params.tenantId!}
                          tagIds={account.scopeTagIds ?? []}
                        />
                        <Show
                          when={
                            can("members.write") &&
                            can("scope_tags.write") &&
                            !isBuiltInOwnerUser(account)
                          }
                        >
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            class="min-h-8"
                            onClick={() => {
                              setTagSelection([...(account.scopeTagIds ?? [])]);
                              setTagTarget(account);
                            }}
                          >
                            Scope tags
                          </Button>
                        </Show>
                      </div>
                      <Show
                        when={!isSelf() && can("members.write")}
                        fallback={
                          <Chip tone="neutral">
                            {isSelf() ? "You" : (account.roleName ?? account.role)}
                          </Chip>
                        }
                      >
                        <select
                          class={selectClass}
                          value={roleValue(account)}
                          onChange={(event) =>
                            changeRole.mutate({
                              accountId: account.accountId,
                              role: event.currentTarget.value,
                            })
                          }
                          disabled={changeRole.isPending || ownerLocked()}
                          aria-label={`Role for ${account.name} (${account.email})`}
                          title={
                            ownerLocked()
                              ? "Only a tenant owner can change the owner role"
                              : undefined
                          }
                        >
                          <For each={accountRoleChoices()}>
                            {(option) => (
                              <option
                                value={option.value}
                                disabled={!option.assignable}
                                selected={option.value === roleValue(account)}
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
                          aria-label={`Remove ${account.name} (${account.email})`}
                          onClick={() => removeAccount.mutate(account.accountId)}
                          disabled={removeAccount.isPending || ownerLocked()}
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
        <Show when={selectedAccounts().length > 0}>
          <div
            role="group"
            aria-label="Bulk administrator actions"
            class="fixed bottom-5 inset-x-4 z-40 mx-auto flex max-w-full flex-wrap items-center justify-center gap-3 rounded-xl border border-border bg-card px-3.5 py-2 shadow-popover"
          >
            <span class="flex items-center gap-2 text-xs font-medium tabular-nums">
              <span class="size-1.5 rounded-full bg-primary" aria-hidden="true" />
              {selectedAccounts().length} selected
            </span>
            <span class="h-4 w-px bg-border" aria-hidden="true" />
            <select
              class={selectClass}
              value={bulkRole()}
              onChange={(event) => setBulkRole(event.currentTarget.value)}
              aria-label="Role for selected administrators"
              disabled={changeRoles.isPending || roleChoices().length === 0}
            >
              <For each={accountRoleChoices()}>
                {(option) => (
                  <option
                    value={option.value}
                    disabled={!option.assignable}
                    selected={option.value === bulkRole()}
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
              onClick={() => changeRoles.mutate()}
              disabled={
                changeRoles.isPending ||
                selectedAccounts().length === 0 ||
                !roleChoices().find((option) => option.value === bulkRole())?.assignable
              }
            >
              {changeRoles.isPending ? "Changing…" : "Change role"}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setSelectedAccountIds(new Set<string>())}
              disabled={changeRoles.isPending}
            >
              Clear
            </Button>
          </div>
        </Show>
        <div class="px-4 pb-4 sm:px-5">
          <ErrorText error={removeAccount.error || changeRole.error || changeRoles.error} />
        </div>
      </Panel>

      <Show when={isOwner() || Boolean(ownershipTransfer.data?.transfer)}>
        <Panel
          title="Ownership transfer"
          description="Hand tenant ownership to another administrator. Ownership only moves when they accept the emailed link."
          class="xl:col-span-2"
        >
          <Show when={transferResult()}>
            {(result) => (
              <div class="mb-4 rounded-lg border border-success/25 bg-success/[0.06] p-3 text-sm">
                <p role="status" aria-live="polite" class="font-medium text-foreground">
                  {result().emailSent
                    ? "Transfer email sent"
                    : "Email could not be sent — share this link"}
                </p>
                <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Sent to <span class="font-medium text-foreground">{result().targetEmail}</span>.
                  Ownership moves only when they accept. Expires{" "}
                  <time datetime={result().expiresAt}>{formatDate(result().expiresAt)}</time>.
                </p>
                <code class="mt-2 block break-all rounded-md border border-border bg-muted p-2 font-mono text-xs text-muted-foreground">
                  {result().acceptUrl}
                </code>
                <div class="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    class="min-h-11 sm:min-h-0"
                    variant="outline"
                    aria-label={`Copy ownership transfer link for ${result().targetEmail}`}
                    onClick={() => void copyLink(result().acceptUrl, "transfer")}
                  >
                    Copy link
                  </Button>
                  <span role="status" aria-live="polite" class="text-xs text-success">
                    {copied() === "transfer" ? "Link copied to clipboard." : ""}
                  </span>
                </div>
              </div>
            )}
          </Show>

          <Show
            when={ownershipTransfer.data?.transfer}
            fallback={
              <Show when={isOwner()}>
                <Show
                  when={transferCandidates().length > 0}
                  fallback={
                    <p class="text-xs text-muted-foreground">
                      Invite another administrator before transferring ownership. Owners cannot take
                      over from each other.
                    </p>
                  }
                >
                  <form
                    class="flex flex-col gap-2 sm:flex-row sm:items-center"
                    onSubmit={(event) => {
                      event.preventDefault();

                      if (transferCandidates().length === 0) return;

                      setTransferConfirm(true);
                    }}
                  >
                    <select
                      class={cn(selectClass, "min-w-0 flex-1 sm:w-auto")}
                      value={transferTarget()}
                      onChange={(event) => setTransferTarget(event.currentTarget.value)}
                      aria-label="Administrator to take over ownership"
                      disabled={
                        requestOwnershipTransfer.isPending ||
                        accounts.isPending ||
                        ownershipTransfer.isPending
                      }
                    >
                      <For each={transferCandidates()}>
                        {(candidate) => (
                          <option value={candidate.accountId}>
                            {candidate.name} ({candidate.email})
                          </option>
                        )}
                      </For>
                    </select>
                    <Button
                      type="submit"
                      class="min-h-11 shrink-0"
                      disabled={
                        requestOwnershipTransfer.isPending ||
                        ownershipTransfer.isPending ||
                        !transferTarget()
                      }
                    >
                      {requestOwnershipTransfer.isPending ? "Requesting…" : "Request transfer"}
                    </Button>
                  </form>
                  <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
                    The new owner must accept the email link. You stay an owner until then, and
                    become an administrator when ownership moves.
                  </p>
                  <ErrorText error={requestOwnershipTransfer.error} />
                </Show>
              </Show>
            }
          >
            {(transfer) => {
              const canCancel = () =>
                isOwner() ||
                transfer().target.id === session().data?.user?.id ||
                transfer().requestedBy.id === session().data?.user?.id;

              return (
                <div class="rounded-lg border border-warning/25 bg-warning/[0.06] p-3">
                  <div class="flex flex-wrap items-center gap-2">
                    <Chip tone="warning">Pending</Chip>
                    <span class="text-xs text-foreground">
                      Ownership is waiting for acceptance.
                    </span>
                  </div>
                  <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                    <dt class="text-muted-foreground">Requested by</dt>
                    <dd class="min-w-0 truncate font-medium text-foreground">
                      {transfer().requestedBy.name} ({transfer().requestedBy.email})
                    </dd>
                    <dt class="text-muted-foreground">New owner</dt>
                    <dd class="min-w-0 truncate font-medium text-foreground">
                      {transfer().target.name} ({transfer().target.email})
                    </dd>
                    <dt class="text-muted-foreground">Expires</dt>
                    <dd class="text-foreground">
                      <time datetime={transfer().expiresAt}>
                        {relativeExpiry(transfer().expiresAt)}
                      </time>
                    </dd>
                  </dl>
                  <Show when={canCancel()}>
                    <Button
                      class="mt-3 min-h-11 sm:min-h-0"
                      size="sm"
                      variant="destructive"
                      disabled={cancelOwnershipTransfer.isPending}
                      onClick={() => setTransferToCancel(true)}
                    >
                      Cancel transfer
                    </Button>
                  </Show>
                  <ErrorText error={cancelOwnershipTransfer.error} />
                </div>
              );
            }}
          </Show>
        </Panel>
      </Show>

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
              <code class="mt-2 block break-all rounded-md border border-border bg-muted p-2 font-mono text-xs text-muted-foreground">
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
                <span role="status" aria-live="polite" class="text-success">
                  {copied() === "resend" ? "Link copied to clipboard." : ""}
                </span>
              </div>
            </div>
          )}
        </Show>

        <div class="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 sm:px-5">
          <FilterBar
            fields={invitationFilterFields}
            conditions={
              filter() === "all"
                ? []
                : [{ field: "invitationStatus", operator: "is", values: [filter()] }]
            }
            onChange={(next) => {
              const value = next[0]?.values[0];

              setFilter(
                value === "active" || value === "accepted" || value === "canceled" ? value : "all",
              );
            }}
            label="Filter"
          />
        </div>

        <Show
          when={filteredInvitations().length > 0}
          fallback={
            <p class="px-4 py-6 text-xs text-muted-foreground sm:px-5">
              {filter() === "active"
                ? "No pending invitations."
                : "No invitations match this filter."}
            </p>
          }
        >
          <ul class="divide-y divide-border">
            <For each={filteredInvitations()}>
              {(item) => {
                const status = () => effectiveStatus(item);

                const canResend = () =>
                  !isOptimisticRow(item.id) &&
                  can("members.write") &&
                  (status() === "pending" || status() === "expired" || status() === "superseded");

                const canCancel = () =>
                  !isOptimisticRow(item.id) &&
                  can("members.write") &&
                  (status() === "pending" || status() === "expired");

                return (
                  <li class="flex flex-col gap-3 px-4 py-3 sm:px-5">
                    <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div class="min-w-0">
                        <p class="break-all text-xs font-medium text-foreground">
                          {item.email}
                        </p>
                        <p class="mt-0.5 text-xs text-muted-foreground">
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
                        <p class="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
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
                        class="text-xs text-success"
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
          <DialogHeader>
            <DialogTitle>Resend invitation?</DialogTitle>
            <DialogDescription>
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
          <DialogHeader>
            <DialogTitle>Cancel invitation?</DialogTitle>
            <DialogDescription>
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
        open={transferConfirm()}
        onOpenChange={setTransferConfirm}
        title="Transfer tenant ownership?"
        description="The new owner must accept the email link. Until they do, you stay an owner. After acceptance you become an administrator and lose owner-only actions such as deleting or exporting the tenant."
        confirmLabel="Send transfer request"
        pending={requestOwnershipTransfer.isPending}
        onConfirm={() => requestOwnershipTransfer.mutate()}
      />

      <ConfirmDialog
        open={transferToCancel()}
        onOpenChange={setTransferToCancel}
        title="Cancel ownership transfer?"
        description="The emailed link stops working and ownership stays with the current owner. You can request a new transfer later."
        confirmLabel="Cancel transfer"
        destructive
        pending={cancelOwnershipTransfer.isPending}
        onConfirm={() => cancelOwnershipTransfer.mutate()}
      />

      <Dialog
        open={tagTarget() !== null}
        onOpenChange={(open) => {
          if (!open) setTagTarget(null);
        }}
      >
        <DialogContent class="max-w-lg">
          <DialogHeader>
            <DialogTitle>Scope tags</DialogTitle>
            <DialogDescription>
              Choose the tagged resources{" "}
              <span class="font-medium text-foreground">
                {tagTarget()?.name ?? "this administrator"}
              </span>{" "}
              can reach. With no tags they see the whole tenant; with tags they see only resources
              carrying one of them.
            </DialogDescription>
          </DialogHeader>
          <div class="mt-4">
            <ScopeTagSelect
              tenantId={params.tenantId!}
              value={tagSelection()}
              onChange={setTagSelection}
            />
          </div>
          <ErrorText error={saveScopeTags.error} />
          <DialogFooter class="mt-4">
            <Button
              variant="outline"
              class="min-h-11 sm:min-h-0"
              onClick={() => setTagTarget(null)}
            >
              Cancel
            </Button>
            <Button
              class="min-h-11 sm:min-h-0"
              disabled={saveScopeTags.isPending}
              onClick={() => saveScopeTags.mutate()}
            >
              {saveScopeTags.isPending ? "Saving…" : "Save scope tags"}
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
        description="Administrators assigned to this role lose the permissions it grants. This cannot be undone."
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

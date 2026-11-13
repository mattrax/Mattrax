import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { ErrorText, Panel, QueryError } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { UsersRound } from "~/components/ui/icons";
import { authClient } from "~/lib/auth";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { cn } from "~/lib/utils";

const roleOptions = [
  { value: "member", label: "Member" },
  { value: "auditor", label: "Auditor (read-only)" },
  { value: "admin", label: "Administrator" },
  { value: "owner", label: "Owner" },
];

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
  const [email, setEmail] = createSignal("");
  const [role, setRole] = createSignal("member");
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
      enterprise.patchUser(params.tenantId, memberId, role),
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
            <For each={roleOptions}>
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
        title="Administrators"
        description="Everyone with access to this workspace."
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
                        value={user.role}
                        onChange={(e) =>
                          changeRole.mutate({
                            memberId: user.memberId,
                            role: e.currentTarget.value,
                          })
                        }
                        disabled={changeRole.isPending}
                        aria-label={`Role for ${user.name}`}
                      >
                        <For each={roleOptions}>
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

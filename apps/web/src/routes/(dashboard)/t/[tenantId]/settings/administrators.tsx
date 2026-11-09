import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import { ErrorText } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { authClient } from "~/lib/auth";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";

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

  return (
    <div class="grid gap-6 xl:grid-cols-2">
      <Card class="xl:col-span-2">
        <CardHeader>
          <CardTitle>Invite an administrator</CardTitle>
        </CardHeader>
        <CardContent>
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
            />
            <select
              class="h-9 rounded-lg border bg-white px-3 text-sm"
              value={role()}
              onChange={(e) => setRole(e.currentTarget.value)}
            >
              <option value="member">Member</option>
              <option value="admin">Administrator</option>
              <option value="owner">Owner</option>
            </select>
            <Button disabled={invite.isPending}>Send invitation</Button>
          </form>
          <ErrorText error={invite.error} />
          <Show when={inviteUrl()}>
            <div class="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
              <p class="font-medium">Share this invitation link with the new administrator</p>
              <code class="mt-2 block break-all rounded bg-white p-2 text-xs">{inviteUrl()}</code>
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
          <p class="mt-3 text-xs text-muted-foreground">
            Invitations expire after 7 days. The recipient must sign in with the invited email
            address. Administrators can manage devices and policies; owners can also manage billing
            and the team.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Administrators</CardTitle>
        </CardHeader>
        <CardContent class="space-y-2">
          <For each={users.data?.users ?? []}>
            {(user) => (
              <div class="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                <span class="min-w-0">
                  <strong class="block truncate">{user.name}</strong>
                  <span class="block truncate text-muted-foreground">{user.email}</span>
                </span>
                <span class="flex shrink-0 items-center gap-2">
                  <Show
                    when={user.userId !== session().data?.user?.id}
                    fallback={<Badge variant="secondary">You</Badge>}
                  >
                    <select
                      class="h-8 rounded-md border bg-white px-2 text-xs capitalize"
                      value={user.role}
                      onChange={(e) =>
                        changeRole.mutate({ memberId: user.memberId, role: e.currentTarget.value })
                      }
                      disabled={changeRole.isPending}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Administrator</option>
                      <option value="owner">Owner</option>
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
                </span>
              </div>
            )}
          </For>
          <ErrorText error={removeUser.error || changeRole.error} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pending invitations</CardTitle>
        </CardHeader>
        <CardContent class="space-y-2">
          <Show
            when={(invitations.data?.invitations.length ?? 0) > 0}
            fallback={<p class="text-sm text-muted-foreground">No pending invitations.</p>}
          >
            <For each={invitations.data?.invitations ?? []}>
              {(item) => (
                <div class="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  <span class="min-w-0 truncate">{item.email}</span>
                  <span class="flex shrink-0 items-center gap-2">
                    <Badge variant="secondary">{item.status}</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => cancelInvitation.mutate(item.id)}
                      disabled={cancelInvitation.isPending}
                    >
                      Cancel
                    </Button>
                  </span>
                </div>
              )}
            </For>
          </Show>
          <ErrorText error={cancelInvitation.error} />
        </CardContent>
      </Card>
    </div>
  );
}

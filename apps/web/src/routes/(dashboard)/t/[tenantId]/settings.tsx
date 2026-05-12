import { useNavigate, useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show } from "solid-js";
import { ErrorText, Field, PageHeader } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { authClient } from "~/lib/auth";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";

export default function TenantSettingsPage() {
  const params = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = authClient.useSession();
  const tenant = useQuery(() => ({ queryKey: enterpriseKeys.tenant(params.tenantId), queryFn: () => enterprise.getTenant(params.tenantId) }));
  const users = useQuery(() => ({ queryKey: enterpriseKeys.users(params.tenantId), queryFn: () => enterprise.listUsers(params.tenantId) }));
  const invitations = useQuery(() => ({ queryKey: enterpriseKeys.invitations(params.tenantId), queryFn: () => enterprise.listInvitations(params.tenantId) }));
  const apns = useQuery(() => ({ queryKey: enterpriseKeys.apns(params.tenantId), queryFn: () => enterprise.getApns(params.tenantId) }));
  const billing = useQuery(() => ({ queryKey: enterpriseKeys.billing(params.tenantId), queryFn: () => enterprise.billing(params.tenantId) }));
  const [name, setName] = createSignal("");
  const [slug, setSlug] = createSignal("");
  const [inviteEmail, setInviteEmail] = createSignal("");
  const [apnsEmail, setApnsEmail] = createSignal("");
  const [cert, setCert] = createSignal("");

  createEffect(() => {
    if (tenant.data) {
      setName(tenant.data.name);
      setSlug(tenant.data.slug);
    }
  });

  const save = useMutation(() => ({
    mutationFn: () => enterprise.patchTenant(params.tenantId, { name: name(), slug: slug() }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.tenant(params.tenantId) });
      await qc.invalidateQueries({ queryKey: enterpriseKeys.me() });
    },
  }));
  const del = useMutation(() => ({
    mutationFn: () => enterprise.deleteTenant(params.tenantId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.me() });
      navigate("/dashboard");
    },
  }));
  const invite = useMutation(() => ({
    mutationFn: () => enterprise.inviteUser(params.tenantId, { email: inviteEmail(), role: "member" }),
    onSuccess: async () => {
      setInviteEmail("");
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
  const cancelInvitation = useMutation(() => ({
    mutationFn: (invitationId: string) => enterprise.cancelInvitation(params.tenantId, invitationId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.invitations(params.tenantId) });
    },
  }));
  const uploadApns = useMutation(() => ({
    mutationFn: () => enterprise.uploadApns(params.tenantId, { email: apnsEmail(), cert: cert() }),
    onSuccess: async () => {
      setCert("");
      await qc.invalidateQueries({ queryKey: enterpriseKeys.apns(params.tenantId) });
    },
  }));
  const portal = useMutation(() => ({
    mutationFn: () => enterprise.billingPortal(params.tenantId, globalThis.location.href),
    onSuccess: ({ url }) => {
      globalThis.location.href = url;
    },
  }));

  return (
    <div class="flex flex-1 flex-col gap-6 p-6">
      <PageHeader title="Tenant settings" description="Manage this Better Auth organization-backed tenant." />
      <div class="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <form class="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
              <Field label="Name">
                <Input value={name()} onInput={(e) => setName(e.currentTarget.value)} />
              </Field>
              <Field label="Slug">
                <Input value={slug()} onInput={(e) => setSlug(e.currentTarget.value)} />
              </Field>
              <ErrorText error={save.error || del.error} />
              <div class="flex gap-2">
                <Button type="submit" disabled={save.isPending}>Save tenant</Button>
                <Button type="button" variant="destructive" onClick={() => del.mutate()} disabled={del.isPending}>Delete tenant</Button>
              </div>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Billing</CardTitle>
          </CardHeader>
          <CardContent class="space-y-3 text-sm">
            <p>Billable devices: <strong>{billing.data?.billableDevices ?? 0}</strong></p>
            <p>Status: <Badge variant="outline">{billing.data?.status ?? "unknown"}</Badge></p>
            <Button variant="outline" onClick={() => portal.mutate()} disabled={portal.isPending}>Open billing portal</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
          </CardHeader>
          <CardContent class="space-y-4">
            <form class="flex gap-2" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
              <Input type="email" placeholder="teammate@example.com" value={inviteEmail()} onInput={(e) => setInviteEmail(e.currentTarget.value)} />
              <Button disabled={invite.isPending}>Invite</Button>
            </form>
            <ErrorText error={invite.error || removeUser.error || cancelInvitation.error} />
            <ul class="space-y-2">
              <For each={users.data?.users ?? []}>{(user) => (
                <li class="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  <span class="min-w-0">
                    <strong>{user.name}</strong>
                    <br />
                    <span class="text-muted-foreground">{user.email}</span>
                  </span>
                  <span class="flex items-center gap-2">
                    <Badge variant="outline">{user.role}</Badge>
                    <Show when={user.userId !== session().data?.user.id} fallback={<Badge variant="secondary">You</Badge>}>
                      <Button type="button" size="sm" variant="destructive" onClick={() => removeUser.mutate(user.memberId)} disabled={removeUser.isPending}>
                        Delete
                      </Button>
                    </Show>
                  </span>
                </li>
              )}</For>
            </ul>
            <ul class="space-y-2">
              <For each={invitations.data?.invitations ?? []}>{(item) => (
                <li class="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  <span class="min-w-0">{item.email}</span>
                  <span class="flex items-center gap-2">
                    <Badge variant="secondary">{item.status}</Badge>
                    <Button type="button" size="sm" variant="destructive" onClick={() => cancelInvitation.mutate(item.id)} disabled={cancelInvitation.isPending}>
                      Delete
                    </Button>
                  </span>
                </li>
              )}</For>
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Apple Push Certificate</CardTitle>
          </CardHeader>
          <CardContent>
            <p class="mb-4 text-sm text-muted-foreground">
              Current status: <Badge variant={apns.data?.configured ? "default" : "secondary"}>{apns.data?.configured ? "Configured" : "Not configured"}</Badge>
            </p>
            <form class="space-y-4" onSubmit={(e) => { e.preventDefault(); uploadApns.mutate(); }}>
              <Field label="Apple ID email">
                <Input type="email" value={apnsEmail()} onInput={(e) => setApnsEmail(e.currentTarget.value)} />
              </Field>
              <Field label="Certificate PEM">
                <textarea class="min-h-32 rounded-lg border bg-white px-3 py-2 font-mono text-xs" value={cert()} onInput={(e) => setCert(e.currentTarget.value)} />
              </Field>
              <ErrorText error={uploadApns.error} />
              <Button disabled={uploadApns.isPending}>Upload certificate</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

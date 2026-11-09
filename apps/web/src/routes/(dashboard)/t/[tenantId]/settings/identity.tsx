import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createSignal, For, Show } from "solid-js";
import { ErrorText } from "~/components/mdm/common";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { ShieldCheck } from "~/components/ui/icons";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";

export default function IdentitySettingsPage() {
  const params = useParams();
  const qc = useQueryClient();
  const tokens = useQuery(() => ({
    queryKey: enterpriseKeys.scim(params.tenantId),
    queryFn: () => enterprise.listScimTokens(params.tenantId),
  }));
  const [name, setName] = createSignal("Identity provider");
  const [created, setCreated] = createSignal<{ token: string; baseUrl: string } | null>(null);
  const create = useMutation(() => ({
    mutationFn: () => enterprise.createScimToken(params.tenantId, { name: name() }),
    onSuccess: async (result) => {
      setCreated({ token: result.token, baseUrl: result.baseUrl });
      await qc.invalidateQueries({ queryKey: enterpriseKeys.scim(params.tenantId) });
    },
  }));
  const revoke = useMutation(() => ({
    mutationFn: (tokenId: string) => enterprise.revokeScimToken(params.tenantId, tokenId),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.scim(params.tenantId) });
    },
  }));
  const baseUrl = () => `${globalThis.location?.origin ?? ""}/scim/v2/${params.tenantId}`;

  return (
    <div class="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>SCIM provisioning</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <p class="text-sm text-muted-foreground">
            Connect an identity provider's SCIM client to create, update and deactivate tenant users
            and groups automatically.
          </p>
          <div class="rounded-lg border bg-stone-50 p-3 text-sm">
            <p class="font-medium">SCIM base URL</p>
            <code class="mt-1 block break-all text-xs">{baseUrl()}</code>
            <p class="mt-2 text-xs text-muted-foreground">
              Use a bearer token below. Supported resources: Users and Groups.
            </p>
          </div>
          <form
            class="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <Input
              required
              placeholder="Token name"
              value={name()}
              onInput={(event) => setName(event.currentTarget.value)}
            />
            <Button disabled={create.isPending}>Create token</Button>
          </form>
          <ErrorText error={create.error} />
          <Show when={created()}>
            {(value) => (
              <div class="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
                <p class="font-medium">Copy this token now. It will not be shown again.</p>
                <code class="mt-2 block break-all rounded bg-white p-2 text-xs">
                  {value().token}
                </code>
                <Button
                  size="sm"
                  class="mt-2"
                  variant="outline"
                  onClick={() => navigator.clipboard.writeText(value().token)}
                >
                  Copy token
                </Button>
              </div>
            )}
          </Show>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SCIM tokens</CardTitle>
        </CardHeader>
        <CardContent class="space-y-2">
          <Show
            when={(tokens.data?.tokens.length ?? 0) > 0}
            fallback={<p class="text-sm text-muted-foreground">No SCIM tokens yet.</p>}
          >
            <For each={tokens.data?.tokens ?? []}>
              {(token) => (
                <div class="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  <span class="min-w-0">
                    <strong class="block truncate">{token.name}</strong>
                    <span class="block text-xs text-muted-foreground">
                      Created {new Date(token.createdAt).toLocaleDateString()}
                      {token.lastUsedAt
                        ? ` · Last used ${new Date(token.lastUsedAt).toLocaleDateString()}`
                        : ""}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(token.id)}
                  >
                    Revoke
                  </Button>
                </div>
              )}
            </For>
          </Show>
          <ErrorText error={tokens.error || revoke.error} />
        </CardContent>
      </Card>

      <Card class="xl:col-span-2">
        <CardHeader>
          <CardTitle>Single sign-on</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="flex items-start gap-3">
            <span class="rounded-lg bg-stone-100 p-2 text-stone-600">
              <ShieldCheck class="size-5" />
            </span>
            <div>
              <p class="flex items-center gap-2 text-sm font-medium">
                SAML and OpenID Connect
                <Badge variant="secondary">Coming soon</Badge>
              </p>
              <p class="mt-1 text-sm text-muted-foreground">
                SSO login is not wired to tenant-level identity providers yet. SCIM provisioning
                works independently and can be enabled today.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

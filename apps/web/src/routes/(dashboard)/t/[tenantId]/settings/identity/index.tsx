import { useParams } from "@solidjs/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show } from "solid-js";
import { ErrorText, Panel, QueryError } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { ShieldCheck } from "~/components/ui/icons";
import { Input } from "~/components/ui/input";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { errorMessage } from "~/lib/errors";

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

  const sso = useQuery(() => ({
    queryKey: enterpriseKeys.sso(params.tenantId),
    queryFn: () => enterprise.getSsoConfig(params.tenantId),
  }));
  const [azureTenantId, setAzureTenantId] = createSignal("");
  const [ssoEnabled, setSsoEnabled] = createSignal(false);
  const [autoProvision, setAutoProvision] = createSignal(true);
  const [requireMfa, setRequireMfa] = createSignal(false);
  let ssoSeeded = false;
  createEffect(
    () => sso.data,
    (config) => {
      if (!config || ssoSeeded) return;
      ssoSeeded = true;
      setAzureTenantId(config.azureTenantId ?? "");
      setSsoEnabled(config.enabled);
      setAutoProvision(config.autoProvision);
      setRequireMfa(config.requireMfa);
    },
  );
  const saveSso = useMutation(() => ({
    mutationFn: () =>
      enterprise.patchSsoConfig(params.tenantId, {
        enabled: ssoEnabled(),
        azureTenantId: azureTenantId().trim() || null,
        autoProvision: autoProvision(),
        requireMfa: requireMfa(),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: enterpriseKeys.sso(params.tenantId) });
    },
  }));
  const [ssoError, setSsoError] = createSignal<string | null>(null);
  const startSso = async () => {
    setSsoError(null);
    try {
      const response = await fetch(
        `/api/v1/sso/azure/start?tenantId=${encodeURIComponent(params.tenantId ?? "")}`,
      );
      const body = (await response.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };
      if (body.url) {
        window.location.href = body.url;
        return;
      }
      setSsoError(errorMessage(body, "Single sign-on is not available for this tenant."));
    } catch (error) {
      setSsoError(errorMessage(error));
    }
  };

  return (
    <div class="grid gap-5 xl:grid-cols-2">
      <QueryError class="xl:col-span-2" error={tokens.error ?? sso.error} />

      <Panel
        title="SCIM provisioning"
        description="Connect an identity provider's SCIM client to create, update and deactivate tenant users and groups automatically."
      >
        <div class="rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
          <p class="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            SCIM base URL
          </p>
          <code class="mt-1.5 block break-all font-mono text-xs text-foreground">{baseUrl()}</code>
          <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
            Use a bearer token below. Supported resources: Users and Groups.
          </p>
        </div>

        <form
          class="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <Input
            required
            aria-label="SCIM token name"
            placeholder="Token name"
            value={name()}
            onInput={(event) => setName(event.currentTarget.value)}
            class="min-w-0 flex-1"
          />
          <Button type="submit" class="shrink-0" disabled={create.isPending}>
            Create token
          </Button>
        </form>
        <ErrorText error={create.error} />

        <Show when={created()}>
          {(value) => (
            <div class="mt-4 rounded-lg border border-success/25 bg-success/[0.06] p-3 text-sm">
              <p class="font-medium text-foreground">
                Copy this token now. It will not be shown again.
              </p>
              <code class="mt-2 block break-all rounded-md border border-white/[0.07] bg-black/25 p-2 font-mono text-xs text-muted-foreground">
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
      </Panel>

      <Panel
        title="SCIM tokens"
        description="Tokens used by your identity provider to call the SCIM API."
        flush
      >
        <Show
          when={(tokens.data?.tokens.length ?? 0) > 0}
          fallback={
            <p class="px-4 py-6 text-[13px] text-muted-foreground sm:px-5">No SCIM tokens yet.</p>
          }
        >
          <ul class="divide-y divide-white/[0.05]">
            <For each={tokens.data?.tokens ?? []}>
              {(token) => (
                <li class="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <span class="min-w-0">
                    <strong class="block truncate text-[13px] font-medium text-foreground">
                      {token.name}
                    </strong>
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
                    class="shrink-0 self-start sm:self-auto"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(token.id)}
                  >
                    Revoke
                  </Button>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <div class="px-4 pb-4 sm:px-5">
          <ErrorText error={tokens.error || revoke.error} />
        </div>
      </Panel>

      <Panel
        class="xl:col-span-2"
        title="Single sign-on"
        description="Let members sign in with your Microsoft Entra tenant."
      >
        <div class="flex items-start gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3">
          <span class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.04] text-muted-foreground">
            <ShieldCheck class="size-4" />
          </span>
          <div class="min-w-0">
            <p class="text-[13px] font-medium text-foreground">Microsoft Entra ID</p>
            <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Let members sign in with your Entra tenant. SCIM provisioning above can keep the
              member list in sync.
            </p>
          </div>
        </div>

        <form
          class="mt-4 divide-y divide-white/[0.05]"
          onSubmit={(event) => {
            event.preventDefault();
            saveSso.mutate();
          }}
        >
          <ToggleSetting
            title="Enable single sign-on"
            description="Shows an Entra sign-in option for this tenant."
            checked={ssoEnabled()}
            onChange={setSsoEnabled}
          />
          <label class="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-8">
            <span class="min-w-0">
              <span class="block text-[13px] font-medium leading-snug text-foreground">
                Microsoft Entra tenant ID
              </span>
              <span class="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                The directory (tenant) ID from Entra ID.
              </span>
            </span>
            <span class="w-full min-w-0 sm:w-[19rem] sm:shrink-0">
              <Input
                placeholder="00000000-0000-0000-0000-000000000000"
                value={azureTenantId()}
                onInput={(event) => setAzureTenantId(event.currentTarget.value)}
              />
            </span>
          </label>
          <ToggleSetting
            title="Create members on first sign-in"
            description="Users with an account in this Entra tenant join as members."
            checked={autoProvision()}
            onChange={setAutoProvision}
          />
          <ToggleSetting
            title="Require MFA for owners and admins"
            description="Owners and admins must enroll an authenticator app before they can access this tenant. Members can still view it."
            checked={requireMfa()}
            onChange={setRequireMfa}
          />

          <div class="flex flex-wrap gap-2 pt-4">
            <Button type="submit" disabled={saveSso.isPending}>
              Save SSO settings
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!sso.data?.enabled || !sso.data?.azureTenantId}
              onClick={startSso}
            >
              Test sign-in
            </Button>
          </div>
          <Show when={ssoError()}>
            {(message) => (
              <p role="alert" class="pt-3 text-[13px] text-destructive">
                {message()}
              </p>
            )}
          </Show>
          <div class="pt-3">
            <ErrorText error={saveSso.error || sso.error} />
          </div>
        </form>
      </Panel>
    </div>
  );
}

function ToggleSetting(props: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label class="flex cursor-pointer items-start justify-between gap-4 py-3.5">
      <span class="min-w-0">
        <span class="block text-[13px] font-medium leading-snug text-foreground">
          {props.title}
        </span>
        <Show when={props.description}>
          <span class="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {props.description}
          </span>
        </Show>
      </span>
      <span class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center">
        <input
          type="checkbox"
          class="peer absolute inset-0 z-10 size-full cursor-pointer opacity-0"
          checked={props.checked}
          onChange={(event) => props.onChange(event.currentTarget.checked)}
        />
        <span
          aria-hidden="true"
          class="h-5 w-9 rounded-full border border-white/[0.12] bg-white/[0.08] transition-colors duration-150 peer-checked:border-brand peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-ring/60 peer-disabled:opacity-50"
        />
        <span
          aria-hidden="true"
          class="pointer-events-none absolute left-0.5 top-0.5 size-3.5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,.4)] transition-transform duration-150 peer-checked:translate-x-[1.125rem] peer-disabled:opacity-50"
        />
      </span>
    </label>
  );
}

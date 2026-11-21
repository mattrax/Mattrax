import { useParams, useSearchParams } from "@solidjs/router";
import type { RoutePreloadFuncArgs } from "@solidjs/router";
import { Option, Schema } from "effect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, Show } from "solid-js";
import { ErrorText, Panel, QueryError } from "~/components/mdm/common";
import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { ShieldCheck } from "~/components/ui/icons";
import { Input } from "~/components/ui/input";
import { enterprise, enterpriseKeys, enterpriseQueries } from "~/lib/enterprise";
import type { TenantSecuritySettings } from "~/lib/enterprise";
import { optimisticallyRemoveCollectionItems, optimisticUpdate } from "~/lib/optimistic";
import { errorMessage, raisedFailure } from "~/lib/errors";
import { preloadPage } from "~/lib/page-data";
import { queryClient } from "~/lib/query-client";
import { ReadOnlyNotice, useCan } from "~/lib/permissions";

export const route = {
  preload: ({ params, intent }: RoutePreloadFuncArgs) => {
    if (intent === "initial") return;

    return preloadPage([
      () => queryClient.ensureQueryData(enterpriseQueries.scim(params.tenantId)),
      () => queryClient.ensureQueryData(enterpriseQueries.tenantSecurity(params.tenantId)),
      () => queryClient.ensureQueryData(enterpriseQueries.sso(params.tenantId)),
    ]);
  },
};

export default function IdentitySettingsPage() {
  const params = useParams();
  const qc = useQueryClient();
  const { can } = useCan();
  const writable = () => can("identity.write");

  const [searchParams, setSearchParams] = useSearchParams();

  const tokens = useQuery(() => enterpriseQueries.scim(params.tenantId));

  /* ---- Tenant MFA requirement (independent of SSO) --------------------- */

  const security = useQuery(() => enterpriseQueries.tenantSecurity(params.tenantId));

  const [requireTenantMfa, setRequireTenantMfa] = createSignal(false);
  const [securitySeeded, setSecuritySeeded] = createSignal(false);
  createEffect(
    () => security.data,
    (value) => {
      if (!value || securitySeeded()) return;
      setSecuritySeeded(true);
      setRequireTenantMfa(value.requireMfa);
    },
  );

  const saveSecurity = useMutation(() => ({
    mutationFn: () =>
      enterprise.patchTenantSecurity(params.tenantId, { requireMfa: requireTenantMfa() }),
    onMutate: async () =>
      optimisticUpdate<TenantSecuritySettings>(
        qc,
        enterpriseKeys.tenantSecurity(params.tenantId),
        (current) => ({ ...current, requireMfa: requireTenantMfa() }),
      ),
    onError: (_error, _variables, restore) => restore?.(),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: enterpriseKeys.tenantSecurity(params.tenantId) });
      // `me` carries the account-level MFA requirement derived from tenants.
      void qc.invalidateQueries({ queryKey: enterpriseKeys.me() });
    },
  }));

  /* ---- Break-glass recovery approval ----------------------------------- */

  const recoveryToken = () => {
    const value = Array.isArray(searchParams.recoveryToken)
      ? searchParams.recoveryToken[0]
      : searchParams.recoveryToken;

    return Option.getOrUndefined(Schema.decodeUnknownOption(Schema.NonEmptyString)(value));
  };

  const approveRecovery = useMutation(() => ({
    mutationFn: (token: string) => enterprise.approveAccountRecovery(params.tenantId, token),
    onSuccess: () => {
      setSearchParams({ recoveryToken: undefined }, { replace: true });
    },
  }));

  const [name, setName] = createSignal("");
  const [expiresOn, setExpiresOn] = createSignal("");
  const [copiedUrl, setCopiedUrl] = createSignal(false);
  const [revokeTarget, setRevokeTarget] = createSignal<{ id: string; name: string } | null>(null);

  const [created, setCreated] = createSignal<{
    token: string;
    baseUrl: string;
    expiresAt?: string | null;
  } | null>(null);

  const create = useMutation(() => ({
    mutationFn: () =>
      enterprise.createScimToken(params.tenantId, {
        name: name(),
        expiresAt: expiresOn() ? new Date(`${expiresOn()}T23:59:59.999Z`).toISOString() : undefined,
      }),
    onSuccess: async (result) => {
      setCreated({
        token: result.token,
        baseUrl: result.baseUrl,
        expiresAt: result.expiresAt ?? null,
      });
      setExpiresOn("");
      await qc.invalidateQueries({ queryKey: enterpriseKeys.scim(params.tenantId) });
    },
  }));

  const revoke = useMutation(() => ({
    mutationFn: (tokenId: string) => enterprise.revokeScimToken(params.tenantId, tokenId),
    onMutate: async (tokenId) =>
      optimisticallyRemoveCollectionItems(qc, enterpriseKeys.scim(params.tenantId), "tokens", [
        tokenId,
      ]),
    onSuccess: () => setRevokeTarget(null),
    onError: (_error, _tokenId, restore) => restore?.(),
    onSettled: () => void qc.invalidateQueries({ queryKey: enterpriseKeys.scim(params.tenantId) }),
  }));

  const baseUrl = () => `${globalThis.location?.origin ?? ""}/scim/v2/${params.tenantId}`;

  const rotationDue = () => (tokens.data?.tokens ?? []).filter((token) => token.rotationDue);

  const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const expiryLabel = (expiresAt: string | null | undefined) => {
    if (!expiresAt) return "No expiry set — rotate to add one";

    const date = new Date(expiresAt);
    const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);

    if (days <= 0) return `Expired ${date.toLocaleDateString()}`;

    return `Expires ${date.toLocaleDateString()} · ${days} day${days === 1 ? "" : "s"} left`;
  };

  const sso = useQuery(() => enterpriseQueries.sso(params.tenantId));

  const [azureTenantId, setAzureTenantId] = createSignal("");
  const [ssoEnabled, setSsoEnabled] = createSignal(false);
  const [autoProvision, setAutoProvision] = createSignal(true);
  let ssoSeeded = false;
  createEffect(
    () => sso.data,
    (config) => {
      if (!config || ssoSeeded) return;
      ssoSeeded = true;
      setAzureTenantId(config.azureTenantId ?? "");
      setSsoEnabled(config.enabled);
      setAutoProvision(config.autoProvision);
    },
  );

  const [ssoSaved, setSsoSaved] = createSignal(false);

  const [consentNotice, setConsentNotice] = createSignal<{
    tone: "success" | "warning";
    text: string;
  } | null>(null);

  const ssoDirty = () => {
    const current = sso.data;

    if (!current) return false;

    return (
      ssoEnabled() !== current.enabled ||
      azureTenantId().trim() !== (current.azureTenantId ?? "") ||
      autoProvision() !== current.autoProvision
    );
  };

  const saveSso = useMutation(() => ({
    mutationFn: () =>
      enterprise.patchSsoConfig(params.tenantId, {
        enabled: ssoEnabled(),
        azureTenantId: azureTenantId().trim() || null,
        autoProvision: autoProvision(),
      }),
    onMutate: async () => {
      setConsentNotice(null);

      return optimisticUpdate<Awaited<ReturnType<typeof enterprise.getSsoConfig>>>(
        qc,
        enterpriseKeys.sso(params.tenantId),
        (current) => ({
          ...current,
          enabled: ssoEnabled(),
          azureTenantId: azureTenantId().trim() || null,
          autoProvision: autoProvision(),
        }),
      );
    },
    onSuccess: (result) => {
      setSsoSaved(true);
      setTimeout(() => setSsoSaved(false), 3000);

      const revocation = result.consentRevocation;

      if (!revocation) return;

      if (revocation.status === "revoked") {
        const count = revocation.grantsRemoved ?? 0;

        setConsentNotice({
          tone: "success",
          text:
            count === 0
              ? "Microsoft Entra tenant unlinked. No delegated consent remained to revoke."
              : `Microsoft Entra tenant unlinked. Admin consent was revoked (${count} delegated permission grant${count === 1 ? "" : "s"} removed).`,
        });

        return;
      }

      if (revocation.status === "skipped")
        setConsentNotice({
          tone: "warning",
          text: `Microsoft Entra tenant unlinked. Admin consent was not revoked: ${revocation.reason ?? "Microsoft Graph credentials are not configured."}`,
        });
      else {
        const removed = revocation.grantsRemoved ?? 0;

        const partial =
          removed > 0
            ? ` ${removed} delegated permission grant${removed === 1 ? "" : "s"} were removed before the failure.`
            : "";

        setConsentNotice({
          tone: "warning",
          text: `Microsoft Entra tenant unlinked, but admin consent could not be revoked: ${revocation.reason ?? "Microsoft Graph rejected the request."}${partial} Remove the app's enterprise application in Entra to finish.`,
        });
      }
    },
    onError: (_error, _variables, restore) => restore?.(),
    onSettled: () => void qc.invalidateQueries({ queryKey: enterpriseKeys.sso(params.tenantId) }),
  }));

  const [ssoError, setSsoError] = createSignal<string | null>(null);

  const startSso = async () => {
    setSsoError(null);

    try {
      const response = await fetch(
        `/api/v1/sso/azure/start?tenantId=${encodeURIComponent(params.tenantId ?? "")}`,
      );

      const body = Option.getOrUndefined(
        Schema.decodeUnknownOption(
          Schema.Struct({
            url: Schema.optional(Schema.String),
            error: Schema.optional(Schema.String),
          }),
        )(await response.json().catch(() => ({}))),
      );

      if (body?.url) {
        window.location.href = body.url;

        return;
      }

      setSsoError(errorMessage(body, "Single sign-on is not available for this tenant."));
    } catch (error) {
      setSsoError(errorMessage(raisedFailure(error)));
    }
  };

  return (
    <div class="grid gap-5 xl:grid-cols-2">
      <QueryError class="xl:col-span-2" error={tokens.error ?? sso.error} />
      <Show when={!writable()}>
        <ReadOnlyNotice class="xl:col-span-2">
          Your role can view identity settings but not change them.
        </ReadOnlyNotice>
      </Show>

      <Panel
        title="SCIM provisioning"
        description="Connect an identity provider's SCIM client to create, update and deactivate tenant users and groups automatically."
      >
        <div class="rounded-lg border border-border bg-surface p-3">
          <p class="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            SCIM base URL
          </p>
          <div class="mt-1.5 flex items-start gap-2">
            <code class="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
              {baseUrl()}
            </code>
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(baseUrl());
                  setCopiedUrl(true);
                  setTimeout(() => setCopiedUrl(false), 1500);
                } catch {
                  // Clipboard access can be denied; the URL stays selectable.
                }
              }}
            >
              {copiedUrl() ? "Copied" : "Copy"}
            </Button>
          </div>
          <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
            Use a bearer token below. Supported resources: Users and Groups.
          </p>
        </div>

        <Show when={writable()}>
          <form
            class="mt-4 flex flex-col gap-2 sm:flex-row"
            novalidate
            onSubmit={(event) => {
              event.preventDefault();

              if (!name().trim()) return;
              create.mutate();
            }}
          >
            <Input
              aria-label="SCIM token name"
              placeholder="e.g. Okta SCIM"
              value={name()}
              onInput={(event) => setName(event.currentTarget.value)}
              class="min-w-0 flex-1"
            />
            <label class="flex min-w-0 flex-col gap-1 sm:w-44">
              <span class="text-[11px] font-medium text-muted-foreground">
                Expires (default 90 days)
              </span>
              <Input
                type="date"
                aria-label="SCIM token expiry"
                min={tomorrow()}
                value={expiresOn()}
                onInput={(event) => setExpiresOn(event.currentTarget.value)}
              />
            </label>
            <Button
              type="submit"
              class="shrink-0 self-end"
              disabled={create.isPending || !name().trim()}
            >
              Create token
            </Button>
          </form>
          <p class="mt-2 text-xs leading-relaxed text-muted-foreground">
            Give the IdP connector the shortest lifetime your rotation process supports. Mattrax
            reminds you to rotate in the final 14 days and rejects the token once it expires.
          </p>
        </Show>
        <ErrorText error={create.error} />

        <Show when={created()}>
          {(value) => (
            <div class="mt-4 rounded-lg border border-success/25 bg-success/[0.06] p-3 text-sm">
              <p class="font-medium text-foreground">
                Copy this token now. It will not be shown again.
              </p>
              <code class="mt-2 block break-all rounded-md border border-border bg-muted p-2 font-mono text-xs text-muted-foreground">
                {value().token}
              </code>
              <p class="mt-2 text-xs text-muted-foreground">{expiryLabel(value().expiresAt)}</p>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigator.clipboard.writeText(value().token)}
                >
                  Copy token
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                  Done
                </Button>
              </div>
            </div>
          )}
        </Show>
      </Panel>

      <Panel
        title="SCIM tokens"
        description="Tokens used by your identity provider to call the SCIM API."
        flush
      >
        <Show when={rotationDue().length > 0}>
          <div
            role="status"
            class="mx-4 mt-4 rounded-lg border border-warning/25 bg-warning/[0.06] p-3 text-[13px] text-foreground sm:mx-5"
          >
            <p class="font-medium">
              Rotate {rotationDue().length === 1 ? "a token" : "tokens"} soon
            </p>
            <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
              {rotationDue()
                .map((token) => token.name)
                .join(", ")}{" "}
              {rotationDue().length === 1 ? "expires" : "expire"} within 14 days or has already
              expired. Create a replacement, update the IdP connector, then revoke the old token.
            </p>
          </div>
        </Show>
        <Show
          when={(tokens.data?.tokens.length ?? 0) > 0}
          fallback={
            <p class="px-4 py-6 text-[13px] text-muted-foreground sm:px-5">No SCIM tokens yet.</p>
          }
        >
          <ul class="divide-y divide-border">
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
                        : " · Never used"}
                    </span>
                    <span
                      class={`mt-0.5 block text-xs ${
                        token.rotationDue ? "text-warning-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {expiryLabel(token.expiresAt)}
                    </span>
                  </span>
                  <Show when={writable()}>
                    <Button
                      size="sm"
                      variant="outline"
                      class="shrink-0 self-start sm:self-auto"
                      disabled={revoke.isPending}
                      onClick={() => setRevokeTarget({ id: token.id, name: token.name })}
                    >
                      Revoke
                    </Button>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
        <div class="px-4 pb-4 sm:px-5">
          <ErrorText error={tokens.error || revoke.error} />
        </div>
      </Panel>

      <Show when={recoveryToken()}>
        {(token) => (
          <Panel
            class="xl:col-span-2 border-warning/25 bg-warning/[0.03]"
            title="Approve an account recovery"
            description="A member of this tenant proved control of their verified email address after losing access to their passkeys. Because this tenant has more than one owner, a second owner must approve signing them back in."
          >
            <p class="text-[12.5px] leading-relaxed text-muted-foreground">
              Approving lets them sign in once and add a new passkey. It does not remove or change
              any existing passkey, and the ceremony is recorded in their account activity.
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <Show when={writable()}>
                <Button
                  disabled={approveRecovery.isPending}
                  onClick={() => approveRecovery.mutate(token())}
                >
                  {approveRecovery.isPending ? "Approving…" : "Approve recovery"}
                </Button>
              </Show>
              <Button
                variant="outline"
                onClick={() => setSearchParams({ recoveryToken: undefined }, { replace: true })}
              >
                Dismiss
              </Button>
            </div>
            <Show when={!writable()}>
              <p class="mt-2 text-[12.5px] text-muted-foreground">
                Your role can view identity settings but cannot approve a recovery. Ask an owner to
                open this link.
              </p>
            </Show>
            <ErrorText error={approveRecovery.error} />
          </Panel>
        )}
      </Show>

      <Panel
        class="xl:col-span-2"
        title="Multi-factor authentication"
        description="Require every member of this tenant — including read-only and auditor roles — to sign in with a passkey or an authenticator app. This is independent of single sign-on; a tenant that signs in with passkeys can enforce it without an identity provider."
      >
        <form
          class="divide-y divide-border"
          onSubmit={(event) => {
            event.preventDefault();
            saveSecurity.mutate();
          }}
        >
          <ToggleSetting
            title="Require multi-factor authentication for every member"
            description="Members without a factor keep access to their own account settings so they can enrol one, but cannot open this tenant's data."
            checked={requireTenantMfa()}
            onChange={setRequireTenantMfa}
          />
          <div class="flex flex-wrap items-center gap-2 pt-4">
            <Show when={writable()}>
              <Button
                type="submit"
                disabled={
                  saveSecurity.isPending ||
                  !security.data ||
                  requireTenantMfa() === security.data.requireMfa
                }
              >
                {saveSecurity.isPending ? "Saving…" : "Save requirement"}
              </Button>
            </Show>
            <Show when={security.data?.requireMfa}>
              <span class="text-[12.5px] text-muted-foreground">
                Currently enforced for every member of this tenant.
              </span>
            </Show>
          </div>
          <div class="pt-3">
            <ErrorText error={saveSecurity.error || security.error} />
          </div>
        </form>
      </Panel>

      <Panel
        class="xl:col-span-2"
        title="Single sign-on"
        description="Let members sign in with your Microsoft Entra tenant."
      >
        <div class="flex items-start gap-3 rounded-lg border border-border bg-surface p-3">
          <span class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground">
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
          class="mt-4 divide-y divide-border"
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
          <div class="flex flex-wrap gap-2 pt-4">
            <Show when={writable()}>
              <Button type="submit" disabled={saveSso.isPending || !ssoDirty()}>
                {saveSso.isPending ? "Saving…" : "Save SSO settings"}
              </Button>
              <Show when={ssoSaved()}>
                <span role="status" class="self-center text-[12.5px] text-success-foreground">
                  Saved.
                </span>
              </Show>
            </Show>
            <Button
              type="button"
              variant="outline"
              disabled={!sso.data?.enabled || !sso.data?.azureTenantId || ssoDirty()}
              title={ssoDirty() ? "Save your changes before testing sign-in" : undefined}
              onClick={startSso}
            >
              Test sign-in
            </Button>
          </div>
          <Show when={consentNotice()}>
            {(notice) => (
              <p
                role="status"
                class={`pt-3 text-[13px] ${
                  notice().tone === "success"
                    ? "text-success-foreground"
                    : "text-warning-foreground"
                }`}
              >
                {notice().text}
              </p>
            )}
          </Show>
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

      <ConfirmDialog
        open={revokeTarget() !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        title={`Revoke “${revokeTarget()?.name ?? "this SCIM token"}”?`}
        description="Your identity provider will stop syncing users and groups immediately. This cannot be undone."
        confirmLabel="Revoke token"
        destructive
        pending={revoke.isPending}
        onConfirm={() => {
          const token = revokeTarget();

          if (token) revoke.mutate(token.id);
        }}
      />
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
          class="h-5 w-9 rounded-full border border-border bg-hover transition-colors duration-150 peer-checked:border-brand peer-checked:bg-brand-solid peer-focus-visible:ring-2 peer-focus-visible:ring-ring/60 peer-disabled:opacity-50"
        />
        <span
          aria-hidden="true"
          class="pointer-events-none absolute left-0.5 top-0.5 size-3.5 rounded-full bg-card shadow-sm transition-transform duration-150 peer-checked:translate-x-[1.125rem] peer-disabled:opacity-50"
        />
      </span>
    </label>
  );
}

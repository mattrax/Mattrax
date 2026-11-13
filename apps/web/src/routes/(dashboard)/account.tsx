import { useNavigate, useSearchParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import { isServer } from "@solidjs/web";
import { AccountSecurity } from "~/components/account-security";
import { Field, Page, PageHeader, Panel } from "~/components/mdm/common";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { authClient } from "~/lib/auth";
import { enterprise, enterpriseKeys } from "~/lib/enterprise";
import { errorMessage } from "~/lib/errors";

export default function AccountPage() {
  const session = authClient.useSession();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = () => session().data?.user;

  onSettled(() => {
    void (async () => {
      const token = searchParams.emailToken;
      if (!token || Array.isArray(token)) return;
      const result = await authClient.verifyEmailChange({ token });
      if (result.error) {
        setEmailError(errorMessage(result.error, "That email change link is invalid or expired."));
        return;
      }
      setSearchParams({ emailToken: undefined }, { replace: true });
      await session().refetch();
    })();
  });

  const [deleteConfirm, setDeleteConfirm] = createSignal("");
  const [deleteError, setDeleteError] = createSignal<string | null>(null);
  const deleteAccount = async () => {
    setDeleteError(null);
    const response = await fetch("/api/v1/me", {
      method: "DELETE",
      credentials: "include",
      headers: { "x-effect-auth-csrf": "1" },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as
        | { message?: string; error?: { message?: string } }
        | undefined;
      setDeleteError(errorMessage(body ?? { message: `Request failed (${response.status})` }));
      return;
    }
    window.location.href = "/";
  };

  const [name, setName] = createSignal("");
  const [namePending, setNamePending] = createSignal(false);
  const [nameError, setNameError] = createSignal<string | null>(null);
  const [nameSuccess, setNameSuccess] = createSignal(false);

  createEffect(
    () => user()?.name,
    (name) => {
      if (name) setName(name);
    },
  );

  const handleNameSave = async (e: SubmitEvent) => {
    e.preventDefault();
    setNameError(null);
    setNameSuccess(false);
    setNamePending(true);

    const result = await authClient.updateUser({ name: name() });
    setNamePending(false);

    if (result.error) {
      setNameError(errorMessage(result.error, "Failed to update name"));
    } else {
      setNameSuccess(true);
      setTimeout(() => setNameSuccess(false), 3000);
    }
  };

  const [newEmail, setNewEmail] = createSignal("");
  const [emailPending, setEmailPending] = createSignal(false);
  const [emailError, setEmailError] = createSignal<string | null>(null);
  const [emailSent, setEmailSent] = createSignal(false);

  const handleEmailChange = async (e: SubmitEvent) => {
    e.preventDefault();
    setEmailError(null);
    setEmailSent(false);
    setEmailPending(true);

    const result = await authClient.changeEmail({
      newEmail: newEmail(),
      callbackURL: "/account",
    });
    setEmailPending(false);

    if (result.error) {
      setEmailError(errorMessage(result.error, "Failed to request email change"));
    } else {
      setEmailSent(true);
      setNewEmail("");
    }
  };

  const [currentPassword, setCurrentPassword] = createSignal("");
  const [newPassword, setNewPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [passwordPending, setPasswordPending] = createSignal(false);
  const [passwordError, setPasswordError] = createSignal<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = createSignal(false);
  type ApiTokens = Awaited<ReturnType<typeof authClient.listApiTokens>>;
  const [tokens, setTokens] = createSignal<ApiTokens>();
  const [tokensPending, setTokensPending] = createSignal(false);
  const [tokensError, setTokensError] = createSignal<string | null>(null);
  const refetchTokens = async () => {
    setTokensPending(true);
    setTokensError(null);
    try {
      setTokens(await authClient.listApiTokens());
    } catch (error) {
      setTokens(undefined);
      setTokensError(errorMessage(error));
    } finally {
      setTokensPending(false);
    }
  };
  onSettled(() => {
    if (!isServer) void refetchTokens();
  });
  type Sessions = {
    sessions: Array<{
      id: string;
      current: boolean;
      createdAt: string;
      expiresAt: string;
      method?: string;
    }>;
  };
  const [sessions, setSessions] = createSignal<Sessions>();
  const [sessionsError, setSessionsError] = createSignal<string | null>(null);
  const refetchSessions = async () => {
    setSessionsError(null);
    try {
      const response = await fetch("/api/v1/account/sessions", { credentials: "include" });
      if (!response.ok) {
        setSessionsError(errorMessage({ message: `Request failed with ${response.status}` }));
        return;
      }
      setSessions((await response.json()) as Sessions);
    } catch (error) {
      setSessionsError(errorMessage(error));
    }
  };
  onSettled(() => {
    if (!isServer) void refetchSessions();
  });
  const revokeSession = async (id: string, current: boolean) => {
    if (current) {
      await authClient.signOut();
      navigate("/login", { replace: true });
      return;
    }
    const response = await fetch(`/api/v1/account/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
      headers: { "x-effect-auth-csrf": "1" },
    });
    if (!response.ok) {
      setSessionsError(errorMessage({ message: `Request failed with ${response.status}` }));
      return;
    }
    await refetchSessions();
  };

  const [tokenName, setTokenName] = createSignal("");
  const [newToken, setNewToken] = createSignal<string | null>(null);
  const [tokenError, setTokenError] = createSignal<string | null>(null);
  const [tokenOpen, setTokenOpen] = createSignal(false);
  const [tokenScope, setTokenScope] = createSignal<"read" | "write">("write");
  const [tokenExpiry, setTokenExpiry] = createSignal("never");
  const [tokenTenantId, setTokenTenantId] = createSignal("");
  const me = useQuery(() => ({ queryKey: enterpriseKeys.me(), queryFn: enterprise.me }));
  const tenants = () => me.data?.tenants ?? [];
  const tenantLabel = (tenantId?: string | null) =>
    tenantId
      ? (tenants().find((tenant) => tenant.id === tenantId)?.displayName ??
        tenants().find((tenant) => tenant.id === tenantId)?.name ??
        "Unknown tenant")
      : "All tenants";
  const scopeLabel = (scopes?: string[]) =>
    !scopes || scopes.includes("write") ? "Read & write" : "Read only";

  const tokenExpiresAt = () => {
    const days = Number(tokenExpiry());
    if (!Number.isFinite(days) || days <= 0) return null;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  };

  const handleTokenCreate = async (e: SubmitEvent) => {
    e.preventDefault();
    setTokenError(null);
    setNewToken(null);
    try {
      const result = await authClient.createApiToken({
        name: tokenName(),
        expiresAt: tokenExpiresAt(),
        scopes: tokenScope() === "read" ? ["read"] : ["read", "write"],
        tenantId: tokenTenantId() || null,
      });
      setNewToken(result.token);
      setTokenName("");
      setTokenOpen(false);
      await refetchTokens();
    } catch (error) {
      setTokenError(errorMessage(error));
    }
  };

  const revokeToken = async (tokenId: string) => {
    await authClient.revokeApiToken(tokenId);
    await refetchTokens();
  };

  const handlePasswordChange = async (e: SubmitEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(false);

    if (newPassword() !== confirmPassword()) {
      setPasswordError("New passwords do not match");
      return;
    }
    if (newPassword().length < 8) {
      setPasswordError("Password must be at least 15 characters");
      return;
    }

    setPasswordPending(true);
    const result = await authClient.changePassword({
      currentPassword: currentPassword(),
      newPassword: newPassword(),
      revokeOtherSessions: false,
    });
    setPasswordPending(false);

    if (result.error) {
      setPasswordError(errorMessage(result.error, "Failed to change password"));
    } else {
      setPasswordSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPasswordSuccess(false), 3000);
    }
  };

  const selectClass =
    "h-8 w-full rounded-lg bg-card px-2.5 text-[13px] text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30";

  return (
    <Page class="max-w-[860px]">
      <PageHeader
        eyebrow="Your account"
        title="Account"
        description="Manage your personal information and security settings."
        meta={
          <Show when={user()}>
            {(current) => (
              <>
                <span class="break-all">{current().email}</span>
                <Show
                  when={current().emailVerified}
                  fallback={<Badge variant="outline">Not verified</Badge>}
                >
                  <Badge
                    variant="outline"
                    class="border-success/25 bg-success/10 text-success-foreground"
                  >
                    Verified
                  </Badge>
                </Show>
              </>
            )}
          </Show>
        }
      />

      <Panel
        title="Display name"
        description="This is the name visible to others in your organisation."
      >
        <form onSubmit={handleNameSave} class="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div class="min-w-0 flex-1">
            <Field label="Name">
              <Input
                id="name"
                type="text"
                required
                class="h-8"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                placeholder="Your name"
              />
            </Field>
          </div>
          <Button type="submit" disabled={namePending()}>
            {namePending() ? "Saving…" : "Save"}
          </Button>
        </form>
        <Show when={nameError()}>
          {(msg) => (
            <p role="alert" class="mt-2 text-[12.5px] text-destructive">
              {msg()}
            </p>
          )}
        </Show>
        <Show when={nameSuccess()}>
          <p class="mt-2 text-[12.5px] text-success-foreground">Name updated successfully.</p>
        </Show>
      </Panel>

      <Panel
        title="Email address"
        description="A verification link will be sent to your new address. The change takes effect after you confirm it."
      >
        <p class="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          Your current email is
          <span class="font-medium text-foreground">{user()?.email}</span>
          <Show
            when={user()?.emailVerified}
            fallback={<Badge variant="outline">Not verified</Badge>}
          >
            <Badge
              variant="outline"
              class="border-success/25 bg-success/10 text-success-foreground"
            >
              Verified
            </Badge>
          </Show>
        </p>
        <Show
          when={!emailSent()}
          fallback={
            <div class="rounded-lg border border-success/25 bg-success/[0.08] px-4 py-3 text-[12.5px] leading-relaxed text-success-foreground">
              Verification email sent. Please check your inbox and click the link to confirm the
              change.
            </div>
          }
        >
          <form onSubmit={handleEmailChange} class="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div class="min-w-0 flex-1">
              <Field label="New email address">
                <Input
                  id="new-email"
                  type="email"
                  required
                  class="h-8"
                  value={newEmail()}
                  onInput={(e) => setNewEmail(e.currentTarget.value)}
                  placeholder="new@example.com"
                />
              </Field>
            </div>
            <Button type="submit" variant="secondary" disabled={emailPending()}>
              {emailPending() ? "Sending…" : "Send verification"}
            </Button>
          </form>
        </Show>
        <Show when={emailError()}>
          {(msg) => (
            <p role="alert" class="mt-2 text-[12.5px] text-destructive">
              {msg()}
            </p>
          )}
        </Show>
      </Panel>

      <Panel
        title="Change password"
        description="Choose a strong password of at least 15 characters."
      >
        <form onSubmit={handlePasswordChange} class="space-y-3">
          <Field label="Current password">
            <Input
              id="current-password"
              type="password"
              required
              value={currentPassword()}
              onInput={(e) => setCurrentPassword(e.currentTarget.value)}
              placeholder="••••••••"
              autocomplete="current-password"
            />
          </Field>
          <Field label="New password">
            <Input
              id="new-password"
              type="password"
              required
              minlength={15}
              value={newPassword()}
              onInput={(e) => setNewPassword(e.currentTarget.value)}
              placeholder="••••••••"
              autocomplete="new-password"
            />
          </Field>
          <Field label="Confirm new password">
            <Input
              id="confirm-password"
              type="password"
              required
              minlength={15}
              value={confirmPassword()}
              onInput={(e) => setConfirmPassword(e.currentTarget.value)}
              placeholder="••••••••"
              autocomplete="new-password"
            />
          </Field>
          <Show when={passwordError()}>
            {(msg) => (
              <p role="alert" class="text-[12.5px] text-destructive">
                {msg()}
              </p>
            )}
          </Show>
          <Show when={passwordSuccess()}>
            <p class="text-[12.5px] text-success-foreground">Password changed successfully.</p>
          </Show>
          <div class="border-t border-white/[0.06] pt-3">
            <Button type="submit" disabled={passwordPending()}>
              {passwordPending() ? "Updating…" : "Update password"}
            </Button>
          </div>
        </form>
      </Panel>

      <AccountSecurity
        mfaEnabled={me.data?.user.mfaEnabled ?? false}
        totpEnabled={me.data?.user.totpEnabled ?? false}
        passkeyEnabled={me.data?.user.passkeyEnabled ?? false}
        mfaRequired={me.data?.user.mfaRequired ?? false}
        hasPassword={me.data?.user.hasPassword ?? false}
        email={user()?.email ?? ""}
      />

      <Show when={sessionsError()}>
        {(msg) => (
          <p role="alert" class="text-[12.5px] text-destructive">
            {msg()}
          </p>
        )}
      </Show>

      <Show when={(sessions()?.sessions.length ?? 0) > 0}>
        <Panel
          title="Active sessions"
          description="Devices and browsers currently signed in to your account."
        >
          <div class="space-y-2">
            <For each={sessions()?.sessions ?? []}>
              {(item) => (
                <div class="flex flex-col gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div class="min-w-0">
                    <p class="flex flex-wrap items-center gap-2 text-[12.5px] font-medium text-foreground">
                      {item.method ?? "Password"}
                      <Show when={item.current}>
                        <Badge
                          variant="outline"
                          class="border-success/25 bg-success/10 text-success-foreground"
                        >
                          This session
                        </Badge>
                      </Show>
                    </p>
                    <p class="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                      Signed in {new Date(item.createdAt).toLocaleString()} · expires{" "}
                      {new Date(item.expiresAt).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => revokeSession(item.id, item.current)}
                  >
                    {item.current ? "Sign out" : "Revoke"}
                  </Button>
                </div>
              )}
            </For>
          </div>
        </Panel>
      </Show>

      <Panel
        title="API tokens"
        description="Create tokens for CLI and API access. Scope a token to read-only or to a single tenant to limit what it can reach."
        actions={
          <Button
            onClick={() => {
              setTokenError(null);
              setTokenOpen(true);
            }}
          >
            Create token
          </Button>
        }
      >
        <Dialog open={tokenOpen()} onOpenChange={setTokenOpen}>
          <DialogContent class="dark max-w-md text-foreground">
            <DialogHeader>
              <DialogTitle>Create API token</DialogTitle>
              <DialogDescription class="text-[12.5px] leading-relaxed text-muted-foreground">
                The token inherits your permissions. Read-only tokens can view data but cannot
                change it; a tenant-bound token is rejected for every other tenant.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleTokenCreate} class="mt-4 space-y-3">
              <Field label="Token name">
                <Input
                  id="token-name"
                  required
                  value={tokenName()}
                  onInput={(e) => setTokenName(e.currentTarget.value)}
                  placeholder="Work laptop CLI"
                />
              </Field>
              <Field label="Access">
                <select
                  id="token-scope"
                  class={selectClass}
                  value={tokenScope()}
                  onChange={(e) => setTokenScope(e.currentTarget.value as "read" | "write")}
                >
                  <option value="read">Read only</option>
                  <option value="write">Read &amp; write</option>
                </select>
              </Field>
              <Field label="Tenant">
                <select
                  id="token-tenant"
                  class={selectClass}
                  value={tokenTenantId()}
                  onChange={(e) => setTokenTenantId(e.currentTarget.value)}
                >
                  <option value="">All tenants I belong to</option>
                  <For each={tenants()}>
                    {(tenant) => (
                      <option value={tenant.id}>{tenant.displayName ?? tenant.name}</option>
                    )}
                  </For>
                </select>
              </Field>
              <Field label="Expiry">
                <select
                  id="token-expiry"
                  class={selectClass}
                  value={tokenExpiry()}
                  onChange={(e) => setTokenExpiry(e.currentTarget.value)}
                >
                  <option value="never">Never</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">1 year</option>
                </select>
              </Field>
              <Show when={tokenError()}>
                {(msg) => (
                  <p role="alert" class="text-[12.5px] text-destructive">
                    {msg()}
                  </p>
                )}
              </Show>
              <DialogFooter class="border-t border-white/[0.06] pt-3">
                <Button type="button" variant="outline" onClick={() => setTokenOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Create token</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Show when={newToken()}>
          {(token) => (
            <div class="mb-4 rounded-lg border border-warning/25 bg-warning/[0.07] p-3">
              <p class="text-[12.5px] font-medium text-warning-foreground">
                Copy this token now. It will not be shown again.
              </p>
              <code class="mt-2 block break-all rounded border border-white/[0.07] bg-black/30 p-2 font-mono text-[11.5px] text-foreground">
                {token()}
              </code>
            </div>
          )}
        </Show>
        <Show when={tokenError()}>
          {(msg) => (
            <p role="alert" class="mb-3 text-[12.5px] text-destructive">
              {msg()}
            </p>
          )}
        </Show>

        <div class="space-y-2">
          <For each={tokens()?.tokens ?? []}>
            {(token) => (
              <div class="flex flex-col gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] p-3 sm:flex-row sm:items-center sm:justify-between">
                <div class="min-w-0">
                  <p class="text-[12.5px] font-medium text-foreground">{token.name}</p>
                  <p class="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                    {scopeLabel(token.scopes)} · {tenantLabel(token.tenantId)} · {token.tokenPrefix}
                    ... · Created {new Date(token.createdAt).toLocaleDateString()} · Last used{" "}
                    {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : "never"}
                    <Show when={token.expiresAt}>
                      {" "}
                      · Expires {new Date(token.expiresAt!).toLocaleDateString()}
                    </Show>
                  </p>
                  <Show when={token.revokedAt}>
                    <p class="mt-1 text-[11px] font-medium text-destructive">Revoked</p>
                  </Show>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(token.revokedAt)}
                  onClick={() => revokeToken(token.id)}
                >
                  Revoke
                </Button>
              </div>
            )}
          </For>
          <Show when={tokensError()}>
            {(msg) => (
              <p role="alert" class="text-[12.5px] text-destructive">
                {msg()}
              </p>
            )}
          </Show>
          <Show when={!tokensPending() && !tokensError() && (tokens()?.tokens.length ?? 0) === 0}>
            <p class="text-[12.5px] text-muted-foreground">
              No API tokens yet. Create one for the CLI or API.
            </p>
          </Show>
        </div>
      </Panel>

      <Panel
        class="border-destructive/25 bg-destructive/[0.025]"
        header={
          <div class="min-w-0">
            <h2 class="text-[13px] font-semibold tracking-[-0.01em] text-destructive">
              Delete account
            </h2>
            <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              This removes your account and solo tenants you own. Tenants with other administrators
              are kept. Type your email address to confirm.
            </p>
          </div>
        }
      >
        <div class="flex flex-col gap-2 sm:flex-row">
          <Input
            type="email"
            class="h-9 sm:flex-1"
            placeholder={user()?.email}
            value={deleteConfirm()}
            onInput={(event) => setDeleteConfirm(event.currentTarget.value)}
          />
          <Button
            type="button"
            variant="destructive"
            disabled={deleteConfirm() !== user()?.email}
            onClick={deleteAccount}
          >
            Delete account
          </Button>
        </div>
        <Show when={deleteError()}>
          {(msg) => (
            <p role="alert" class="mt-2 text-[12.5px] text-destructive">
              {msg()}
            </p>
          )}
        </Show>
      </Panel>
    </Page>
  );
}

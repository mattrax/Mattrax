import { useNavigate, useSearchParams } from "@solidjs/router";
import { useQuery } from "@tanstack/solid-query";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import { isServer } from "@solidjs/web";
import { AccountSecurity } from "~/components/account-security";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
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

  const inputClass =
    "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200 transition-colors";

  return (
    <div class="flex flex-1 flex-col gap-6 p-6 max-w-2xl">
      <div>
        <h1 class="text-xl font-semibold text-stone-900">Account</h1>
        <p class="text-sm text-stone-500 mt-1">
          Manage your personal information and security settings.
        </p>
      </div>

      <section class="rounded-xl border border-border bg-card p-6">
        <h2 class="text-sm font-semibold mb-1">Display name</h2>
        <p class="text-sm text-muted-foreground mb-4">
          This is the name visible to others in your organisation.
        </p>
        <form onSubmit={handleNameSave} class="flex gap-3 items-end">
          <div class="flex-1 space-y-1.5">
            <label for="name" class="text-xs font-medium text-stone-700">
              Name
            </label>
            <input
              id="name"
              type="text"
              required
              value={name()}
              onInput={(e) => setName(e.currentTarget.value)}
              class={inputClass}
              placeholder="Your name"
            />
          </div>
          <button
            type="submit"
            disabled={namePending()}
            class="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {namePending() ? "Saving…" : "Save"}
          </button>
        </form>
        <Show when={nameError()}>{(msg) => <p class="mt-2 text-sm text-red-600">{msg()}</p>}</Show>
        <Show when={nameSuccess()}>
          <p class="mt-2 text-sm text-green-600">Name updated successfully.</p>
        </Show>
      </section>

      <section class="rounded-xl border border-border bg-card p-6">
        <h2 class="text-sm font-semibold mb-1">Email address</h2>
        <p class="text-sm text-muted-foreground mb-1">
          Your current email is <span class="font-medium text-stone-900">{user()?.email}</span>
          <Show when={user()?.emailVerified}>
            <span class="ml-1.5 inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
              Verified
            </span>
          </Show>
          <Show when={!user()?.emailVerified}>
            <span class="ml-1.5 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              Not verified
            </span>
          </Show>
        </p>
        <p class="text-sm text-muted-foreground mb-4">
          A verification link will be sent to your new address. The change takes effect after you
          confirm it.
        </p>
        <Show
          when={!emailSent()}
          fallback={
            <div class="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
              Verification email sent. Please check your inbox and click the link to confirm the
              change.
            </div>
          }
        >
          <form onSubmit={handleEmailChange} class="flex gap-3 items-end">
            <div class="flex-1 space-y-1.5">
              <label for="new-email" class="text-xs font-medium text-stone-700">
                New email address
              </label>
              <input
                id="new-email"
                type="email"
                required
                value={newEmail()}
                onInput={(e) => setNewEmail(e.currentTarget.value)}
                class={inputClass}
                placeholder="new@example.com"
              />
            </div>
            <button
              type="submit"
              disabled={emailPending()}
              class="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {emailPending() ? "Sending…" : "Send verification"}
            </button>
          </form>
        </Show>
        <Show when={emailError()}>{(msg) => <p class="mt-2 text-sm text-red-600">{msg()}</p>}</Show>
      </section>

      <section class="rounded-xl border border-border bg-card p-6">
        <h2 class="text-sm font-semibold mb-1">Change password</h2>
        <p class="text-sm text-muted-foreground mb-4">
          Choose a strong password of at least 15 characters.
        </p>
        <form onSubmit={handlePasswordChange} class="space-y-3">
          <div class="space-y-1.5">
            <label for="current-password" class="text-xs font-medium text-stone-700">
              Current password
            </label>
            <input
              id="current-password"
              type="password"
              required
              value={currentPassword()}
              onInput={(e) => setCurrentPassword(e.currentTarget.value)}
              class={inputClass}
              placeholder="••••••••"
              autocomplete="current-password"
            />
          </div>
          <div class="space-y-1.5">
            <label for="new-password" class="text-xs font-medium text-stone-700">
              New password
            </label>
            <input
              id="new-password"
              type="password"
              required
              minlength={15}
              value={newPassword()}
              onInput={(e) => setNewPassword(e.currentTarget.value)}
              class={inputClass}
              placeholder="••••••••"
              autocomplete="new-password"
            />
          </div>
          <div class="space-y-1.5">
            <label for="confirm-password" class="text-xs font-medium text-stone-700">
              Confirm new password
            </label>
            <input
              id="confirm-password"
              type="password"
              required
              minlength={15}
              value={confirmPassword()}
              onInput={(e) => setConfirmPassword(e.currentTarget.value)}
              class={inputClass}
              placeholder="••••••••"
              autocomplete="new-password"
            />
          </div>
          <Show when={passwordError()}>{(msg) => <p class="text-sm text-red-600">{msg()}</p>}</Show>
          <Show when={passwordSuccess()}>
            <p class="text-sm text-green-600">Password changed successfully.</p>
          </Show>
          <div class="pt-1">
            <button
              type="submit"
              disabled={passwordPending()}
              class="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50 transition-colors"
            >
              {passwordPending() ? "Updating…" : "Update password"}
            </button>
          </div>
        </form>
      </section>

      <AccountSecurity
        mfaEnabled={me.data?.user.mfaEnabled ?? false}
        totpEnabled={me.data?.user.totpEnabled ?? false}
        passkeyEnabled={me.data?.user.passkeyEnabled ?? false}
        mfaRequired={me.data?.user.mfaRequired ?? false}
        hasPassword={me.data?.user.hasPassword ?? false}
        email={user()?.email ?? ""}
      />

      <section class="rounded-xl border border-red-200 bg-card p-6">
        <h2 class="text-sm font-semibold text-red-700 mb-1">Delete account</h2>
        <p class="text-sm text-muted-foreground mb-4">
          This removes your account and solo tenants you own. Tenants with other administrators are
          kept. Type your email address to confirm.
        </p>
        <div class="flex flex-col gap-2 sm:flex-row">
          <input
            type="email"
            class={inputClass}
            placeholder={user()?.email}
            value={deleteConfirm()}
            onInput={(event) => setDeleteConfirm(event.currentTarget.value)}
          />
          <button
            type="button"
            disabled={deleteConfirm() !== user()?.email}
            onClick={deleteAccount}
            class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            Delete account
          </button>
        </div>
        <Show when={deleteError()}>
          {(msg) => <p class="mt-2 text-sm text-red-600">{msg()}</p>}
        </Show>
      </section>

      <Show when={sessionsError()}>
        {(msg) => <p class="mb-4 text-sm text-red-600">{msg()}</p>}
      </Show>

      <Show when={(sessions()?.sessions.length ?? 0) > 0}>
        <section class="rounded-xl border border-border bg-card p-6">
          <h2 class="text-sm font-semibold mb-1">Active sessions</h2>
          <p class="text-sm text-muted-foreground mb-4">
            Devices and browsers currently signed in to your account.
          </p>
          <div class="space-y-2">
            <For each={sessions()?.sessions ?? []}>
              {(item) => (
                <div class="flex items-center justify-between rounded-lg border border-stone-200 p-3 text-sm">
                  <div>
                    <p class="font-medium text-stone-900">
                      {item.method ?? "Password"}{" "}
                      <Show when={item.current}>
                        <span class="ml-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                          This session
                        </span>
                      </Show>
                    </p>
                    <p class="text-xs text-muted-foreground">
                      Signed in {new Date(item.createdAt).toLocaleString()} · expires{" "}
                      {new Date(item.expiresAt).toLocaleString()}
                    </p>
                  </div>
                  <button
                    type="button"
                    class="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100"
                    onClick={() => revokeSession(item.id, item.current)}
                  >
                    {item.current ? "Sign out" : "Revoke"}
                  </button>
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>

      <section class="rounded-xl border border-border bg-card p-6">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-sm font-semibold mb-1">API tokens</h2>
            <p class="text-sm text-muted-foreground">
              Create tokens for CLI and API access. Scope a token to read-only or to a single tenant
              to limit what it can reach.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setTokenError(null);
              setTokenOpen(true);
            }}
            class="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 transition-colors whitespace-nowrap"
          >
            Create token
          </button>
        </div>

        <Dialog open={tokenOpen()} onOpenChange={setTokenOpen}>
          <DialogContent class="max-w-md rounded-xl bg-white p-6">
            <DialogHeader>
              <DialogTitle>Create API token</DialogTitle>
              <DialogDescription class="mt-1 text-sm text-stone-500">
                The token inherits your permissions. Read-only tokens can view data but cannot
                change it; a tenant-bound token is rejected for every other tenant.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleTokenCreate} class="mt-4 space-y-3">
              <div class="space-y-1.5">
                <label for="token-name" class="text-xs font-medium text-stone-700">
                  Token name
                </label>
                <input
                  id="token-name"
                  required
                  value={tokenName()}
                  onInput={(e) => setTokenName(e.currentTarget.value)}
                  class={inputClass}
                  placeholder="Work laptop CLI"
                />
              </div>
              <div class="space-y-1.5">
                <label for="token-scope" class="text-xs font-medium text-stone-700">
                  Access
                </label>
                <select
                  id="token-scope"
                  class={inputClass}
                  value={tokenScope()}
                  onChange={(e) => setTokenScope(e.currentTarget.value as "read" | "write")}
                >
                  <option value="read">Read only</option>
                  <option value="write">Read &amp; write</option>
                </select>
              </div>
              <div class="space-y-1.5">
                <label for="token-tenant" class="text-xs font-medium text-stone-700">
                  Tenant
                </label>
                <select
                  id="token-tenant"
                  class={inputClass}
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
              </div>
              <div class="space-y-1.5">
                <label for="token-expiry" class="text-xs font-medium text-stone-700">
                  Expiry
                </label>
                <select
                  id="token-expiry"
                  class={inputClass}
                  value={tokenExpiry()}
                  onChange={(e) => setTokenExpiry(e.currentTarget.value)}
                >
                  <option value="never">Never</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                  <option value="365">1 year</option>
                </select>
              </div>
              <Show when={tokenError()}>
                {(msg) => <p class="text-sm text-red-600">{msg()}</p>}
              </Show>
              <DialogFooter class="pt-1">
                <button
                  type="button"
                  onClick={() => setTokenOpen(false)}
                  class="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  class="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 transition-colors"
                >
                  Create token
                </button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Show when={newToken()}>
          {(token) => (
            <div class="mt-4 mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p class="font-medium">Copy this token now. It will not be shown again.</p>
              <code class="mt-2 block break-all rounded bg-white p-2 text-xs">{token()}</code>
            </div>
          )}
        </Show>
        <Show when={tokenError()}>{(msg) => <p class="mb-3 text-sm text-red-600">{msg()}</p>}</Show>
        <div class="mt-4 space-y-2">
          <For each={tokens()?.tokens ?? []}>
            {(token) => (
              <div class="flex items-center justify-between rounded-lg border border-stone-200 p-3 text-sm">
                <div>
                  <p class="font-medium text-stone-900">{token.name}</p>
                  <p class="text-xs text-muted-foreground">
                    {scopeLabel(token.scopes)} · {tenantLabel(token.tenantId)} · {token.tokenPrefix}
                    ... · Created {new Date(token.createdAt).toLocaleDateString()} · Last used{" "}
                    {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : "never"}
                    <Show when={token.expiresAt}>
                      {" "}
                      · Expires {new Date(token.expiresAt!).toLocaleDateString()}
                    </Show>
                  </p>
                  <Show when={token.revokedAt}>
                    <p class="text-xs text-red-600">Revoked</p>
                  </Show>
                </div>
                <button
                  type="button"
                  disabled={Boolean(token.revokedAt)}
                  onClick={() => revokeToken(token.id)}
                  class="rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-100 disabled:opacity-50"
                >
                  Revoke
                </button>
              </div>
            )}
          </For>
          <Show when={tokensError()}>
            {(msg) => <p class="mb-3 text-sm text-red-600">{msg()}</p>}
          </Show>
          <Show when={!tokensPending() && !tokensError() && (tokens()?.tokens.length ?? 0) === 0}>
            <p class="text-sm text-muted-foreground">No API tokens yet.</p>
          </Show>
        </div>
      </section>
    </div>
  );
}

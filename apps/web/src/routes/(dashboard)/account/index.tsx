import { useSearchParams } from "@solidjs/router";
import { useNavigate } from "~/lib/navigation";
import { useQuery, useQueryClient } from "@tanstack/solid-query";
import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import { isServer } from "@solidjs/web";
import { Option, Schema } from "effect";
import { PERMISSIONS } from "@mattrax/enterprise-domain/client";
import type { Permission } from "@mattrax/enterprise-domain/client";
import AccountActivity from "~/components/account-activity";
import AccountLoginAttempts from "~/components/account-login-attempts";
import AccountSecurity from "~/components/account-security";
import { Field, Page, PageHeader, Panel } from "~/components/mdm/common";
import ThemeSwitcher from "~/components/theme-switcher";
import PermissionPicker from "~/components/permission-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@mattrax/ui";
import { Badge } from "@mattrax/ui";
import ConfirmDialog from "~/components/ui/confirm-dialog";
import { Button } from "@mattrax/ui";
import { Input } from "@mattrax/ui";
import { Skeleton } from "@mattrax/ui";
import { authClient } from "~/lib/auth";
import { enterprise, enterpriseKeys, enterpriseQueries, meQueryOptions } from "~/lib/enterprise";
import type { McpConnectionInfo } from "~/lib/enterprise";
import { optimisticallyPatchMe, optimisticallyUpdateCollection } from "~/lib/optimistic";
import { errorMessage, raisedFailure } from "~/lib/errors";
import { routes } from "~/lib/routes";
import { refreshMeAfterEmailVerification } from "~/lib/me-refresh";

/** "2h ago" style label for a session's last authenticated request. */
const relativeTime = (value: string) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "recently";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);

  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);

  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);

  if (days < 30) return `${days}d ago`;

  return date.toLocaleDateString();
};

export default function AccountPage() {
  const session = authClient.useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = () => session().data?.user;

  onSettled(() => {
    void (async () => {
      const cancelToken = searchParams.emailCancelToken;

      if (cancelToken && !Array.isArray(cancelToken)) {
        const result = await authClient.cancelEmailChange(cancelToken);

        setSearchParams({ emailCancelToken: undefined }, { replace: true });

        if (result.error) {
          setEmailError(
            errorMessage(
              raisedFailure(result.error),
              "That cancellation link is invalid or expired.",
            ),
          );

          return;
        }

        setEmailCancelled(true);

        return;
      }

      const token = searchParams.emailToken;

      if (!token || Array.isArray(token)) return;
      const result = await authClient.verifyEmailChange({ token });

      if (result.error) {
        setEmailError(
          errorMessage(
            raisedFailure(result.error),
            "That email change link is invalid or expired.",
          ),
        );

        return;
      }

      setSearchParams({ emailToken: undefined }, { replace: true });
      await session().refetch();
      await refreshMeAfterEmailVerification(queryClient, { optimistic: true });
    })();
  });

  const [deleteDialogOpen, setDeleteDialogOpen] = createSignal(false);
  const [deleteEmail, setDeleteEmail] = createSignal("");

  const openDeletionConfirmation = () => {
    setDeleteDialogOpen(false);
    setDeleteEmail("");
    navigate(routes.accountDelete());
  };

  const emailMatches = () => {
    const expected = (email() ?? "").trim().toLowerCase();

    return expected.length > 0 && deleteEmail().trim().toLowerCase() === expected;
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

    const nextName = name();
    const restore = await optimisticallyPatchMe(queryClient, { name: nextName });

    try {
      const result = await authClient.updateUser({ name: nextName });

      if (result.error) {
        restore();
        setNameError(errorMessage(raisedFailure(result.error), "Failed to update name"));

        return;
      }

      setNameSuccess(true);
      setTimeout(() => setNameSuccess(false), 3000);
    } catch (error) {
      restore();
      setNameError(errorMessage(raisedFailure(error), "Failed to update name"));
    } finally {
      setNamePending(false);
    }
  };

  const [newEmail, setNewEmail] = createSignal("");
  const [emailPending, setEmailPending] = createSignal(false);
  const [emailError, setEmailError] = createSignal<string | null>(null);
  const [emailSent, setEmailSent] = createSignal(false);
  const [emailCancelled, setEmailCancelled] = createSignal(false);

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
      setEmailError(errorMessage(raisedFailure(result.error), "Failed to request email change"));
    } else {
      setEmailSent(true);
      setNewEmail("");
    }
  };

  type ApiTokens = Awaited<ReturnType<typeof authClient.listApiTokens>>;

  const [tokens, setTokens] = createSignal<ApiTokens>();
  const [tokensPending, setTokensPending] = createSignal(false);
  const [tokensError, setTokensError] = createSignal<string | null>(null);
  const [revokingToken, setRevokingToken] = createSignal<string | null>(null);

  const refetchTokens = async () => {
    setTokensPending(true);
    setTokensError(null);

    try {
      setTokens(await authClient.listApiTokens());
    } catch (error) {
      setTokens(undefined);
      setTokensError(errorMessage(raisedFailure(error)));
    } finally {
      setTokensPending(false);
    }
  };

  onSettled(() => {
    if (!isServer) void refetchTokens();
  });

  const Sessions = Schema.Struct({
    sessions: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        current: Schema.Boolean,
        createdAt: Schema.String,
        expiresAt: Schema.String,
        method: Schema.optional(Schema.NullOr(Schema.String)),
        lastUsedAt: Schema.optional(Schema.NullOr(Schema.String)),
        browser: Schema.optional(Schema.NullOr(Schema.String)),
        platform: Schema.optional(Schema.NullOr(Schema.String)),
        deviceType: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    ),
  });

  type Sessions = typeof Sessions.Type;

  const [sessions, setSessions] = createSignal<Sessions>();
  const [sessionsError, setSessionsError] = createSignal<string | null>(null);

  const refetchSessions = async () => {
    setSessionsError(null);

    try {
      const body = await enterprise.listAccountSessions();
      const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(Sessions)(body));

      if (decoded === undefined) throw new Error("Unexpected sessions response");

      setSessions(decoded);
    } catch (error) {
      setSessionsError(errorMessage(raisedFailure(error)));
    }
  };

  onSettled(() => {
    if (!isServer) void refetchSessions();
  });

  const revokeSession = async (id: string, current: boolean) => {
    setSessionsError(null);

    if (current) {
      try {
        const result = await authClient.signOut();

        if (result.error) {
          setSessionsError(
            errorMessage(raisedFailure(result.error), "Could not sign out. Try again."),
          );

          return;
        }
      } catch (error) {
        setSessionsError(errorMessage(raisedFailure(error), "Could not sign out. Try again."));

        return;
      }

      navigate("/login", { replace: true });

      return;
    }

    // Drop the row immediately; a failed revoke puts it back.
    const previous = sessions();
    setSessions((value) =>
      value ? { sessions: value.sessions.filter((item) => item.id !== id) } : value,
    );

    try {
      await enterprise.revokeAccountSession(id);

      // Already gone from the list above; the refetch confirms it.
      await refetchSessions();
    } catch (error) {
      setSessions(previous);
      setSessionsError(
        errorMessage(raisedFailure(error), "Could not revoke that session. Try again."),
      );
    }
  };

  const [signingOutEverywhere, setSigningOutEverywhere] = createSignal(false);
  const [signOutEverywhereOpen, setSignOutEverywhereOpen] = createSignal(false);

  /**
   * Revoke every session, including this one. The next request is
   * unauthenticated, so the page navigates to the sign-in screen.
   */
  const signOutEverywhere = async () => {
    setSessionsError(null);
    setSigningOutEverywhere(true);

    try {
      await enterprise.revokeAllAccountSessions();
      window.location.href = "/login";
    } catch (error) {
      setSigningOutEverywhere(false);
      setSessionsError(
        errorMessage(raisedFailure(error), "Could not sign out everywhere. Try again."),
      );
    }
  };

  const sessionLabel = (item: Sessions["sessions"][number]) => {
    if (item.browser && item.platform) return `${item.browser} on ${item.platform}`;

    if (item.browser) return item.browser;

    if (item.platform) return item.platform;

    return item.method ? `${item.method} sign-in` : "Unknown device";
  };

  const connections = useQuery(() => enterpriseQueries.mcpConnections());

  const [revoking, setRevoking] = createSignal<string | null>(null);
  const [connectionError, setConnectionError] = createSignal<string | null>(null);

  const revokeConnection = async (connectionId: string) => {
    setRevoking(connectionId);
    setConnectionError(null);

    // The row flips to "Revoked" immediately; the list refetch reconciles.
    const restore = await optimisticallyUpdateCollection(
      queryClient,
      enterpriseKeys.mcpConnections(),
      "connections",
      (connections: McpConnectionInfo[]) =>
        connections.map((connection): McpConnectionInfo =>
          connection.id === connectionId
            ? { ...connection, revokedAt: new Date().toISOString() }
            : connection,
        ),
    );

    try {
      await enterprise.revokeMcpConnection(connectionId);
      await connections.refetch();
    } catch (error) {
      restore();
      setConnectionError(errorMessage(raisedFailure(error), "Could not revoke this MCP client"));
    } finally {
      setRevoking(null);
    }
  };

  const [tokenName, setTokenName] = createSignal("");
  const [newToken, setNewToken] = createSignal<string | null>(null);
  const [tokenError, setTokenError] = createSignal<string | null>(null);
  const [tokenOpen, setTokenOpen] = createSignal(false);
  const [tokenPermissions, setTokenPermissions] = createSignal<ReadonlyArray<Permission>>([]);
  const [tokenExpiry, setTokenExpiry] = createSignal("never");
  const [tokenTenantId, setTokenTenantId] = createSignal("");
  const me = useQuery(() => meQueryOptions(session().data?.user?.id));

  // Session claims are a sign-in snapshot. The `me` query reads the current
  // user row, so verification changes made in this tab cannot leave stale
  // "Not verified" badges behind.
  const email = () => me.data?.account.email ?? user()?.email;
  const emailVerified = () => me.data?.account.emailVerified ?? user()?.emailVerified ?? false;
  const tenants = () => me.data?.tenants ?? [];

  /** The permissions the account already holds in at least one tenant. */
  const availablePermissions = (): ReadonlyArray<Permission> => {
    const granted = new Set(me.data?.tenants.flatMap((tenant) => tenant.permissions) ?? []);

    return PERMISSIONS.filter((permission) => granted.has(permission));
  };

  const tenantLabel = (tenantId?: string | null) =>
    tenantId
      ? (tenants().find((tenant) => tenant.id === tenantId)?.displayName ??
        tenants().find((tenant) => tenant.id === tenantId)?.name ??
        "Unknown tenant")
      : "All tenants";

  // Seed from the query's SSR/preloaded value so the first paint already shows
  // the saved choice instead of flashing the empty option.
  const [defaultTenantId, setDefaultTenantId] = createSignal(
    me.data?.account.defaultTenantId ?? "",
  );

  const [defaultTenantPending, setDefaultTenantPending] = createSignal(false);
  const [defaultTenantError, setDefaultTenantError] = createSignal<string | null>(null);
  const [defaultTenantSaved, setDefaultTenantSaved] = createSignal(false);

  // Follow refetches (another tab may change the choice) without clobbering
  // the select while the save is in flight.
  createEffect(
    () => me.data?.account.defaultTenantId,
    (value) => {
      if (!defaultTenantPending()) setDefaultTenantId(value ?? "");
    },
  );

  const chooseDefaultTenant = (value: string) => {
    setDefaultTenantId(value);
    setDefaultTenantError(null);
    setDefaultTenantSaved(false);
  };

  const saveDefaultTenant = async (value: string | null) => {
    setDefaultTenantPending(true);
    setDefaultTenantError(null);
    setDefaultTenantSaved(false);

    const restore = await optimisticallyPatchMe(queryClient, { defaultTenantId: value });

    try {
      await enterprise.updateMe({ defaultTenantId: value });
      setDefaultTenantId(value ?? "");
      setDefaultTenantSaved(true);
      setTimeout(() => setDefaultTenantSaved(false), 3000);
      // The shell reads the same payload to pick the unscoped landing tenant.
      void queryClient.invalidateQueries({ queryKey: enterpriseKeys.me() });
    } catch (error) {
      // Put the rejected choice back to what the server still holds.
      restore();
      setDefaultTenantId(me.data?.account.defaultTenantId ?? "");
      setDefaultTenantError(
        errorMessage(raisedFailure(error), "Could not update your default tenant. Try again."),
      );
    } finally {
      setDefaultTenantPending(false);
    }
  };

  const handleDefaultTenantSave = (e: SubmitEvent) => {
    e.preventDefault();
    void saveDefaultTenant(defaultTenantId() || null);
  };

  const scopeLabel = (permissions?: ReadonlyArray<Permission>, scopes?: ReadonlyArray<string>) => {
    if (!permissions || permissions.length === 0)
      return scopes?.includes("read") ? "Read only" : "No permissions";

    if (permissions.length === PERMISSIONS.length) return "All permissions";

    if (
      permissions.every((permission) => permission.endsWith(".read")) &&
      permissions.length === PERMISSIONS.filter((permission) => permission.endsWith(".read")).length
    )
      return "Read only";

    return `${permissions.length} permission${permissions.length === 1 ? "" : "s"}`;
  };

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
      if (tokenPermissions().length === 0) {
        setTokenError("Choose at least one permission.");

        return;
      }

      const result = await authClient.createApiToken({
        name: tokenName(),
        expiresAt: tokenExpiresAt(),
        permissions: [...tokenPermissions()],
        tenantId: tokenTenantId() || null,
      });

      setNewToken(result.token);
      setTokenName("");
      setTokenOpen(false);
      await refetchTokens();
    } catch (error) {
      setTokenError(errorMessage(raisedFailure(error)));
    }
  };

  const revokeToken = async (tokenId: string) => {
    setTokenError(null);
    setRevokingToken(tokenId);

    // Mark the row revoked before the request; a failure restores the list.
    const previous = tokens();
    setTokens((value) =>
      value
        ? {
            tokens: value.tokens.map((token) =>
              token.id === tokenId ? { ...token, revokedAt: new Date().toISOString() } : token,
            ),
          }
        : value,
    );

    try {
      await authClient.revokeApiToken(tokenId);
      await refetchTokens();
    } catch (error) {
      setTokens(previous);
      setTokenError(errorMessage(raisedFailure(error), "Could not revoke that token. Try again."));
    } finally {
      setRevokingToken(null);
    }
  };

  const selectClass =
    "h-8 w-full rounded-lg bg-card px-2.5 text-xs text-foreground outline-none transition-colors focus-visible:border-ring focus-visible:ring focus-visible:ring-ring/30";

  return (
    <Page class="max-w-215">
      <PageHeader
        title="Account"
        description="Manage your personal information and security settings."
        meta={
          <Show when={email()}>
            {(current) => (
              <>
                <span class="break-all">{current()}</span>
                <Show
                  when={emailVerified()}
                  fallback={<Badge variant="outline">Not verified</Badge>}
                >
                  <Badge
                    variant="success"
                    data-success-badge="verified"
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
            <p role="alert" class="mt-2 text-xs text-destructive">
              {msg()}
            </p>
          )}
        </Show>
        <Show when={nameSuccess()}>
          <p class="mt-2 text-xs text-success">Name updated successfully.</p>
        </Show>
      </Panel>

      <Panel
        title="Appearance"
        description="Mattrax follows your system theme unless you pick one. The choice is remembered for this account on this browser."
      >
        <ThemeSwitcher userId={user()?.id} class="max-w-sm" />
      </Panel>

      <Panel
        title="Default tenant"
        description="Where Mattrax opens when you sign in on a new device or browser. With no default, the tenant you last opened on this browser is used instead."
      >
        <Show
          when={!(me.isPending && me.data === undefined)}
          fallback={<Skeleton class="h-8 w-full max-w-sm" />}
        >
          <Show
            when={tenants().length > 0}
            fallback={
              <p class="text-xs leading-relaxed text-muted-foreground">
                You don't belong to a tenant yet, so there is nothing to choose. Create or join a
                tenant first.
              </p>
            }
          >
            <form
              onSubmit={handleDefaultTenantSave}
              class="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <div class="min-w-0 flex-1">
                <Field
                  label="Default tenant"
                  hint={
                    me.data?.account.defaultTenantId
                      ? `Currently ${tenantLabel(me.data.account.defaultTenantId)}.`
                      : "No default tenant is set."
                  }
                >
                  <select
                    id="default-tenant"
                    class={selectClass}
                    value={defaultTenantId()}
                    disabled={defaultTenantPending()}
                    onChange={(e) => chooseDefaultTenant(e.currentTarget.value)}
                  >
                    <option value="">Last opened on this browser</option>
                    <For each={tenants()}>
                      {(tenant) => (
                        <option value={tenant.id}>{tenant.displayName ?? tenant.name}</option>
                      )}
                    </For>
                  </select>
                </Field>
              </div>
              <div class="flex gap-2">
                <Show when={me.data?.account.defaultTenantId}>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={defaultTenantPending()}
                    onClick={() => void saveDefaultTenant(null)}
                  >
                    Clear
                  </Button>
                </Show>
                <Button type="submit" disabled={defaultTenantPending()}>
                  {defaultTenantPending() ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          </Show>
        </Show>
        <Show when={defaultTenantError()}>
          {(msg) => (
            <p role="alert" class="mt-2 text-xs text-destructive">
              {msg()}
            </p>
          )}
        </Show>
        <Show when={defaultTenantSaved()}>
          <p role="status" aria-live="polite" class="mt-2 text-xs text-success">
            Default tenant updated.
          </p>
        </Show>
      </Panel>

      <Panel
        title="Email address"
        description="A verification link will be sent to your new address. The change takes effect after you confirm it."
      >
        <p class="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          Your current email is
          <span class="font-medium text-foreground">{email()}</span>
          <Show when={emailVerified()} fallback={<Badge variant="outline">Not verified</Badge>}>
            <Badge
              variant="success"
              data-success-badge="verified"
            >
              Verified
            </Badge>
          </Show>
        </p>
        <Show when={emailCancelled()}>
          <div class="mb-4 rounded-lg border border-warning/25 bg-warning/[0.08] px-4 py-3 text-xs leading-relaxed text-warning-foreground">
            The pending address change was cancelled. No change was made. If you did not expect a
            change, review your active sessions below and add another passkey.
          </div>
        </Show>
        <Show
          when={!emailSent()}
          fallback={
            <div class="rounded-lg border border-success/25 bg-success/[0.08] px-4 py-3 text-xs leading-relaxed text-success">
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
            <p role="alert" class="mt-2 text-xs text-destructive">
              {msg()}
            </p>
          )}
        </Show>
      </Panel>

      <AccountSecurity
        totpEnabled={me.data?.account.totpEnabled ?? false}
        passkeyEnabled={me.data?.account.passkeyEnabled ?? false}
        mfaRequired={me.data?.account.mfaRequired ?? false}
        email={email() ?? ""}
      />

      <AccountLoginAttempts userId={user()?.id} />

      <AccountActivity userId={user()?.id} />

      <Show when={sessionsError()}>
        {(msg) => (
          <p role="alert" class="text-xs text-destructive">
            {msg()}
          </p>
        )}
      </Show>

      <Panel
        title="Active sessions"
        description="Devices and browsers currently signed in to your account. Client details are captured the first time a session is used."
        actions={
          <Button
            variant="outline"
            disabled={signingOutEverywhere()}
            onClick={() => setSignOutEverywhereOpen(true)}
          >
            Sign out everywhere
          </Button>
        }
      >
        <div class="space-y-2">
          <For each={sessions()?.sessions ?? []}>
            {(item) => (
              <div class="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
                <div class="min-w-0">
                  <p class="flex flex-wrap items-center gap-2 text-xs font-medium text-foreground">
                    <span>{sessionLabel(item)}</span>
                    <Show when={item.current}>
                      <Badge
                        variant="success"
                        data-success-badge="current-session"
                      >
                        This session
                      </Badge>
                    </Show>
                  </p>
                  <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {item.lastUsedAt
                      ? `Last used ${relativeTime(item.lastUsedAt)}`
                      : "Not used since sign-in"}
                    {" · "}Signed in {new Date(item.createdAt).toLocaleString()}
                    {" · "}expires {new Date(item.expiresAt).toLocaleString()}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={
                    item.current
                      ? "Sign out of this session"
                      : `Revoke ${sessionLabel(item)} last used ${item.lastUsedAt ? relativeTime(item.lastUsedAt) : "never"}`
                  }
                  onClick={() => revokeSession(item.id, item.current)}
                >
                  {item.current ? "Sign out" : "Revoke"}
                </Button>
              </div>
            )}
          </For>
          <Show when={(sessions()?.sessions.length ?? 0) === 0}>
            <p class="text-xs text-muted-foreground">
              No active sessions were found. Sign in again to start one.
            </p>
          </Show>
        </div>
      </Panel>

      <Panel
        title="API tokens"
        description="Create tokens for CLI and API access. Grant only the permissions a job needs and bind the token to one tenant to limit what it can reach."
        actions={
          <Button
            onClick={() => {
              setTokenError(null);
              setTokenPermissions(availablePermissions());
              setTokenOpen(true);
            }}
          >
            Create token
          </Button>
        }
      >
        <Dialog open={tokenOpen()} onOpenChange={setTokenOpen}>
          <DialogContent class="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create API token</DialogTitle>
              <DialogDescription>
                Choose what the token may do. Its access is the intersection of this grant and your
                role in each tenant; a tenant-bound token is rejected for every other tenant.
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
              <Show
                when={availablePermissions().length > 0}
                fallback={
                  <p class="text-xs text-muted-foreground">Loading your permissions…</p>
                }
              >
                <PermissionPicker
                  available={availablePermissions()}
                  selected={tokenPermissions()}
                  onChange={setTokenPermissions}
                />
              </Show>
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
                  <p role="alert" class="text-xs text-destructive">
                    {msg()}
                  </p>
                )}
              </Show>
              <DialogFooter>
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
              <p class="text-xs font-medium text-warning-foreground">
                Copy this token now. It will not be shown again.
              </p>
              <code class="mt-2 block break-all rounded border border-border bg-muted p-2 font-mono text-xs text-foreground">
                {token()}
              </code>
            </div>
          )}
        </Show>
        <Show when={tokenError()}>
          {(msg) => (
            <p role="alert" class="mb-3 text-xs text-destructive">
              {msg()}
            </p>
          )}
        </Show>

        <div class="space-y-2">
          <For each={tokens()?.tokens ?? []}>
            {(token) => (
              <div class="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
                <div class="min-w-0">
                  <p class="text-xs font-medium text-foreground">{token.name}</p>
                  <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {scopeLabel(token.permissions, token.scopes)} · {tenantLabel(token.tenantId)} ·{" "}
                    {token.tokenPrefix}
                    ... · Created {new Date(token.createdAt).toLocaleDateString()} · Last used{" "}
                    {token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleDateString() : "never"}
                    <Show when={token.expiresAt}>
                      {" "}
                      · Expires {new Date(token.expiresAt!).toLocaleDateString()}
                    </Show>
                  </p>
                  <Show when={token.revokedAt}>
                    <p class="mt-1 text-xs font-medium text-destructive">Revoked</p>
                  </Show>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(token.revokedAt) || revokingToken() === token.id}
                  onClick={() => void revokeToken(token.id)}
                >
                  {revokingToken() === token.id ? "Revoking…" : "Revoke"}
                </Button>
              </div>
            )}
          </For>
          <Show when={tokensError()}>
            {(msg) => (
              <p role="alert" class="text-xs text-destructive">
                {msg()}
              </p>
            )}
          </Show>
          <Show when={!tokensPending() && !tokensError() && (tokens()?.tokens.length ?? 0) === 0}>
            <p class="text-xs text-muted-foreground">
              No API tokens yet. Create one for the CLI or API.
            </p>
          </Show>
        </div>
      </Panel>

      <Panel
        title="Agent access (MCP)"
        description="OAuth clients you have authorised to manage Mattrax through the Model Context Protocol. API tokens above work with MCP too. Revoking a client ends its access and refresh tokens immediately."
      >
        <div class="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
          <span class="text-xs text-muted-foreground">MCP endpoint</span>
          <code class="min-w-0 flex-1 truncate font-mono text-xs text-foreground">/mcp</code>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              void navigator.clipboard?.writeText(`${window.location.origin}/mcp`);
            }}
          >
            Copy URL
          </Button>
          <Button as="a" href="/docs/" size="xs" variant="ghost">
            Docs
          </Button>
        </div>
        <Show when={connections.error}>
          {(error) => (
            <p role="alert" class="text-xs text-destructive">
              {errorMessage(raisedFailure(error()), "Could not load MCP connections")}
            </p>
          )}
        </Show>
        <Show when={connectionError()}>
          {(message) => (
            <p role="alert" class="mb-2 text-xs text-destructive">
              {message()}
            </p>
          )}
        </Show>
        <div class="space-y-2">
          <For each={connections.data?.connections ?? []}>
            {(connection) => (
              <div class="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="text-xs font-medium text-foreground">{connection.clientName}</p>
                    <Show when={connection.revokedAt}>
                      <Badge variant="destructive">Revoked</Badge>
                    </Show>
                  </div>
                  <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {scopeLabel(connection.permissions, connection.scopes)} · Connected{" "}
                    {new Date(connection.createdAt).toLocaleDateString()} · Last used{" "}
                    {connection.lastUsedAt
                      ? new Date(connection.lastUsedAt).toLocaleString()
                      : "never"}
                    {connection.requestCount > 0
                      ? ` · ${connection.requestCount} action${connection.requestCount === 1 ? "" : "s"}`
                      : ""}
                    {connection.lastAction ? ` · ${connection.lastAction}` : ""}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={Boolean(connection.revokedAt) || revoking() === connection.id}
                  onClick={() => void revokeConnection(connection.id)}
                >
                  {revoking() === connection.id ? "Revoking…" : "Revoke"}
                </Button>
              </div>
            )}
          </For>
          <Show
            when={
              !connections.isPending &&
              !connections.error &&
              (connections.data?.connections.length ?? 0) === 0
            }
          >
            <p class="text-xs text-muted-foreground">
              No agent clients are connected. An OAuth-capable MCP client will appear here after you
              authorise it.
            </p>
          </Show>
        </div>
      </Panel>

      <ConfirmDialog
        open={signOutEverywhereOpen()}
        onOpenChange={setSignOutEverywhereOpen}
        title="Sign out everywhere?"
        description="Every browser session for this account is revoked, including this one. You will need a passkey to sign in again."
        confirmLabel="Sign out everywhere"
        destructive
        pending={signingOutEverywhere()}
        onConfirm={() => void signOutEverywhere()}
      />

      <Panel
        class="border-destructive/25 bg-destructive/[0.025]"
        header={
          <div class="min-w-0">
            <h2 class="text-xs font-semibold tracking-tight text-destructive">
              Delete account
            </h2>
            <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Deleting your account also deletes the tenant you own, including its devices,
              policies, audit history and subscription. Mattrax checks that you are the only member
              and owner first, and explains what to do if you are not.
            </p>
          </div>
        }
      >
        <Button type="button" variant="destructive" onClick={() => setDeleteDialogOpen(true)}>
          Delete account
        </Button>

        <Dialog open={deleteDialogOpen()} onOpenChange={setDeleteDialogOpen}>
          <DialogContent class="max-w-md">
            <DialogHeader>
              <DialogTitle>Delete your account?</DialogTitle>
              <DialogDescription>
                Your account and the tenant you own are deleted together. Devices are sent an
                unenroll request, the subscription is cancelled, and policies, audit history and
                stored files are removed. This cannot be undone.
              </DialogDescription>
            </DialogHeader>

            <div class="mt-3">
              <Field label="Type your email address to continue">
                <Input
                  type="email"
                  autofocus
                  autocomplete="email"
                  placeholder={email() ?? ""}
                  value={deleteEmail()}
                  onInput={(event) => setDeleteEmail(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && emailMatches()) {
                      event.preventDefault();
                      openDeletionConfirmation();
                    }
                  }}
                />
              </Field>
            </div>

            <DialogFooter class="mt-4">
              <Button type="button" variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={!emailMatches()}
                onClick={openDeletionConfirmation}
              >
                Continue
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Panel>
    </Page>
  );
}

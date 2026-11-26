import type { Effect } from "effect";

/**
 * A directory provider is an external identity source whose users and groups a
 * tenant imports so policies can target people.
 *
 * The interface is deliberately small. Discovery returns provider-neutral
 * records; applying them to the tenant's directory (upsert, disable, reconcile)
 * lives in one shared pipeline so every provider has the same lease/leaver
 * semantics. Everything provider-specific stays in its own package.
 */
export type DirectoryProviderId = "entra" | "google";

/** The `user.source` value a provider writes. */
export type DirectoryProviderUserSource = "entra" | "google";

/** The `user_group.source` value a provider writes. */
export type DirectoryProviderGroupSource = "graph" | "google";

export type DirectoryProviderCapabilities = {
  readonly users: boolean;
  readonly groups: boolean;
  /**
   * Whether a directory person from this provider can be linked to a Mattrax
   * account for single sign-on. This is a property of the deployed sign-in
   * integration, not of directory sync: Google Workspace sync works without a
   * Google OIDC client, so it reports `false` until one is configured.
   */
  readonly ssoSignIn: boolean;
  /** Whether a per-user administrative deep link can be built. */
  readonly deepLink: boolean;
  /**
   * Whether discovery can return changes since the previous run. Entra uses
   * Graph delta tokens; Google Workspace only offers full listings, which the
   * pipeline reconciles against the previous state.
   */
  readonly incremental: boolean;
};

export type DirectoryUserRecord = {
  /** Provider object id. Stable for the lifetime of the person. */
  readonly externalId: string;
  /** Primary address used to match a manually created person. */
  readonly email: string;
  readonly name: string;
  /**
   * Suspended/disabled upstream. The person is kept (so device links and
   * history survive) but stops granting user-scoped policy.
   */
  readonly disabled?: boolean;
  /** Deleted upstream. Treated like `disabled` plus membership removal. */
  readonly removed?: boolean;
  /** Organisational unit, shown as read-only context. */
  readonly orgUnit?: string;
};

export type DirectoryGroupMember = {
  readonly externalId: string;
  /** Present when the provider reports a membership removal. */
  readonly removed?: boolean;
};

export type DirectoryGroupRecord = {
  readonly externalId: string;
  readonly name: string;
  readonly description?: string;
  readonly members: ReadonlyArray<DirectoryGroupMember>;
  readonly removed?: boolean;
};

export type DirectoryUserPage = {
  readonly users: ReadonlyArray<DirectoryUserRecord>;
  /** Continue paginating with this cursor; absent when the listing ended. */
  readonly nextCursor?: string | null;
  /**
   * Persisted for the next run when the provider supports incremental sync.
   * Absent for providers that always return a complete listing.
   */
  readonly deltaCursor?: string | null;
  /**
   * True when this run enumerates the complete directory. After the last page
   * the pipeline disables people this provider previously imported but did not
   * see. Delta runs leave it false so removals only come from explicit records.
   */
  readonly authoritative: boolean;
};

export type DirectoryGroupPage = {
  readonly groups: ReadonlyArray<DirectoryGroupRecord>;
  readonly nextCursor?: string | null;
  readonly deltaCursor?: string | null;
  readonly authoritative: boolean;
};

/** A verified upstream profile, used for sign-in linking and diagnostics. */
export type DirectoryProfile = {
  readonly externalId: string;
  readonly email: string;
  readonly name: string;
  readonly disabled: boolean;
};

export type DirectoryProfileQuery = {
  readonly externalId?: string | null;
  readonly email?: string | null;
};

export type DirectoryDeepLinkQuery = {
  readonly externalId?: string | null;
  readonly email?: string | null;
};

export type DirectoryProviderHealth = {
  readonly ok: boolean;
  /** Safe, human-readable summary. Must never contain credentials. */
  readonly message?: string;
};

/**
 * A configured provider instance for one tenant (or one validation call).
 *
 * Credentials are captured in the closure, never in the provider definition,
 * so a registry entry cannot be used to discover another tenant's directory.
 */
export type DirectoryUserDirectory<E = unknown> = {
  readonly provider: DirectoryProviderDefinition;
  readonly discoverUsers: (cursor?: string | null) => Effect.Effect<DirectoryUserPage, E>;
  readonly discoverGroups: (cursor?: string | null) => Effect.Effect<DirectoryGroupPage, E>;
  readonly resolveProfile: (
    input: DirectoryProfileQuery,
  ) => Effect.Effect<DirectoryProfile | null, E>;
  /** Verify credentials and reachability without changing tenant state. */
  readonly validate: () => Effect.Effect<DirectoryProviderHealth, E>;
};

/** The registry entry: metadata plus pure, credential-free helpers. */
export type DirectoryProviderDefinition = {
  readonly id: DirectoryProviderId;
  readonly label: string;
  /** Short label for badges and source columns (`Entra`, `Google`). */
  readonly shortLabel: string;
  readonly capabilities: DirectoryProviderCapabilities;
  readonly userSource: DirectoryProviderUserSource;
  readonly groupSource: DirectoryProviderGroupSource;
  /** Administrative console URL for the directory as a whole. */
  readonly adminDirectoryUrl: string;
  /**
   * Build the provider's per-user administration URL. Pure: it may only use
   * the identifiers passed in, and must URL-encode them.
   */
  readonly deepLink: (query: DirectoryDeepLinkQuery) => string | null;
  /**
   * Where credentials for this provider come from:
   * - `tenant`: every tenant supplies its own.
   * - `deployment`: the deployment supplies one app identity.
   * - `tenant-or-deployment`: either, with tenant credentials taking
   *   precedence.
   * - `deployment-and-tenant`: deployment app credentials plus a per-tenant
   *   directory identifier (Entra's tenant id).
   */
  readonly credentials: "tenant" | "deployment" | "tenant-or-deployment" | "deployment-and-tenant";
};

/**
 * Provider definitions only need their metadata checked once, at module load.
 * Keeping this a function (rather than a class) makes the entries plain data
 * that tests can compare without instantiating a registry.
 */
export const defineDirectoryProvider = (
  definition: DirectoryProviderDefinition,
): DirectoryProviderDefinition => definition;

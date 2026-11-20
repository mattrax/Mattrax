import { Effect, Predicate, Schema } from "effect";
import type {
  AzureGraphError,
  AzureGraphService,
  GraphGroup,
  GraphUser,
} from "@mattrax/azure-graph";
import {
  defineDirectoryProvider,
  type DirectoryGroupRecord,
  type DirectoryUserDirectory,
  type DirectoryUserRecord,
} from "@mattrax/directory-sync";

/** Microsoft's admin console for one user, addressed by Entra object id. */
const ENTRA_USER_URL =
  "https://entra.microsoft.com/#view/Microsoft_AAD_UsersAndTenants/UserProfileMenuBlade/~/overview/userId/";

const GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

const optionalString = Schema.optional(Schema.NullOr(Schema.String));

const optionalBoolean = Schema.optional(Schema.NullOr(Schema.Boolean));

const GraphUserProfile = Schema.Struct({
  id: Schema.String,
  displayName: optionalString,
  mail: optionalString,
  userPrincipalName: optionalString,
  accountEnabled: optionalBoolean,
});

const mapUser = (user: GraphUser): DirectoryUserRecord => ({
  externalId: user.id,
  // A removed user only carries the object id; the pipeline still finds the
  // local row by external id to disable it.
  email: (user.mail ?? user.userPrincipalName ?? "").trim().toLowerCase(),
  name: user.displayName?.trim() ?? "",
  disabled: user.accountEnabled === false,
  removed: user.removed,
});

const mapGroup = (group: GraphGroup): DirectoryGroupRecord => ({
  externalId: group.id,
  name: group.displayName,
  description: group.description,
  removed: group.removed,
  members: (group.members ?? [])
    // Graph returns nested groups, service principals and devices too. Only a
    // user membership becomes a directory membership.
    .filter((member) => !member.type || member.type === "user")
    .map((member) => ({ externalId: member.id, removed: member.removed })),
});

const isExpiredDelta = (error: AzureGraphError): boolean =>
  Predicate.isTagged(error, "RequestFailed") &&
  (error.status === 410 || /syncStateNotFound|resyncRequired|resync/i.test(error.body ?? ""));

/**
 * Entra's provider definition. The registry entry is pure data; credentials and
 * the tenant id are captured by {@link entraDirectoryUserDirectory}.
 */
export const entraDirectoryProvider = defineDirectoryProvider({
  id: "entra",
  label: "Microsoft Entra ID",
  shortLabel: "Entra",
  capabilities: {
    users: true,
    groups: true,
    ssoSignIn: true,
    deepLink: true,
    incremental: true,
  },
  userSource: "entra",
  groupSource: "graph",
  adminDirectoryUrl: "https://entra.microsoft.com/",
  credentials: "deployment-and-tenant",
  deepLink: ({ externalId }) =>
    externalId ? `${ENTRA_USER_URL}${encodeURIComponent(externalId)}` : null,
});

/**
 * A configured Entra directory for one tenant.
 *
 * Graph delta tokens are incremental: a stored delta link resumes where the
 * previous run stopped. When Graph expires the token (410) the provider
 * restarts the listing from the beginning and marks it authoritative, so the
 * shared pipeline disables people the listing no longer contains.
 */
export const entraDirectoryUserDirectory = (options: {
  readonly graph: AzureGraphService;
  readonly azureTenantId: string;
}): DirectoryUserDirectory => {
  const { graph, azureTenantId } = options;

  let usersReset = false;
  let groupsReset = false;

  const usersPage = (cursor?: string | null) =>
    graph.usersDelta(azureTenantId, cursor ?? undefined).pipe(
      Effect.catchTag("RequestFailed", (error) => {
        if (!isExpiredDelta(error)) return Effect.fail(error);

        usersReset = true;

        return graph.usersDelta(azureTenantId, undefined);
      }),
    );

  const groupsPage = (cursor?: string | null) =>
    graph.groupsDelta(azureTenantId, cursor ?? undefined).pipe(
      Effect.catchTag("RequestFailed", (error) => {
        if (!isExpiredDelta(error)) return Effect.fail(error);

        groupsReset = true;

        return graph.groupsDelta(azureTenantId, undefined);
      }),
    );

  return {
    provider: entraDirectoryProvider,
    discoverUsers: (cursor) =>
      Effect.gen(function* () {
        const firstPage = !cursor;
        const reset = usersReset;
        const result = yield* usersPage(cursor);

        return {
          users: result.items.map(mapUser),
          nextCursor: result.nextLink,
          deltaCursor: result.nextLink ? undefined : (result.deltaLink ?? undefined),
          authoritative: firstPage || reset,
        };
      }),
    discoverGroups: (cursor) =>
      Effect.gen(function* () {
        const firstPage = !cursor;
        const reset = groupsReset;
        const result = yield* groupsPage(cursor);

        return {
          groups: result.items.map(mapGroup),
          nextCursor: result.nextLink,
          deltaCursor: result.nextLink ? undefined : (result.deltaLink ?? undefined),
          authoritative: firstPage || reset,
        };
      }),
    resolveProfile: ({ externalId, email }) => {
      const key = externalId ?? email;

      if (!key) return Effect.succeed(null);

      return graph
        .get(
          azureTenantId,
          `${GRAPH_BASE_URL}/users/${encodeURIComponent(key)}?$select=id,displayName,mail,userPrincipalName,accountEnabled`,
          GraphUserProfile,
        )
        .pipe(
          Effect.map((user) => ({
            externalId: user.id,
            email: (user.mail ?? user.userPrincipalName ?? "").trim().toLowerCase(),
            name: user.displayName?.trim() ?? "",
            disabled: user.accountEnabled === false,
          })),
          Effect.catchTag("NotFound", () => Effect.succeed(null)),
        );
    },
    validate: () =>
      graph.domains(azureTenantId).pipe(
        Effect.map((domains) => ({
          ok: true,
          message: `Microsoft Graph reachable; ${domains.length} domain(s) visible.`,
        })),
      ),
  };
};

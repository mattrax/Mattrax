import { Effect } from "effect";
import { defineDirectoryProvider } from "@mattrax/directory-sync";
import type {
  DirectoryGroupRecord,
  DirectoryUserDirectory,
  DirectoryUserRecord,
} from "@mattrax/directory-sync";
import type {
  GoogleDirectoryUser,
  GoogleWorkspaceError,
  GoogleWorkspaceService,
} from "./service.js";

/** Google Admin console: a user's detail card, by Workspace id or email. */
export const GOOGLE_ADMIN_USERS_URL = "https://admin.google.com/ac/users";

const toRecord = (user: GoogleDirectoryUser): DirectoryUserRecord => ({
  externalId: user.id,
  email: user.primaryEmail,
  name: user.name,
  disabled: user.suspended || user.archived || user.deleted,
  // A deleted account is only returned when `showDeleted=true`. Treat it as a
  // removal so its directory memberships are dropped; the local person and
  // their device links stay for history.
  ...(user.deleted ? { removed: true } : {}),
});

/**
 * Google Workspace provider definition.
 *
 * SSO is `false` on purpose: Workspace directory sync uses a service account,
 * while dashboard sign-in needs a Google OIDC client and a verified ID token.
 * This package exposes {@link googleWorkspaceDirectoryUserDirectory}'s
 * `resolveProfile` for a future link flow, but it does not pretend a synced
 * Google user can sign in.
 */
export const googleWorkspaceDirectoryProvider = defineDirectoryProvider({
  id: "google",
  label: "Google Workspace",
  shortLabel: "Google",
  capabilities: {
    users: true,
    groups: true,
    ssoSignIn: false,
    deepLink: true,
    // Directory API has no delta/sync token; every run is a full listing.
    incremental: false,
  },
  userSource: "google",
  groupSource: "google",
  adminDirectoryUrl: GOOGLE_ADMIN_USERS_URL,
  credentials: "tenant-or-deployment",
  deepLink: ({ externalId, email }) => {
    const key = externalId ?? email;

    return key ? `${GOOGLE_ADMIN_USERS_URL}/${encodeURIComponent(key)}` : null;
  },
});

/**
 * A configured Workspace directory for one tenant.
 *
 * Users are always a full, authoritative listing. Groups are also full
 * listings; membership is fetched per group, bounded by the service, and only
 * for groups Google reports as non-empty. The shared pipeline compares the
 * result with the previous run, so an unchanged person is not rewritten.
 */
export const googleWorkspaceDirectoryUserDirectory = (options: {
  readonly service: GoogleWorkspaceService;
}): DirectoryUserDirectory<GoogleWorkspaceError> => {
  const { service } = options;

  return {
    provider: googleWorkspaceDirectoryProvider,
    discoverUsers: (cursor) =>
      service.listUsers(cursor).pipe(
        Effect.map((page) => ({
          users: page.users.map(toRecord),
          nextCursor: page.nextPageToken,
          // No delta cursor: the listing is complete for this run.
          authoritative: true,
        })),
      ),
    discoverGroups: (cursor) =>
      Effect.gen(function* () {
        const page = yield* service.listGroups(cursor);

        const groups = yield* Effect.forEach(
          page.groups,
          (group) =>
            Effect.gen(function* () {
              // Fetch when the group is non-empty or the count is unknown; an
              // absent count must not look like "no members", or the pipeline
              // would reconcile real memberships away.
              const members =
                group.directMembersCount === 0 ? [] : yield* service.listAllGroupMembers(group.id);

              const record: DirectoryGroupRecord = {
                externalId: group.id,
                name: group.name,
                description: group.description,
                members: members.map((member) => ({ externalId: member.id })),
              };

              return record;
            }),
          // Directory API quotas are per user; two groups at a time keeps a
          // large tenant well inside them while still finishing in time.
          { concurrency: 2 },
        );

        return {
          groups,
          nextCursor: page.nextPageToken,
          authoritative: true,
        };
      }),
    resolveProfile: ({ externalId, email }) => {
      const key = externalId ?? email;

      if (!key) return Effect.succeed(null);

      return service.getUser(key).pipe(
        Effect.map((user) =>
          user
            ? {
                externalId: user.id,
                email: user.primaryEmail,
                name: user.name,
                disabled: user.suspended || user.archived || user.deleted,
              }
            : null,
        ),
      );
    },
    validate: () => service.validate(),
  };
};

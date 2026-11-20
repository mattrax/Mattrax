import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { GoogleWorkspaceCredentials } from "./config.js";
import {
  decodeServiceAccountJson,
  decodeDeploymentCredentials,
  redactGoogleCredentials,
} from "./config.js";
import {
  googleWorkspaceDirectoryProvider,
  googleWorkspaceDirectoryUserDirectory,
  GOOGLE_ADMIN_USERS_URL,
} from "./provider.js";
import type { GoogleWorkspaceService } from "./service.js";
import { googleDirectorySyncStatus, type GoogleDirectorySyncRow } from "./sync.js";

const serviceAccountJson = (
  overrides: Partial<{ type: string; client_email: string; private_key: string }> = {},
) =>
  JSON.stringify({
    type: "service_account",
    client_email: "sync@project.iam.gserviceaccount.com",
    private_key: "-----BEGIN PRIVATE KEY-----\nSECRETKEYMATERIAL\n-----END PRIVATE KEY-----\n",
    ...overrides,
  });

const credentials: GoogleWorkspaceCredentials = {
  serviceAccount: {
    clientEmail: "sync@project.iam.gserviceaccount.com",
    privateKeyPem: "-----BEGIN PRIVATE KEY-----\nSECRETKEYMATERIAL\n-----END PRIVATE KEY-----",
  },
  adminEmail: "admin@example.com",
  customer: "my_customer",
};

const service = (overrides: Partial<GoogleWorkspaceService> = {}): GoogleWorkspaceService => ({
  listUsers: () => Effect.succeed({ users: [] }),
  listGroups: () => Effect.succeed({ groups: [] }),
  listGroupMembers: () => Effect.succeed({ members: [] }),
  listAllGroupMembers: () => Effect.succeed([]),
  getUser: () => Effect.succeed(null),
  validate: () => Effect.succeed({ ok: true, message: "ok" }),
  ...overrides,
});

describe("Google Workspace provider", () => {
  it("builds encoded per-user admin deep links", () => {
    expect(googleWorkspaceDirectoryProvider.deepLink({ externalId: "user+id@example.com" })).toBe(
      `${GOOGLE_ADMIN_USERS_URL}/user%2Bid%40example.com`,
    );
    expect(googleWorkspaceDirectoryProvider.deepLink({ email: "a b@example.com" })).toBe(
      `${GOOGLE_ADMIN_USERS_URL}/a%20b%40example.com`,
    );
    expect(googleWorkspaceDirectoryProvider.deepLink({})).toBeNull();
    expect(googleWorkspaceDirectoryProvider.capabilities.ssoSignIn).toBe(false);
  });

  it("maps a full user listing to directory records", async () => {
    const directory = googleWorkspaceDirectoryUserDirectory({
      service: service({
        listUsers: () =>
          Effect.succeed({
            users: [
              {
                id: "u1",
                primaryEmail: "one@example.com",
                name: "One",
                suspended: false,
                archived: false,
                deleted: false,
                isAdmin: false,
              },
              {
                id: "u2",
                primaryEmail: "two@example.com",
                name: "Two",
                suspended: true,
                archived: false,
                deleted: false,
                isAdmin: false,
              },
              {
                id: "u3",
                primaryEmail: "three@example.com",
                name: "Three",
                suspended: false,
                archived: false,
                deleted: true,
                isAdmin: false,
              },
            ],
            nextPageToken: "next",
          }),
      }),
    });

    const page = await Effect.runPromise(directory.discoverUsers());

    expect(page.authoritative).toBe(true);
    expect(page.nextCursor).toBe("next");
    expect(page.users).toEqual([
      { externalId: "u1", email: "one@example.com", name: "One", disabled: false },
      { externalId: "u2", email: "two@example.com", name: "Two", disabled: true },
      {
        externalId: "u3",
        email: "three@example.com",
        name: "Three",
        disabled: true,
        removed: true,
      },
    ]);
  });

  it("resolves a verified profile by id or email", async () => {
    const directory = googleWorkspaceDirectoryUserDirectory({
      service: service({
        getUser: (key) =>
          Effect.succeed(
            key === "one@example.com"
              ? {
                  id: "u1",
                  primaryEmail: "one@example.com",
                  name: "One",
                  suspended: false,
                  archived: false,
                  deleted: false,
                  isAdmin: false,
                }
              : null,
          ),
      }),
    });

    await expect(
      Effect.runPromise(directory.resolveProfile({ email: "one@example.com" })),
    ).resolves.toEqual({
      externalId: "u1",
      email: "one@example.com",
      name: "One",
      disabled: false,
    });

    await expect(
      Effect.runPromise(directory.resolveProfile({ externalId: "missing" })),
    ).resolves.toBeNull();
  });

  it("only fetches members for non-empty groups and drops empty memberships", async () => {
    const fetched: string[] = [];

    const directory = googleWorkspaceDirectoryUserDirectory({
      service: service({
        listGroups: () =>
          Effect.succeed({
            groups: [
              {
                id: "g1",
                email: "staff@example.com",
                name: "Staff",
                directMembersCount: 2,
              },
              {
                id: "g2",
                email: "empty@example.com",
                name: "Empty",
                directMembersCount: 0,
              },
            ],
          }),
        listAllGroupMembers: (groupKey) => {
          fetched.push(groupKey);

          return Effect.succeed([{ id: "u1", email: "one@example.com", type: "USER" }]);
        },
      }),
    });

    const page = await Effect.runPromise(directory.discoverGroups());

    expect(fetched).toEqual(["g1"]);
    expect(page.groups).toEqual([
      {
        externalId: "g1",
        name: "Staff",
        description: undefined,
        members: [{ externalId: "u1" }],
      },
      { externalId: "g2", name: "Empty", description: undefined, members: [] },
    ]);
    expect(page.authoritative).toBe(true);
  });
});

describe("Google Workspace configuration", () => {
  it("accepts a service-account JSON document", async () => {
    await expect(
      Effect.runPromise(decodeServiceAccountJson(serviceAccountJson())),
    ).resolves.toEqual({
      clientEmail: "sync@project.iam.gserviceaccount.com",
      privateKeyPem: "-----BEGIN PRIVATE KEY-----\nSECRETKEYMATERIAL\n-----END PRIVATE KEY-----\n",
    });
  });

  it("rejects malformed or incomplete documents without echoing them", async () => {
    const missing = await Effect.runPromise(
      Effect.flip(decodeServiceAccountJson(serviceAccountJson({ private_key: undefined }))),
    );

    expect(missing.message).toMatch(/missing client_email or private_key/);
    expect(missing.message).not.toContain("SECRETKEYMATERIAL");

    const malformed = await Effect.runPromise(
      Effect.flip(decodeServiceAccountJson("{not json SECRETKEYMATERIAL")),
    );

    expect(malformed.message).toMatch(/not valid JSON/);
    expect(malformed.message).not.toContain("SECRETKEYMATERIAL");
  });

  it("requires a super-admin email for deployment credentials", async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        decodeDeploymentCredentials({
          serviceAccountJson: serviceAccountJson(),
          adminEmail: "not-an-email",
        }),
      ),
    );

    expect(error.message).toMatch(/GOOGLE_WORKSPACE_ADMIN_EMAIL/);
    expect(error.message).not.toContain("SECRETKEYMATERIAL");
  });

  it("redacts the private key if it ever reaches an error string", () => {
    const redacted = redactGoogleCredentials(
      `boom ${credentials.serviceAccount.privateKeyPem} boom`,
      credentials,
    );

    expect(redacted).toBe("boom [redacted] boom");
    expect(redacted).not.toContain("SECRETKEYMATERIAL");
    expect(redactGoogleCredentials("boom", undefined)).toBe("boom");
  });

  it("builds a status view that cannot contain the sealed key", () => {
    const row: GoogleDirectorySyncRow = {
      organizationId: "org-1",
      enabled: true,
      adminEmail: "admin@example.com",
      customer: "example.com",
      serviceAccountEmail: "sync@project.iam.gserviceaccount.com",
      sealedServiceAccount: "ciphertext-with-SECRETKEYMATERIAL",
      status: "idle",
      lastSyncedAt: new Date("2026-11-20T00:00:00.000Z"),
      lastAttemptedAt: null,
      lastError: null,
      lastCounts: { users: 2, groups: 1 },
      syncIntervalMinutes: 60,
      nextSyncAt: null,
      lastRunTrigger: "manual",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const view = googleDirectorySyncStatus(row);
    const serialised = JSON.stringify(view);

    expect(view.configured).toBe(true);
    expect(view.credentialsSource).toBe("tenant");
    expect(view.serviceAccountEmail).toBe("sync@project.iam.gserviceaccount.com");
    expect(serialised).not.toContain("SECRETKEYMATERIAL");
    expect(serialised).not.toContain("sealedServiceAccount");
    expect(serialised).not.toContain("private");
  });

  it("falls back to deployment credentials in the status view", () => {
    const view = googleDirectorySyncStatus(undefined, { deployment: credentials });

    expect(view.configured).toBe(true);
    expect(view.credentialsSource).toBe("deployment");
    expect(view.adminEmail).toBe("admin@example.com");
    expect(JSON.stringify(view)).not.toContain("SECRETKEYMATERIAL");
  });
});

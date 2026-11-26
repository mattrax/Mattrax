import { Effect } from "effect";
import { TestConsole } from "effect/testing";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { sealSecret } from "@mattrax/crypto";
import { defineDirectoryProvider, syncDirectory } from "@mattrax/directory-sync";
import {
  googleWorkspaceDirectoryUserDirectory,
  loadGoogleDirectoryConfig,
  runGoogleDirectorySyncForTenant,
  runScheduledGoogleSync,
} from "@mattrax/google-workspace";
import type { GoogleWorkspaceCredentials, GoogleWorkspaceService } from "@mattrax/google-workspace";
import { GoogleWorkspaceError } from "@mattrax/google-workspace";
import { EnterpriseBadRequest } from "@mattrax/enterprise-domain";
import { schema } from "@mattrax/enterprise-core";
import { linkDirectoryUserSso } from "@mattrax/enterprise-backend";
import { makeDb } from "./helpers.js";

const authSecret = "google-directory-sync-test-secret";

const credentials: GoogleWorkspaceCredentials = {
  serviceAccount: {
    clientEmail: "sync@project.iam.gserviceaccount.com",
    privateKeyPem: "-----BEGIN PRIVATE KEY-----\nSECRETKEYMATERIAL\n-----END PRIVATE KEY-----",
  },
  adminEmail: "admin@example.com",
  customer: "my_customer",
};

const serviceAccountJson = JSON.stringify({
  type: "service_account",
  client_email: "sync@project.iam.gserviceaccount.com",
  private_key: credentials.serviceAccount.privateKeyPem,
});

const user = (
  id: string,
  email: string,
  options: { suspended?: boolean; deleted?: boolean } = {},
) => ({
  id,
  primaryEmail: email,
  name: email.split("@")[0],
  suspended: options.suspended ?? false,
  archived: false,
  deleted: options.deleted ?? false,
  isAdmin: false,
});

const service = (
  options: {
    users?: ReadonlyArray<ReturnType<typeof user>>;
    groups?: ReadonlyArray<{
      id: string;
      email: string;
      name: string;
      directMembersCount: number;
    }>;
    members?: Record<string, ReadonlyArray<{ id: string; type: string }>>;
  },
  overrides: Partial<GoogleWorkspaceService> = {},
): GoogleWorkspaceService => ({
  listUsers: () => Effect.succeed({ users: options.users ?? [] }),
  listGroups: () => Effect.succeed({ groups: options.groups ?? [] }),
  listGroupMembers: () => Effect.succeed({ members: [] }),
  listAllGroupMembers: (groupKey) => Effect.succeed(options.members?.[groupKey] ?? []),
  getUser: () => Effect.succeed(null),
  validate: () => Effect.succeed({ ok: true, message: "ok" }),
  ...overrides,
});

const timestamp = new Date("2026-11-01T00:00:00.000Z");

const seedDirectory = () =>
  makeDb({
    organization: [
      { id: "org-1", name: "One", slug: "one", createdAt: timestamp, updatedAt: timestamp },
      { id: "org-2", name: "Two", slug: "two", createdAt: timestamp, updatedAt: timestamp },
    ],
    user: [
      {
        id: "dir-1",
        organizationId: "org-1",
        name: "One",
        email: "one@example.com",
        externalId: "google-1",
        source: "google",
        disabled: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "dir-2",
        organizationId: "org-1",
        name: "Two",
        email: "two@example.com",
        externalId: "google-2",
        source: "google",
        disabled: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "dir-other",
        organizationId: "org-2",
        name: "Other tenant",
        email: "one@example.com",
        externalId: "google-1",
        source: "google",
        disabled: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    user_group: [
      {
        id: "group-1",
        organizationId: "org-1",
        name: "Staff",
        externalId: "google-g1",
        description: null,
        source: "google",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "group-other",
        organizationId: "org-2",
        name: "Other staff",
        externalId: "google-g1",
        description: null,
        source: "google",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    user_group_member: [
      { groupId: "group-1", userId: "dir-1" },
      { groupId: "group-1", userId: "dir-2" },
      { groupId: "group-other", userId: "dir-other" },
    ],
    device_user: [
      {
        organizationId: "org-1",
        deviceId: "device-1",
        userId: "dir-1",
        source: "directory",
        createdAt: timestamp,
      },
    ],
  });

describe("Google Workspace directory sync", () => {
  it("upserts users and groups, disables suspended people and keeps device links", async () => {
    const db = seedDirectory();
    const changed: Array<ReadonlyArray<string>> = [];

    const outcome = await Effect.runPromise(
      runGoogleDirectorySyncForTenant({
        db,
        organizationId: "org-1",
        credentials,
        now: new Date("2026-11-20T12:00:00.000Z"),
        service: service({
          users: [
            user("google-1", "one@example.com", { suspended: true }),
            user("google-2", "two@example.com"),
            user("google-3", "three@example.com"),
          ],
          groups: [
            { id: "google-g1", email: "staff@example.com", name: "Staff", directMembersCount: 2 },
          ],
          members: {
            "google-g1": [
              { id: "google-2", type: "USER" },
              { id: "google-3", type: "USER" },
            ],
          },
        }),
        onMembershipsChanged: (_organizationId, userIds) =>
          Effect.sync(() => {
            changed.push(userIds);
          }),
      }),
    );

    // Suspended/removed records are reconciled, not counted as imported users
    // (same contract as the Entra sync).
    expect(outcome).toEqual({ status: "ok", users: 2, groups: 1 });

    // The suspended person is disabled and loses directory grants; the device
    // link is deliberately kept for correlation/history.
    expect(db.store.user.find((row: any) => row.id === "dir-1")).toMatchObject({
      disabled: true,
      externalId: "google-1",
    });
    expect(db.store.device_user).toContainEqual(
      expect.objectContaining({ deviceId: "device-1", userId: "dir-1" }),
    );

    // Active people stay enabled; a new person is imported with source google.
    expect(db.store.user.find((row: any) => row.id === "dir-2")).toMatchObject({
      disabled: false,
    });
    expect(db.store.user).toContainEqual(
      expect.objectContaining({
        organizationId: "org-1",
        email: "three@example.com",
        externalId: "google-3",
        source: "google",
      }),
    );

    // Cross-tenant isolation: the same external id in org-2 is untouched.
    expect(db.store.user.find((row: any) => row.id === "dir-other")).toMatchObject({
      disabled: false,
    });
    expect(db.store.user_group_member).toContainEqual({
      groupId: "group-other",
      userId: "dir-other",
    });

    const memberships = db.store.user_group_member.filter((row: any) => row.groupId === "group-1");
    expect(memberships).not.toContainEqual({ groupId: "group-1", userId: "dir-1" });
    expect(memberships).toHaveLength(2);

    expect(changed[0]).toContain("dir-1");

    const state = db.store.google_directory_sync.find((row: any) => row.organizationId === "org-1");
    expect(state).toMatchObject({
      status: "idle",
      lastCounts: { users: 2, groups: 1 },
      lastRunTrigger: "manual",
      nextSyncAt: null,
    });
    expect(state.lastError).toBeNull();
    expect(state.lastSyncedAt).toEqual(new Date("2026-11-20T12:00:00.000Z"));
  });

  it("does not steal an address owned by another directory provider", async () => {
    const db = seedDirectory();
    db.store.user.push({
      id: "dir-entra",
      organizationId: "org-1",
      name: "Shared",
      email: "shared@example.com",
      externalId: "entra-1",
      source: "entra",
      disabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await Effect.runPromise(
      runGoogleDirectorySyncForTenant({
        db,
        organizationId: "org-1",
        credentials,
        service: service({
          users: [user("google-2", "two@example.com"), user("google-4", "shared@example.com")],
          groups: [
            { id: "google-g1", email: "staff@example.com", name: "Staff", directMembersCount: 0 },
          ],
        }),
      }),
    );

    expect(db.store.user.find((row: any) => row.id === "dir-entra")).toMatchObject({
      source: "entra",
      externalId: "entra-1",
      disabled: false,
    });
    expect(db.store.user.find((row: any) => row.externalId === "google-4")).toBeUndefined();
  });

  it("removes memberships missing from a later complete listing and converges once", async () => {
    const db = seedDirectory();
    const changed: Array<ReadonlyArray<string>> = [];
    const onMembershipsChanged = (_organizationId: string, userIds: ReadonlyArray<string>) =>
      Effect.sync(() => {
        changed.push(userIds);
      });
    const users = [user("google-1", "one@example.com"), user("google-2", "two@example.com")];
    const groups = [
      { id: "google-g1", email: "staff@example.com", name: "Staff", directMembersCount: 2 },
    ];

    await Effect.runPromise(
      runGoogleDirectorySyncForTenant({
        db,
        organizationId: "org-1",
        credentials,
        service: service({
          users,
          groups,
          members: {
            "google-g1": [
              { id: "google-1", type: "USER" },
              { id: "google-2", type: "USER" },
            ],
          },
        }),
        onMembershipsChanged,
      }),
    );

    expect(changed).toEqual([]);

    await Effect.runPromise(
      runGoogleDirectorySyncForTenant({
        db,
        organizationId: "org-1",
        credentials,
        service: service({
          users,
          groups,
          members: { "google-g1": [{ id: "google-2", type: "USER" }] },
        }),
        onMembershipsChanged,
      }),
    );

    expect(db.store.user_group_member).toContainEqual({ groupId: "group-1", userId: "dir-2" });
    expect(db.store.user_group_member).not.toContainEqual({ groupId: "group-1", userId: "dir-1" });
    expect(changed).toEqual([["dir-1"]]);

    await Effect.runPromise(
      runGoogleDirectorySyncForTenant({
        db,
        organizationId: "org-1",
        credentials,
        service: service({
          users,
          groups,
          members: { "google-g1": [{ id: "google-2", type: "USER" }] },
        }),
        onMembershipsChanged,
      }),
    );

    expect(changed).toEqual([["dir-1"]]);
  });

  it("marks disabled users seen and does not wake devices on repeated listings", async () => {
    const db = seedDirectory();
    const changed: Array<ReadonlyArray<string>> = [];
    const onMembershipsChanged = (_organizationId: string, userIds: ReadonlyArray<string>) =>
      Effect.sync(() => {
        changed.push(userIds);
      });
    const suspended = user("google-1", "one@example.com", { suspended: true });
    const users = [suspended, user("google-2", "two@example.com")];
    const groups = [
      { id: "google-g1", email: "staff@example.com", name: "Staff", directMembersCount: 2 },
    ];
    const members = {
      "google-g1": [
        { id: "google-1", type: "USER" },
        { id: "google-2", type: "USER" },
      ],
    };

    await Effect.runPromise(
      runGoogleDirectorySyncForTenant({
        db,
        organizationId: "org-1",
        credentials,
        now: new Date("2026-11-20T12:00:00.000Z"),
        service: service({ users, groups, members }),
        onMembershipsChanged,
      }),
    );

    const disabled = db.store.user.find((row: any) => row.id === "dir-1");
    const firstUpdatedAt = disabled.updatedAt;

    expect(disabled.disabled).toBe(true);
    expect(db.store.user_group_member).not.toContainEqual({ groupId: "group-1", userId: "dir-1" });
    expect(changed).toEqual([["dir-1"]]);

    await Effect.runPromise(
      runGoogleDirectorySyncForTenant({
        db,
        organizationId: "org-1",
        credentials,
        now: new Date("2026-11-21T12:00:00.000Z"),
        service: service({ users, groups, members }),
        onMembershipsChanged,
      }),
    );

    expect(db.store.user.find((row: any) => row.id === "dir-1").updatedAt).toEqual(firstUpdatedAt);
    expect(changed).toEqual([["dir-1"]]);
  });

  it("rolls back authoritative reconciliation when the cursor checkpoint fails", async () => {
    const db = seedDirectory();
    db.store.user.push({
      id: "dir-entra-missing",
      organizationId: "org-1",
      name: "Missing",
      email: "missing@example.com",
      externalId: "entra-missing",
      source: "entra",
      disabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    db.store.entra_directory_sync.push({
      organizationId: "org-1",
      usersDeltaLink: "old-cursor",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const provider = defineDirectoryProvider({
      id: "entra",
      label: "Microsoft Entra ID",
      shortLabel: "Entra",
      capabilities: {
        users: true,
        groups: false,
        ssoSignIn: true,
        deepLink: true,
        incremental: true,
      },
      userSource: "entra",
      groupSource: "graph",
      adminDirectoryUrl: "https://entra.test",
      credentials: "deployment-and-tenant",
      deepLink: () => null,
    });
    let checkpointAttempted = false;

    const error = await Effect.runPromise(
      Effect.flip(
        syncDirectory({
          db,
          organizationId: "org-1",
          directory: {
            provider,
            discoverUsers: () =>
              Effect.succeed({
                users: [],
                deltaCursor: "new-cursor",
                authoritative: true,
              }),
            discoverGroups: () => Effect.succeed({ groups: [], authoritative: false }),
            resolveProfile: () => Effect.succeed(null),
            validate: () => Effect.succeed({ ok: true }),
          },
          onUsersComplete: (progress, tx) =>
            Effect.gen(function* () {
              checkpointAttempted = true;
              yield* tx
                .update(schema.entraDirectorySync)
                .set({ usersDeltaLink: progress.cursor })
                .where(eq(schema.entraDirectorySync.organizationId, "org-1"));

              return yield* Effect.fail(new Error("checkpoint failed"));
            }),
        }),
      ),
    );

    expect(error._tag).toBe("DirectorySyncTransactionError");
    expect(checkpointAttempted).toBe(true);
    expect(db.store.user.find((row: any) => row.id === "dir-entra-missing").disabled).toBe(false);
    expect(db.store.entra_directory_sync[0].usersDeltaLink).toBe("old-cursor");
  });

  it("does not advance a cursor when a later provider page fails", async () => {
    const db = makeDb();
    const failure = new GoogleWorkspaceError({ message: "page unavailable", status: 503 });
    let checkpointAttempted = false;
    const provider = defineDirectoryProvider({
      id: "entra",
      label: "Microsoft Entra ID",
      shortLabel: "Entra",
      capabilities: {
        users: true,
        groups: false,
        ssoSignIn: true,
        deepLink: true,
        incremental: true,
      },
      userSource: "entra",
      groupSource: "graph",
      adminDirectoryUrl: "https://entra.test",
      credentials: "deployment-and-tenant",
      deepLink: () => null,
    });

    const error = await Effect.runPromise(
      Effect.flip(
        syncDirectory({
          db,
          organizationId: "org-1",
          directory: {
            provider,
            discoverUsers: (cursor) =>
              cursor
                ? Effect.fail(failure)
                : Effect.succeed({
                    users: [],
                    nextCursor: "page-2",
                    authoritative: false,
                  }),
            discoverGroups: () => Effect.succeed({ groups: [], authoritative: false }),
            resolveProfile: () => Effect.succeed(null),
            validate: () => Effect.succeed({ ok: true }),
          },
          onUsersComplete: () =>
            Effect.sync(() => {
              checkpointAttempted = true;
            }),
        }),
      ),
    );

    expect(error).toBe(failure);
    expect(checkpointAttempted).toBe(false);
  });

  it("preserves typed Google provider failures through the shared pipeline", async () => {
    const db = seedDirectory();
    const failure = new GoogleWorkspaceError({ message: "provider unavailable", status: 503 });
    const directory = googleWorkspaceDirectoryUserDirectory({
      service: service({}, { listUsers: () => Effect.fail(failure) }),
    });

    const error = await Effect.runPromise(
      Effect.flip(syncDirectory({ db, organizationId: "org-1", directory })),
    );

    expect(error).toBe(failure);
  });

  it("redacts provider credentials from status errors and structured logs", async () => {
    const db = seedDirectory();
    const secret = credentials.serviceAccount.privateKeyPem;
    const failure = new GoogleWorkspaceError({ message: `provider failed: ${secret}` });

    const { outcome, errors } = await Effect.runPromise(
      Effect.gen(function* () {
        const outcome = yield* runGoogleDirectorySyncForTenant({
          db,
          organizationId: "org-1",
          credentials,
          service: service({}, { listUsers: () => Effect.fail(failure) }),
        });
        const errors = yield* TestConsole.errorLines;

        return { outcome, errors };
      }).pipe(Effect.provide(TestConsole.layer)),
    );

    expect(outcome.status).toBe("error");
    if (outcome.status !== "error") throw new Error("Expected sync failure");
    expect(outcome.message).toContain("[redacted]");
    expect(outcome.message).not.toContain(secret);
    expect(JSON.stringify(errors)).not.toContain(secret);
    expect(db.store.google_directory_sync[0].lastError).toBe(outcome.message);
  });

  it("disables people missing from an authoritative full listing", async () => {
    const db = seedDirectory();

    await Effect.runPromise(
      runGoogleDirectorySyncForTenant({
        db,
        organizationId: "org-1",
        credentials,
        service: service({
          users: [user("google-2", "two@example.com")],
          groups: [
            { id: "google-g1", email: "staff@example.com", name: "Staff", directMembersCount: 0 },
          ],
        }),
      }),
    );

    expect(db.store.user.find((row: any) => row.id === "dir-1")).toMatchObject({
      disabled: true,
    });
    // A removed person keeps the device link but loses directory membership.
    expect(db.store.device_user).toHaveLength(1);
    expect(db.store.user_group_member).not.toContainEqual({
      groupId: "group-1",
      userId: "dir-1",
    });
  });

  it("does not run while another run holds the lock", async () => {
    const db = seedDirectory();
    db.store.google_directory_sync.push({
      organizationId: "org-1",
      enabled: true,
      status: "running",
      syncIntervalMinutes: 0,
      lastAttemptedAt: new Date(),
      createdAt: timestamp,
      updatedAt: new Date(),
    });

    const outcome = await Effect.runPromise(
      runGoogleDirectorySyncForTenant({
        db,
        organizationId: "org-1",
        credentials,
        service: service({}),
      }),
    );

    expect(outcome).toEqual({ status: "locked" });
  });

  it("reports not configured rather than failing when no credentials exist", async () => {
    const db = seedDirectory();

    const outcome = await Effect.runPromise(
      runGoogleDirectorySyncForTenant({
        db,
        organizationId: "org-1",
        credentials: null,
        service: service({}),
      }),
    );

    expect(outcome.status).toBe("not_configured");
  });

  it("runs only tenants that are due in a scheduled sweep", async () => {
    const db = seedDirectory();
    const past = new Date("2026-11-01T00:00:00.000Z");
    const future = new Date("2027-01-01T00:00:00.000Z");

    db.store.google_directory_sync.push(
      {
        organizationId: "org-1",
        enabled: true,
        status: "idle",
        syncIntervalMinutes: 60,
        nextSyncAt: past,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        organizationId: "org-2",
        enabled: true,
        status: "idle",
        syncIntervalMinutes: 60,
        nextSyncAt: future,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    );

    const result = await Effect.runPromise(
      runScheduledGoogleSync({
        db,
        now: new Date("2026-11-20T12:00:00.000Z"),
        resolveCredentials: (organizationId) =>
          Effect.succeed(organizationId === "org-1" ? credentials : null),
        service: service({ users: [user("google-2", "two@example.com")] }),
      }),
    );

    expect(result).toEqual({ due: 1, succeeded: 1, failed: 0, skipped: 0, locked: 0 });
    expect(db.store.user.find((row: any) => row.id === "dir-1")?.disabled).toBe(true);
    expect(db.store.user.find((row: any) => row.id === "dir-other")?.disabled).toBe(false);
  });
});

describe("Google Workspace SSO", () => {
  it("refuses to link a Google directory user instead of faking sign-in", async () => {
    const db = seedDirectory();

    const error = await Effect.runPromise(
      Effect.flip(linkDirectoryUserSso(db, { organizationId: "org-1", directoryUserId: "dir-1" })),
    );

    expect(error).toBeInstanceOf(EnterpriseBadRequest);
    expect(error.message).toContain("Google Workspace");
    expect(error.message).toContain("single sign-on");
    expect(db.store.sso_identity).toEqual([]);
  });
});

describe("Google Workspace credential storage", () => {
  it("prefers tenant-sealed credentials and decrypts them", async () => {
    const db = makeDb({
      google_directory_sync: [
        {
          organizationId: "org-1",
          enabled: true,
          adminEmail: "tenant-admin@example.com",
          customer: "example.com",
          serviceAccountEmail: "tenant@project.iam.gserviceaccount.com",
          sealedServiceAccount: await sealSecret(authSecret, serviceAccountJson),
          status: "idle",
          syncIntervalMinutes: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });

    const loaded = await Effect.runPromise(
      loadGoogleDirectoryConfig({
        db,
        organizationId: "org-1",
        authSecret,
        deployment: { ...credentials, adminEmail: "deployment@example.com" },
      }),
    );

    expect(loaded?.source).toBe("tenant");
    expect(loaded?.credentials.adminEmail).toBe("tenant-admin@example.com");
    expect(loaded?.credentials.customer).toBe("example.com");
    expect(loaded?.credentials.serviceAccount.clientEmail).toBe(
      "sync@project.iam.gserviceaccount.com",
    );
  });

  it("falls back to deployment credentials and returns null when neither exists", async () => {
    const db = makeDb();

    await expect(
      Effect.runPromise(
        loadGoogleDirectoryConfig({ db, organizationId: "org-1", deployment: credentials }),
      ),
    ).resolves.toEqual({ source: "deployment", credentials });

    await expect(
      Effect.runPromise(loadGoogleDirectoryConfig({ db, organizationId: "org-1" })),
    ).resolves.toBeNull();
  });

  it("fails safely when sealed credentials cannot be decrypted", async () => {
    const db = makeDb({
      google_directory_sync: [
        {
          organizationId: "org-1",
          enabled: true,
          adminEmail: "admin@example.com",
          customer: "my_customer",
          serviceAccountEmail: "sync@example.com",
          sealedServiceAccount: "not-a-sealed-secret",
          status: "idle",
          syncIntervalMinutes: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
    });

    const error = await Effect.runPromise(
      Effect.flip(loadGoogleDirectoryConfig({ db, organizationId: "org-1", authSecret })),
    );

    if (!(error instanceof Error)) throw new Error("Expected configuration error");
    expect(error.message).toMatch(/could not be decrypted/);
    expect(error.message).not.toContain("SECRETKEYMATERIAL");
  });
});

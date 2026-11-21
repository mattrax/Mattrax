import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { sealSecret } from "@mattrax/crypto";
import {
  loadGoogleDirectoryConfig,
  runGoogleDirectorySyncForTenant,
  runScheduledGoogleSync,
} from "@mattrax/google-workspace";
import type { GoogleWorkspaceCredentials, GoogleWorkspaceService } from "@mattrax/google-workspace";
import { EnterpriseBadRequest } from "@mattrax/enterprise-domain";
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

const service = (options: {
  users?: ReadonlyArray<ReturnType<typeof user>>;
  groups?: ReadonlyArray<{
    id: string;
    email: string;
    name: string;
    directMembersCount: number;
  }>;
  members?: Record<string, ReadonlyArray<{ id: string; type: string }>>;
}): GoogleWorkspaceService => ({
  listUsers: () => Effect.succeed({ users: options.users ?? [] }),
  listGroups: () => Effect.succeed({ groups: options.groups ?? [] }),
  listGroupMembers: () => Effect.succeed({ members: [] }),
  listAllGroupMembers: (groupKey) => Effect.succeed(options.members?.[groupKey] ?? []),
  getUser: () => Effect.succeed(null),
  validate: () => Effect.succeed({ ok: true, message: "ok" }),
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

    expect(error.message).toMatch(/could not be decrypted/);
    expect(error.message).not.toContain("SECRETKEYMATERIAL");
  });
});

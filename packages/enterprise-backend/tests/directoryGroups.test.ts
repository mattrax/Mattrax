import { describe, expect, it } from "vitest";
import { syncDirectoryGroupsForTenant, syncDirectoryGroup } from "@mattrax/mdm-core";
import { makeDb, runEffect } from "./helpers.js";

const now = new Date("2026-11-18T12:00:00.000Z");

const organizationId = "org-1";

const timestamp = new Date("2026-11-01T00:00:00.000Z");

const seedDirectoryGroup = (
  db: ReturnType<typeof makeDb>,
  input: {
    userIds: ReadonlyArray<string>;
    disabled?: ReadonlyArray<string>;
    links?: ReadonlyArray<{ userId: string; deviceId: string }>;
    deviceIds?: ReadonlyArray<string>;
    directoryGroupId?: string;
    groupId?: string;
  },
) => {
  const directoryGroupId = input.directoryGroupId ?? "directory-1";
  const groupId = input.groupId ?? "group-1";

  db.store.user_group.push({
    id: directoryGroupId,
    organizationId,
    name: "Engineering",
    externalId: null,
    description: null,
    source: "scim",
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  db.store.enterprise_group.push({
    id: groupId,
    organizationId,
    name: "Engineering devices",
    notes: null,
    kind: "manual",
    rules: null,
    directoryGroupId,
    lastEvaluatedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  for (const userId of input.userIds) {
    db.store.user.push({
      id: userId,
      organizationId,
      name: userId,
      email: `${userId}@acme.test`,
      externalId: userId,
      source: "scim",
      disabled: input.disabled?.includes(userId) ?? false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    db.store.user_group_member.push({ groupId: directoryGroupId, userId });
  }

  for (const deviceId of input.deviceIds ?? []) {
    db.store.device.push({
      id: deviceId,
      organizationId,
      proto: "apple",
      status: "enrolled",
      name: deviceId,
      enrolledAt: timestamp,
      lastSeenAt: timestamp,
    });
  }

  for (const link of input.links ?? [])
    db.store.device_user.push({
      organizationId,
      deviceId: link.deviceId,
      userId: link.userId,
      source: "manual",
      createdAt: timestamp,
    });
};

const memberships = (db: ReturnType<typeof makeDb>) =>
  [...db.store.group_device]
    .map((row: any) => `${row.groupId}:${row.deviceId}:${row.source}`)
    .sort();

describe("directory-linked device groups", () => {
  it("derives membership from directory members and their linked devices", async () => {
    const db = makeDb();

    seedDirectoryGroup(db, {
      userIds: ["user-1", "user-2"],
      deviceIds: ["device-1", "device-2"],
      links: [
        { userId: "user-1", deviceId: "device-1" },
        { userId: "user-2", deviceId: "device-2" },
      ],
    });

    const results = await runEffect(syncDirectoryGroupsForTenant(db, organizationId, { now }));

    expect(results).toMatchObject([{ groupId: "group-1", matched: 2, added: 2, removed: 0 }]);
    expect(memberships(db)).toEqual(["group-1:device-1:directory", "group-1:device-2:directory"]);
  });

  it("adds and removes devices as directory membership changes", async () => {
    const db = makeDb();

    seedDirectoryGroup(db, {
      userIds: ["user-1"],
      deviceIds: ["device-1", "device-2"],
      links: [{ userId: "user-1", deviceId: "device-1" }],
    });

    await runEffect(syncDirectoryGroup(db, organizationId, "group-1", { now }));

    // A second person joins the directory group and brings a device.
    db.store.user.push({
      id: "user-2",
      organizationId,
      name: "Two",
      email: "two@acme.test",
      externalId: "user-2",
      source: "scim",
      disabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    db.store.user_group_member.push({ groupId: "directory-1", userId: "user-2" });
    db.store.device_user.push({
      organizationId,
      deviceId: "device-2",
      userId: "user-2",
      source: "manual",
      createdAt: timestamp,
    });

    await runEffect(syncDirectoryGroup(db, organizationId, "group-1", { now }));
    expect(memberships(db)).toEqual(["group-1:device-1:directory", "group-1:device-2:directory"]);

    // The first person leaves the directory group.
    db.store.user_group_member = db.store.user_group_member.filter(
      (row: any) => row.userId !== "user-1",
    );

    await runEffect(syncDirectoryGroup(db, organizationId, "group-1", { now }));
    expect(memberships(db)).toEqual(["group-1:device-2:directory"]);
  });

  it("follows a device-user link change", async () => {
    const db = makeDb();

    seedDirectoryGroup(db, {
      userIds: ["user-1"],
      deviceIds: ["device-1", "device-2"],
      links: [{ userId: "user-1", deviceId: "device-1" }],
    });

    await runEffect(syncDirectoryGroup(db, organizationId, "group-1", { now }));

    db.store.device_user = [
      {
        organizationId,
        deviceId: "device-2",
        userId: "user-1",
        source: "manual",
        createdAt: timestamp,
      },
    ];

    await runEffect(syncDirectoryGroup(db, organizationId, "group-1", { now }));
    expect(memberships(db)).toEqual(["group-1:device-2:directory"]);
  });

  it("drops a disabled directory user's devices", async () => {
    const db = makeDb();

    seedDirectoryGroup(db, {
      userIds: ["user-1"],
      deviceIds: ["device-1"],
      links: [{ userId: "user-1", deviceId: "device-1" }],
    });

    await runEffect(syncDirectoryGroup(db, organizationId, "group-1", { now }));
    expect(memberships(db)).toEqual(["group-1:device-1:directory"]);

    db.store.user[0]!.disabled = true;
    await runEffect(syncDirectoryGroup(db, organizationId, "group-1", { now }));
    expect(memberships(db)).toEqual([]);
  });

  it("removes manual rows when a group becomes linked and after unlinking", async () => {
    const db = makeDb();

    seedDirectoryGroup(db, {
      userIds: ["user-1"],
      deviceIds: ["device-1", "device-2"],
      links: [{ userId: "user-1", deviceId: "device-1" }],
    });

    db.store.group_device.push({ groupId: "group-1", deviceId: "device-2", source: "manual" });

    await runEffect(syncDirectoryGroup(db, organizationId, "group-1", { now }));
    expect(memberships(db)).toEqual(["group-1:device-1:directory"]);

    db.store.enterprise_group[0]!.directoryGroupId = null;
    await runEffect(syncDirectoryGroupsForTenant(db, organizationId, { now }));
    expect(memberships(db)).toEqual([]);
  });

  it("runs each recompute in a transaction that locks the group row", async () => {
    const db = makeDb();

    seedDirectoryGroup(db, {
      userIds: ["user-1"],
      deviceIds: ["device-1"],
      links: [{ userId: "user-1", deviceId: "device-1" }],
    });

    const originalTransaction = db.transaction.bind(db);
    const originalSelect = db.select.bind(db);
    let transactions = 0;
    let locks = 0;

    // SAFETY: the fake implements the same transaction signature; the wrapper
    // only counts calls and forwards the original effect.
    db.transaction = ((work: any) => {
      transactions++;

      return originalTransaction(work);
    }) as typeof db.transaction;

    // SAFETY: the fake select builder exposes `for`; wrapping it lets the test
    // observe that the recompute takes a row lock before reading memberships.
    db.select = (...args: any[]) => {
      const builder = originalSelect(...args);
      const originalFor = builder.for.bind(builder);

      builder.for = (strength: string) => {
        if (strength === "update") locks++;

        return originalFor(strength);
      };

      return builder;
    };

    await runEffect(syncDirectoryGroup(db, organizationId, "group-1", { now }));

    expect(transactions).toBe(1);
    expect(locks).toBe(1);
    expect(memberships(db)).toEqual(["group-1:device-1:directory"]);
  });

  it("isolates tenants and ignores cross-tenant users", async () => {
    const db = makeDb();

    seedDirectoryGroup(db, {
      userIds: ["user-1"],
      deviceIds: ["device-1", "device-2"],
      links: [{ userId: "user-1", deviceId: "device-1" }],
    });

    // A user from another tenant linked to this tenant's device-user row must
    // never reach the group.
    db.store.user.push({
      id: "other-user",
      organizationId: "org-2",
      name: "Other",
      email: "other@other.test",
      externalId: "other-user",
      source: "scim",
      disabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    db.store.user_group_member.push({ groupId: "directory-1", userId: "other-user" });
    db.store.device_user.push(
      {
        organizationId,
        deviceId: "device-1",
        userId: "other-user",
        source: "manual",
        createdAt: timestamp,
      },
      {
        organizationId,
        deviceId: "device-2",
        userId: "other-user",
        source: "manual",
        createdAt: timestamp,
      },
    );

    await runEffect(syncDirectoryGroup(db, organizationId, "group-1", { now }));
    // Only user-1's device is derived; the cross-tenant person contributes
    // nothing even though a `device_user` row names them.
    expect(memberships(db)).toEqual(["group-1:device-1:directory"]);
  });
});

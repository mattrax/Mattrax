import { describe, expect, it } from "vitest";
import {
  EnterpriseBadRequest,
  EnterpriseNotFound,
  type UserMergeCounts,
} from "@mattrax/enterprise-domain";
import {
  listDirectoryUserMergeCandidates,
  mergeDirectoryUsers,
  previewDirectoryUserMerge,
} from "../src/Identity/mergeDirectoryUsers.ts";
import { makeDb, runEffect } from "./helpers.js";

const organizationId = "org-1";

const now = new Date("2026-11-20T00:00:00.000Z");

type Db = ReturnType<typeof makeDb>;

const seedUser = (
  db: Db,
  id: string,
  overrides: Partial<{
    organizationId: string;
    name: string;
    email: string;
    externalId: string | null;
    source: "manual" | "entra" | "scim";
    disabled: boolean;
  }> = {},
) =>
  db.store.user.push({
    id,
    organizationId,
    name: id,
    email: `${id}@acme.test`,
    externalId: `${id}-object`,
    source: "entra",
    disabled: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

const seedMergeAudit = (
  db: Db,
  targetId: string,
  sources: ReadonlyArray<{ id: string; email: string; externalId: string | null }>,
) =>
  db.store.audit_log.push({
    id: `audit-${targetId}-${sources.map((source) => source.id).join("-")}`,
    organizationId,
    actorAccountId: "account-1",
    actorEmail: "owner@acme.test",
    actorType: "account",
    category: "account",
    action: "directory.users_merged",
    targetType: "directoryUser",
    targetId,
    metadata: { sources },
    createdAt: now,
  });

const zero: UserMergeCounts = {
  deviceLinks: 0,
  groupMemberships: 0,
  directPolicies: 0,
  groupExclusions: 0,
  appleUserChannels: 0,
};

/**
 * One target and one duplicate with every shape of edge: a device, group,
 * policy and exclusion they both have, plus a second of each the target does
 * not, and an Apple user channel on each.
 */
const seedOverlap = (db: Db) => {
  seedUser(db, "target");
  seedUser(db, "source");

  for (const deviceId of ["device-1", "device-2", "device-3"])
    db.store.device.push({
      id: deviceId,
      organizationId,
      proto: "apple",
      status: "enrolled",
      name: deviceId,
      enrolledAt: now,
      lastSeenAt: now,
    });

  db.store.device_user.push(
    {
      organizationId,
      deviceId: "device-1",
      userId: "target",
      source: "manual",
      createdAt: now,
    },
    {
      organizationId,
      deviceId: "device-1",
      userId: "source",
      source: "directory",
      createdAt: now,
    },
    {
      organizationId,
      deviceId: "device-2",
      userId: "source",
      source: "manual",
      createdAt: now,
    },
  );

  for (const groupId of ["group-1", "group-2"])
    db.store.user_group.push({
      id: groupId,
      organizationId,
      name: groupId,
      externalId: null,
      description: null,
      source: "graph",
      createdAt: now,
      updatedAt: now,
    });

  db.store.user_group_member.push(
    { groupId: "group-1", userId: "target" },
    { groupId: "group-1", userId: "source" },
    { groupId: "group-2", userId: "source" },
  );

  db.store.user_policy.push(
    {
      organizationId,
      userId: "target",
      policyId: "policy-1",
      mode: "include",
      createdAt: now,
    },
    {
      organizationId,
      userId: "source",
      policyId: "policy-1",
      mode: "exclude",
      createdAt: now,
    },
    {
      organizationId,
      userId: "source",
      policyId: "policy-2",
      mode: "exclude",
      createdAt: now,
    },
  );

  for (const groupId of ["enterprise-1", "enterprise-2"])
    db.store.enterprise_group.push({
      id: groupId,
      organizationId,
      name: groupId,
      notes: null,
      kind: "manual",
      rules: null,
      directoryGroupId: null,
      lastEvaluatedAt: null,
      createdAt: now,
      updatedAt: now,
    });

  db.store.group_exclusion.push(
    { groupId: "enterprise-1", target: "user", targetId: "target", createdAt: now },
    { groupId: "enterprise-1", target: "user", targetId: "source", createdAt: now },
    { groupId: "enterprise-2", target: "user", targetId: "source", createdAt: now },
  );

  db.store.device_apple_user.push(
    { deviceId: "device-1", userId: "apple-user-1", directoryUserId: "target" },
    { deviceId: "device-3", userId: "apple-user-3", directoryUserId: "source" },
  );

  db.store.sso_identity.push({
    organizationId,
    objectId: "source-object",
    accountId: "account-1",
    createdAt: now,
  });
};

describe("merging duplicate directory users", () => {
  it("moves every edge and keeps the target's row when the edge exists on both", async () => {
    const db = makeDb();
    seedOverlap(db);

    const result = await runEffect(
      mergeDirectoryUsers(db, {
        organizationId,
        targetId: "target",
        sourceIds: ["source"],
        confirmExternalIdMismatch: true,
      }),
    );

    expect(result.status).toBe("merged");
    expect(result.target.id).toBe("target");
    expect(result.sources.map((source) => source.user.id)).toEqual(["source"]);
    expect(result.totals).toEqual({
      deviceLinks: 1,
      groupMemberships: 1,
      directPolicies: 1,
      groupExclusions: 1,
      appleUserChannels: 1,
    });
    expect(result.deduplicated).toEqual({
      deviceLinks: 1,
      groupMemberships: 1,
      directPolicies: 1,
      groupExclusions: 1,
      appleUserChannels: 0,
    });

    // The duplicate row is gone; only the survivor remains.
    expect(db.store.user.map((row) => row.id)).toEqual(["target"]);

    // Device links: device-1 keeps the target's own row, device-2 moves.
    expect(
      db.store.device_user
        .filter((row) => row.organizationId === organizationId)
        .map((row) => [row.deviceId, row.userId, row.source])
        .sort(),
    ).toEqual([
      ["device-1", "target", "manual"],
      ["device-2", "target", "manual"],
    ]);

    expect(db.store.user_group_member.map((row) => [row.groupId, row.userId]).sort()).toEqual([
      ["group-1", "target"],
      ["group-2", "target"],
    ]);

    // policy-1 keeps the target's include; policy-2 moves with its mode.
    expect(db.store.user_policy.map((row) => [row.policyId, row.userId, row.mode]).sort()).toEqual([
      ["policy-1", "target", "include"],
      ["policy-2", "target", "exclude"],
    ]);

    expect(db.store.group_exclusion.map((row) => [row.groupId, row.targetId]).sort()).toEqual([
      ["enterprise-1", "target"],
      ["enterprise-2", "target"],
    ]);

    expect(
      db.store.device_apple_user.map((row) => [row.deviceId, row.directoryUserId]).sort(),
    ).toEqual([
      ["device-1", "target"],
      ["device-3", "target"],
    ]);

    // SSO links bind accounts to provider objects, so they are untouched.
    expect(db.store.sso_identity).toHaveLength(1);
    expect(result.ssoIdentitiesRetained).toBe(1);
  });

  it("folds a disabled duplicate into an active target and leaves the target enabled", async () => {
    const db = makeDb();
    seedUser(db, "target");
    seedUser(db, "source", { disabled: true });

    const result = await runEffect(
      mergeDirectoryUsers(db, {
        organizationId,
        targetId: "target",
        sourceIds: ["source"],
        confirmExternalIdMismatch: true,
      }),
    );

    expect(result.status).toBe("merged");
    expect(db.store.user).toHaveLength(1);
    expect(db.store.user[0]!.disabled).toBe(false);
  });

  it("does not require confirmation when the duplicate reports the same external id", async () => {
    const db = makeDb();
    seedUser(db, "target", { externalId: "same-object" });
    seedUser(db, "source", { externalId: "same-object" });

    const result = await runEffect(
      mergeDirectoryUsers(db, {
        organizationId,
        targetId: "target",
        sourceIds: ["source"],
      }),
    );

    expect(result.status).toBe("merged");
    expect(db.store.user.map((row) => row.id)).toEqual(["target"]);
  });

  it("refuses differing external ids without the explicit confirmation", async () => {
    const db = makeDb();
    seedOverlap(db);

    await expect(
      runEffect(
        mergeDirectoryUsers(db, {
          organizationId,
          targetId: "target",
          sourceIds: ["source"],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    // The failed transaction wrote nothing.
    expect(db.store.user.map((row) => row.id).sort()).toEqual(["source", "target"]);
    expect(db.store.device_user).toHaveLength(3);
    expect(db.store.user_group_member).toHaveLength(3);
  });

  it("never merges a user into itself", async () => {
    const db = makeDb();
    seedUser(db, "target");
    seedUser(db, "source");

    await expect(
      runEffect(
        mergeDirectoryUsers(db, {
          organizationId,
          targetId: "target",
          sourceIds: ["target"],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    expect(db.store.user).toHaveLength(2);
  });

  it("rejects a source from another tenant without touching either directory", async () => {
    const db = makeDb();
    seedUser(db, "target");
    seedUser(db, "other", { organizationId: "org-2" });

    await expect(
      runEffect(
        mergeDirectoryUsers(db, {
          organizationId,
          targetId: "target",
          sourceIds: ["other"],
          confirmExternalIdMismatch: true,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);

    expect(db.store.user.map((row) => row.id).sort()).toEqual(["other", "target"]);
  });

  it("reports a target from another tenant as missing", async () => {
    const db = makeDb();
    seedUser(db, "other", { organizationId: "org-2" });

    await expect(
      runEffect(
        mergeDirectoryUsers(db, {
          organizationId,
          targetId: "other",
          sourceIds: ["source"],
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseNotFound);

    expect(db.store.user).toHaveLength(1);
  });

  it("treats a retry as unchanged once the audit entry records the absorbed source", async () => {
    const db = makeDb();
    seedOverlap(db);

    await runEffect(
      mergeDirectoryUsers(db, {
        organizationId,
        targetId: "target",
        sourceIds: ["source"],
        confirmExternalIdMismatch: true,
      }),
    );

    // The handler writes this entry after the transaction commits. It is the
    // only alias record, so the retry can tell "already merged" from "unknown".
    seedMergeAudit(db, "target", [
      { id: "source", email: "source@acme.test", externalId: "source-object" },
    ]);

    const retry = await runEffect(
      mergeDirectoryUsers(db, {
        organizationId,
        targetId: "target",
        sourceIds: ["source"],
        confirmExternalIdMismatch: true,
      }),
    );

    expect(retry.status).toBe("unchanged");
    expect(retry.alreadyMerged).toEqual(["source"]);
    expect(retry.totals).toEqual(zero);
    expect(db.store.user).toHaveLength(1);
    expect(db.store.device_user).toHaveLength(2);
    expect(db.store.user_group_member).toHaveLength(2);
  });

  it("previews the plan without writing and flags the external-id confirmation", async () => {
    const db = makeDb();
    seedOverlap(db);

    const preview = await runEffect(
      previewDirectoryUserMerge(db, {
        organizationId,
        targetId: "target",
        sourceIds: ["source"],
      }),
    );

    expect(preview.requiresExternalIdConfirmation).toBe(true);
    expect(preview.totals).toEqual({
      deviceLinks: 1,
      groupMemberships: 1,
      directPolicies: 1,
      groupExclusions: 1,
      appleUserChannels: 1,
    });
    expect(preview.ssoIdentitiesRetained).toBe(1);
    expect(preview.sources[0]!.user.id).toBe("source");

    // A preview is a dry run.
    expect(db.store.user).toHaveLength(2);
    expect(db.store.device_user).toHaveLength(3);
    expect(db.store.user_group_member).toHaveLength(3);
  });

  it("refuses more sources than the merge cap", async () => {
    const db = makeDb();
    seedUser(db, "target");

    const sourceIds = Array.from({ length: 11 }, (_, index) => `source-${index}`);

    await expect(
      runEffect(
        mergeDirectoryUsers(db, {
          organizationId,
          targetId: "target",
          sourceIds,
          confirmExternalIdMismatch: true,
        }),
      ),
    ).rejects.toBeInstanceOf(EnterpriseBadRequest);
  });

  it("suggests a recreated duplicate from the object id an earlier merge absorbed", async () => {
    const db = makeDb();
    seedUser(db, "target", { email: "ada@acme.test", externalId: "target-object" });
    seedUser(db, "recreated", { email: "ada.old@acme.test", externalId: "source-object" });
    seedUser(db, "same-email", { email: "ADA@acme.test", externalId: "other-object" });
    seedUser(db, "unrelated", { email: "unrelated@acme.test" });

    seedMergeAudit(db, "target", [
      { id: "source", email: "source@acme.test", externalId: "source-object" },
    ]);

    const candidates = await runEffect(
      listDirectoryUserMergeCandidates(db, { organizationId, targetId: "target" }),
    );

    expect(candidates.map((candidate) => candidate.user.id).sort()).toEqual([
      "recreated",
      "same-email",
    ]);
    expect(candidates.find((candidate) => candidate.user.id === "recreated")?.reasons).toEqual([
      "previously-merged",
    ]);
    expect(candidates.find((candidate) => candidate.user.id === "same-email")?.reasons).toEqual([
      "same-email",
    ]);
    expect(candidates.some((candidate) => candidate.user.id === "target")).toBe(false);
  });
});

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { Db } from "@mattrax/enterprise-core";
import { runMaintenance } from "../src/maintenance.js";
import { makeDb, runEffect } from "./helpers.js";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-11-10T12:00:00.000Z");

const run = (db: ReturnType<typeof makeDb>) =>
  runEffect(
    runMaintenance({ now, auditRetentionDays: 0, credentialAlerts: false }).pipe(
      Effect.provideService(Db, db as unknown as Db["Service"]),
    ),
  );

describe("maintenance enrollment-attempt retention", () => {
  it("deletes attempts older than 30 days and keeps newer ones", async () => {
    const db = makeDb();
    const attempt = (id: string, ageDays: number) => ({
      id,
      organizationId: "org-1",
      enrollmentId: "enrollment-1",
      platform: "apple",
      outcome: "ok",
      detail: "Apple enrollment profile issued",
      ipHash: null,
      userAgent: null,
      createdAt: new Date(now.getTime() - ageDays * DAY),
    });
    db.store.enrollment_attempt.push(
      attempt("old", 31),
      attempt("boundary", 30),
      attempt("fresh", 2),
    );

    const result = await run(db);
    expect(result.purgedEnrollmentAttempts).toBe(1);
    expect(db.store.enrollment_attempt.map((row) => row.id).sort()).toEqual(["boundary", "fresh"]);

    // Idempotent: a second run has nothing left to delete.
    expect((await run(db)).purgedEnrollmentAttempts).toBe(0);
  });

  it("can be disabled with a retention of 0", async () => {
    const db = makeDb();
    db.store.enrollment_attempt.push({
      id: "old",
      organizationId: "org-1",
      enrollmentId: "enrollment-1",
      platform: "apple",
      outcome: "ok",
      createdAt: new Date(now.getTime() - 365 * DAY),
    });

    const result = await runEffect(
      runMaintenance({
        now,
        auditRetentionDays: 0,
        enrollmentAttemptRetentionDays: 0,
        credentialAlerts: false,
      }).pipe(Effect.provideService(Db, db as unknown as Db["Service"])),
    );
    expect(result.purgedEnrollmentAttempts).toBe(0);
    expect(db.store.enrollment_attempt).toHaveLength(1);
  });
});

describe("maintenance dynamic groups", () => {
  it("reconciles dynamic membership as devices become stale or check in", async () => {
    const db = makeDb();
    db.store.organization.push({
      id: "org-1",
      name: "Acme",
      slug: "acme",
      createdAt: now,
      updatedAt: now,
    });
    db.store.device.push({
      id: "device-1",
      organizationId: "org-1",
      proto: "apple",
      status: "enrolled",
      name: "Mac",
      enrolledAt: new Date(now.getTime() - 40 * DAY),
      lastSeenAt: new Date(now.getTime() - 20 * DAY),
    });
    db.store.enterprise_group.push({
      id: "group-1",
      organizationId: "org-1",
      name: "Stale Macs",
      notes: null,
      kind: "dynamic",
      rules: { version: 1, all: [{ field: "staleDays", op: "gte", value: 14 }] },
      lastEvaluatedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const first = await run(db);
    expect(first.dynamicGroupsEvaluated).toBe(1);
    expect(db.store.group_device).toEqual([
      { groupId: "group-1", deviceId: "device-1", source: "dynamic" },
    ]);

    // A fresh check-in makes the device no longer stale; maintenance removes
    // the rule-derived row on the next run.
    db.store.device[0].lastSeenAt = now;
    const second = await run(db);
    expect(second.dynamicGroupsEvaluated).toBe(1);
    expect(db.store.group_device).toEqual([]);
  });

  it("can be disabled for tests and constrained hosts", async () => {
    const db = makeDb();
    db.store.organization.push({
      id: "org-1",
      name: "Acme",
      slug: "acme",
      createdAt: now,
      updatedAt: now,
    });
    db.store.enterprise_group.push({
      id: "group-1",
      organizationId: "org-1",
      name: "Dynamic",
      notes: null,
      kind: "dynamic",
      rules: { version: 1, all: [{ field: "platform", op: "eq", value: "apple" }] },
      lastEvaluatedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const result = await runEffect(
      runMaintenance({
        now,
        auditRetentionDays: 0,
        credentialAlerts: false,
        dynamicGroups: false,
      }).pipe(Effect.provideService(Db, db as unknown as Db["Service"])),
    );
    expect(result.dynamicGroupsEvaluated).toBe(0);
  });
});

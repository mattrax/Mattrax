import { Cause, Effect, Exit } from "effect";
import { getTableName } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import * as pkijs from "pkijs";
import { Db } from "@mattrax/enterprise-core";
import { TestConsole } from "effect/testing";
import { pruneWebhookDeliveries } from "@mattrax/mdm-core";
import { sweepWindowsStateCommands } from "@mattrax/mdm-windows";
import { createApnsCsrDer, importApnsKeyJwk } from "@mattrax/apns";
import { openSecret, sealSecret } from "@mattrax/crypto";
import { generateScepCa, sealCaPrivateKey } from "@mattrax/scep";
import {
  MAINTENANCE_DELETE_BATCH_SIZE,
  runMaintenance,
  VPP_CLIENT_LOAD_FAILED,
} from "../src/Tenant/maintenance.ts";
import { makeDb, runEffect } from "./helpers.js";

const DAY = 24 * 60 * 60 * 1000;

const now = new Date("2026-11-10T12:00:00.000Z");

const run = (db: ReturnType<typeof makeDb>) =>
  runEffect(
    runMaintenance({ now, auditRetentionDays: 0, credentialAlerts: false }).pipe(
      Effect.provideService(Db, db),
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
    expect(db.store.enrollment_attempt.map((row: { id: string }) => row.id).sort()).toEqual([
      "boundary",
      "fresh",
    ]);

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
      }).pipe(Effect.provideService(Db, db)),
    );

    expect(result.purgedEnrollmentAttempts).toBe(0);
    expect(db.store.enrollment_attempt).toHaveLength(1);
  });
});

describe("maintenance login-attempt retention", () => {
  it("prunes login attempts with the audit window", async () => {
    const db = makeDb();

    const attempt = (id: string, ageDays: number) => ({
      id,
      accountId: "account-1",
      email: "owner@example.com",
      success: true,
      method: "passkey",
      failureReason: null,
      ip: "203.0.113.0/24",
      userAgent: null,
      createdAt: new Date(now.getTime() - ageDays * DAY),
    });

    db.store.login_attempt.push(attempt("old", 400), attempt("fresh", 10));

    const result = await runEffect(
      runMaintenance({ now, auditRetentionDays: 365, credentialAlerts: false }).pipe(
        Effect.provideService(Db, db),
      ),
    );

    expect(result.purgedLoginAttempts).toBe(1);
    expect(db.store.login_attempt.map((row: { id: string }) => row.id)).toEqual(["fresh"]);
  });
});

const observeMaintenanceQueries = (db: ReturnType<typeof makeDb>) => {
  const selects: Array<{ table: string; fields: string; limit: number }> = [];
  const deletes: Array<{ table: string; limit: number }> = [];
  const select = db.select.bind(db);
  const remove = db.delete.bind(db);

  db.select = ((fields?: any) => {
    const builder: any = select(fields);
    let table = "";
    const from = builder.from.bind(builder);
    const limit = builder.limit.bind(builder);

    builder.from = (value: any) => {
      table = getTableName(value);
      return from(value);
    };
    builder.limit = (count: number) => {
      selects.push({ table, fields: Object.keys(fields ?? {}).join(","), limit: count });
      return limit(count);
    };

    return builder;
  }) as typeof db.select;

  db.delete = ((table: any) => {
    const builder: any = remove(table);
    const limit = builder.limit.bind(builder);

    builder.limit = (count: number) => {
      deletes.push({ table: getTableName(table), limit: count });
      return limit(count);
    };

    return builder;
  }) as typeof db.delete;

  return { selects, deletes };
};

const runRetention = (db: ReturnType<typeof makeDb>) =>
  runEffect(
    runMaintenance({
      now,
      staleDeviceDays: 0,
      auditRetentionDays: 365,
      approvalRetentionDays: 90,
      enrollmentAttemptRetentionDays: 30,
      androidPubSubRetentionDays: 30,
      webhookDeliveryRetentionDays: 30,
      webhookRetry: false,
      credentialAlerts: false,
      scepCaRotation: false,
      credentialIssuance: false,
      dynamicGroups: false,
      directoryGroups: false,
      applicationInventory: false,
      vppSync: false,
      fleetMigrations: false,
      reports: false,
      commandRetentionDays: 0,
      windowsCommandRetentionDays: 0,
      windowsFailureRetentionDays: 0,
      scriptExecutionRetentionDays: 0,
      tenantDeletionLogRetentionDays: 0,
    }).pipe(Effect.provideService(Db, db)),
  );

describe("maintenance bounded retention", () => {
  it("drains expired sessions, audit streams, approvals and webhook history in bounded batches", async () => {
    const db = makeDb();
    const queries = observeMaintenanceQueries(db);
    const count = MAINTENANCE_DELETE_BATCH_SIZE + 1;
    const old = new Date(now.getTime() - 400 * DAY);
    const fresh = new Date(now.getTime() - 10 * DAY);

    db.store.auth_sessions.push(
      ...Array.from({ length: count }, (_, index) => ({
        sessionId: "session-" + String(index + 1).padStart(4, "0"),
        expiresAt: now.getTime() - DAY,
      })),
      // Live sessions are excluded by the expiry-leading query and keep
      // their descriptors.
      { sessionId: "session-0000", expiresAt: now.getTime() + DAY },
    );
    db.store.account_session_context.push(
      ...Array.from({ length: count }, (_, index) => ({
        sessionId: "session-" + String(index + 1).padStart(4, "0"),
        accountId: "account-1",
      })),
      { sessionId: "session-0000", accountId: "account-1" },
    );
    db.store.audit_log.push(
      ...Array.from({ length: count }, (_, index) => ({
        id: "audit-" + index,
        organizationId: "org-1",
        createdAt: old,
      })),
      { id: "audit-fresh", organizationId: "org-1", createdAt: fresh },
    );
    db.store.account_audit_log.push(
      ...Array.from({ length: count }, (_, index) => ({
        id: "account-audit-" + index,
        createdAt: old,
      })),
      { id: "account-audit-fresh", createdAt: fresh },
    );
    db.store.approval_request.push(
      ...Array.from({ length: count }, (_, index) => ({
        id: "approval-" + index,
        status: "approved",
        updatedAt: old,
      })),
      { id: "approval-pending", status: "pending", updatedAt: old },
      { id: "approval-fresh", status: "rejected", updatedAt: fresh },
    );
    db.store.webhook_delivery.push(
      ...Array.from({ length: count }, (_, index) => ({
        id: "delivery-" + index,
        createdAt: old,
      })),
      { id: "delivery-boundary", createdAt: new Date(now.getTime() - 30 * DAY) },
      { id: "delivery-fresh", createdAt: fresh },
    );

    const result = await runRetention(db);

    expect(result.expiredAuthSessions).toBe(count);
    expect(result.purgedAuditEntries).toBe(count);
    expect(result.purgedAccountAuditEntries).toBe(count);
    expect(result.purgedApprovalRequests).toBe(count);
    expect(result.purgedWebhookDeliveries).toBe(count);
    expect(db.store.auth_sessions.map((row: { sessionId: string }) => row.sessionId)).toEqual([
      "session-0000",
    ]);
    expect(db.store.account_session_context).toEqual([
      { sessionId: "session-0000", accountId: "account-1" },
    ]);
    expect(db.store.audit_log.map((row: { id: string }) => row.id)).toEqual(["audit-fresh"]);
    expect(db.store.account_audit_log.map((row: { id: string }) => row.id)).toEqual([
      "account-audit-fresh",
    ]);
    expect(db.store.approval_request.map((row: { id: string }) => row.id).sort()).toEqual([
      "approval-fresh",
      "approval-pending",
    ]);
    expect(db.store.webhook_delivery.map((row: { id: string }) => row.id).sort()).toEqual([
      "delivery-boundary",
      "delivery-fresh",
    ]);

    const sessionSelects = queries.selects.filter((query) => query.table === "auth_sessions");
    expect(sessionSelects).toHaveLength(2);
    expect(sessionSelects.every((query) => query.limit === MAINTENANCE_DELETE_BATCH_SIZE)).toBe(
      true,
    );

    for (const table of [
      "audit_log",
      "account_audit_log",
      "approval_request",
      "webhook_delivery",
    ]) {
      const deletes = queries.deletes.filter((query) => query.table === table);
      expect(deletes, table).toHaveLength(2);
      expect(
        deletes.every((query) => query.limit === MAINTENANCE_DELETE_BATCH_SIZE),
        table,
      ).toBe(true);
    }
  });

  it("keysets more than 500 expired sessions interspersed among live sessions", async () => {
    const db = makeDb();
    const queries = observeMaintenanceQueries(db);
    const total = 1_501;
    const expiredCount = Math.ceil(total / 2);
    const sessionId = (index: number) =>
      "session-" + String((index * 7919) % 100_000).padStart(6, "0");
    const rows = Array.from({ length: total }, (_, index) => ({
      sessionId: sessionId(index),
      expiresAt: now.getTime() + (index % 2 === 0 ? -DAY - (index % 3) : DAY),
    }));
    const expiredIds = rows
      .filter((_, index) => index % 2 === 0)
      .map((row) => row.sessionId)
      .sort();
    const liveIds = rows
      .filter((_, index) => index % 2 === 1)
      .map((row) => row.sessionId)
      .sort();

    db.store.auth_sessions.push(...rows);
    db.store.account_session_context.push(
      ...expiredIds.map((id) => ({ sessionId: id, accountId: "account-1" })),
    );

    const result = await runRetention(db);

    expect(result.expiredAuthSessions).toBe(expiredCount);
    expect(
      db.store.auth_sessions.map((row: { sessionId: string }) => row.sessionId).sort(),
    ).toEqual(liveIds);
    expect(db.store.account_session_context).toEqual([]);

    const candidateSelects = queries.selects.filter(
      (query) => query.table === "auth_sessions" && query.fields === "expiresAt,sessionId",
    );
    expect(candidateSelects).toHaveLength(2);
    expect(candidateSelects.every((query) => query.limit === MAINTENANCE_DELETE_BATCH_SIZE)).toBe(
      true,
    );
  });

  it("batches realtime, enrollment-attempt and Android retention without id materialization", async () => {
    const db = makeDb();
    const queries = observeMaintenanceQueries(db);
    const count = MAINTENANCE_DELETE_BATCH_SIZE + 1;
    const old = new Date(now.getTime() - 40 * DAY);
    const fresh = new Date(now.getTime() - 10 * DAY);

    db.store.realtime_event.push(
      ...Array.from({ length: count }, (_, index) => ({
        seq: index + 1,
        organizationId: "org-1",
        kind: "device.checkin",
        createdAt: old,
      })),
      {
        seq: count + 1,
        organizationId: "org-1",
        kind: "device.checkin",
        createdAt: new Date(now.getTime() - 60 * 60 * 1000),
      },
    );
    db.store.enrollment_attempt.push(
      ...Array.from({ length: count }, (_, index) => ({ id: "attempt-" + index, createdAt: old })),
      { id: "attempt-fresh", createdAt: fresh },
    );
    db.store.android_pubsub_message.push(
      ...Array.from({ length: count }, (_, index) => ({
        messageId: "message-" + index,
        receivedAt: old,
      })),
      { messageId: "message-fresh", receivedAt: fresh },
    );

    const result = await runRetention(db);

    expect(result.purgedEnrollmentAttempts).toBe(count);
    expect(result.purgedAndroidPubSubMessages).toBe(count);
    expect(db.store.realtime_event).toHaveLength(1);
    expect(db.store.enrollment_attempt.map((row: { id: string }) => row.id)).toEqual([
      "attempt-fresh",
    ]);
    expect(
      db.store.android_pubsub_message.map((row: { messageId: string }) => row.messageId),
    ).toEqual(["message-fresh"]);

    for (const table of ["realtime_event", "enrollment_attempt", "android_pubsub_message"]) {
      const deletes = queries.deletes.filter((query) => query.table === table);
      expect(deletes, table).toHaveLength(2);
      expect(
        deletes.every((query) => query.limit === MAINTENANCE_DELETE_BATCH_SIZE),
        table,
      ).toBe(true);
    }
    expect(
      queries.selects.filter(
        (query) => query.table === "enrollment_attempt" || query.table === "android_pubsub_message",
      ),
    ).toEqual([]);
  });

  it("claims stale devices in bounded ordered batches", async () => {
    const db = makeDb();
    const queries = observeMaintenanceQueries(db);
    const count = MAINTENANCE_DELETE_BATCH_SIZE + 1;
    const stale = new Date(now.getTime() - 40 * DAY);

    db.store.device.push(
      ...Array.from({ length: count }, (_, index) => ({
        id: "stale-" + String(index).padStart(4, "0"),
        organizationId: "org-1",
        proto: "apple",
        status: "enrolled",
        name: "Stale " + index,
        enrolledAt: stale,
        lastSeenAt: stale,
      })),
      {
        id: "fresh",
        organizationId: "org-1",
        proto: "apple",
        status: "enrolled",
        name: "Fresh",
        enrolledAt: now,
        lastSeenAt: now,
      },
      {
        id: "already-unenrolled",
        organizationId: "org-1",
        proto: "apple",
        status: "unenrolled",
        name: "Gone",
        enrolledAt: stale,
        lastSeenAt: stale,
      },
    );

    const result = await run(db);

    expect(result.staleDevices).toBe(count);
    expect(db.store.device.filter((row: { status: string }) => row.status === "enrolled")).toEqual([
      expect.objectContaining({ id: "fresh" }),
    ]);
    const staleDeviceSelects = queries.selects.filter(
      (query) =>
        query.table === "device" &&
        query.fields === "id,organizationId" &&
        query.limit === MAINTENANCE_DELETE_BATCH_SIZE,
    );
    expect(staleDeviceSelects).toHaveLength(2);
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
      }).pipe(Effect.provideService(Db, db)),
    );

    expect(result.dynamicGroupsEvaluated).toBe(0);
  });
});

describe("maintenance directory-linked groups", () => {
  it("repairs stale derived membership when an event was missed", async () => {
    const db = makeDb();
    db.store.organization.push({
      id: "org-1",
      name: "Acme",
      slug: "acme",
      createdAt: now,
      updatedAt: now,
    });
    db.store.user_group.push({
      id: "directory-1",
      organizationId: "org-1",
      name: "Engineering",
      externalId: "entra-group-1",
      description: null,
      source: "graph",
      createdAt: now,
      updatedAt: now,
    });
    db.store.user.push({
      id: "user-1",
      organizationId: "org-1",
      name: "Ada",
      email: "ada@acme.test",
      externalId: "entra-user-1",
      source: "entra",
      disabled: false,
      createdAt: now,
      updatedAt: now,
    });
    db.store.user_group_member.push({ groupId: "directory-1", userId: "user-1" });
    db.store.device.push(
      {
        id: "device-1",
        organizationId: "org-1",
        proto: "apple",
        status: "enrolled",
        name: "Ada's Mac",
        enrolledAt: now,
        lastSeenAt: now,
      },
      {
        id: "device-2",
        organizationId: "org-1",
        proto: "apple",
        status: "enrolled",
        name: "Old Mac",
        enrolledAt: now,
        lastSeenAt: now,
      },
    );
    db.store.device_user.push({
      organizationId: "org-1",
      deviceId: "device-1",
      userId: "user-1",
      source: "manual",
      createdAt: now,
    });
    db.store.enterprise_group.push({
      id: "group-1",
      organizationId: "org-1",
      name: "Engineering devices",
      notes: null,
      kind: "manual",
      rules: null,
      directoryGroupId: "directory-1",
      lastEvaluatedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    // A missed event left a derived row for a device no longer linked to any
    // member of the directory group.
    db.store.group_device.push({
      groupId: "group-1",
      deviceId: "device-2",
      source: "directory",
    });

    const result = await run(db);

    expect(result.directoryGroupsEvaluated).toBe(1);
    expect(db.store.group_device).toEqual([
      { groupId: "group-1", deviceId: "device-1", source: "directory" },
    ]);
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
    db.store.user_group.push({
      id: "directory-1",
      organizationId: "org-1",
      name: "Engineering",
      externalId: "entra-group-1",
      description: null,
      source: "graph",
      createdAt: now,
      updatedAt: now,
    });
    db.store.enterprise_group.push({
      id: "group-1",
      organizationId: "org-1",
      name: "Engineering devices",
      notes: null,
      kind: "manual",
      rules: null,
      directoryGroupId: "directory-1",
      lastEvaluatedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const result = await runEffect(
      runMaintenance({
        now,
        auditRetentionDays: 0,
        credentialAlerts: false,
        directoryGroups: false,
      }).pipe(Effect.provideService(Db, db)),
    );

    expect(result.directoryGroupsEvaluated).toBe(0);
  });
});

describe("maintenance webhook deliveries", () => {
  const endpoint = async () => ({
    id: "wh-1",
    organizationId: "org-1",
    url: "https://hooks.example.com/mattrax",
    secret: await sealSecret("maintenance-secret", "whsec_test_secret"),
    secretPrefix: "cret",
    description: null,
    eventFilters: [],
    enabled: true,
    lastDeliveryAt: null,
    lastDeliveryStatus: null,
    consecutiveFailures: 0,
    createdAt: now,
    updatedAt: now,
  });

  it("prunes delivery rows older than 30 days", async () => {
    const db = makeDb();

    const row = (id: string, ageDays: number) => ({
      id,
      endpointId: "wh-1",
      organizationId: "org-1",
      event: "device.enrolled",
      eventId: `evt_${id}`,
      payload: { id: `evt_${id}`, type: "device.enrolled", organizationId: "org-1", data: {} },
      status: "succeeded",
      attempt: 1,
      responseStatus: 200,
      error: null,
      createdAt: new Date(now.getTime() - ageDays * DAY),
    });

    db.store.webhook_delivery.push(row("old", 31), row("boundary", 30), row("fresh", 2));

    const result = await run(db);
    expect(result.purgedWebhookDeliveries).toBe(1);
    expect(db.store.webhook_delivery.map((item: { id: string }) => item.id).sort()).toEqual([
      "boundary",
      "fresh",
    ]);
  });

  it("propagates interruption while pruning webhook deliveries", async () => {
    const db = makeDb();
    const remove = db.delete.bind(db);
    db.delete = (table) => {
      const builder = remove(table);
      builder[Symbol.iterator] = () => Effect.interrupt[Symbol.iterator]();

      return builder;
    };

    const exit = await Effect.runPromiseExit(
      pruneWebhookDeliveries(db, { now, retentionDays: 30 }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.hasInterrupts(exit.cause)).toBe(true);
  });

  it("retries a recent failed delivery with the sealed secret", async () => {
    const fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    const db = makeDb();
    db.store.webhook_endpoint.push(await endpoint());
    db.store.webhook_delivery.push({
      id: "whd-1",
      endpointId: "wh-1",
      organizationId: "org-1",
      event: "device.enrolled",
      eventId: "evt_1",
      payload: {
        id: "evt_1",
        type: "device.enrolled",
        occurredAt: now.toISOString(),
        organizationId: "org-1",
        data: {},
      },
      status: "failed",
      attempt: 1,
      responseStatus: 500,
      error: "Endpoint responded with HTTP 500",
      createdAt: new Date(now.getTime() - 60_000),
    });

    const result = await runEffect(
      runMaintenance({
        now,
        auditRetentionDays: 0,
        credentialAlerts: false,
        dynamicGroups: false,
        webhookAuthSecret: "maintenance-secret",
        webhookFetch: fetch,
      }).pipe(Effect.provideService(Db, db)),
    );

    expect(result.webhookRetries).toBe(1);
    expect(result.webhookRetrySucceeded).toBe(1);
    expect(result.webhookRetryFailed).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(db.store.webhook_delivery[0]).toMatchObject({
      status: "succeeded",
      attempt: 2,
      responseStatus: 200,
      error: null,
    });
  });
});

describe("maintenance Apple application inventory", () => {
  const makeDevice = (
    id: string,
    overrides: {
      proto?: "apple" | "win" | "android";
      status?: "enrolling" | "enrolled" | "unenrolling" | "unenrolled";
      applicationsUpdatedAt?: Date | null;
    } = {},
  ) => ({
    id,
    organizationId: "org-1",
    proto: "apple",
    status: "enrolled",
    name: id,
    enrolledAt: new Date(now.getTime() - 30 * DAY),
    lastSeenAt: now,
    applicationsUpdatedAt: null,
    ...overrides,
  });

  it("queues one refresh for every Apple device whose inventory is missing or stale", async () => {
    const db = makeDb();
    db.store.device.push(
      makeDevice("never-reported"),
      makeDevice("stale", { applicationsUpdatedAt: new Date(now.getTime() - 2 * DAY) }),
      makeDevice("fresh", { applicationsUpdatedAt: new Date(now.getTime() - 60_000) }),
      makeDevice("windows", { proto: "win" }),
      makeDevice("android", { proto: "android" }),
      makeDevice("unenrolled", { status: "unenrolled" }),
    );

    const result = await run(db);

    expect(result.applicationInventoryRefreshes).toBe(2);
    expect(
      db.store.device_command.map((row: { deviceId: string | null }) => row.deviceId).sort(),
    ).toEqual(["never-reported", "stale"]);
    expect(db.store.device_command[0]).toMatchObject({
      organizationId: "org-1",
      requestType: "InstalledApplicationList",
      status: "queued",
    });

    // A second daily run must not queue a second refresh while one is pending.
    expect((await run(db)).applicationInventoryRefreshes).toBe(0);
    expect(db.store.device_command).toHaveLength(2);
  });

  it("re-queues once the previous refresh finished", async () => {
    const db = makeDb();
    db.store.device.push(
      makeDevice("stale", { applicationsUpdatedAt: new Date(now.getTime() - 2 * DAY) }),
    );
    db.store.device_command.push({
      id: "command-1",
      organizationId: "org-1",
      deviceId: "stale",
      requestType: "InstalledApplicationList",
      payload: null,
      status: "succeeded",
      createdAt: new Date(now.getTime() - 3 * DAY),
      updatedAt: new Date(now.getTime() - 3 * DAY),
    });

    expect((await run(db)).applicationInventoryRefreshes).toBe(1);
    expect(db.store.device_command).toHaveLength(2);
  });

  it("can be disabled", async () => {
    const db = makeDb();
    db.store.device.push(makeDevice("never-reported"));

    const result = await runEffect(
      runMaintenance({
        now,
        auditRetentionDays: 0,
        credentialAlerts: false,
        dynamicGroups: false,
        applicationInventory: false,
      }).pipe(Effect.provideService(Db, db)),
    );

    expect(result.applicationInventoryRefreshes).toBe(0);
    expect(db.store.device_command).toHaveLength(0);
  });
});

describe("maintenance origin certificate review", () => {
  const peer = {
    hostname: "e.mattrax.app",
    port: 443,
    subject: "CN=e.mattrax.app",
    issuer: "CN=Test CA",
    serialNumber: "2a",
    fingerprintSha256: "a".repeat(64),
    notBefore: new Date(now.getTime() - 300 * DAY),
    notAfter: new Date(now.getTime() + 60 * DAY),
    authorized: true,
    authorizationError: null,
    chainLength: 2,
  };

  const runAt = (db: ReturnType<typeof makeDb>, at: Date, probe: () => Effect.Effect<any>) =>
    runEffect(
      runMaintenance({
        now: at,
        auditRetentionDays: 0,
        credentialAlerts: false,
        serverCertificateOrigin: "https://e.mattrax.app",
        serverCertificateProbe: probe,
      }).pipe(Effect.provideService(Db, db)),
    );

  it("probes on the scheduled run and reuses a fresh observation", async () => {
    const db = makeDb();
    const probe = vi.fn(() => Effect.succeed(peer));

    const first = await runAt(db, now, probe);
    expect(first.serverCertificateChecked).toBe(1);
    expect(db.store.server_certificate_health).toHaveLength(1);
    expect(db.store.server_certificate_health[0]).toMatchObject({
      origin: "https://e.mattrax.app",
      authorized: true,
      notAfter: peer.notAfter,
    });

    const second = await runAt(db, new Date(now.getTime() + 30 * 60 * 1000), probe);
    expect(second.serverCertificateChecked).toBe(0);
    expect(probe).toHaveBeenCalledTimes(1);

    const third = await runAt(db, new Date(now.getTime() + 61 * 60 * 1000), probe);
    expect(third.serverCertificateChecked).toBe(1);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("skips the probe when no origin is configured and never fails the run", async () => {
    const db = makeDb();

    const result = await runEffect(
      runMaintenance({ now, auditRetentionDays: 0, credentialAlerts: false }).pipe(
        Effect.provideService(Db, db),
      ),
    );

    expect(result.serverCertificateChecked).toBe(0);
    expect(db.store.server_certificate_health).toHaveLength(0);
  });
});

describe("maintenance SCEP CA rotation", () => {
  const authSecret = "maintenance-rotation-secret";

  it("rotates a due CA and records the overlap without revoking identities", async () => {
    const db = makeDb();
    db.store.organization.push({ id: "org-1", name: "Acme" });

    const previous = await Effect.runPromise(
      generateScepCa("org-1", {
        now: new Date(now.getTime() - 300 * DAY),
        lifetimeDays: 500,
      }),
    );

    db.store.scep_ca.push({
      id: 1,
      organizationId: "org-1",
      certPem: previous.certPem,
      privateKeyJwk: await sealCaPrivateKey(authSecret, previous.privateKeyJwk),
      source: "generated",
      createdAt: new Date(now.getTime() - 300 * DAY),
      rotatedAt: null,
    });
    db.store.scep_issued_certificate.push({
      serial: "s1",
      organizationId: "org-1",
      deviceId: "d1",
      notAfter: new Date(now.getTime() + 20 * DAY),
      revokedAt: null,
      createdAt: now,
    });

    const result = await runEffect(
      runMaintenance({
        now,
        auditRetentionDays: 0,
        credentialAlerts: false,
        authSecret,
      }).pipe(Effect.provideService(Db, db)),
    );

    expect(result.scepCaRotated).toBe(1);
    expect(result.scepCaRotationFailed).toBe(0);
    expect(db.store.scep_ca[0]!.certPem).not.toBe(previous.certPem);
    expect(db.store.scep_ca_trust).toHaveLength(1);
    expect(db.store.scep_ca_trust[0]!.certPem).toBe(previous.certPem);
    expect(db.store.scep_issued_certificate[0]!.revokedAt).toBeNull();
    expect(db.store.audit_log.some((row: any) => row.action === "scep_ca.auto_rotated")).toBe(true);
  });

  it("can be disabled for hosts that rotate out of band", async () => {
    const db = makeDb();
    db.store.organization.push({ id: "org-1", name: "Acme" });

    const previous = await Effect.runPromise(
      generateScepCa("org-1", {
        now: new Date(now.getTime() - 300 * DAY),
        lifetimeDays: 500,
      }),
    );

    db.store.scep_ca.push({
      id: 1,
      organizationId: "org-1",
      certPem: previous.certPem,
      privateKeyJwk: await sealCaPrivateKey(authSecret, previous.privateKeyJwk),
      source: "generated",
      createdAt: new Date(now.getTime() - 300 * DAY),
      rotatedAt: null,
    });

    const result = await runEffect(
      runMaintenance({
        now,
        auditRetentionDays: 0,
        credentialAlerts: false,
        authSecret,
        scepCaRotation: false,
      }).pipe(Effect.provideService(Db, db)),
    );

    expect(result.scepCaRotated).toBe(0);
    expect(db.store.scep_ca[0]!.certPem).toBe(previous.certPem);
  });
});

describe("maintenance Windows state command retention", () => {
  const command = (id: string, ageDays: number, requestType: string, status = "sent") => ({
    id,
    organizationId: "org-1",
    deviceId: "device-1",
    requestType,
    payload: { kind: "Replace", locURI: `./Vendor/MSFT/${id}` },
    status,
    dedupeKey: null,
    expiresAt: null,
    resultStatus: null,
    resultDetail: null,
    createdAt: new Date(now.getTime() - ageDays * DAY),
    updatedAt: new Date(now.getTime() - ageDays * DAY),
  });

  it("prunes old Windows policy and inventory rows without touching imperative commands", async () => {
    const db = makeDb();
    db.store.device_command.push(
      command("old-policy", 31, "WindowsPolicyReplace"),
      command("boundary-policy", 30, "WindowsPolicyReplace"),
      command("old-delete", 45, "WindowsPolicyDelete"),
      command("old-inventory", 60, "WindowsInventoryGet"),
      command("fresh-inventory", 2, "WindowsApplicationInventoryGet"),
      command("old-unenroll", 31, "WindowsUnenroll"),
      command("imperative", 31, "DeviceLock", "expired"),
    );

    const result = await run(db);
    expect(result.purgedWindowsCommands).toBe(3);
    expect(db.store.device_command.map((row: { id: string }) => row.id).sort()).toEqual([
      "boundary-policy",
      "fresh-inventory",
      "imperative",
      "old-unenroll",
    ]);

    // Idempotent: a second run has nothing left to delete.
    expect((await run(db)).purgedWindowsCommands).toBe(0);
  });

  it("does not double-count a terminal row drained by the generic sweep", async () => {
    const db = makeDb();
    db.store.device_command.push(command("drained", 120, "WindowsPolicyReplace", "succeeded"));

    const result = await run(db);

    // The generic terminal-command retention runs first and owns the row.
    expect(result.purgedCommands).toBe(1);
    expect(result.purgedWindowsCommands).toBe(0);
    expect(db.store.device_command).toHaveLength(0);
  });

  it("can be disabled with a retention of 0", async () => {
    const db = makeDb();
    db.store.device_command.push(command("old-policy", 365, "WindowsPolicyReplace"));

    const result = await runEffect(
      runMaintenance({
        now,
        auditRetentionDays: 0,
        credentialAlerts: false,
        dynamicGroups: false,
        applicationInventory: false,
        windowsCommandRetentionDays: 0,
      }).pipe(Effect.provideService(Db, db)),
    );

    expect(result.purgedWindowsCommands).toBe(0);
    expect(db.store.device_command).toHaveLength(1);
  });

  it("bounds one sweep so a large backlog is drained over several runs", async () => {
    const db = makeDb();
    db.store.device_command.push(
      command("one", 60, "WindowsPolicyReplace"),
      command("two", 60, "WindowsPolicyReplace"),
      command("three", 60, "WindowsPolicyReplace"),
    );

    const first = await runEffect(sweepWindowsStateCommands(db, { now, limit: 2 }));
    expect(first.pruned).toBe(2);
    expect(db.store.device_command).toHaveLength(1);

    const second = await runEffect(sweepWindowsStateCommands(db, { now, limit: 2 }));
    expect(second.pruned).toBe(1);
    expect(db.store.device_command).toHaveLength(0);
  });

  it("prunes Windows failure history on the same daily run", async () => {
    const db = makeDb();

    const failure = (id: string, ageDays: number) => ({
      id,
      organizationId: "org-1",
      deviceId: null,
      deviceIdentifier: `device-${id}`,
      serial: null,
      hostname: null,
      phase: "enrollment",
      code: "windows_disabled",
      message: "Windows enrollment is disabled for this tenant.",
      detail: null,
      createdAt: new Date(now.getTime() - ageDays * DAY),
    });

    db.store.windows_failure.push(failure("old", 31), failure("boundary", 30), failure("fresh", 1));

    const result = await run(db);

    expect(result.purgedWindowsFailures).toBe(1);
    expect(db.store.windows_failure.map((row: { id: string }) => row.id).sort()).toEqual([
      "boundary",
      "fresh",
    ]);

    // Idempotent on the next run.
    expect((await run(db)).purgedWindowsFailures).toBe(0);
  });
});

describe("maintenance credential issuance", () => {
  const authSecret = "maintenance-issuance-secret";

  const tenant = (id: string) => ({ id, name: id, slug: id, createdAt: now, updatedAt: now });

  const device = (id: string, organizationId: string, proto: "apple" | "win" | "android") => ({
    id,
    organizationId,
    proto,
    status: "enrolled",
    name: id,
    enrolledAt: new Date(now.getTime() - DAY),
    lastSeenAt: now,
  });

  const runIssuance = (
    db: ReturnType<typeof makeDb>,
    overrides: Parameters<typeof runMaintenance>[0] = {},
  ) =>
    runEffect(
      runMaintenance({
        now,
        auditRetentionDays: 0,
        credentialAlerts: false,
        dynamicGroups: false,
        applicationInventory: false,
        authSecret,
        ...overrides,
      }).pipe(Effect.provideService(Db, db)),
    );

  it("can be disabled for hosts that issue credentials out of band", async () => {
    const db = makeDb();
    db.store.organization.push(tenant("org-1"));
    db.store.device.push(device("device-1", "org-1", "apple"));

    const result = await runIssuance(db, { credentialIssuance: false });
    expect(result.scepCasIssued).toBe(0);
    expect(result.missingApnsCertificates).toBe(0);
    expect(result.apnsCsrsGenerated).toBe(0);
    expect(db.store.scep_ca).toHaveLength(0);
    expect(db.store.apple_push_key).toHaveLength(0);
  });

  it("generates a missing SCEP CA for a tenant with active devices", async () => {
    const db = makeDb();
    db.store.organization.push(tenant("org-1"));
    db.store.device.push(device("device-1", "org-1", "win"));

    const first = await runIssuance(db);
    expect(first.scepCasIssued).toBe(1);
    expect(first.scepCasFailed).toBe(0);
    expect(db.store.scep_ca).toHaveLength(1);
    expect(db.store.scep_ca[0]).toMatchObject({ organizationId: "org-1" });
    expect(
      db.store.audit_log.filter((row: { action: string }) => row.action === "scep_ca.auto_issued"),
    ).toHaveLength(1);

    // The CA exists now, so the next run issues nothing.
    const second = await runIssuance(db);
    expect(second.scepCasIssued).toBe(0);
    expect(db.store.scep_ca).toHaveLength(1);
    expect(
      db.store.audit_log.filter((row: { action: string }) => row.action === "scep_ca.auto_issued"),
    ).toHaveLength(1);
  });

  it("does not mint a CA when the tenant still has SCEP identity history", async () => {
    const db = makeDb();
    db.store.organization.push(tenant("org-1"));
    db.store.device.push(device("device-1", "org-1", "apple"));
    db.store.scep_issued_certificate.push({
      serial: "s1",
      organizationId: "org-1",
      deviceId: "device-1",
      notAfter: new Date(now.getTime() + 30 * DAY),
      revokedAt: null,
      createdAt: new Date(now.getTime() - 10 * DAY),
    });

    const first = await runIssuance(db);
    expect(first.scepCasIssued).toBe(0);
    expect(first.scepCasFailed).toBe(1);
    expect(db.store.scep_ca).toHaveLength(0);

    const failures = () =>
      db.store.audit_log.filter(
        (row: { action: string }) => row.action === "scep_ca.issuance_failed",
      );

    expect(failures()).toHaveLength(1);
    expect(failures()[0]).toMatchObject({
      organizationId: "org-1",
      metadata: { reason: "identity_history_present" },
    });

    // The refusal is audited once per UTC day, not once per run.
    await runIssuance(db);
    expect(failures()).toHaveLength(1);
    expect(db.store.scep_ca).toHaveLength(0);
  });

  it("does not issue a CA for a tenant without devices that use SCEP", async () => {
    const db = makeDb();
    db.store.organization.push(tenant("org-1"), tenant("org-2"));
    db.store.device.push(
      { ...device("device-1", "org-1", "win"), status: "unenrolled" },
      device("device-2", "org-2", "android"),
    );

    const result = await runIssuance(db);
    expect(result.scepCasIssued).toBe(0);
    expect(db.store.scep_ca).toHaveLength(0);
  });

  it("reports a missing CA without throwing when no sealing secret is configured", async () => {
    const db = makeDb();
    db.store.organization.push(tenant("org-1"));
    db.store.device.push(device("device-1", "org-1", "apple"));

    const result = await runIssuance(db, { authSecret: undefined });
    expect(result.scepCasIssued).toBe(0);
    expect(result.scepCasFailed).toBe(1);
    expect(db.store.scep_ca).toHaveLength(0);
    // Without a sealing secret neither the CA nor a pending APNs key can exist.
    expect(result.missingApnsCertificates).toBe(1);
    expect(result.apnsCsrsGenerated).toBe(0);
    expect(db.store.apple_push_key).toHaveLength(0);
  });

  it("counts active Apple tenants without an APNs certificate", async () => {
    const db = makeDb();
    db.store.organization.push(tenant("apple-org"), tenant("windows-org"));

    db.store.device.push(
      device("apple-device", "apple-org", "apple"),
      device("windows-device", "windows-org", "win"),
    );

    const result = await runIssuance(db);
    expect(result.missingApnsCertificates).toBe(1);
    expect(result.apnsCsrsGenerated).toBe(1);
    expect(db.store.apple_push_key).toHaveLength(1);
    expect(db.store.apple_push_key[0]).toMatchObject({ organizationId: "apple-org" });

    // The stored key is sealed, and it is the key behind the CSR an operator
    // would download: open it, rebuild the request and compare the public keys.
    const pending = db.store.apple_push_key[0]!;

    const privateJwk: JsonWebKey = JSON.parse(
      await openSecret(authSecret, pending.encryptedPrivateKeyJwk),
    );

    expect(privateJwk).toMatchObject({ kty: "RSA" });

    const privateKey = await importApnsKeyJwk(privateJwk);

    const publicKey = await crypto.subtle.importKey(
      "jwk",
      { kty: privateJwk.kty, n: privateJwk.n, e: privateJwk.e, ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      true,
      ["verify"],
    );

    const csr = pkijs.CertificationRequest.fromBER(
      await createApnsCsrDer(
        { privateKey, publicKey },
        { organization: "apple-org", organizationalUnit: "apple-org" },
      ),
    );

    const csrSpki = Buffer.from(
      await crypto.subtle.exportKey("spki", await csr.getPublicKey()),
    ).toString("hex");

    const keySpki = Buffer.from(await crypto.subtle.exportKey("spki", publicKey)).toString("hex");

    expect(csrSpki).toBe(keySpki);
    expect(csr.subject.typesAndValues.some((attribute) => attribute.type === "2.5.4.11")).toBe(
      true,
    );

    // The pending key is reused rather than rotated on the next daily run.
    const second = await runIssuance(db);
    expect(second.missingApnsCertificates).toBe(1);
    expect(second.apnsCsrsGenerated).toBe(0);
    expect(db.store.apple_push_key).toHaveLength(1);
  });

  it("requests issuance for an origin whose probe returned no certificate", async () => {
    const db = makeDb();
    const request = vi.fn(() => Effect.succeed(undefined));

    const result = await runIssuance(db, {
      serverCertificateOrigin: "https://e.mattrax.app",
      serverCertificateProbe: () =>
        Effect.succeed({
          hostname: "e.mattrax.app",
          port: 443,
          subject: null,
          issuer: null,
          serialNumber: null,
          fingerprintSha256: null,
          notBefore: null,
          notAfter: null,
          authorized: false,
          authorizationError: null,
          chainLength: 0,
        }),
      requestDomainCertificate: request,
    });

    expect(result.missingDomainCertificates).toBe(1);
    expect(result.domainCertificateRequests).toBe(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({
      origin: "https://e.mattrax.app",
      hostname: "e.mattrax.app",
      reason: "missing",
    });
  });

  it("does not request issuance when the origin certificate is healthy", async () => {
    const db = makeDb();
    const request = vi.fn(() => Effect.succeed(undefined));

    const result = await runIssuance(db, {
      serverCertificateOrigin: "https://e.mattrax.app",
      serverCertificateProbe: () =>
        Effect.succeed({
          hostname: "e.mattrax.app",
          port: 443,
          subject: "CN=e.mattrax.app",
          issuer: "CN=Test CA",
          serialNumber: "2a",
          fingerprintSha256: "a".repeat(64),
          notBefore: new Date(now.getTime() - 30 * DAY),
          notAfter: new Date(now.getTime() + 60 * DAY),
          authorized: true,
          authorizationError: null,
          chainLength: 2,
        }),
      requestDomainCertificate: request,
    });

    expect(result.missingDomainCertificates).toBe(0);
    expect(result.domainCertificateRequests).toBe(0);
    expect(request).not.toHaveBeenCalled();
  });

  it("isolates a failing issuance hook and retries on the next run", async () => {
    const db = makeDb();
    const request = vi.fn(() => Effect.fail(new Error("ACME unavailable")));

    const missingLeaf = () =>
      Effect.succeed({
        hostname: "e.mattrax.app",
        port: 443,
        subject: null,
        issuer: null,
        serialNumber: null,
        fingerprintSha256: null,
        notBefore: null,
        notAfter: null,
        authorized: false,
        authorizationError: null,
        chainLength: 0,
      });

    const first = await runIssuance(db, {
      serverCertificateOrigin: "https://e.mattrax.app",
      serverCertificateProbe: missingLeaf,
      serverCertificateIntervalMinutes: 0,
      requestDomainCertificate: request,
    });

    expect(first.missingDomainCertificates).toBe(1);
    expect(first.domainCertificateRequests).toBe(0);
    expect(request).toHaveBeenCalledTimes(1);

    // A failed request leaves the observation missing, so the next run retries.
    await runIssuance(db, {
      serverCertificateOrigin: "https://e.mattrax.app",
      serverCertificateProbe: missingLeaf,
      serverCertificateIntervalMinutes: 0,
      requestDomainCertificate: request,
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not request issuance when the TLS probe itself failed", async () => {
    const db = makeDb();
    const request = vi.fn(() => Effect.succeed(undefined));

    const result = await runIssuance(db, {
      serverCertificateOrigin: "https://e.mattrax.app",
      serverCertificateProbe: () => Effect.fail(new Error("TLS handshake failed")),
      requestDomainCertificate: request,
    });

    // An outage leaves notAfter null too, but it is not a missing certificate.
    expect(result.missingDomainCertificates).toBe(0);
    expect(result.domainCertificateProbeFailed).toBe(1);
    expect(result.domainCertificateRequests).toBe(0);
    expect(request).not.toHaveBeenCalled();
  });
});

describe("maintenance organisation event retention", () => {
  it("prunes old MDM rows with the same window as account actions", async () => {
    const db = makeDb();

    const row = (id: string, ageDays: number, category: "account" | "mdm") => ({
      id,
      organizationId: "org-1",
      actorAccountId: category === "account" ? "account-1" : null,
      actorEmail: category === "account" ? "owner@example.com" : "system",
      actorType: category === "account" ? "account" : "system",
      category,
      action: category === "account" ? "policy.updated" : "mdm.checkin",
      targetType: "device",
      targetId: "device-1",
      metadata: null,
      ip: "203.0.113.9",
      userAgent: null,
      deviceId: "device-1",
      deviceCertificateFingerprint: null,
      deviceCertificateSerial: "0a1b",
      protocol: category === "account" ? null : "apple",
      createdAt: new Date(now.getTime() - ageDays * DAY),
    });

    db.store.audit_log.push(
      row("old-mdm", 400, "mdm"),
      row("old-account", 400, "account"),
      row("fresh-mdm", 10, "mdm"),
    );

    const result = await runEffect(
      runMaintenance({ now, auditRetentionDays: 365, credentialAlerts: false }).pipe(
        Effect.provideService(Db, db),
      ),
    );

    expect(result.purgedAuditEntries).toBe(2);
    expect(db.store.audit_log.map((row: { id: string }) => row.id)).toEqual(["fresh-mdm"]);
  });
});

describe("maintenance Apps and Books client", () => {
  it("logs and skips the sweep when the client chunk cannot be loaded", async () => {
    // The Apps and Books client is imported lazily by the daily sweep. A
    // rejected chunk must skip that step (and say so) instead of failing the
    // rest of maintenance or surfacing as a defect.
    vi.doMock("@mattrax/apple-business-manager", () => {
      throw new Error("chunk load failed");
    });

    try {
      const db = makeDb();

      const outcome = await Effect.runPromise(
        Effect.gen(function* () {
          const result = yield* runMaintenance({
            now,
            auditRetentionDays: 0,
            credentialAlerts: false,
            vppSync: true,
            authSecret: "maintenance-test-secret",
          }).pipe(Effect.provideService(Db, db));

          const logs = yield* TestConsole.logLines;
          const errors = yield* TestConsole.errorLines;

          return {
            result,
            lines: [...logs, ...errors].map((entry) =>
              typeof entry === "string" ? entry : JSON.stringify(entry),
            ),
          };
        }).pipe(Effect.provide(TestConsole.layer)),
      );

      // The sweep was skipped, the run still finished, and nothing died.
      expect(outcome.result.vppSynced).toBe(0);
      expect(outcome.result.vppFailed).toBe(0);
      expect(outcome.lines.some((line) => line.includes(VPP_CLIENT_LOAD_FAILED))).toBe(true);
    } finally {
      vi.doUnmock("@mattrax/apple-business-manager");
    }
  });
});

describe("maintenance approval retention", () => {
  it("deletes terminal approval requests older than 90 days and keeps pending ones", async () => {
    const db = makeDb();

    const approval = (id: string, status: string, ageDays: number) => ({
      id,
      organizationId: "org-1",
      policyId: null,
      action: "policy.delete",
      status,
      scopeType: "tenant",
      scopeId: null,
      requestedByAccountId: "account-1",
      requestedByEmail: "owner@example.com",
      requestedByCredential: "session",
      payloadHash: "hash-" + id,
      payloadSummary: {},
      approverPermission: null,
      approverRole: "admin",
      approvalsRequired: 1,
      breakGlass: false,
      breakGlassReason: null,
      consumedAt: status === "approved" ? new Date(now.getTime() - ageDays * DAY) : null,
      expiresAt: new Date(now.getTime() - ageDays * DAY + DAY),
      createdAt: new Date(now.getTime() - ageDays * DAY),
      updatedAt: new Date(now.getTime() - ageDays * DAY),
    });

    db.store.approval_request.push(
      approval("old-approved", "approved", 91),
      approval("old-rejected", "rejected", 120),
      approval("fresh-approved", "approved", 10),
      approval("old-pending", "pending", 120),
    );

    const result = await run(db);

    expect(result.purgedApprovalRequests).toBe(2);
    expect(db.store.approval_request.map((row: { id: string }) => row.id).sort()).toEqual([
      "fresh-approved",
      "old-pending",
    ]);
  });

  it("can be disabled with a retention of 0", async () => {
    const db = makeDb();

    db.store.approval_request.push({
      id: "old",
      organizationId: "org-1",
      policyId: null,
      action: "policy.delete",
      status: "rejected",
      scopeType: "tenant",
      scopeId: null,
      requestedByAccountId: null,
      requestedByEmail: null,
      requestedByCredential: "session",
      payloadHash: "hash",
      payloadSummary: {},
      approverPermission: null,
      approverRole: "admin",
      approvalsRequired: 1,
      breakGlass: false,
      breakGlassReason: null,
      consumedAt: null,
      expiresAt: new Date(0),
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });

    const result = await runEffect(
      runMaintenance({
        now,
        auditRetentionDays: 0,
        approvalRetentionDays: 0,
        credentialAlerts: false,
      }).pipe(Effect.provideService(Db, db)),
    );

    expect(result.purgedApprovalRequests).toBe(0);
    expect(db.store.approval_request).toHaveLength(1);
  });
});

describe("maintenance handover archive retention", () => {
  const archive = (id: string, ageDays: number) => ({
    id,
    organizationId: "org-1",
    createdByAccountId: "user-1",
    createdByEmail: "owner@example.com",
    reason: "Lease returned",
    deviceCount: 1,
    devices: [],
    secretKinds: [],
    r2Key: `handovers/org-1/${id}.json`,
    sizeBytes: 10,
    sha256: "a".repeat(64),
    envelopeVersion: 1,
    createdAt: new Date(now.getTime() - ageDays * DAY),
    expiresAt: new Date(now.getTime() - ageDays * DAY + 15 * 60 * 1000),
    downloadedAt: null,
  });

  it("prunes expired rows without storage and keeps live ones", async () => {
    const db = makeDb();

    db.store.device_handover_archive.push(
      archive("expired", 2),
      { ...archive("downloaded", 0), downloadedAt: now },
      archive("live", 0),
    );

    const result = await runEffect(
      runMaintenance({ now, auditRetentionDays: 0, credentialAlerts: false }).pipe(
        Effect.provideService(Db, db),
      ),
    );

    expect(result.purgedHandoverArchives).toBe(2);
    expect(db.store.device_handover_archive.map((row: any) => row.id)).toEqual(["live"]);
  });

  it("deletes the sealed object before the row when storage is available", async () => {
    const db = makeDb();
    const objects = new Set(["handovers/org-1/expired.json"]);
    const deleted: string[] = [];
    const storage = {
      head: async () => null,
      get: async () => null,
      put: async () => {
        throw new Error("not used");
      },
      delete: async (keys: string | ReadonlyArray<string>) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          deleted.push(key);
          objects.delete(key);
        }
      },
      list: async () => ({ objects: [], truncated: false, delimitedPrefixes: [] }),
    };

    db.store.device_handover_archive.push(archive("expired", 2));

    const result = await runEffect(
      runMaintenance({
        now,
        auditRetentionDays: 0,
        credentialAlerts: false,
        // SAFETY: the fake implements the R2 operations this step uses.
        storage: storage as any,
      }).pipe(Effect.provideService(Db, db)),
    );

    expect(result.purgedHandoverArchives).toBe(1);
    expect(deleted).toEqual(["handovers/org-1/expired.json"]);
    expect(objects.size).toBe(0);
    expect(db.store.device_handover_archive).toHaveLength(0);
  });

  it("keeps the row when the object delete fails so a retry can finish", async () => {
    const db = makeDb();
    const storage = {
      head: async () => null,
      get: async () => null,
      put: async () => {
        throw new Error("not used");
      },
      delete: async () => {
        throw new Error("R2 outage");
      },
      list: async () => ({ objects: [], truncated: false, delimitedPrefixes: [] }),
    };

    db.store.device_handover_archive.push(archive("expired", 2));

    const result = await runEffect(
      runMaintenance({
        now,
        auditRetentionDays: 0,
        credentialAlerts: false,
        // SAFETY: the fake implements the R2 operations this step uses.
        storage: storage as any,
      }).pipe(Effect.provideService(Db, db)),
    );

    expect(result.purgedHandoverArchives).toBe(0);
    expect(db.store.device_handover_archive).toHaveLength(1);
  });
});

describe("maintenance diagnostic archive retention", () => {
  const archive = (id: string, ageDays: number, r2Key: string | null) => ({
    id,
    organizationId: "org-1",
    deviceId: "device-1",
    requestedByAccountId: "user-1",
    requestedByEmail: "owner@example.com",
    collectionId: id,
    commandId: null,
    status: r2Key ? "uploaded" : "pending",
    r2Key,
    sizeBytes: r2Key ? 10 : null,
    sha256: r2Key ? "a".repeat(64) : null,
    contentType: r2Key ? "application/zip" : null,
    error: null,
    requestedAt: new Date(now.getTime() - ageDays * DAY),
    uploadedAt: r2Key ? new Date(now.getTime() - ageDays * DAY) : null,
    expiresAt: new Date(now.getTime() - ageDays * DAY + 24 * 60 * 60 * 1000),
    updatedAt: new Date(now.getTime() - ageDays * DAY),
  });

  it("prunes keyless expired rows without storage but keeps R2-backed rows", async () => {
    const db = makeDb();

    db.store.device_diagnostics_archive.push(
      archive("pending", 2, null),
      archive("uploaded", 2, "diagnostics/org-1/device-1/uploaded.zip"),
      archive("live", 0, null),
    );

    const result = await runEffect(
      runMaintenance({ now, auditRetentionDays: 0, credentialAlerts: false }).pipe(
        Effect.provideService(Db, db),
      ),
    );

    expect(result.purgedDiagnosticsArchives).toBe(1);
    expect(db.store.device_diagnostics_archive.map((row: any) => row.id)).toEqual([
      "uploaded",
      "live",
    ]);
  });

  it("deletes the object before the row when storage is available", async () => {
    const db = makeDb();
    const deleted: string[] = [];
    const storage = {
      head: async () => null,
      get: async () => null,
      put: async () => {
        throw new Error("not used");
      },
      delete: async (keys: string | ReadonlyArray<string>) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) deleted.push(key);
      },
      list: async () => ({ objects: [], truncated: false, delimitedPrefixes: [] }),
    };

    db.store.device_diagnostics_archive.push(
      archive("uploaded", 2, "diagnostics/org-1/device-1/uploaded.zip"),
    );

    const result = await runEffect(
      runMaintenance({
        now,
        auditRetentionDays: 0,
        credentialAlerts: false,
        storage: storage as any,
      }).pipe(Effect.provideService(Db, db)),
    );

    expect(result.purgedDiagnosticsArchives).toBe(1);
    expect(deleted).toEqual(["diagnostics/org-1/device-1/uploaded.zip"]);
    expect(db.store.device_diagnostics_archive).toHaveLength(0);
  });
});

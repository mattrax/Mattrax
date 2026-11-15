import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { Db } from "@mattrax/enterprise-core";
import { sealSecret } from "@mattrax/crypto";
import { runMaintenance } from "../src/maintenance.js";
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
      }).pipe(Effect.provideService(Db, db)),
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
      }).pipe(Effect.provideService(Db, db)),
    );

    expect(result.dynamicGroupsEvaluated).toBe(0);
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
    expect(db.store.webhook_delivery.map((item) => item.id).sort()).toEqual(["boundary", "fresh"]);
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

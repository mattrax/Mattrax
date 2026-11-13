import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  isEntraSyncDue,
  runEntraDirectorySyncForTenant,
  runScheduledEntraSync,
} from "../src/entraSync.js";
import { makeDb } from "./helpers.js";

const now = new Date("2026-11-11T12:00:00.000Z");

const tenantRow = (overrides: Record<string, unknown> = {}) => ({
  organizationId: "org-1",
  enabled: true,
  status: "idle",
  syncIntervalMinutes: 60,
  nextSyncAt: new Date(now.getTime() - 60_000),
  lastAttemptedAt: new Date(now.getTime() - 3_600_000),
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const ssoRow = (organizationId: string, azureTenantId: string) => ({
  organizationId,
  enabled: true,
  azureTenantId,
  autoProvision: true,
  requireMfa: false,
  createdAt: now,
  updatedAt: now,
});

const page = (deltaLink: string) => ({
  items: [],
  nextLink: null,
  deltaLink,
});

type GraphCall = { kind: "domains" | "users" | "groups"; tenantId: string };

const makeGraph = (options: {
  calls: GraphCall[];
  failFor?: string;
  domains?: (tenantId: string) => Effect.Effect<any>;
}) =>
  ({
    domains: (tenantId: string) => {
      options.calls.push({ kind: "domains", tenantId });

      if (options.failFor === tenantId) return Effect.fail(new Error("graph down"));

      return (
        options.domains?.(tenantId) ??
        Effect.succeed([{ id: `${tenantId}.onmicrosoft.com`, isVerified: true, isInitial: false }])
      );
    },
    usersDelta: (tenantId: string) => {
      options.calls.push({ kind: "users", tenantId });

      return Effect.succeed(page("users-delta"));
    },
    groupsDelta: (tenantId: string) => {
      options.calls.push({ kind: "groups", tenantId });

      return Effect.succeed(page("groups-delta"));
    },
    consentUrl: () => "https://consent.test",
  }) as never;

describe("isEntraSyncDue", () => {
  it("is due when nextSyncAt has passed", () => {
    expect(
      isEntraSyncDue(
        {
          enabled: true,
          syncIntervalMinutes: 60,
          nextSyncAt: new Date(now.getTime() - 1),
        },
        now,
      ),
    ).toBe(true);
  });

  it("is not due before nextSyncAt", () => {
    expect(
      isEntraSyncDue(
        {
          enabled: true,
          syncIntervalMinutes: 60,
          nextSyncAt: new Date(now.getTime() + 60_000),
        },
        now,
      ),
    ).toBe(false);
  });

  it("falls back to lastAttemptedAt + interval when nextSyncAt is absent", () => {
    expect(
      isEntraSyncDue(
        {
          enabled: true,
          syncIntervalMinutes: 60,
          lastAttemptedAt: new Date(now.getTime() - 3_600_000),
        },
        now,
      ),
    ).toBe(true);
    expect(
      isEntraSyncDue(
        {
          enabled: true,
          syncIntervalMinutes: 60,
          lastAttemptedAt: new Date(now.getTime() - 60_000),
        },
        now,
      ),
    ).toBe(false);
  });

  it("treats a never-run tenant as due", () => {
    expect(isEntraSyncDue({ enabled: true, syncIntervalMinutes: 60 }, now)).toBe(true);
  });

  it("is never due when disabled or the interval is zero", () => {
    expect(
      isEntraSyncDue(
        { enabled: false, syncIntervalMinutes: 60, nextSyncAt: new Date(now.getTime() - 1) },
        now,
      ),
    ).toBe(false);
    expect(
      isEntraSyncDue(
        { enabled: true, syncIntervalMinutes: 0, nextSyncAt: new Date(now.getTime() - 1) },
        now,
      ),
    ).toBe(false);
  });

  it("treats unparseable dates as due rather than stuck", () => {
    expect(
      isEntraSyncDue({ enabled: true, syncIntervalMinutes: 60, nextSyncAt: "not-a-date" }, now),
    ).toBe(true);
  });
});

describe("runScheduledEntraSync", () => {
  it("selects only due, enabled tenants with a positive interval", async () => {
    const db = makeDb({
      sso_config: [
        ssoRow("org-1", "entra-1"),
        ssoRow("org-2", "entra-2"),
        ssoRow("org-3", "entra-3"),
        ssoRow("org-4", "entra-4"),
      ],
      entra_directory_sync: [
        tenantRow({ organizationId: "org-1" }),
        tenantRow({
          organizationId: "org-2",
          nextSyncAt: new Date(now.getTime() + 3_600_000),
        }),
        tenantRow({ organizationId: "org-3", syncIntervalMinutes: 0 }),
        tenantRow({ organizationId: "org-4", enabled: false }),
      ],
    });

    const calls: GraphCall[] = [];

    const result = await Effect.runPromise(
      runScheduledEntraSync({ db: db as never, graph: makeGraph({ calls }), now }),
    );

    expect(result).toMatchObject({ graphConfigured: true, due: 1, succeeded: 1, failed: 0 });
    expect(calls.filter((call) => call.kind === "domains")).toEqual([
      { kind: "domains", tenantId: "entra-1" },
    ]);
  });

  it("does nothing when Graph is not configured", async () => {
    const db = makeDb({
      sso_config: [ssoRow("org-1", "entra-1")],
      entra_directory_sync: [tenantRow()],
    });

    const result = await Effect.runPromise(runScheduledEntraSync({ db: db as never, now }));

    expect(result).toEqual({
      graphConfigured: false,
      due: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      locked: 0,
    });
    expect(db.store.entra_directory_sync[0]).toMatchObject({ status: "idle" });
  });

  it("skips tenants without an Entra tenant id", async () => {
    const db = makeDb({
      sso_config: [],
      entra_directory_sync: [tenantRow()],
    });

    const calls: GraphCall[] = [];

    const result = await Effect.runPromise(
      runScheduledEntraSync({ db: db as never, graph: makeGraph({ calls }), now }),
    );

    expect(result).toMatchObject({ due: 1, skipped: 1, succeeded: 0 });
    expect(calls).toEqual([]);
  });

  it("reports a lock conflict without touching Graph", async () => {
    const db = makeDb({
      sso_config: [ssoRow("org-1", "entra-1")],
      entra_directory_sync: [
        tenantRow({ status: "running", updatedAt: new Date(now.getTime() - 60_000) }),
      ],
    });

    const calls: GraphCall[] = [];

    const result = await Effect.runPromise(
      runScheduledEntraSync({ db: db as never, graph: makeGraph({ calls }), now }),
    );

    expect(result).toMatchObject({ due: 1, locked: 1, succeeded: 0, failed: 0 });
    expect(calls).toEqual([]);
    expect(db.store.entra_directory_sync[0]).toMatchObject({ status: "running" });
  });

  it("isolates a failing tenant and still syncs the rest", async () => {
    const db = makeDb({
      sso_config: [ssoRow("org-1", "entra-1"), ssoRow("org-2", "entra-2")],
      entra_directory_sync: [
        tenantRow({ organizationId: "org-1" }),
        tenantRow({ organizationId: "org-2" }),
      ],
    });

    const calls: GraphCall[] = [];

    const result = await Effect.runPromise(
      runScheduledEntraSync({
        db: db as never,
        graph: makeGraph({ calls, failFor: "entra-1" }),
        now,
        concurrency: 2,
      }),
    );

    expect(result).toMatchObject({ due: 2, succeeded: 1, failed: 1 });
    const [failed, succeeded] = db.store.entra_directory_sync;
    expect(failed).toMatchObject({ organizationId: "org-1", status: "error" });
    expect(String(failed.lastError)).toContain("graph down");
    expect(succeeded).toMatchObject({ organizationId: "org-2", status: "idle" });
  });

  it("persists cursors, counts, trigger and the next run time", async () => {
    const db = makeDb({
      sso_config: [ssoRow("org-1", "entra-1")],
      entra_directory_sync: [tenantRow()],
    });

    const calls: GraphCall[] = [];

    await Effect.runPromise(
      runScheduledEntraSync({ db: db as never, graph: makeGraph({ calls }), now }),
    );

    expect(db.store.entra_directory_sync[0]).toMatchObject({
      status: "idle",
      lastError: null,
      usersDeltaLink: "users-delta",
      groupsDeltaLink: "groups-delta",
      lastCounts: { users: 0, groups: 0, domains: 0 },
      lastRunTrigger: "scheduled",
      lastSyncedAt: now,
      nextSyncAt: new Date(now.getTime() + 60 * 60_000),
      lastAttemptedAt: now,
    });
  });

  it("keeps a manual run's trigger separate from scheduled runs", async () => {
    const db = makeDb({
      sso_config: [ssoRow("org-1", "entra-1")],
      entra_directory_sync: [tenantRow()],
    });

    const outcome = await Effect.runPromise(
      runEntraDirectorySyncForTenant({
        db: db as never,
        graph: makeGraph({ calls: [] }),
        organizationId: "org-1",
        trigger: "manual",
        now,
      }),
    );

    expect(outcome).toMatchObject({ status: "ok", users: 0, groups: 0, domains: 0 });
    expect(db.store.entra_directory_sync[0]).toMatchObject({ lastRunTrigger: "manual" });
  });

  it("returns not_configured instead of throwing when Graph is absent", async () => {
    const db = makeDb({
      sso_config: [ssoRow("org-1", "entra-1")],
      entra_directory_sync: [tenantRow()],
    });

    const outcome = await Effect.runPromise(
      runEntraDirectorySyncForTenant({
        db: db as never,
        organizationId: "org-1",
        now,
      }),
    );

    expect(outcome).toMatchObject({ status: "not_configured" });
    expect(db.store.entra_directory_sync[0]).toMatchObject({ status: "idle" });
  });
});

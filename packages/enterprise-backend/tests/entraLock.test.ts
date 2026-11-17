import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { ENTRA_SYNC_STALE_MS, acquireEntraSyncLock } from "@mattrax/entra-id";

/** A value a fake sync row can hold. */
type RowValue = string | number | boolean | Date | null | undefined | RowValue[] | Row;

type Row = { readonly [column: string]: RowValue };

/** Row values the fake recorded for each write path. */
type LockCalls = { readonly inserts: Row[]; readonly updates: Row[] };

const makeLockDb = (initial?: Row) => {
  const rows: Row[] = initial ? [{ ...initial }] : [];
  const calls: LockCalls = { inserts: [], updates: [] };

  const tx = {
    query: {
      entraDirectorySync: {
        findFirst: () => Effect.sync(() => rows[0]),
      },
    },
    insert: () => ({
      values: (value: Row) =>
        Effect.sync(() => {
          calls.inserts.push(value);
          rows.push({ ...value });
        }),
    }),
    update: () => ({
      set: (value: Row) => ({
        where: () =>
          Effect.sync(() => {
            calls.updates.push(value);

            if (rows[0]) Object.assign(rows[0], value);

            return { affectedRows: rows[0] ? 1 : 0 };
          }),
      }),
    }),
    transaction: <A, E>(work: (tx: any) => Effect.Effect<A, E>) => work(tx),
  };

  // SAFETY: the fake transaction exposes only the query/insert/update calls the
  // lock helper makes, not the full Drizzle `EnterpriseDb` surface.
  return { db: tx as any, calls, rows };
};

const now = new Date("2026-11-11T12:00:00.000Z");

describe("Entra directory sync lock", () => {
  it("creates a running lock for a tenant that has never synced", async () => {
    const fake = makeLockDb();

    const result = await Effect.runPromise(
      acquireEntraSyncLock({ db: fake.db, organizationId: "org-1", now }),
    );

    expect(result).toEqual({
      acquired: true,
      stale: false,
      previousStatus: null,
      enabled: true,
    });
    expect(fake.calls.inserts).toHaveLength(1);
    expect(fake.rows[0]).toMatchObject({
      organizationId: "org-1",
      status: "running",
      lastAttemptedAt: now,
      updatedAt: now,
    });
  });

  it("refuses a second concurrent sync", async () => {
    const fake = makeLockDb({
      organizationId: "org-1",
      enabled: true,
      status: "running",
      updatedAt: new Date(now.getTime() - 60_000),
    });

    const result = await Effect.runPromise(
      acquireEntraSyncLock({ db: fake.db, organizationId: "org-1", now }),
    );

    expect(result.acquired).toBe(false);
    expect(result.previousStatus).toBe("running");
    expect(fake.calls.updates).toHaveLength(0);
  });

  it("takes over a stale running lock", async () => {
    const fake = makeLockDb({
      organizationId: "org-1",
      enabled: true,
      status: "running",
      lastError: "worker was evicted",
      updatedAt: new Date(now.getTime() - ENTRA_SYNC_STALE_MS - 1_000),
    });

    const result = await Effect.runPromise(
      acquireEntraSyncLock({ db: fake.db, organizationId: "org-1", now }),
    );

    expect(result.acquired).toBe(true);
    expect(result.stale).toBe(true);
    expect(fake.calls.updates).toHaveLength(1);
    expect(fake.rows[0]).toMatchObject({ status: "running", lastAttemptedAt: now, updatedAt: now });
  });

  it("treats an unparseable timestamp as stale rather than wedging forever", async () => {
    const fake = makeLockDb({
      organizationId: "org-1",
      enabled: true,
      status: "running",
      updatedAt: "not-a-date",
    });

    const result = await Effect.runPromise(
      acquireEntraSyncLock({ db: fake.db, organizationId: "org-1", now }),
    );

    expect(result.acquired).toBe(true);
    expect(result.stale).toBe(true);
  });

  it("acquires an idle or errored row and clears the old error", async () => {
    for (const status of ["idle", "error"] as const) {
      const fake = makeLockDb({
        organizationId: "org-1",
        enabled: false,
        status,
        lastError: "previous failure",
        updatedAt: new Date(now.getTime() - 1_000),
      });

      const result = await Effect.runPromise(
        acquireEntraSyncLock({ db: fake.db, organizationId: "org-1", now }),
      );

      expect(result.acquired).toBe(true);
      expect(result.stale).toBe(false);
      expect(result.enabled).toBe(false);
      expect(fake.calls.updates[0]).toMatchObject({ status: "running", lastError: null });
    }
  });

  it("honours a custom stale window", async () => {
    const fake = makeLockDb({
      organizationId: "org-1",
      enabled: true,
      status: "running",
      updatedAt: new Date(now.getTime() - 5_000),
    });

    const result = await Effect.runPromise(
      acquireEntraSyncLock({
        db: fake.db,
        organizationId: "org-1",
        now,
        staleAfterMs: 1_000,
      }),
    );

    expect(result.acquired).toBe(true);
    expect(result.stale).toBe(true);
  });
});

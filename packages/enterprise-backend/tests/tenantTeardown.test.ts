import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { R2Bucket, TenantDeletionStep } from "@mattrax/enterprise-core";
import {
  deleteTenantObjects,
  teardownTenant,
  type DeviceUnenrollSummary,
  type TenantTeardownStepFailed,
} from "../src/tenantTeardown.js";
import { makeDb, runEffect } from "./helpers.js";

const failureStep = (failure: TenantTeardownStepFailed | null) => failure?.step;

const recordedSteps = (journal: { readonly steps: unknown }) => {
  // SAFETY: the teardown validates every journal entry it writes; the fake
  // database stores the same array it was given.
  return journal.steps as ReadonlyArray<TenantDeletionStep>;
};

const organization = {
  id: "org-1",
  name: "Acme",
  slug: "acme",
  logo: null,
  displayName: null,
  supportEmail: null,
  brandColor: null,
  metadata: null,
  stripeCustomerId: "cus_1",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

type FakeStorage = R2Bucket & {
  readonly objects: Map<string, string>;
  failNextDelete?: boolean;
};

const makeStorage = (entries: Record<string, string> = {}): FakeStorage => {
  const objects = new Map(Object.entries(entries));

  const storage: FakeStorage = {
    objects,
    put: async (key, value) => {
      objects.set(key, String(value));

      return {
        key,
        version: "1",
        size: 1,
        etag: "etag",
        httpEtag: "etag",
        uploaded: new Date(),
      };
    },
    get: async () => null,
    head: async () => null,
    delete: async (keys) => {
      if (storage.failNextDelete) {
        storage.failNextDelete = false;
        throw new Error("R2 unavailable");
      }

      for (const key of Schema.is(Schema.String)(keys) ? [keys] : keys) objects.delete(key);
    },
    list: async (options) => ({
      objects: [...objects.keys()].flatMap((key) =>
        !options?.prefix || key.startsWith(options.prefix)
          ? [
              {
                key,
                version: "1",
                size: 1,
                etag: "etag",
                httpEtag: "etag",
                uploaded: new Date(),
              },
            ]
          : [],
      ),
      truncated: false,
      delimitedPrefixes: [],
    }),
  };

  return storage;
};

const makeDeviceSummary = (
  overrides: Partial<DeviceUnenrollSummary> = {},
): DeviceUnenrollSummary => ({
  total: 2,
  contacted: 2,
  unreachable: [],
  ...overrides,
});

const makeDeps = (
  options: {
    readonly calls?: string[];
    readonly devices?: DeviceUnenrollSummary;
    readonly subscription?: "cancelled" | "at_period_end" | "none";
    readonly cancelError?: Error;
  } = {},
) => ({
  unenrollDevices: (organizationId: string) =>
    Effect.sync(() => {
      options.calls?.push(`devices:${organizationId}`);

      return options.devices ?? makeDeviceSummary();
    }),
  cancelSubscription: (target: { readonly id: string }) =>
    Effect.suspend(() => {
      options.calls?.push(`subscription:${target.id}`);

      if (options.cancelError) return Effect.fail(options.cancelError);

      return Effect.succeed(options.subscription ?? "cancelled");
    }),
});

const seed = (db: ReturnType<typeof makeDb>) => {
  db.store.organization.push({ ...organization });
  db.store.subscription.push({
    id: "sub-row-1",
    plan: "device",
    referenceId: "org-1",
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    status: "active",
    periodStart: null,
    periodEnd: null,
    cancelAtPeriodEnd: false,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  });
};

describe("tenant teardown", () => {
  it("contacts devices, cancels billing and deletes only tenant-prefixed objects before the row", async () => {
    const db = makeDb();
    seed(db);

    const storage = makeStorage({
      "p/org-1/policy-1/file": "policy",
      "a/org-1/app-1/file": "app",
      "backups/org-1/2026-01-01T00-00-00-000Z.json": "{}",
      "p/org-2/policy-1/file": "other tenant",
    });

    const calls: string[] = [];
    let seenDuringSubscription: unknown;

    const result = await runEffect(
      teardownTenant(db, storage, {
        organizationId: "org-1",
        actor: { id: "user-1", email: "owner@example.com" },
        deps: {
          unenrollDevices: makeDeps({ calls }).unenrollDevices,
          cancelSubscription: (target) =>
            Effect.sync(() => {
              calls.push(`subscription:${target.id}`);
              // The organization must still exist while billing is cancelled.
              seenDuringSubscription = db.store.organization.find(
                (row: { id: string }) => row.id === "org-1",
              );

              return "cancelled" as const;
            }),
        },
        now: () => new Date("2026-11-01T00:00:00Z"),
      }),
    );

    expect(calls).toEqual(["devices:org-1", "subscription:org-1"]);
    expect(seenDuringSubscription).toBeDefined();
    expect(result).toMatchObject({
      subscription: "cancelled",
      objectsDeleted: 3,
      devices: { total: 2, contacted: 2 },
    });

    expect(db.store.organization).toHaveLength(0);
    expect(db.store.subscription).toHaveLength(0);
    expect([...storage.objects.keys()]).toEqual(["p/org-2/policy-1/file"]);

    const journal = db.store.tenant_deletion.at(0)!;
    expect(journal).toMatchObject({
      organizationId: "org-1",
      status: "completed",
      attempts: 1,
      lastError: null,
    });
    expect(recordedSteps(journal).map((step) => step.step)).toEqual([
      "devices",
      "subscription",
      "storage",
      "tenant",
    ]);
    expect(recordedSteps(journal).find((step) => step.step === "storage")?.count).toBe(3);
  });

  it("keeps the tenant and resumes after a storage failure", async () => {
    const db = makeDb();
    seed(db);

    const storage = makeStorage({ "backups/org-1/run.json": "{}" });
    storage.failNextDelete = true;

    const first = await runEffect(
      Effect.match(
        teardownTenant(db, storage, {
          organizationId: "org-1",
          deps: makeDeps(),
        }),
        {
          onFailure: (error) => error,
          onSuccess: () => null,
        },
      ),
    );

    expect(failureStep(first)).toBe("storage");
    // The tenant is not half-deleted: the row and journal stay for a retry.
    expect(db.store.organization).toHaveLength(1);
    expect(db.store.tenant_deletion.at(0)).toMatchObject({
      status: "failed",
      attempts: 1,
    });
    // Objects were not silently dropped from the index of work still to do.
    expect([...storage.objects.keys()]).toEqual(["backups/org-1/run.json"]);

    const second = await runEffect(
      teardownTenant(db, storage, { organizationId: "org-1", deps: makeDeps() }),
    );

    expect(second.objectsDeleted).toBe(1);
    expect(db.store.organization).toHaveLength(0);
    expect(db.store.tenant_deletion.at(0)).toMatchObject({
      status: "completed",
      attempts: 2,
      completedAt: expect.any(Date),
    });
  });

  it("reports unreachable devices without blocking the deletion", async () => {
    const db = makeDb();
    seed(db);
    const storage = makeStorage();

    const result = await runEffect(
      teardownTenant(db, storage, {
        organizationId: "org-1",
        deps: makeDeps({
          devices: makeDeviceSummary({
            total: 3,
            contacted: 1,
            unreachable: [
              {
                id: "device-2",
                name: "MacBook",
                platform: "apple",
                reason: "The APNs push failed.",
              },
            ],
          }),
        }),
      }),
    );

    expect(result.devices.unreachable).toHaveLength(1);
    expect(db.store.organization).toHaveLength(0);
    const journal = db.store.tenant_deletion.at(0)!;
    expect(recordedSteps(journal).find((step) => step.step === "devices")).toMatchObject({
      status: "skipped",
      count: 3,
    });
  });

  it("keeps the tenant when billing cannot be cancelled", async () => {
    const db = makeDb();
    seed(db);
    const storage = makeStorage();

    const failure = await runEffect(
      Effect.match(
        teardownTenant(db, storage, {
          organizationId: "org-1",
          deps: makeDeps({ cancelError: new Error("Stripe unavailable") }),
        }),
        { onFailure: (error) => error, onSuccess: () => null },
      ),
    );

    expect(failureStep(failure)).toBe("subscription");
    expect(db.store.organization).toHaveLength(1);
    expect(db.store.subscription).toHaveLength(1);
    expect(db.store.tenant_deletion.at(0)).toMatchObject({ status: "failed" });
  });

  it("is idempotent when the row is already gone", async () => {
    const db = makeDb();
    const storage = makeStorage();

    const result = await runEffect(
      teardownTenant(db, storage, { organizationId: "org-missing", deps: makeDeps() }),
    );

    expect(result.objectsDeleted).toBe(0);
    expect(db.store.tenant_deletion.at(0)).toMatchObject({
      organizationId: "org-missing",
      status: "completed",
    });
    expect(db.store.tenant_deletion.at(0)!.steps).toMatchObject([
      { step: "tenant", status: "skipped" },
    ]);
  });

  it("returns the recorded result when a completed deletion is replayed", async () => {
    const db = makeDb({
      tenant_deletion: [
        {
          id: "job-1",
          organizationId: "org-1",
          status: "completed",
          steps: [
            {
              step: "storage",
              status: "succeeded",
              detail: "Deleted 7 objects.",
              count: 7,
              at: "",
            },
            {
              step: "subscription",
              status: "succeeded",
              detail: "Subscription cancelled.",
              result: "cancelled",
              at: "",
            },
          ],
          attempts: 1,
          lastError: null,
          requestedByUserId: null,
          requestedByEmail: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          completedAt: new Date(),
        },
      ],
    });

    const result = await runEffect(
      teardownTenant(db, makeStorage(), { organizationId: "org-1", deps: makeDeps() }),
    );

    expect(result.objectsDeleted).toBe(7);
    expect(result.subscription).toBe("cancelled");
  });
});

describe("tenant object deletion", () => {
  it("leaves other tenants' objects alone", async () => {
    const storage = makeStorage({
      "p/org-1/a": "1",
      "a/org-1/b": "1",
      "backups/org-1/c": "1",
      "p/org-10/d": "1",
    });

    expect(await deleteTenantObjects(storage, "org-1")).toEqual({ deleted: 3, complete: true });
    expect([...storage.objects.keys()]).toEqual(["p/org-10/d"]);
  });
});

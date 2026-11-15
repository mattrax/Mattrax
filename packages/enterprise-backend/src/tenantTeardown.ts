import { Data, Effect, Match } from "effect";
import { eq } from "drizzle-orm";
import { schema, type R2Bucket, type TenantDeletionStep } from "@mattrax/enterprise-core";
import type { EnterpriseDb, EnterpriseOrganization } from "./schema.ts";

/** Object prefixes owned by a tenant; see `@mattrax/enterprise-domain/storage`. */
export const tenantObjectPrefixes = (organizationId: string): ReadonlyArray<string> => [
  `p/${organizationId}/`,
  `a/${organizationId}/`,
  `backups/${organizationId}/`,
];

/**
 * A single teardown attempt is bounded so a pathological tenant cannot hold a
 * request open forever. A tenant with more objects is completed by retrying:
 * the next attempt lists what is left.
 */
export const TENANT_TEARDOWN_MAX_OBJECTS = 100_000;

const DELETE_BATCH_SIZE = 500;

export type TenantObjectDeletion = {
  readonly deleted: number;
  /** False when the object cap was hit; a retry continues from what remains. */
  readonly complete: boolean;
};

/**
 * Delete every object under the tenant's prefixes. Listing happens before
 * deleting because R2 cursor pagination is not stable while keys disappear.
 * Throws on storage failure so the caller keeps the tenant row and retries.
 */
export const deleteTenantObjects = async (
  storage: R2Bucket,
  organizationId: string,
): Promise<TenantObjectDeletion> => {
  const keys: string[] = [];
  let complete = true;

  for (const prefix of tenantObjectPrefixes(organizationId)) {
    let cursor: string | undefined;

    do {
      const page = await storage.list({ prefix, cursor, limit: 1_000 });

      for (const object of page.objects) keys.push(object.key);

      if (keys.length >= TENANT_TEARDOWN_MAX_OBJECTS) {
        complete = false;
        break;
      }

      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor !== undefined);

    if (!complete) break;
  }

  for (let index = 0; index < keys.length; index += DELETE_BATCH_SIZE)
    await storage.delete(keys.slice(index, index + DELETE_BATCH_SIZE));

  return { deleted: keys.length, complete };
};

export type UnreachableDevice = {
  readonly id: string;
  readonly name: string;
  readonly platform: "apple" | "win" | "android";
  /** Why the unenroll request could not be delivered; never a secret. */
  readonly reason: string;
};

export type DeviceUnenrollSummary = {
  /** Enrolled or unenrolling devices that belonged to the tenant. */
  readonly total: number;
  /** Devices the platform accepted an unenroll request for. */
  readonly contacted: number;
  /** Devices that need manual removal because they could not be reached. */
  readonly unreachable: ReadonlyArray<UnreachableDevice>;
};

export type SubscriptionReclamation = "cancelled" | "at_period_end" | "none";

/**
 * The two outbound edges of a teardown. Everything else (database rows, R2
 * prefixes) is owned by this module, so the ordering and retry journal stay in
 * one place and tests only fake the network.
 */
export type TenantTeardownDependencies = {
  /**
   * Read-only check for the irreversible steps that need external
   * configuration (billing, storage). Runs before any device is contacted, so
   * a misconfigured deployment cannot unenroll a fleet and then fail.
   */
  readonly preflight?: () => Effect.Effect<void, unknown>;
  readonly unenrollDevices: (
    organizationId: string,
  ) => Effect.Effect<DeviceUnenrollSummary, unknown>;
  readonly cancelSubscription: (
    organization: EnterpriseOrganization,
  ) => Effect.Effect<SubscriptionReclamation, unknown>;
};

export class TenantTeardownStepFailed extends Data.TaggedError("TenantTeardownStepFailed")<{
  readonly step: TenantDeletionStep["step"];
  readonly message: string;
}> {}

export type TenantTeardownResult = {
  readonly devices: DeviceUnenrollSummary;
  readonly subscription: SubscriptionReclamation;
  readonly objectsDeleted: number;
  readonly steps: ReadonlyArray<TenantDeletionStep>;
};

export type TenantTeardownOptions = {
  readonly organizationId: string;
  readonly actor?: { readonly id: string; readonly email: string };
  readonly deps: TenantTeardownDependencies;
  readonly now?: () => Date;
};

const newId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

type MutableStep = { -readonly [Key in keyof TenantDeletionStep]: TenantDeletionStep[Key] };

const summaryFromSteps = (steps: ReadonlyArray<TenantDeletionStep>): TenantTeardownResult => {
  const devices = steps.find((step) => step.step === "devices");
  const storage = steps.find((step) => step.step === "storage");
  const subscription = steps.find((step) => step.step === "subscription");
  const total = devices?.count ?? 0;

  const recovered = Match.value(subscription?.result).pipe(
    Match.when("cancelled", () => "cancelled" as const),
    Match.when("at_period_end", () => "at_period_end" as const),
    Match.orElse(() => "none" as const),
  );

  return {
    devices: { total, contacted: total, unreachable: [] },
    subscription: recovered,
    objectsDeleted: storage?.count ?? 0,
    steps,
  };
};

/**
 * Complete, idempotent tenant teardown.
 *
 * Order is deliberate: contact devices first (while their push tokens and
 * commands still exist), cancel billing, delete tenant-prefixed objects, and
 * only then delete the organization row. Every step is appended to the
 * `tenant_deletion` journal, which has no foreign key to the organization so
 * support can still see what was reclaimed after the row is gone. If a step
 * fails the organization is left in place and a retry resumes from the journal
 * rather than leaving a half-deleted tenant.
 */
export const teardownTenant = (
  db: EnterpriseDb,
  storage: R2Bucket,
  { organizationId, actor, deps, now = () => new Date() }: TenantTeardownOptions,
): Effect.Effect<TenantTeardownResult, TenantTeardownStepFailed, never> =>
  Effect.gen(function* () {
    const existing = yield* db.query.tenantDeletion.findFirst({
      where: { organizationId },
    });

    if (existing?.status === "completed") return summaryFromSteps(existing.steps);

    const organization = yield* db.query.organization.findFirst({
      where: { id: organizationId },
    });

    const steps: TenantDeletionStep[] = [];
    const timestamp = () => now().toISOString();

    const jobId = existing?.id ?? newId();
    const createdAt = existing?.createdAt ?? now();
    // Set once the claim below inserts the row; later persists must update it.
    let jobExists = existing !== undefined;

    const persist = (patch: {
      readonly status: "pending" | "failed" | "completed";
      readonly lastError?: string | null;
      readonly completedAt?: Date | null;
    }) =>
      Effect.gen(function* () {
        const value = {
          steps: [...steps],
          status: patch.status,
          lastError: patch.lastError ?? null,
          updatedAt: now(),
          completedAt: patch.completedAt ?? null,
        };

        if (jobExists) {
          yield* db
            .update(schema.tenantDeletion)
            .set(value)
            .where(eq(schema.tenantDeletion.id, jobId));
        } else {
          yield* db.insert(schema.tenantDeletion).values({
            id: jobId,
            organizationId,
            attempts: 1,
            requestedByUserId: actor?.id ?? null,
            requestedByEmail: actor?.email ?? null,
            createdAt,
            ...value,
          });
          jobExists = true;
        }
      });

    const record = (
      step: TenantDeletionStep["step"],
      status: TenantDeletionStep["status"],
      detail: string,
      options: { readonly count?: number; readonly result?: string } = {},
    ) =>
      Effect.sync(() => {
        const entry: MutableStep = { step, status, detail, at: timestamp() };

        if (options.count !== undefined) entry.count = options.count;

        if (options.result !== undefined) entry.result = options.result;

        steps.push(entry);
      });

    if (!organization) {
      // The row is already gone: a previous attempt finished the reclamation
      // but did not get to write the final journal entry.
      yield* record("tenant", "skipped", "The tenant row was already removed.");
      yield* persist({ status: "completed", completedAt: now() });

      return summaryFromSteps(steps);
    }

    // Claim the job before doing work so a crash is visible to support. The
    // existing journal is kept: a retry resumes from the last successful step
    // and repeats the idempotent ones.
    if (existing)
      yield* db
        .update(schema.tenantDeletion)
        .set({
          status: "pending",
          attempts: (existing.attempts ?? 0) + 1,
          updatedAt: now(),
          requestedByUserId: actor?.id ?? existing.requestedByUserId ?? null,
          requestedByEmail: actor?.email ?? existing.requestedByEmail ?? null,
        })
        .where(eq(schema.tenantDeletion.id, jobId));
    else
      yield* db.insert(schema.tenantDeletion).values({
        id: jobId,
        organizationId,
        status: "pending",
        steps: [],
        attempts: 1,
        lastError: null,
        requestedByUserId: actor?.id ?? null,
        requestedByEmail: actor?.email ?? null,
        createdAt,
        updatedAt: now(),
        completedAt: null,
      });
    jobExists = true;

    const fail = (step: TenantDeletionStep["step"], detail: string) =>
      Effect.gen(function* () {
        yield* record(step, "failed", detail);
        yield* persist({ status: "failed", lastError: detail });

        return yield* Effect.fail(new TenantTeardownStepFailed({ step, message: detail }));
      });

    // Fail before contacting a single device if a later, irreversible step
    // cannot possibly succeed (for example a Stripe subscription on a
    // deployment without billing configured).
    if (deps.preflight)
      yield* deps.preflight().pipe(
        Effect.catch((cause) =>
          Effect.gen(function* () {
            return yield* fail(
              "subscription",
              `Teardown preflight failed: ${describeTeardownError(cause)}`,
            );
          }),
        ),
      );

    const devices = yield* deps.unenrollDevices(organizationId).pipe(
      Effect.catch((cause) =>
        Effect.gen(function* () {
          return yield* fail(
            "devices",
            `Could not send unenroll requests: ${describeTeardownError(cause)}`,
          );
        }),
      ),
    );

    yield* record(
      "devices",
      devices.unreachable.length > 0 ? "skipped" : "succeeded",
      describeDevices(devices),
      { count: devices.total },
    );
    // Keep the running journal current even when the next steps fail.
    yield* persist({ status: "pending" });

    const subscription = yield* deps.cancelSubscription(organization).pipe(
      Effect.catch((cause) =>
        Effect.gen(function* () {
          return yield* fail(
            "subscription",
            `Could not cancel billing: ${describeTeardownError(cause)}`,
          );
        }),
      ),
    );

    yield* db
      .delete(schema.subscription)
      .where(eq(schema.subscription.referenceId, organizationId));

    if (organization.stripeCustomerId)
      yield* db
        .update(schema.organization)
        .set({ stripeCustomerId: null, updatedAt: now() })
        .where(eq(schema.organization.id, organizationId));

    yield* record(
      "subscription",
      subscription === "none" ? "skipped" : "succeeded",
      describeSubscription(subscription),
      { result: subscription },
    );
    yield* persist({ status: "pending" });

    const objects = yield* Effect.tryPromise({
      try: () => deleteTenantObjects(storage, organizationId),
      catch: (cause) => cause,
    }).pipe(
      Effect.catch((cause) =>
        Effect.gen(function* () {
          return yield* fail(
            "storage",
            `Could not delete tenant objects: ${describeTeardownError(cause)}`,
          );
        }),
      ),
    );

    if (!objects.complete) {
      yield* record(
        "storage",
        "failed",
        `Deleted ${objects.deleted} objects but the tenant exceeds the per-run limit; retry to finish.`,
        { count: objects.deleted },
      );
      yield* persist({
        status: "failed",
        lastError: "The tenant has more objects than one teardown run can delete.",
      });

      return yield* Effect.fail(
        new TenantTeardownStepFailed({
          step: "storage",
          message: "The tenant has more objects than one teardown run can delete. Retry to finish.",
        }),
      );
    }

    yield* record(
      "storage",
      objects.deleted > 0 ? "succeeded" : "skipped",
      `Deleted ${objects.deleted} tenant object${objects.deleted === 1 ? "" : "s"}.`,
      { count: objects.deleted },
    );
    yield* persist({ status: "pending" });

    yield* db.delete(schema.organization).where(eq(schema.organization.id, organizationId));

    yield* record("tenant", "succeeded", "Tenant row deleted.");
    yield* persist({ status: "completed", completedAt: now() });

    return {
      devices,
      subscription,
      objectsDeleted: objects.deleted,
      steps: [...steps],
    };
  }).pipe(
    Effect.mapError((cause: unknown): TenantTeardownStepFailed =>
      cause instanceof TenantTeardownStepFailed
        ? cause
        : new TenantTeardownStepFailed({
            step: "tenant",
            message: `The teardown could not be recorded: ${describeTeardownError(cause)}`,
          }),
    ),
  );

const describeDevices = (devices: DeviceUnenrollSummary): string => {
  if (devices.total === 0) return "No enrolled devices.";

  const unreachable = devices.unreachable.length;

  if (unreachable === 0)
    return `Sent unenroll requests to ${devices.contacted} of ${devices.total} enrolled device${
      devices.total === 1 ? "" : "s"
    }.`;

  return `Sent unenroll requests to ${devices.contacted} of ${devices.total} enrolled device${
    devices.total === 1 ? "" : "s"
  }; ${unreachable} could not be reached and must be removed manually.`;
};

const describeSubscription = (subscription: SubscriptionReclamation): string => {
  switch (subscription) {
    case "cancelled":
      return "Subscription cancelled.";
    case "at_period_end":
      return "Subscription scheduled to cancel at the end of the billing period.";
    case "none":
      return "No active billing subscription.";
  }
};

/** Bounded, secret-free error text for the support journal. */
const describeTeardownError = (cause: unknown): string =>
  (cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause))
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\b[A-Za-z0-9+/=_-]{32,}\b/g, "[redacted]")
    .slice(0, 500);

/** Age after which a completed teardown journal entry may be pruned. */
export const TENANT_DELETION_LOG_RETENTION_DAYS = 365;

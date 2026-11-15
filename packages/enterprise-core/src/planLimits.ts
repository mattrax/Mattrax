import { Effect, Schema } from "effect";
import { count, eq } from "drizzle-orm";
import type { EnterpriseDb } from "./db.ts";
import { device, subscription } from "./schema.ts";

/**
 * A single plan limit. `null` means unlimited. `0` means the plan allows none.
 */
export type PlanLimit = number | null;

export type PlanLimits = {
  readonly devices: PlanLimit;
  readonly tenants: PlanLimit;
};

/**
 * Deployment-level plan catalogue, parsed from `MATTRAX_PLAN_LIMITS`.
 *
 * The JSON format is a map of plan name to limits, optionally wrapped in a
 * `plans` object with a `defaultPlan` for tenants that have no subscription:
 *
 *   { "free": { "devices": 50, "tenants": 1 }, "device": { "devices": null } }
 *
 *   { "defaultPlan": "free", "plans": { "free": { "devices": 50 } } }
 *
 * Missing limits are unlimited. Invalid values are reported in `warnings` and
 * treated as unlimited so a bad deployment secret cannot lock customers out or
 * crash the Worker.
 */
export type PlanLimitsConfig = {
  /** False when the secret is absent or unparseable; all limits are unlimited. */
  readonly configured: boolean;
  readonly defaultPlan: string;
  readonly plans: Readonly<Record<string, PlanLimits>>;
  readonly warnings: ReadonlyArray<string>;
};

export const DEFAULT_PLAN_NAME = "free";

export const UNLIMITED_PLAN_LIMITS: PlanLimits = Object.freeze({
  devices: null,
  tenants: null,
});

/** Subscription states that no longer grant their stored plan. */
const DOWNGRADED_SUBSCRIPTION_STATUSES = new Set(["canceled", "incomplete_expired", "unpaid"]);

const isRecord = (value: Schema.Json): value is Schema.JsonObject =>
  Schema.is(Schema.JsonObject)(value);

const normalizeLimit = (value: Schema.Json, path: string, warnings: string[]): PlanLimit => {
  if (value === null || value === undefined) return null;

  if (Schema.is(Schema.Number)(value) && Number.isSafeInteger(value) && value >= 0) return value;
  warnings.push(
    `MATTRAX_PLAN_LIMITS: "${path}" must be a non-negative whole number or null; treating it as unlimited.`,
  );

  return null;
};

/**
 * Parse the `MATTRAX_PLAN_LIMITS` secret. Never throws: malformed input yields
 * an unconfigured (unlimited) catalogue plus warnings for the caller to log.
 */
export const parsePlanLimits = (raw?: string | null): PlanLimitsConfig => {
  const warnings: string[] = [];

  const absent = (): PlanLimitsConfig => ({
    configured: false,
    defaultPlan: DEFAULT_PLAN_NAME,
    plans: {},
    warnings,
  });

  const text = raw?.trim();

  if (!text) return absent();

  let decoded: Schema.Json;

  try {
    decoded = Schema.decodeUnknownSync(Schema.Json)(JSON.parse(text));
  } catch {
    warnings.push(
      "MATTRAX_PLAN_LIMITS: the value is not valid JSON; plan limits are disabled (unlimited).",
    );

    return absent();
  }

  if (!isRecord(decoded)) {
    warnings.push(
      "MATTRAX_PLAN_LIMITS: the value must be a JSON object; plan limits are disabled (unlimited).",
    );

    return absent();
  }

  let defaultPlan = DEFAULT_PLAN_NAME;
  const rawDefault = decoded.defaultPlan ?? decoded.$defaultPlan;

  if (rawDefault !== undefined) {
    if (Schema.is(Schema.String)(rawDefault) && rawDefault.trim()) defaultPlan = rawDefault.trim();
    else
      warnings.push(
        `MATTRAX_PLAN_LIMITS: "defaultPlan" must be a non-empty string; using "${DEFAULT_PLAN_NAME}".`,
      );
  }

  if (decoded.plans !== undefined && !isRecord(decoded.plans))
    warnings.push(
      'MATTRAX_PLAN_LIMITS: "plans" must be an object; plan limits are disabled (unlimited).',
    );
  const nestedPlans = isRecord(decoded.plans) ? decoded.plans : undefined;
  const source = nestedPlans ?? decoded;
  const plans: Record<string, PlanLimits> = {};

  for (const [rawName, value] of Object.entries(source)) {
    // Reserved keys only apply to the flat format.
    if (!nestedPlans && (rawName === "defaultPlan" || rawName === "$defaultPlan")) continue;

    if (!nestedPlans && rawName === "plans") continue;

    const name = rawName.trim();

    if (!name) {
      warnings.push("MATTRAX_PLAN_LIMITS: ignoring a plan with an empty name.");
      continue;
    }

    if (!isRecord(value)) {
      warnings.push(
        `MATTRAX_PLAN_LIMITS: plan "${name}" must be an object; ignoring it (unlimited).`,
      );
      continue;
    }

    const unknownKeys = Object.keys(value).filter((key) => key !== "devices" && key !== "tenants");

    if (unknownKeys.length > 0)
      warnings.push(
        `MATTRAX_PLAN_LIMITS: plan "${name}" has unknown keys (${unknownKeys.join(
          ", ",
        )}); only "devices" and "tenants" are enforced.`,
      );
    plans[name.toLowerCase()] = {
      devices: normalizeLimit(value.devices, `${name}.devices`, warnings),
      tenants: normalizeLimit(value.tenants, `${name}.tenants`, warnings),
    };
  }

  if (!plans[defaultPlan.toLowerCase()])
    warnings.push(
      `MATTRAX_PLAN_LIMITS: default plan "${defaultPlan}" is not defined; unsubscribed tenants are unlimited.`,
    );

  return { configured: true, defaultPlan: defaultPlan.toLowerCase(), plans, warnings };
};

/**
 * Limits for a plan name. An absent config, an unknown plan or a plan without
 * limits is unlimited — an unrecognised Stripe plan must not lock out a paying
 * customer.
 */
export const planLimitsFor = (
  config: PlanLimitsConfig | undefined,
  plan: string | null | undefined,
): PlanLimits => {
  if (!config?.configured) return UNLIMITED_PLAN_LIMITS;
  const name = (plan?.trim() || config.defaultPlan).toLowerCase();

  return config.plans[name] ?? UNLIMITED_PLAN_LIMITS;
};

const planNameForSubscription = (
  subscription:
    | { readonly plan?: string | null; readonly status?: string | null }
    | null
    | undefined,
  config: PlanLimitsConfig | undefined,
) => {
  const fallback = config?.defaultPlan ?? DEFAULT_PLAN_NAME;

  if (!subscription) return fallback;
  const status = subscription.status?.trim().toLowerCase();

  if (status && DOWNGRADED_SUBSCRIPTION_STATUSES.has(status)) return fallback;

  return subscription.plan?.trim() || fallback;
};

export type PlanResolutionInput = {
  readonly db: EnterpriseDb;
  readonly organizationId: string;
  readonly config?: PlanLimitsConfig;
};

/**
 * Effective plan for a tenant. The `subscription` row is authoritative; a
 * tenant without one (or with a lapsed subscription) uses the configured
 * default plan.
 */
export const planForOrganization = (input: PlanResolutionInput) =>
  Effect.gen(function* () {
    const [row] = yield* input.db
      .select({ plan: subscription.plan, status: subscription.status })
      .from(subscription)
      .where(eq(subscription.referenceId, input.organizationId))
      .limit(1);

    return planNameForSubscription(row, input.config);
  });

/** Exact number of device rows (any status) for a tenant. */
export const countOrganizationDevices = (db: EnterpriseDb, organizationId: string) =>
  Effect.gen(function* () {
    const [row] = yield* db
      .select({ value: count() })
      .from(device)
      .where(eq(device.organizationId, organizationId));

    return row?.value ?? 0;
  });

export type DeviceLimitStatus = {
  readonly plan: string;
  /** `null` when the plan is unlimited. */
  readonly limit: PlanLimit;
  /**
   * Devices currently counted against the limit, capped at `limit + 1` so an
   * over-limit tenant does not require loading every row. `null` when the plan
   * is unlimited (usage is not counted).
   */
  readonly used: number | null;
  /** True when another device cannot be added (`used >= limit`). */
  readonly reached: boolean;
  /** True when usage is already above the limit (`used > limit`). */
  readonly overLimit: boolean;
};

/**
 * Resolve a tenant's device limit and current usage. Existing devices are
 * never deleted: an organisation already above a newly lowered limit keeps all
 * of its rows and is simply blocked from adding more.
 */
export const deviceLimitForOrganization = (input: PlanResolutionInput) =>
  Effect.gen(function* () {
    const plan = yield* planForOrganization(input);
    const limit = planLimitsFor(input.config, plan).devices;

    if (limit === null) return { plan, limit, used: null, reached: false, overLimit: false };

    const rows = yield* input.db
      .select({ id: device.id })
      .from(device)
      .where(eq(device.organizationId, input.organizationId))
      .limit(limit + 1);

    const used = rows.length;

    return { plan, limit, used, reached: used >= limit, overLimit: used > limit };
  });

const hasOwnerRole = (role: string | null | undefined) =>
  (role ?? "")
    .split(",")
    .map((part) => part.trim())
    .includes("owner");

/** Organisations where the account is an owner. */
export const ownedTenantIds = (db: EnterpriseDb, userId: string) =>
  Effect.gen(function* () {
    const memberships = yield* db.query.member.findMany({ where: { userId } });

    return [
      ...new Set(
        memberships
          .filter((row) => row.customRoleId == null && hasOwnerRole(row.role))
          .map((row) => row.organizationId),
      ),
    ];
  });

const morePermissive = (candidate: PlanLimit, current: PlanLimit) =>
  (candidate ?? Number.POSITIVE_INFINITY) > (current ?? Number.POSITIVE_INFINITY);

export type TenantLimitStatus = {
  readonly plan: string;
  readonly limit: PlanLimit;
  readonly used: number;
  /** True when another tenant cannot be created (`used >= limit`). */
  readonly reached: boolean;
  /** True when usage is already above the limit (`used > limit`). */
  readonly overLimit: boolean;
};

/**
 * Tenant-creation limit for an account, based on the most permissive plan
 * among the tenants it already owns. New accounts use the default plan.
 */
export const tenantLimitForAccount = (input: {
  readonly db: EnterpriseDb;
  readonly userId: string;
  readonly config?: PlanLimitsConfig;
}) =>
  Effect.gen(function* () {
    const owned = yield* ownedTenantIds(input.db, input.userId);
    const used = owned.length;

    if (!input.config?.configured) {
      return {
        plan: input.config?.defaultPlan ?? DEFAULT_PLAN_NAME,
        limit: null,
        used,
        reached: false,
        overLimit: false,
      };
    }

    let plan = input.config.defaultPlan;
    let best = planLimitsFor(input.config, plan);

    for (const organizationId of owned) {
      const [row] = yield* input.db
        .select({ plan: subscription.plan, status: subscription.status })
        .from(subscription)
        .where(eq(subscription.referenceId, organizationId))
        .limit(1);

      const candidatePlan = planNameForSubscription(row, input.config);
      const candidate = planLimitsFor(input.config, candidatePlan);

      if (morePermissive(candidate.tenants, best.tenants)) {
        best = candidate;
        plan = candidatePlan;
      }
    }

    const limit = best.tenants;

    return {
      plan,
      limit,
      used,
      reached: limit !== null && used >= limit,
      overLimit: limit !== null && used > limit,
    };
  });

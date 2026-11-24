import { and, desc, eq, inArray, like, lt } from "drizzle-orm";
import { Data, Effect, Option, Result, Schema } from "effect";
import { Digest } from "effect/crypto";
import {
  AndroidManagement,
  androidPolicyHash,
  compileAndroidPolicy,
  decodePubSubPush,
  androidPolicyIdForHash,
  bearerToken,
  commandStatus,
  GoogleApiError,
  isAndroidPackageName,
  mergeAssignedAndroidApplications,
  PubSubOidcVerifier,
} from "@mattrax/dm-android";
import type { AndroidPolicyConfiguration, IssueCommandParams } from "@mattrax/dm-android";
import {
  deviceLimitForOrganization,
  markAndroidRestrictedSoftwarePolicyDelivered,
  replaceDeviceApplications,
  resolveRestrictedSoftwareForDevice,
  schema,
} from "@mattrax/enterprise-core";
import type { EnterpriseDb, PlanLimitsConfig } from "@mattrax/enterprise-core";
import {
  ANDROID_OS_UPDATE_CONFIGURATION_KIND,
  androidSystemUpdatePolicy,
  osPolicyRuleFromRow,
  selectInstaller,
  shouldApplyReportedName,
} from "@mattrax/enterprise-domain";

/** Command notification statuses mapped to the device command lifecycle. */
const COMMAND_STATUS_OUTCOME = new Map<string | undefined, "succeeded" | "failed" | "sent">([
  ["COMPLETED", "succeeded"],
  ["FAILED", "failed"],
  ["CANCELLED", "failed"],
  ["PENDING", "sent"],
]);

import {
  ACTIVE_COMMAND_STATUSES,
  assignedApplicationIdsForDevice,
  commandDedupeKeyEffect,
  commandIsExpired,
  deviceCommandExpiresAt,
  RECONCILED_RESULT_STATUS,
  resolveEffectivePolicyForDevice,
  syncDynamicGroupsForDevice,
  writeSystemAudit,
  SYSTEM_AUDIT_ACTIONS,
} from "@mattrax/mdm-core";
import { signToken, verifyToken } from "@mattrax/enterprise-tokens";

/**
 * Android Enterprise delivery for the enterprise backend.
 *
 * The Google service-account JSON is deployment configuration; only its client
 * email is persisted. Every function takes the tenant database explicitly so
 * it can be exercised with the in-memory test database, and every Google call
 * is scoped by the tenant's own `enterprises/{id}` resource name.
 */

export const DEFAULT_ANDROID_POLICY_ID = "mattrax-default";

/**
 * Synthetic configuration kind carrying `installType: BLOCKED` entries from
 * restricted software rules. It is appended after the tenant's own policies and
 * the OS-update fragment, so a deny rule wins over an install fragment for the
 * same package.
 */
export const ANDROID_RESTRICTED_SOFTWARE_CONFIGURATION_KIND =
  "mttx.android.policy.restricted-software";

/**
 * Status reporting Mattrax always requests. Google only reports
 * `softwareInfo` and `applicationReports` when the applied policy opts in, so
 * without this baseline every Android device would show no OS build, no patch
 * level and no installed applications. An explicit tenant value still wins,
 * which lets an operator switch reporting off.
 */
const STATUS_REPORTING_BASELINE = {
  softwareInfoEnabled: true,
  applicationReportsEnabled: true,
  // RAM and the carrier/operator are part of the device page's hardware card.
  // Both reports are opt-in on each applied policy, so without these the fields
  // stay empty no matter what Google sends.
  memoryInfoEnabled: true,
  networkInfoEnabled: true,
} as const;

/**
 * Merge the reporting baseline underneath the tenant's compiled policy. Kept
 * pure so the policy hash covers exactly what is pushed to Google.
 */
export const withStatusReporting = (policy: Schema.JsonObject): Schema.JsonObject => {
  const configured = policy["statusReportingSettings"];

  // `Object.assign` keeps the baseline's literal keys while letting a tenant
  // override either flag (or add reporting settings Mattrax does not request).
  const statusReportingSettings = Object.assign(
    {},
    STATUS_REPORTING_BASELINE,
    Schema.is(Schema.JsonObject)(configured) ? configured : null,
  );

  return { ...policy, statusReportingSettings };
};

/** Notification types requested when the enterprise is created. */
export const ANDROID_NOTIFICATION_TYPES = ["ENROLLMENT", "STATUS_REPORT", "COMMAND"] as const;

/**
 * Provisioning modes Mattrax can request through an enrollment token.
 *
 * `work-profile` permits personal usage so a personally owned phone gets a
 * managed work profile; `fully-managed` requires a company-owned device with no
 * personal profile; `dedicated` is a userless kiosk device. Google decides the
 * real mode at provisioning time and reports it as the device's
 * `managementMode`, so a mode that a device ignores is visible rather than
 * silently assumed.
 */
export const ANDROID_PROVISIONING_MODES = ["work-profile", "fully-managed", "dedicated"] as const;

export type AndroidProvisioningMode = (typeof ANDROID_PROVISIONING_MODES)[number];

export const DEFAULT_ANDROID_PROVISIONING_MODE: AndroidProvisioningMode = "work-profile";

/** The AMAPI `allowPersonalUsage` value for a provisioning mode. */
export const allowPersonalUsageFor = (mode: AndroidProvisioningMode): string => {
  switch (mode) {
    case "fully-managed":
      return "PERSONAL_USAGE_DISALLOWED";
    case "dedicated":
      return "PERSONAL_USAGE_DISALLOWED_USERLESS";
    default:
      return "PERSONAL_USAGE_ALLOWED";
  }
};

const SIGNUP_STATE_PURPOSE = "android-signup";

const SIGNUP_STATE_TTL_MS = 30 * 60 * 1000;

export const ANDROID_PUBSUB_RETENTION_DAYS = 30;

export type AndroidServiceAccount = {
  readonly clientEmail: string;
  readonly privateKeyPem: string;
  readonly projectId: string;
  readonly tokenUri?: string;
};

export type AndroidDeliveryConfig = {
  readonly serviceAccount: AndroidServiceAccount;
  /** `projects/{project}/topics/{topic}`. Must exist in the Google project. */
  readonly pubsubTopic?: string;
  /** `projects/{project}/subscriptions/{subscription}` receiving push deliveries. */
  readonly pubsubSubscription?: string;
  /** OIDC audience configured on the Pub/Sub push subscription. */
  readonly pubsubAudience?: string;
  /** Policy used for new devices before their first effective policy is pushed. */
  readonly defaultPolicyId?: string;
  /** Override Google's JWKS (tests). */
  readonly jwksUri?: string;
};

export type AndroidDeliveryErrorKind =
  | "not_configured"
  | "invalid_state"
  | "conflict"
  | "not_found"
  | "unauthorized"
  | "invalid_payload"
  | "upstream";

export class AndroidDeliveryError extends Data.TaggedError("AndroidDeliveryError")<{
  message: string;
  kind: AndroidDeliveryErrorKind;
  cause?: unknown;
}> {}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const now = () => new Date();

const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

const iso = (value: Date | null | undefined) =>
  value == null ? null : (value instanceof Date ? value : new Date(value)).toISOString();

/** Truncate and redact provider errors before they are stored or returned. */
export const describeAndroidError = (cause: unknown): string => {
  const text =
    cause instanceof Error
      ? cause.message
      : Schema.is(Schema.String)(cause)
        ? cause
        : (() => {
            try {
              return JSON.stringify(cause);
            } catch {
              return String(cause);
            }
          })();

  return text
    .replaceAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replaceAll(/\s+/g, " ")
    .slice(0, 500);
};

const notConfigured = () =>
  new AndroidDeliveryError({
    kind: "not_configured",
    message: "Android Enterprise is not configured for this deployment.",
  });

/** Ensure database/provider failures leave with the module's stable tag. */
const toAndroidDeliveryError = (cause: unknown): AndroidDeliveryError =>
  cause instanceof AndroidDeliveryError
    ? cause
    : new AndroidDeliveryError({
        kind: "upstream",
        message: describeAndroidError(cause),
        cause,
      });

const mapAndroidError = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
  effect.pipe(Effect.mapError(toAndroidDeliveryError));

/** Swallow a best-effort database write without hiding failures from the caller. */
const ignoreDbFailure = (effect: Effect.Effect<unknown, unknown>) =>
  Effect.gen(function* () {
    yield* effect;
  }).pipe(Effect.catch(() => Effect.void));

export const isAndroidConfigured = (
  config: AndroidDeliveryConfig | undefined,
): config is AndroidDeliveryConfig => Boolean(config);

export type AndroidEnterpriseRow = typeof schema.androidEnterprise.$inferSelect;

export const loadAndroidEnterprise = (
  db: EnterpriseDb,
  organizationId: string,
): Effect.Effect<AndroidEnterpriseRow | undefined, unknown> =>
  db.query.androidEnterprise.findFirst({ where: { organizationId } });

const findAndroidEnterpriseByName = (
  db: EnterpriseDb,
  enterpriseName: string,
): Effect.Effect<AndroidEnterpriseRow | undefined, unknown> =>
  db.query.androidEnterprise.findFirst({ where: { enterpriseName } });

const insertAndroidEnterprise = (
  db: EnterpriseDb,
  row: typeof schema.androidEnterprise.$inferInsert,
) => db.insert(schema.androidEnterprise).values(row);

const updateAndroidEnterprise = (
  db: EnterpriseDb,
  organizationId: string,
  patch: Partial<typeof schema.androidEnterprise.$inferInsert>,
) =>
  db
    .update(schema.androidEnterprise)
    .set({ ...patch, updatedAt: now() })
    .where(eq(schema.androidEnterprise.organizationId, organizationId));

const insertAndroidDevice = (db: EnterpriseDb, row: typeof schema.androidDevice.$inferInsert) =>
  db.insert(schema.androidDevice).values(row);

const updateAndroidDevice = (
  db: EnterpriseDb,
  deviceId: string,
  patch: Partial<typeof schema.androidDevice.$inferInsert>,
) =>
  db
    .update(schema.androidDevice)
    .set({ ...patch, updatedAt: now() })
    .where(eq(schema.androidDevice.deviceId, deviceId));

export type AndroidEnterpriseInfoResult = {
  readonly configured: boolean;
  readonly status: AndroidEnterpriseRow["status"];
  readonly enterpriseName: string | null;
  readonly pubsubTopic: string | null;
  readonly pubsubSubscription: string | null;
  readonly serviceAccountEmail: string | null;
  readonly provisioningMode: AndroidProvisioningMode;
  readonly lastError: string | null;
  readonly lastSyncedAt: string | null;
  readonly deviceCount: number;
  readonly available: boolean;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
};

export const androidEnterpriseInfo = (
  db: EnterpriseDb,
  organizationId: string,
  config?: AndroidDeliveryConfig,
): Effect.Effect<AndroidEnterpriseInfoResult, AndroidDeliveryError> =>
  Effect.gen(function* () {
    const row = yield* loadAndroidEnterprise(db, organizationId);

    const mappings = yield* db
      .select()
      .from(schema.androidDevice)
      .where(eq(schema.androidDevice.organizationId, organizationId));

    const configured = isAndroidConfigured(config);

    const status: AndroidEnterpriseRow["status"] = configured
      ? (row?.status ?? "pending")
      : "disabled";

    return {
      configured,
      status,
      enterpriseName: row?.enterpriseName ?? null,
      pubsubTopic: row?.pubsubTopic ?? config?.pubsubTopic ?? null,
      pubsubSubscription: row?.pubsubSubscription ?? config?.pubsubSubscription ?? null,
      serviceAccountEmail: row?.serviceAccountEmail ?? config?.serviceAccount.clientEmail ?? null,
      provisioningMode: row?.provisioningMode ?? DEFAULT_ANDROID_PROVISIONING_MODE,
      lastError: row?.lastError ?? null,
      lastSyncedAt: iso(row?.lastSyncedAt ?? null),
      deviceCount: mappings.length,
      available: configured && status === "active" && Boolean(row?.enterpriseName),
      createdAt: iso(row?.createdAt ?? null),
      updatedAt: iso(row?.updatedAt ?? null),
    } satisfies AndroidEnterpriseInfoResult;
  }).pipe(mapAndroidError);

export const setAndroidEnabled = (input: {
  readonly db: EnterpriseDb;
  readonly config?: AndroidDeliveryConfig;
  readonly organizationId: string;
  readonly enabled: boolean;
}): Effect.Effect<void, AndroidDeliveryError> =>
  Effect.gen(function* () {
    if (input.enabled && !isAndroidConfigured(input.config))
      return yield* Effect.fail(notConfigured());
    const row = yield* loadAndroidEnterprise(input.db, input.organizationId);

    if (input.enabled && !row?.enterpriseName)
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "conflict",
          message: "Connect Android Enterprise before enabling it.",
        }),
      );
    const timestamp = now();

    if (!row) {
      yield* insertAndroidEnterprise(input.db, {
        organizationId: input.organizationId,
        enterpriseName: null,
        signupUrl: null,
        signupState: null,
        pubsubTopic: input.config?.pubsubTopic ?? null,
        pubsubSubscription: input.config?.pubsubSubscription ?? null,
        serviceAccountEmail: input.config?.serviceAccount.clientEmail ?? null,
        provisioningMode: DEFAULT_ANDROID_PROVISIONING_MODE,
        status: "disabled",
        lastError: null,
        lastSyncedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    } else {
      yield* updateAndroidEnterprise(input.db, input.organizationId, {
        status: input.enabled ? "active" : "disabled",
        lastError: null,
      });
    }
  }).pipe(mapAndroidError);

/**
 * Choose how devices enrolled from now on are provisioned.
 *
 * The mode lives on the enterprise because enrollment tokens are minted per
 * enrollment page load and never persisted; the token carries the mode to
 * Google, and the device reports the mode it actually received. Existing
 * devices keep the mode they were enrolled with.
 */
export const setAndroidProvisioningMode = (input: {
  readonly db: EnterpriseDb;
  readonly config?: AndroidDeliveryConfig;
  readonly organizationId: string;
  readonly mode: AndroidProvisioningMode;
}): Effect.Effect<void, AndroidDeliveryError> =>
  Effect.gen(function* () {
    if (!isAndroidConfigured(input.config)) return yield* Effect.fail(notConfigured());

    if (!ANDROID_PROVISIONING_MODES.includes(input.mode))
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "invalid_payload",
          message: `Unknown Android provisioning mode "${String(input.mode)}".`,
        }),
      );

    const row = yield* loadAndroidEnterprise(input.db, input.organizationId);

    if (!row)
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "conflict",
          message: "Connect Android Enterprise before choosing a provisioning mode.",
        }),
      );

    yield* updateAndroidEnterprise(input.db, input.organizationId, {
      provisioningMode: input.mode,
    });
  }).pipe(mapAndroidError);

export type AndroidDisconnectResult = {
  readonly enterpriseName: string;
};

/**
 * Disconnect the tenant from Google.
 *
 * `enterprises.delete` removes the enterprise together with every policy and
 * device record Google holds for it, so the tenant cannot leave managed devices
 * behind when it disconnects or is deleted. The local mapping rows go with the
 * connection: the devices are no longer managed, and their shared `device` rows
 * are marked unenrolled so the dashboard stops offering Android actions.
 *
 * A Google 404 is treated as success so a retried disconnect (or a tenant whose
 * enterprise was deleted in the Google console) still cleans up locally.
 */
export const disconnectAndroidEnterprise = (input: {
  readonly db: EnterpriseDb;
  readonly config?: AndroidDeliveryConfig;
  readonly organizationId: string;
}): Effect.Effect<AndroidDisconnectResult | null, AndroidDeliveryError, AndroidManagement> =>
  Effect.gen(function* () {
    if (!isAndroidConfigured(input.config)) return yield* Effect.fail(notConfigured());
    const row = yield* loadAndroidEnterprise(input.db, input.organizationId);

    if (!row?.enterpriseName) return null;
    const android = yield* AndroidManagement;

    yield* android.deleteEnterprise({ enterpriseName: row.enterpriseName }).pipe(
      Effect.catchIf(
        (cause) => cause instanceof GoogleApiError && cause.status === 404,
        () => Effect.void,
      ),
      Effect.mapError(
        (cause) =>
          new AndroidDeliveryError({
            kind: "upstream",
            message: `Could not disconnect the Android enterprise: ${describeAndroidError(cause)}`,
            cause,
          }),
      ),
    );

    const timestamp = now();

    yield* input.db
      .update(schema.device)
      .set({ status: "unenrolled" })
      .where(
        and(
          eq(schema.device.organizationId, input.organizationId),
          eq(schema.device.proto, "android"),
          eq(schema.device.status, "enrolled"),
        ),
      );

    yield* input.db
      .delete(schema.androidDevice)
      .where(eq(schema.androidDevice.organizationId, input.organizationId));

    yield* input.db
      .delete(schema.androidEnterprise)
      .where(eq(schema.androidEnterprise.organizationId, input.organizationId));

    // Nothing can be delivered to a device Google no longer manages.
    const androidDeviceIds = (yield* input.db
      .select({ id: schema.device.id })
      .from(schema.device)
      .where(
        and(
          eq(schema.device.organizationId, input.organizationId),
          eq(schema.device.proto, "android"),
        ),
      )).map((device) => device.id);

    if (androidDeviceIds.length > 0)
      yield* ignoreDbFailure(
        input.db
          .update(schema.deviceCommand)
          .set({
            status: "cancelled",
            dedupeKey: null,
            resultStatus: RECONCILED_RESULT_STATUS,
            resultDetail: "Android Enterprise was disconnected before the command was delivered.",
            updatedAt: timestamp,
          })
          .where(
            and(
              eq(schema.deviceCommand.organizationId, input.organizationId),
              inArray(schema.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES]),
              inArray(schema.deviceCommand.deviceId, androidDeviceIds),
            ),
          ),
      );

    return { enterpriseName: row.enterpriseName };
  }).pipe(mapAndroidError);

export type AndroidSignupOrganization = {
  readonly id: string;
  readonly name: string;
  readonly displayName?: string | null;
  readonly supportEmail?: string | null;
};

const signupStateToken = (
  authSecret: string,
  organizationId: string,
  nonce: string,
): Effect.Effect<string, AndroidDeliveryError> =>
  Effect.tryPromise({
    try: () =>
      Effect.runPromise(
        signToken(authSecret, {
          sub: organizationId,
          email: "android-signup",
          exp: Date.now() + SIGNUP_STATE_TTL_MS,
          purpose: SIGNUP_STATE_PURPOSE,
          nonce,
        }),
      ),
    catch: (cause) =>
      new AndroidDeliveryError({
        kind: "not_configured",
        message: "Could not sign the Android signup state.",
        cause,
      }),
  });

type AndroidSignupState = {
  readonly organizationId: string;
  readonly nonce: string;
};

const readSignupState = (
  authSecret: string,
  state: string,
): Effect.Effect<AndroidSignupState, AndroidDeliveryError> =>
  Effect.gen(function* () {
    const payload = yield* Effect.tryPromise({
      try: () => Effect.runPromise(verifyToken(authSecret, state)),
      catch: (cause) =>
        new AndroidDeliveryError({
          kind: "invalid_state",
          message: "The Android signup state is invalid.",
          cause,
        }),
    });

    if (payload.purpose !== SIGNUP_STATE_PURPOSE || payload.exp <= Date.now())
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "invalid_state",
          message: "The Android signup state has expired.",
        }),
      );

    if (!payload.nonce)
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "invalid_state",
          message: "The Android signup state is incomplete.",
        }),
      );

    return { organizationId: payload.sub, nonce: payload.nonce };
  });

/** Start the Google-hosted enterprise signup for one tenant. */
export const createAndroidSignup = (input: {
  readonly db: EnterpriseDb;
  readonly config?: AndroidDeliveryConfig;
  readonly authSecret?: string;
  readonly origin: string;
  readonly organization: AndroidSignupOrganization;
}): Effect.Effect<{ readonly url: string }, AndroidDeliveryError, AndroidManagement> =>
  Effect.gen(function* () {
    const config = input.config;

    if (!isAndroidConfigured(config)) return yield* Effect.fail(notConfigured());

    if (!input.authSecret)
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "not_configured",
          message: "Android Enterprise signup requires AUTH_SECRET.",
        }),
      );
    const android = yield* AndroidManagement;
    const existing = yield* loadAndroidEnterprise(input.db, input.organization.id);

    if (existing?.status === "active" && existing.enterpriseName)
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "conflict",
          message: "Android Enterprise is already connected for this tenant.",
        }),
      );

    const nonce = crypto.randomUUID();
    const state = yield* signupStateToken(input.authSecret, input.organization.id, nonce);
    const callbackUrl = `${input.origin.replace(/\/+$/, "")}/api/v1/android/signup/callback?state=${encodeURIComponent(state)}`;

    const signup = yield* android.createSignupUrl({ callbackUrl }).pipe(
      Effect.mapError(
        (cause) =>
          new AndroidDeliveryError({
            kind: "upstream",
            message: `Could not create an Android signup URL: ${describeAndroidError(cause)}`,
            cause,
          }),
      ),
    );

    const timestamp = now();

    if (!existing) {
      yield* insertAndroidEnterprise(input.db, {
        organizationId: input.organization.id,
        enterpriseName: null,
        signupUrl: signup.name,
        signupState: nonce,
        pubsubTopic: config.pubsubTopic ?? null,
        pubsubSubscription: config.pubsubSubscription ?? null,
        serviceAccountEmail: config.serviceAccount.clientEmail,
        provisioningMode: DEFAULT_ANDROID_PROVISIONING_MODE,
        status: "pending",
        lastError: null,
        lastSyncedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    } else {
      yield* updateAndroidEnterprise(input.db, input.organization.id, {
        enterpriseName: null,
        signupUrl: signup.name,
        signupState: nonce,
        pubsubTopic: config.pubsubTopic ?? null,
        pubsubSubscription: config.pubsubSubscription ?? null,
        serviceAccountEmail: config.serviceAccount.clientEmail,
        status: "pending",
        lastError: null,
      });
    }

    yield* writeSystemAudit(
      input.db,
      {
        organizationId: input.organization.id,
        action: "android.signup_started",
        targetType: "android_enterprise",
        targetId: input.organization.id,
      },
      {},
    );

    return { url: signup.url };
  }).pipe(mapAndroidError);

/**
 * Complete Google's redirect. The signed state and the stored one-time nonce
 * bind the callback to the tenant that started signup, so a replayed or
 * tampered `enterpriseToken` cannot attach another enterprise to this tenant.
 */
export const completeAndroidSignup = (input: {
  readonly db: EnterpriseDb;
  readonly config?: AndroidDeliveryConfig;
  readonly authSecret?: string;
  readonly state: string;
  readonly enterpriseToken: string;
}): Effect.Effect<
  { readonly organizationId: string; readonly enterpriseName: string },
  AndroidDeliveryError,
  AndroidManagement
> =>
  Effect.gen(function* () {
    const config = input.config;

    if (!isAndroidConfigured(config)) return yield* Effect.fail(notConfigured());

    if (!input.authSecret)
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "not_configured",
          message: "Android Enterprise signup requires AUTH_SECRET.",
        }),
      );

    if (!input.enterpriseToken.trim())
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "invalid_state",
          message: "Google did not return an enterprise token.",
        }),
      );

    const state = yield* readSignupState(input.authSecret, input.state);
    const row = yield* loadAndroidEnterprise(input.db, state.organizationId);

    if (
      !row ||
      row.signupState !== state.nonce ||
      !row.signupUrl ||
      (row.status !== "pending" && row.status !== "error")
    )
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "invalid_state",
          message: "No matching Android signup is pending for this tenant.",
        }),
      );

    const organization = yield* input.db.query.organization.findFirst({
      where: { id: state.organizationId },
    });

    if (!organization)
      return yield* Effect.fail(
        new AndroidDeliveryError({ kind: "not_found", message: "Tenant not found." }),
      );

    const android = yield* AndroidManagement;
    const defaultPolicyId = config.defaultPolicyId ?? DEFAULT_ANDROID_POLICY_ID;

    const enterpriseName = yield* Effect.gen(function* () {
      const enterprise = yield* android.createEnterprise({
        signupUrlName: row.signupUrl!,
        enterpriseToken: input.enterpriseToken,
        displayName: organization.displayName ?? organization.name,
        contactEmail: organization.supportEmail ?? "hello@mattrax.cloud",
        pubsubTopic: config.pubsubTopic,
        enabledNotificationTypes: [...ANDROID_NOTIFICATION_TYPES],
      });

      // A policy must exist before an enrollment token can reference it. It
      // only requests the status reporting every device needs; device-specific
      // policy is pushed after enrollment.
      yield* android.patchPolicy({
        enterpriseName: enterprise.name,
        policyId: defaultPolicyId,
        policy: withStatusReporting({}),
      });

      return enterprise.name;
    }).pipe(
      Effect.mapError(
        (cause) =>
          new AndroidDeliveryError({
            kind: "upstream",
            message: describeAndroidError(cause),
            cause,
          }),
      ),
    );

    const timestamp = now();
    yield* updateAndroidEnterprise(input.db, state.organizationId, {
      enterpriseName,
      signupUrl: row.signupUrl,
      signupState: null,
      pubsubTopic: config.pubsubTopic ?? null,
      pubsubSubscription: config.pubsubSubscription ?? null,
      serviceAccountEmail: config.serviceAccount.clientEmail,
      status: "active",
      lastError: null,
      lastSyncedAt: timestamp,
    });
    yield* writeSystemAudit(
      input.db,
      {
        organizationId: state.organizationId,
        action: "android.enterprise_connected",
        targetType: "android_enterprise",
        targetId: state.organizationId,
        metadata: { enterpriseName },
      },
      {},
    );

    return { organizationId: state.organizationId, enterpriseName };
  }).pipe(
    mapAndroidError,
    Effect.catchTag("AndroidDeliveryError", (error) =>
      error.kind === "upstream"
        ? Effect.gen(function* () {
            // Best-effort: the state token already proved this callback came
            // from a signup we started, so the tenant is safe to identify.
            const state = yield* readSignupState(input.authSecret!, input.state).pipe(
              Effect.catch(() => Effect.succeed(undefined)),
            );

            if (state) {
              yield* ignoreDbFailure(
                updateAndroidEnterprise(input.db, state.organizationId, {
                  status: "error",
                  lastError: error.message,
                  signupState: null,
                }),
              );
              yield* writeSystemAudit(
                input.db,
                {
                  organizationId: state.organizationId,
                  action: "android.enterprise_error",
                  targetType: "android_enterprise",
                  targetId: state.organizationId,
                  metadata: { message: error.message },
                },
                {},
              ).pipe(Effect.catch(() => Effect.void));
            }

            return yield* Effect.fail(error);
          })
        : Effect.fail(error),
    ),
  );

/** How long an enrollment token stays valid. */
export const ANDROID_ENROLLMENT_TOKEN_DURATION = "3600s";

export type AndroidEnrollmentTokenResult = {
  readonly value: string;
  readonly qrCode?: string;
  readonly policyName?: string;
  readonly expiresAt?: string;
  readonly provisioningMode: AndroidProvisioningMode;
};

export const createAndroidEnrollmentToken = (input: {
  readonly db: EnterpriseDb;
  readonly config?: AndroidDeliveryConfig;
  readonly organizationId: string;
}): Effect.Effect<AndroidEnrollmentTokenResult, AndroidDeliveryError, AndroidManagement> =>
  Effect.gen(function* () {
    const config = input.config;

    if (!isAndroidConfigured(config)) return yield* Effect.fail(notConfigured());
    const row = yield* loadAndroidEnterprise(input.db, input.organizationId);

    if (row?.status !== "active" || !row.enterpriseName)
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "conflict",
          message: "Android Enterprise is not connected for this tenant.",
        }),
      );
    const android = yield* AndroidManagement;

    // The token decides what the device may become. Sending it explicitly stops
    // Google from applying its own default, which is what silently produced a
    // fully managed device when an operator expected a work profile.
    const token = yield* android
      .createEnrollmentToken({
        enterpriseName: row.enterpriseName,
        policyName: config.defaultPolicyId ?? DEFAULT_ANDROID_POLICY_ID,
        additionalData: input.organizationId,
        oneTimeOnly: true,
        allowPersonalUsage: allowPersonalUsageFor(row.provisioningMode),
        // Enrollment tokens default to one hour; make it explicit so the value
        // the page shows and the value Google enforces cannot drift.
        duration: ANDROID_ENROLLMENT_TOKEN_DURATION,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new AndroidDeliveryError({
              kind: "upstream",
              message: `Could not create an Android enrollment token: ${describeAndroidError(cause)}`,
              cause,
            }),
        ),
      );

    const result: Mutable<AndroidEnrollmentTokenResult> = {
      value: token.value,
      provisioningMode: row.provisioningMode,
    };

    if (token.qrCode) result.qrCode = token.qrCode;

    if (token.policyName) result.policyName = token.policyName;

    if (token.expirationTimestamp) result.expiresAt = token.expirationTimestamp;

    return result;
  }).pipe(mapAndroidError);

const AndroidRecord = Schema.Record(Schema.String, Schema.Json);

function recordOf(value: Schema.Json | undefined): Record<string, Schema.Json> | undefined {
  return Option.getOrUndefined(Schema.decodeUnknownOption(AndroidRecord)(value));
}

function stringOf(value: Schema.Json | undefined): string | undefined {
  const text = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(value));

  if (text === undefined) return undefined;
  const trimmed = text.trim();

  return trimmed ? trimmed : undefined;
}

function dateOf(value: Schema.Json | undefined): Date | undefined {
  const text = stringOf(value);

  if (!text) return undefined;
  const parsed = Date.parse(text);

  return Number.isFinite(parsed) ? new Date(parsed) : undefined;
}

/** AMAPI encodes 64-bit values (RAM, storage) as strings, but tests and older
 * responses use plain numbers. Accept both and reject negatives. */
function intOf(value: Schema.Json | undefined): number | undefined {
  const raw = Schema.is(Schema.Number)(value)
    ? value
    : Schema.is(Schema.String)(value) && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : undefined;

  return raw !== undefined && Number.isSafeInteger(raw) && raw >= 0 ? raw : undefined;
}

/**
 * Map an AMAPI device state onto the shared lifecycle.
 *
 * `DISABLED` (an administrator suspended the device) and `LOST` (lost mode) are
 * still managed devices: Google keeps applying policy and the dashboard must
 * keep offering commands such as re-enable or stop-lost-mode. Only a device
 * Google has deleted, or one finance deactivated, has actually left management.
 */
function androidDeviceStatus(value: string | undefined): "enrolling" | "enrolled" | "unenrolled" {
  switch (value) {
    case "ACTIVE":
    case "DISABLED":
    case "LOST":
      return "enrolled";
    case "DELETED":
    case "DEACTIVATED_BY_DEVICE_FINANCE":
      return "unenrolled";
    default:
      return "enrolling";
  }
}

/** One installed application from an AMAPI `applicationReports` entry. */
export type AndroidApplicationReport = {
  readonly bundleId: string;
  readonly name?: string;
  readonly version?: string;
};

/**
 * Application states Google reports. A report carries every package the device
 * told Android Device Policy about, including packages that are on their way
 * out, so uninstalled apps must be dropped rather than shown as installed.
 */
const ANDROID_ABSENT_APPLICATION_STATES = new Set(["REMOVED", "PENDING_UNINSTALL"]);

function applicationReports(
  value: Schema.Json | undefined,
): AndroidApplicationReport[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const applications = new Map<string, AndroidApplicationReport>();

  for (const entry of value) {
    const report = recordOf(entry);

    if (!report) continue;
    const packageName = stringOf(report["packageName"]);

    if (!packageName) continue;

    const state = stringOf(report["state"]);

    if (state && ANDROID_ABSENT_APPLICATION_STATES.has(state)) continue;

    applications.set(packageName, {
      bundleId: packageName,
      name: stringOf(report["displayName"]) ?? packageName,
      version: stringOf(report["versionName"]),
    });
  }

  return [...applications.values()];
}

/**
 * Everything Mattrax keeps from one AMAPI device resource.
 *
 * Google sends partial resources: a status notification can carry only the
 * fields that changed, and several inventory groups (`softwareInfo`,
 * `networkInfo`, `applicationReports`) depend on `statusReportingSettings` in
 * the applied policy. Every optional field therefore means "the device did not
 * report this", never "the value is now empty".
 */
export type AndroidDeviceResource = {
  readonly name: string;
  readonly enterpriseName: string;
  readonly state?: string;
  /** Admin-assigned name, when the enterprise provides one. */
  readonly displayName?: string;
  /** `hardwareInfo.hardware`: the hardware name, for example `Angler`. */
  readonly hardwareName?: string;
  readonly model?: string;
  readonly manufacturer?: string;
  readonly brand?: string;
  readonly serial?: string;
  readonly osVersion?: string;
  readonly buildNumber?: string;
  readonly securityPatchLevel?: string;
  readonly apiLevel?: number;
  readonly managementMode?: string;
  readonly ownership?: string;
  readonly appliedPolicyName?: string;
  readonly appliedPolicyVersion?: string;
  readonly enrollmentTokenName?: string;
  readonly disabledReason?: string;
  readonly networkOperator?: string;
  readonly totalRam?: number;
  readonly totalInternalStorage?: number;
  readonly enrolledAt?: Date;
  readonly lastSeenAt: Date;
  /** `undefined` when the report did not include `applicationReports`. */
  readonly applications?: ReadonlyArray<AndroidApplicationReport>;
  /** True when any inventory field was present in the report. */
  readonly hasInventory: boolean;
};

/**
 * Parse one AMAPI `Device` resource.
 *
 * AMAPI has no single "device name" field: `displayName` is the name an
 * enterprise assigns, `hardwareInfo.model` is the only user-visible name the
 * device itself reports and `appliedPolicyName` identifies the policy it runs.
 * The name precedence is documented on {@link androidReportedName}.
 */
export function parseAndroidDeviceResource(
  data: Schema.Json | undefined,
  fallbackEnterpriseName: string,
): AndroidDeviceResource | undefined {
  const record = recordOf(data);

  if (!record) return undefined;
  const name = stringOf(record["name"]);

  if (!name) return undefined;
  const hardware = recordOf(record["hardwareInfo"]);
  const software = recordOf(record["softwareInfo"]);
  const memory = recordOf(record["memoryInfo"]);
  const network = recordOf(record["networkInfo"]);
  const disabledReason = recordOf(record["disabledReason"]);

  const applications = applicationReports(record["applicationReports"]);

  const resource = {
    name,
    enterpriseName: stringOf(record["enterpriseName"]) ?? fallbackEnterpriseName,
    state: stringOf(record["state"]),
    displayName: stringOf(record["displayName"]),
    hardwareName: stringOf(hardware?.["hardware"]),
    model: stringOf(hardware?.["model"]) ?? stringOf(record["model"]),
    manufacturer: stringOf(hardware?.["manufacturer"]) ?? stringOf(record["manufacturer"]),
    brand: stringOf(hardware?.["brand"]),
    serial: stringOf(hardware?.["serialNumber"]) ?? stringOf(record["serialNumber"]),
    osVersion: stringOf(software?.["androidVersion"]),
    buildNumber: stringOf(software?.["androidBuildNumber"]),
    securityPatchLevel: stringOf(software?.["securityPatchLevel"]),
    apiLevel: intOf(record["apiLevel"]),
    managementMode: stringOf(record["managementMode"]),
    ownership: stringOf(record["ownership"]),
    appliedPolicyName: stringOf(record["appliedPolicyName"]),
    appliedPolicyVersion: stringOf(record["appliedPolicyVersion"]),
    enrollmentTokenName: stringOf(record["enrollmentTokenName"]),
    // `UserFacingMessage.localizedMessage` is what the operator sees on the
    // device; the message id alone is not actionable.
    disabledReason: stringOf(disabledReason?.["localizedMessage"]),
    // IMEI, MEID and Wi-Fi MAC are deliberately not parsed: they are personal
    // data and no inventory view needs them.
    networkOperator: stringOf(network?.["networkOperatorName"]),
    totalRam: intOf(memory?.["totalRam"]),
    totalInternalStorage: intOf(memory?.["totalInternalStorage"]),
    enrolledAt: dateOf(record["enrollmentTime"]),
    lastSeenAt: dateOf(record["lastStatusReportTime"]) ?? now(),
    applications,
  };

  return {
    ...resource,
    hasInventory: [
      resource.model,
      resource.manufacturer,
      resource.serial,
      resource.osVersion,
      resource.buildNumber,
      resource.securityPatchLevel,
      resource.apiLevel,
      resource.totalRam,
      resource.totalInternalStorage,
      resource.networkOperator,
      resource.appliedPolicyName,
      resource.enrollmentTokenName,
      resource.managementMode,
      resource.ownership,
    ].some((value) => value !== undefined),
  };
}

const deviceNameBelongs = (enterpriseName: string, deviceName: string) =>
  deviceName.startsWith(`${enterpriseName}/devices/`);

const enterpriseNameFromResource = (data: Schema.Json | undefined): string | undefined => {
  const record = recordOf(data);

  if (!record) return undefined;
  const explicit = stringOf(record["enterpriseName"]);

  if (explicit) return explicit;

  for (const candidate of [record["name"], record["deviceName"]]) {
    const text = stringOf(candidate);
    const match = text ? /^(enterprises\/[^/]+)/.exec(text) : undefined;

    if (match) return match[1];
  }

  return undefined;
};

type UpsertAndroidDeviceResult = {
  readonly deviceId: string;
  readonly created: boolean;
  readonly previousStatus?: string;
  readonly limitReached?: boolean;
};

type AndroidDeviceRow = typeof schema.device.$inferSelect;

/** Never replace a known value with a value the report omitted. */
const mergeValue = <T>(reported: T | undefined, known: T | null | undefined): T | null =>
  reported ?? known ?? null;

/**
 * The name Android reports for the device.
 *
 * AMAPI does not expose the user-visible device name ("Oscar's Pixel"); the
 * closest value is the enterprise-assigned `displayName` when present, then the
 * hardware model Google reports (`Pixel 9`). The applied policy name is
 * persisted separately on `android_device` so an unnamed device can still be
 * traced to the policy that manages it.
 */
export const androidReportedName = (
  resource: Pick<AndroidDeviceResource, "displayName" | "model">,
): string | undefined => resource.displayName ?? resource.model;

/**
 * Merge one device resource into the `device` row.
 *
 * Google sends partial resources, so every optional field means "not reported
 * in this notification". A missing `hardwareInfo` therefore keeps the known
 * model and serial instead of blanking them, and `inventoryUpdatedAt` only
 * moves when the report actually carried inventory.
 */
export const mergeAndroidDevice = (input: {
  readonly existing?: AndroidDeviceRow;
  readonly resource: AndroidDeviceResource;
  readonly serial: string | null;
  readonly status: "enrolling" | "enrolled" | "unenrolled";
  readonly now: Date;
}): Partial<typeof schema.device.$inferInsert> => {
  const { existing, resource } = input;
  const reportedName = androidReportedName(resource);

  const name = existing
    ? shouldApplyReportedName({
        currentName: existing.name,
        reportedName,
        // Anything the server itself derived the current name from is a
        // placeholder; an administrator's rename is not.
        placeholders: [
          existing.physicalName,
          existing.dmIdentifier,
          existing.serial,
          existing.model,
          resource.serial,
          resource.model,
        ],
      })
      ? (reportedName ?? existing.name)
      : existing.name
    : (reportedName ?? resource.serial ?? resource.name.split("/").at(-1) ?? "Android device");

  return {
    proto: "android",
    status: input.status,
    name,
    physicalName: mergeValue(reportedName, existing?.physicalName),
    model: mergeValue(resource.model, existing?.model),
    modelIdentifier: mergeValue(resource.hardwareName, existing?.modelIdentifier),
    serial: input.serial ?? existing?.serial ?? null,
    vendor: mergeValue(resource.manufacturer ?? resource.brand, existing?.vendor) ?? "Google",
    osEdition: existing?.osEdition ?? "Android",
    osVersion: mergeValue(resource.osVersion, existing?.osVersion),
    osBuild: mergeValue(resource.buildNumber, existing?.osBuild),
    // AMAPI only reports totals; used storage is derived nowhere, so leave a
    // previously known figure alone rather than clearing it.
    diskTotal:
      resource.totalInternalStorage !== undefined
        ? String(resource.totalInternalStorage)
        : (existing?.diskTotal ?? null),
    lastSeenAt: resource.lastSeenAt,
    inventoryUpdatedAt: resource.hasInventory ? input.now : (existing?.inventoryUpdatedAt ?? null),
    dmIdentifier: resource.name,
  };
};

/**
 * Merge one device resource into the `android_device` row. Only values the
 * report actually carried are returned, so an update patch never blanks a
 * known column.
 */
export const mergeAndroidDeviceInfo = (
  resource: AndroidDeviceResource,
): Partial<typeof schema.androidDevice.$inferInsert> => {
  const patch: Partial<typeof schema.androidDevice.$inferInsert> = {
    state: resource.state,
    managementMode: resource.managementMode,
    ownership: resource.ownership,
    apiLevel: resource.apiLevel,
    securityPatchLevel: resource.securityPatchLevel,
    appliedPolicyName: resource.appliedPolicyName,
    appliedPolicyVersion: resource.appliedPolicyVersion,
    enrollmentTokenName: resource.enrollmentTokenName,
    disabledReason: resource.disabledReason,
    networkOperator: resource.networkOperator,
    totalRam: resource.totalRam,
  };

  // SAFETY: the keys are this object's own keys, so each one is a valid patch
  // column and can be deleted when the report omitted it.
  for (const key of Object.keys(patch) as Array<keyof typeof patch>)
    if (patch[key] === undefined) delete patch[key];

  return patch;
};

const upsertAndroidDevice = (input: {
  readonly db: EnterpriseDb;
  readonly organizationId: string;
  readonly enterpriseName: string;
  readonly resource: AndroidDeviceResource;
  readonly planLimits?: PlanLimitsConfig;
}): Effect.Effect<UpsertAndroidDeviceResult, unknown> =>
  Effect.gen(function* () {
    const existingMapping = yield* input.db.query.androidDevice.findFirst({
      where: { organizationId: input.organizationId, deviceName: input.resource.name },
    });

    let existingDevice = existingMapping
      ? yield* input.db.query.device.findFirst({ where: { id: existingMapping.deviceId } })
      : undefined;

    if (!existingDevice) {
      existingDevice = yield* input.db.query.device.findFirst({
        where: {
          organizationId: input.organizationId,
          dmIdentifier: input.resource.name,
        },
      });
    }

    // A serial may already belong to an Apple/Windows device. In that case do
    // not reuse or overwrite it; keep the Android device's serial null so the
    // tenant-wide unique index cannot be violated.
    const serialMatch = input.resource.serial
      ? yield* input.db.query.device.findFirst({
          where: { organizationId: input.organizationId, serial: input.resource.serial },
        })
      : undefined;

    const serial =
      serialMatch && existingDevice?.id !== serialMatch.id ? null : (input.resource.serial ?? null);

    if (!existingDevice && input.planLimits) {
      const limit = yield* deviceLimitForOrganization({
        db: input.db,
        organizationId: input.organizationId,
        config: input.planLimits,
      });

      if (limit.limit !== null && (limit.used ?? 0) >= limit.limit)
        return { deviceId: "", created: false, limitReached: true };
    }

    const deviceId = existingDevice?.id ?? id();
    const timestamp = now();
    const status = androidDeviceStatus(input.resource.state);

    const devicePatch = mergeAndroidDevice({
      existing: existingDevice,
      resource: input.resource,
      serial,
      status,
      now: timestamp,
    });

    if (existingDevice) {
      yield* input.db
        .update(schema.device)
        .set(devicePatch)
        .where(
          and(
            eq(schema.device.id, deviceId),
            eq(schema.device.organizationId, input.organizationId),
          ),
        );
    } else {
      yield* input.db.insert(schema.device).values({
        id: deviceId,
        organizationId: input.organizationId,
        proto: "android",
        status,
        name: devicePatch.name ?? "Android device",
        physicalName: devicePatch.physicalName ?? null,
        model: devicePatch.model ?? null,
        modelIdentifier: devicePatch.modelIdentifier ?? null,
        serial: devicePatch.serial ?? null,
        enrolledAt: input.resource.enrolledAt ?? timestamp,
        lastSeenAt: input.resource.lastSeenAt,
        notes: null,
        assetTag: null,
        vendor: devicePatch.vendor ?? "Google",
        osEdition: devicePatch.osEdition ?? "Android",
        osVersion: devicePatch.osVersion ?? null,
        osBuild: devicePatch.osBuild ?? null,
        diskTotal: devicePatch.diskTotal ?? null,
        diskUsed: null,
        fileVaultEnabled: null,
        batteryHealth: null,
        capabilities: null,
        modelNumber: null,
        inventoryUpdatedAt: devicePatch.inventoryUpdatedAt ?? null,
        applicationsUpdatedAt: null,
        dmIdentifier: input.resource.name,
        dmCertHash: null,
        dmIdentityFingerprint: null,
        ddmDeclarationsToken: null,
      });
    }

    const infoPatch = mergeAndroidDeviceInfo(input.resource);
    const mapping = yield* input.db.query.androidDevice.findFirst({ where: { deviceId } });

    if (!mapping) {
      yield* insertAndroidDevice(input.db, {
        deviceId,
        organizationId: input.organizationId,
        enterpriseName: input.enterpriseName,
        deviceName: input.resource.name,
        policyId: null,
        policyHash: null,
        lastError: null,
        lastSyncedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...infoPatch,
      });
    } else {
      yield* updateAndroidDevice(input.db, deviceId, {
        organizationId: input.organizationId,
        enterpriseName: input.enterpriseName,
        deviceName: input.resource.name,
        lastError: null,
        ...infoPatch,
      });
    }

    // Google only sends `applicationReports` when the applied policy enables
    // status reporting, so an absent list means "not reported", not "no apps".
    if (input.resource.applications !== undefined)
      yield* replaceDeviceApplications(input.db, {
        deviceId,
        organizationId: input.organizationId,
        applications: input.resource.applications,
        reportedAt: timestamp,
      });

    return {
      deviceId,
      created: !existingDevice,
      previousStatus: existingDevice?.status,
    };
  });

/**
 * Android applications assigned to one device, directly or through a group.
 *
 * `packageName` is the catalogue entry's bundle id. Only Android entries in the
 * same tenant are considered; a mis-typed Apple bundle id therefore cannot end
 * up in a Google policy.
 */
const assignedAndroidApplications = (
  db: EnterpriseDb,
  input: { readonly organizationId: string; readonly deviceId: string },
): Effect.Effect<
  ReadonlyArray<{ readonly applicationId: string; readonly packageName: string }>,
  unknown
> =>
  Effect.gen(function* () {
    const ids = yield* assignedApplicationIdsForDevice(db, input);

    if (ids.length === 0) return [];

    const [device] = yield* db
      .select({
        proto: schema.device.proto,
        osVersion: schema.device.osVersion,
        capabilities: schema.device.capabilities,
      })
      .from(schema.device)
      .where(eq(schema.device.id, input.deviceId))
      .limit(1);

    const applications = yield* db
      .select({
        id: schema.application.id,
        bundleId: schema.application.bundleId,
        platform: schema.application.platform,
      })
      .from(schema.application)
      .where(
        and(
          eq(schema.application.organizationId, input.organizationId),
          inArray(schema.application.id, ids),
        ),
      );

    const installers = yield* db
      .select()
      .from(schema.applicationInstaller)
      .where(
        and(
          eq(schema.applicationInstaller.organizationId, input.organizationId),
          eq(schema.applicationInstaller.platform, "android"),
          inArray(schema.applicationInstaller.applicationId, ids),
        ),
      );

    const capabilities = Array.isArray(device?.capabilities)
      ? device.capabilities.filter((value): value is string => typeof value === "string")
      : undefined;

    return applications.flatMap((application) => {
      const installer = selectInstaller(
        installers.filter((item) => item.applicationId === application.id),
        { proto: device?.proto ?? "android", osVersion: device?.osVersion, capabilities },
      );

      // A legacy row without installer rows is only an Android app when its
      // own platform says so; otherwise it belongs to another platform.
      if (!installer && application.platform !== "android") return [];

      const packageName = installer?.bundleId ?? application.bundleId;

      return packageName ? [{ applicationId: application.id, packageName }] : [];
    });
  });

/** Applications declared by a compiled policy that can hold managed data. */
const managedAndroidPackageNames = (policy: Schema.JsonObject): string[] => {
  const applications = policy["applications"];

  if (!Array.isArray(applications)) return [];
  const packageNames = new Set<string>();

  for (const entry of applications) {
    const record = recordOf(entry);
    const packageName = stringOf(record?.["packageName"]);

    if (!packageName) continue;

    // A blocked package is present in the policy but never installed, so it
    // has no app data to clear.
    if (stringOf(record?.["installType"]) === "BLOCKED") continue;

    packageNames.add(packageName);
  }

  return [...packageNames];
};

/**
 * Compile the AMAPI policy Google will receive for one device.
 *
 * This is the single source of truth for "managed on this device": tenant
 * policy fragments, the status-reporting baseline and assigned catalogue
 * applications. Remote actions that target managed apps must use the same
 * compiled list rather than only catalogue assignments.
 */
const compileEffectiveAndroidPolicy = (input: {
  readonly db: EnterpriseDb;
  readonly organizationId: string;
  readonly deviceId: string;
}): Effect.Effect<
  { readonly policy: Schema.JsonObject; readonly hash: string },
  AndroidDeliveryError
> =>
  Effect.gen(function* () {
    const effective = yield* resolveEffectivePolicyForDevice(input.db, {
      id: input.deviceId,
      organizationId: input.organizationId,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new AndroidDeliveryError({
            kind: "upstream",
            message: `Could not resolve the Android policy: ${describeAndroidError(cause)}`,
            cause,
          }),
      ),
    );

    const configurations: Array<AndroidPolicyConfiguration> = effective.configurations.map(
      (configuration) => ({
        kind: configuration.kind,
        data: configuration.data,
        policyId: configuration.policyId,
      }),
    );

    // The tenant OS policy is rendered as a systemUpdate fragment rather than
    // a stored policy, so it applies without the operator authoring one. It is
    // appended last: the tenant-wide rule wins over a conflicting fragment,
    // matching how the Windows check-in merges its generated nodes.
    const osPolicyRows = yield* input.db
      .select({
        platform: schema.tenantOsPolicy.platform,
        minimumVersion: schema.tenantOsPolicy.minimumVersion,
        enforcement: schema.tenantOsPolicy.enforcement,
        deferralDays: schema.tenantOsPolicy.deferralDays,
        updatedAt: schema.tenantOsPolicy.updatedAt,
      })
      .from(schema.tenantOsPolicy)
      .where(
        and(
          eq(schema.tenantOsPolicy.organizationId, input.organizationId),
          eq(schema.tenantOsPolicy.platform, "android"),
        ),
      )
      .limit(1)
      .pipe(
        Effect.mapError(
          (cause) =>
            new AndroidDeliveryError({
              kind: "upstream",
              message: `Could not load the Android OS policy: ${describeAndroidError(cause)}`,
              cause,
            }),
        ),
      );

    const osPolicyRule = osPolicyRows[0] ? osPolicyRuleFromRow(osPolicyRows[0]) : null;
    const systemUpdate = androidSystemUpdatePolicy(osPolicyRule);

    if (systemUpdate)
      configurations.push({
        kind: ANDROID_OS_UPDATE_CONFIGURATION_KIND,
        data: { systemUpdate },
      });

    // Managed Google Play delivery is the policy's `applications` array. Assigned
    // catalogue apps are merged underneath the tenant's own policy fragments, so
    // an explicit `installType` or managed configuration always wins.
    const assignedApplications = yield* assignedAndroidApplications(input.db, {
      organizationId: input.organizationId,
      deviceId: input.deviceId,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new AndroidDeliveryError({
            kind: "upstream",
            message: `Could not load assigned Android applications: ${describeAndroidError(cause)}`,
            cause,
          }),
      ),
    );

    for (const application of assignedApplications) {
      if (!isAndroidPackageName(application.packageName))
        yield* Effect.logWarning(
          `Android application ${application.applicationId} has an invalid package name and was not added to the policy for ${input.deviceId}`,
        );
    }

    // Restricted software is compiled last so a BLOCKED entry wins over a
    // FORCE_INSTALLED entry for the same package. It is scoped per device, so
    // only rules whose include/exclude scope resolves here are added. Only
    // Block installation is expressible: Google has no process-kill or
    // app-removal command, and those actions stay detection-only.
    const restricted = yield* resolveRestrictedSoftwareForDevice(input.db, {
      organizationId: input.organizationId,
      deviceId: input.deviceId,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new AndroidDeliveryError({
            kind: "upstream",
            message: `Could not resolve restricted software for the Android policy: ${describeAndroidError(cause)}`,
            cause,
          }),
      ),
    );

    const blockedPackages = [
      ...new Set(
        restricted.rules
          .filter(
            ({ rule, capability }) =>
              capability.mode === "policy" &&
              rule.action === "block-install" &&
              rule.matchType === "android-package" &&
              isAndroidPackageName(rule.matchValue),
          )
          .map(({ rule }) => rule.matchValue.trim()),
      ),
    ].sort();

    if (blockedPackages.length > 0)
      configurations.push({
        kind: ANDROID_RESTRICTED_SOFTWARE_CONFIGURATION_KIND,
        data: {
          applications: blockedPackages.map((packageName) => ({
            packageName,
            installType: "BLOCKED",
          })),
        },
      });

    const compiled = compileAndroidPolicy(configurations);

    if (Result.isFailure(compiled)) {
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "invalid_payload",
          message: `Could not compile the Android policy: ${describeAndroidError(compiled.failure)}`,
          cause: compiled.failure,
        }),
      );
    }

    // Mattrax needs software and application status to inventory a device,
    // and Google disables both by default. The baseline sits underneath the
    // tenant's own reporting settings, so an operator can still turn either
    // off (at the cost of that inventory).
    const policy = mergeAssignedAndroidApplications(
      withStatusReporting(compiled.success),
      assignedApplications,
    );

    const hash = yield* androidPolicyHash(policy).pipe(
      Effect.mapError(
        (cause) =>
          new AndroidDeliveryError({
            kind: "invalid_payload",
            message: `Could not hash the Android policy: ${describeAndroidError(cause)}`,
            cause,
          }),
      ),
      Effect.provide(Digest.layerWebCrypto),
    );

    return { policy, hash };
  });

const syncAndroidPolicyForDevice = (input: {
  readonly db: EnterpriseDb;
  readonly config: AndroidDeliveryConfig;
  readonly organizationId: string;
  readonly enterpriseName: string;
  readonly device: { readonly id: string; readonly dmIdentifier: string | null };
}): Effect.Effect<
  { readonly status: "updated" | "skipped" },
  AndroidDeliveryError,
  AndroidManagement
> =>
  Effect.gen(function* () {
    if (
      !input.device.dmIdentifier ||
      !deviceNameBelongs(input.enterpriseName, input.device.dmIdentifier)
    )
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "invalid_payload",
          message: "The Android device is not linked to this enterprise.",
        }),
      );
    const android = yield* AndroidManagement;

    const compiled = yield* compileEffectiveAndroidPolicy({
      db: input.db,
      organizationId: input.organizationId,
      deviceId: input.device.id,
    });

    const policyId = androidPolicyIdForHash(compiled.hash);

    const mapping = yield* input.db.query.androidDevice.findFirst({
      where: { deviceId: input.device.id },
    });

    if (mapping && mapping.policyHash === compiled.hash && mapping.policyId === policyId) {
      return { status: "skipped" as const };
    }

    yield* android
      .patchPolicy({
        enterpriseName: input.enterpriseName,
        policyId,
        policy: compiled.policy,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new AndroidDeliveryError({
              kind: "upstream",
              message: `Could not push the Android policy: ${describeAndroidError(cause)}`,
              cause,
            }),
        ),
      );
    yield* android
      .patchDevice({
        deviceName: input.device.dmIdentifier,
        policyName: policyId,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new AndroidDeliveryError({
              kind: "upstream",
              message: `Could not assign the Android policy: ${describeAndroidError(cause)}`,
              cause,
            }),
        ),
      );

    const timestamp = now();

    if (mapping) {
      yield* updateAndroidDevice(input.db, input.device.id, {
        policyId,
        policyHash: compiled.hash,
        lastError: null,
        lastSyncedAt: timestamp,
      });
    } else {
      yield* insertAndroidDevice(input.db, {
        deviceId: input.device.id,
        organizationId: input.organizationId,
        enterpriseName: input.enterpriseName,
        deviceName: input.device.dmIdentifier,
        policyId,
        policyHash: compiled.hash,
        state: null,
        lastError: null,
        lastSyncedAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    return { status: "updated" as const };
  }).pipe(mapAndroidError);

export type AndroidSyncResult = {
  readonly devices: number;
  readonly updated: number;
  readonly skipped: number;
  readonly failed: number;
};

/**
 * Push the effective `mttx.android.policy*` configuration to every Android
 * device in a tenant (or a provided subset). Delivery failures are recorded on
 * the enterprise/device rows and never fail an administrator's policy write.
 */
export const syncAndroidPoliciesForTenant = (input: {
  readonly db: EnterpriseDb;
  readonly config?: AndroidDeliveryConfig;
  readonly organizationId: string;
  readonly deviceIds?: ReadonlyArray<string>;
}): Effect.Effect<AndroidSyncResult, AndroidDeliveryError, AndroidManagement> =>
  Effect.gen(function* () {
    const config = input.config;

    if (!isAndroidConfigured(config)) return { devices: 0, updated: 0, skipped: 0, failed: 0 };
    const enterprise = yield* loadAndroidEnterprise(input.db, input.organizationId);

    if (enterprise?.status !== "active" || !enterprise.enterpriseName)
      return { devices: 0, updated: 0, skipped: 0, failed: 0 };
    const enterpriseName = enterprise.enterpriseName;

    const scopedIds = input.deviceIds ? [...new Set(input.deviceIds)] : undefined;

    if (scopedIds && scopedIds.length === 0)
      return { devices: 0, updated: 0, skipped: 0, failed: 0 };

    const devices = yield* input.db
      .select()
      .from(schema.device)
      .where(
        scopedIds
          ? and(
              eq(schema.device.organizationId, input.organizationId),
              eq(schema.device.proto, "android"),
              eq(schema.device.status, "enrolled"),
              inArray(schema.device.id, scopedIds),
            )
          : and(
              eq(schema.device.organizationId, input.organizationId),
              eq(schema.device.proto, "android"),
              // A retired device's Google resource no longer exists; pushing
              // policy to it would 404 and poison the tenant's sync status.
              eq(schema.device.status, "enrolled"),
            ),
      );

    let updated = 0;
    let skipped = 0;
    let failed = 0;
    let lastError: string | null = null;

    // AMAPI policy pushes are two network calls per device. Keep the fan-out
    // bounded so a large group save cannot exhaust the Worker request budget.
    const outcomes = yield* Effect.forEach(
      devices,
      (device) =>
        syncAndroidPolicyForDevice({
          db: input.db,
          config,
          organizationId: input.organizationId,
          enterpriseName,
          device: { id: device.id, dmIdentifier: device.dmIdentifier },
        }).pipe(
          Effect.match({
            onFailure: (error) => ({ device, status: "failed" as const, error }),
            onSuccess: (value) => ({ device, ...value, error: undefined }),
          }),
        ),
      { concurrency: 4 },
    );

    for (const outcome of outcomes) {
      // `skipped` means Google already holds this exact compiled policy, so a
      // pending block violation is just as delivered as after an update.
      if (outcome.status === "updated" || outcome.status === "skipped") {
        yield* markAndroidRestrictedSoftwarePolicyDelivered(input.db, {
          organizationId: input.organizationId,
          deviceId: outcome.device.id,
          at: now(),
        }).pipe(
          Effect.catch((error) =>
            Effect.logWarning(
              `Could not mark restricted software enforced for ${outcome.device.id}: ${String(error)}`,
            ),
          ),
        );
      }

      if (outcome.status === "updated") {
        updated += 1;

        yield* writeSystemAudit(
          input.db,
          {
            organizationId: input.organizationId,
            action: SYSTEM_AUDIT_ACTIONS.mdmPolicyDelivered,
            targetType: "device",
            targetId: outcome.device.id,
            deviceId: outcome.device.id,
            protocol: "android",
            metadata: { platform: "android", mode: "policy" },
          },
          {},
        ).pipe(Effect.catch(() => Effect.void));
      } else if (outcome.status === "skipped") skipped += 1;
      else {
        failed += 1;

        const error =
          outcome.error ??
          new AndroidDeliveryError({
            kind: "upstream",
            message: "Android policy sync failed",
          });

        lastError = error.message;
        yield* ignoreDbFailure(
          updateAndroidDevice(input.db, outcome.device.id, {
            lastError: error.message,
          }),
        );
        yield* writeSystemAudit(
          input.db,
          {
            organizationId: input.organizationId,
            action: SYSTEM_AUDIT_ACTIONS.mdmFailure,
            targetType: "device",
            targetId: outcome.device.id,
            deviceId: outcome.device.id,
            protocol: "android",
            metadata: {
              platform: "android",
              phase: "policy",
              code: "policy_sync_failed",
              reason: error.message.slice(0, 300),
            },
          },
          {},
        ).pipe(Effect.catch(() => Effect.void));
      }
    }

    yield* ignoreDbFailure(
      updateAndroidEnterprise(input.db, input.organizationId, {
        lastSyncedAt: now(),
        lastError,
      }),
    );

    return { devices: devices.length, updated, skipped, failed };
  }).pipe(mapAndroidError);

export type AndroidRefreshResult = {
  readonly status: "refreshed" | "retired";
};

/**
 * Refresh one device from Google.
 *
 * The device page's **Sync** action should reflect Google, not the last push
 * Mattrax sent, and it should not have to list the whole enterprise to do it.
 * A 404 means Google no longer has the device (it was deleted or
 * deprovisioned), so the local row is retired instead of pushing policy into a
 * void.
 */
export const refreshAndroidDevice = (input: {
  readonly db: EnterpriseDb;
  readonly config?: AndroidDeliveryConfig;
  readonly authSecret?: string;
  readonly organizationId: string;
  readonly device: { readonly id: string; readonly dmIdentifier: string | null };
}): Effect.Effect<AndroidRefreshResult, AndroidDeliveryError, AndroidManagement> =>
  Effect.gen(function* () {
    const config = input.config;

    if (!isAndroidConfigured(config)) return yield* Effect.fail(notConfigured());
    const enterprise = yield* loadAndroidEnterprise(input.db, input.organizationId);

    if (enterprise?.status !== "active" || !enterprise.enterpriseName)
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "conflict",
          message: "Android Enterprise is not connected for this tenant.",
        }),
      );

    if (
      !input.device.dmIdentifier ||
      !deviceNameBelongs(enterprise.enterpriseName, input.device.dmIdentifier)
    )
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "invalid_payload",
          message: "This device is not linked to the tenant's Android enterprise.",
        }),
      );
    const android = yield* AndroidManagement;

    const deviceName = input.device.dmIdentifier;

    const resource = yield* android.getDevice({ deviceName }).pipe(
      Effect.catchIf(
        (cause) => cause instanceof GoogleApiError && cause.status === 404,
        () => Effect.succeed(null),
      ),
      Effect.mapError(
        (cause) =>
          new AndroidDeliveryError({
            kind: "upstream",
            message: `Could not read the Android device: ${describeAndroidError(cause)}`,
            cause,
          }),
      ),
    );

    if (!resource) {
      const timestamp = now();

      yield* input.db
        .update(schema.device)
        .set({ status: "unenrolled" })
        .where(
          and(
            eq(schema.device.id, input.device.id),
            eq(schema.device.organizationId, input.organizationId),
          ),
        );

      yield* updateAndroidDevice(input.db, input.device.id, {
        state: "DELETED",
        policyId: null,
        policyHash: null,
        appliedPolicyName: null,
        appliedPolicyVersion: null,
        lastSyncedAt: timestamp,
      });

      return { status: "retired" as const };
    }

    const parsed = parseAndroidDeviceResource(
      Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(resource)),
      enterprise.enterpriseName,
    );

    if (!parsed)
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "upstream",
          message: "Google returned a device without a resource name.",
        }),
      );

    const device = yield* upsertAndroidDevice({
      db: input.db,
      organizationId: input.organizationId,
      enterpriseName: enterprise.enterpriseName,
      resource: parsed,
    }).pipe(Effect.mapError(toAndroidDeliveryError));

    yield* syncDynamicGroupsForDevice(input.db, input.organizationId, device.deviceId, {
      now: now(),
    }).pipe(Effect.catch(() => Effect.void));

    // A missed command notification is exactly the kind of stale state an
    // operator presses Sync to fix, so resolve this device's operations too.
    yield* reconcileAndroidCommands({
      db: input.db,
      authSecret: input.authSecret,
      organizationId: input.organizationId,
      deviceId: device.deviceId,
    }).pipe(Effect.mapError(toAndroidDeliveryError));

    yield* syncAndroidPoliciesForTenant({
      db: input.db,
      config,
      organizationId: input.organizationId,
      deviceIds: [device.deviceId],
    }).pipe(
      Effect.mapError((error) =>
        error instanceof AndroidDeliveryError
          ? error
          : new AndroidDeliveryError({
              kind: "upstream",
              message: describeAndroidError(error),
              cause: error,
            }),
      ),
    );

    return { status: "refreshed" as const };
  }).pipe(mapAndroidError);

/**
 * Resolve Android commands whose operation Google has already finished.
 *
 * Command results arrive as Pub/Sub notifications, which can be dropped. Polling
 * the operation closes that gap; without it a wipe or lock stays `sent` until
 * its budget expires even though Google finished it. One broken operation logs
 * a warning and the rest continue.
 */
const reconcileAndroidCommands = (input: {
  readonly db: EnterpriseDb;
  readonly authSecret?: string;
  readonly organizationId: string;
  /** Restrict to one device; omitted for a whole-enterprise reconcile. */
  readonly deviceId?: string;
}): Effect.Effect<number, unknown, AndroidManagement> =>
  Effect.gen(function* () {
    const android = yield* AndroidManagement;

    const pending = yield* input.db
      .select()
      .from(schema.deviceCommand)
      .where(
        and(
          eq(schema.deviceCommand.organizationId, input.organizationId),
          eq(schema.deviceCommand.status, "sent"),
          like(schema.deviceCommand.requestType, "Android%"),
          ...(input.deviceId ? [eq(schema.deviceCommand.deviceId, input.deviceId)] : []),
        ),
      )
      .orderBy(desc(schema.deviceCommand.createdAt))
      .limit(50);

    const payloadSchema = Schema.Struct({ operationName: Schema.optional(Schema.String) });
    let resolved = 0;

    for (const command of pending) {
      const payload = Option.getOrUndefined(
        Schema.decodeUnknownOption(payloadSchema)(command.payload),
      );

      if (!payload?.operationName) continue;

      const operation = yield* android.getOperation({ operationName: payload.operationName }).pipe(
        Effect.catchIf(
          (cause) => cause instanceof GoogleApiError && cause.status === 404,
          () => Effect.succeed(undefined),
        ),
        Effect.catch((error) =>
          Effect.logWarning(
            `Could not poll Android operation ${payload.operationName}: ${describeAndroidError(error)}`,
          ).pipe(Effect.as(undefined)),
        ),
      );

      if (!operation || !operation.done) continue;

      const operationRecord = recordOf(
        Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(operation)),
      );

      const operationMetadata = recordOf(operationRecord?.["metadata"]);

      yield* input.db
        .update(schema.deviceCommand)
        .set({
          status: operation.error ? "failed" : "succeeded",
          dedupeKey: null,
          resultStatus: operation.error
            ? (operation.error.status ?? "FAILED")
            : (stringOf(operationMetadata?.["status"]) ?? "COMPLETED"),
          resultDetail: operation.error
            ? describeAndroidError(operation.error)
            : commandResultDetail(operationRecord, command.requestType),
          updatedAt: now(),
        })
        .where(eq(schema.deviceCommand.id, command.id));

      if (operation.error)
        yield* writeSystemAudit(
          input.db,
          {
            organizationId: input.organizationId,
            action: SYSTEM_AUDIT_ACTIONS.commandFailed,
            targetType: "device_command",
            targetId: command.id,
            metadata: { deviceId: command.deviceId, requestType: command.requestType },
          },
          { authSecret: input.authSecret },
        ).pipe(Effect.catch(() => Effect.void));

      resolved += 1;
    }

    return resolved;
  });

export type AndroidReconcileResult = {
  /** Devices Google reported for the enterprise. */
  readonly reconciled: number;
  /** Local devices marked unenrolled because Google no longer lists them. */
  readonly removed: number;
  /** In-flight commands whose operation Google had already finished. */
  readonly commands: number;
  /** Superseded `mattrax-*` policies deleted from Google. */
  readonly policiesPruned: number;
};

/** Bound the number of API pages one reconcile will walk. */
const ANDROID_RECONCILE_MAX_PAGES = 50;

/**
 * Make the tenant's view match Google's, without waiting for Pub/Sub.
 *
 * Pub/Sub is at-least-once and can drop a delivery (a misconfigured
 * subscription, a deploy that misses the endpoint), so state that only arrives
 * through it eventually goes stale: a device wiped in the Google console stays
 * "enrolled" forever, and a finished command stays "sent". This walks the
 * enterprise instead:
 *
 * 1. re-asserts the notification types the tenant needs,
 * 2. lists every device and applies the same merge a notification would,
 * 3. retires local devices Google no longer lists,
 * 4. polls in-flight command operations,
 * 5. pushes policy to the devices it saw,
 * 6. deletes superseded `mattrax-*` policies no device references.
 *
 * Every step is tenant-scoped by the enterprise name, and a failure is reported
 * instead of silently leaving a half-synced tenant.
 */
export const reconcileAndroidEnterprise = (input: {
  readonly db: EnterpriseDb;
  readonly config?: AndroidDeliveryConfig;
  readonly authSecret?: string;
  readonly organizationId: string;
  readonly planLimits?: PlanLimitsConfig;
}): Effect.Effect<
  AndroidReconcileResult & AndroidSyncResult,
  AndroidDeliveryError,
  AndroidManagement
> =>
  Effect.gen(function* () {
    const empty = {
      devices: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      reconciled: 0,
      removed: 0,
      commands: 0,
      policiesPruned: 0,
    };

    const config = input.config;

    if (!isAndroidConfigured(config)) return empty;
    const enterprise = yield* loadAndroidEnterprise(input.db, input.organizationId);

    if (enterprise?.status !== "active" || !enterprise.enterpriseName) return empty;
    const enterpriseName = enterprise.enterpriseName;
    const android = yield* AndroidManagement;

    // A second enterprise on the same Google project is not ours to manage, so
    // a 404 here means the tenant's enterprise was deleted in the console.
    const remote = yield* android.getEnterprise({ enterpriseName }).pipe(
      Effect.catchIf(
        (cause) => cause instanceof GoogleApiError && cause.status === 404,
        () =>
          Effect.fail(
            new AndroidDeliveryError({
              kind: "conflict",
              message:
                "The Android enterprise no longer exists in Google. Disconnect it here and connect again.",
            }),
          ),
      ),
      Effect.mapError(toAndroidDeliveryError),
    );

    const missingNotifications = ANDROID_NOTIFICATION_TYPES.filter(
      (type) => !(remote.enabledNotificationTypes ?? []).includes(type),
    );

    // `enabledNotificationTypes` is fixed at creation, so an enterprise created
    // before Mattrax asked for COMMAND events would never report command
    // results. Re-assert it here; a failure is not fatal to the rest of the
    // reconcile, and the next run retries.
    if (missingNotifications.length > 0)
      yield* android
        .patchEnterprise({
          enterpriseName,
          enabledNotificationTypes: [
            ...new Set([...(remote.enabledNotificationTypes ?? []), ...ANDROID_NOTIFICATION_TYPES]),
          ],
        })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning(
              `Could not update Android notification types for ${enterpriseName}: ${describeAndroidError(error)}`,
            ),
          ),
        );

    const resources: Array<AndroidDeviceResource> = [];
    let pageToken: string | undefined;
    let pages = 0;

    do {
      const page = yield* android.listDevices({ enterpriseName, pageToken }).pipe(
        Effect.mapError(
          (cause) =>
            new AndroidDeliveryError({
              kind: "upstream",
              message: `Could not list Android devices: ${describeAndroidError(cause)}`,
              cause,
            }),
        ),
      );

      for (const device of page.devices) {
        const resource = parseAndroidDeviceResource(
          Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(device)),
          enterpriseName,
        );

        if (!resource || resource.enterpriseName !== enterpriseName) continue;

        if (!deviceNameBelongs(enterpriseName, resource.name)) continue;
        resources.push(resource);
      }

      pageToken = page.nextPageToken;
      pages += 1;
    } while (pageToken && pages < ANDROID_RECONCILE_MAX_PAGES);

    let reconciled = 0;

    for (const resource of resources) {
      const device = yield* upsertAndroidDevice({
        db: input.db,
        organizationId: input.organizationId,
        enterpriseName,
        resource,
        planLimits: input.planLimits,
      }).pipe(Effect.mapError(toAndroidDeliveryError));

      if (device.limitReached) continue;
      reconciled += 1;

      yield* syncDynamicGroupsForDevice(input.db, input.organizationId, device.deviceId, {
        now: now(),
      }).pipe(Effect.catch(() => Effect.void));

      if (device.created || (device.previousStatus !== "enrolled" && resource.state === "ACTIVE")) {
        yield* writeSystemAudit(
          input.db,
          {
            organizationId: input.organizationId,
            action: SYSTEM_AUDIT_ACTIONS.deviceEnrolled,
            targetType: "device",
            targetId: device.deviceId,
            metadata: {
              platform: "android",
              serial: resource.serial ?? null,
              model: resource.model ?? null,
              reconciled: true,
            },
          },
          { authSecret: input.authSecret },
        ).pipe(Effect.catch(() => Effect.void));
      }
    }

    // Anything local that Google did not list has left management: a device
    // retired in the console, or one whose enterprise record was deleted.
    const reported = new Set(resources.map((resource) => resource.name));

    const localMappings = yield* input.db
      .select()
      .from(schema.androidDevice)
      .where(eq(schema.androidDevice.organizationId, input.organizationId));

    const localDeviceIds = localMappings.map((mapping) => mapping.deviceId);

    // Two plain reads rather than a join: the same shape the rest of this
    // module uses, and the mapping row already carries the Google device name.
    const localDevices = localDeviceIds.length
      ? yield* input.db
          .select()
          .from(schema.device)
          .where(
            and(
              eq(schema.device.organizationId, input.organizationId),
              inArray(schema.device.id, localDeviceIds),
            ),
          )
      : [];

    const localDeviceById = new Map(localDevices.map((device) => [device.id, device]));

    const removedAt = now();
    let removed = 0;

    for (const device of localMappings) {
      const row = localDeviceById.get(device.deviceId);

      if (!row || reported.has(device.deviceName) || row.status === "unenrolled") continue;

      yield* input.db
        .update(schema.device)
        .set({ status: "unenrolled" })
        .where(
          and(eq(schema.device.id, row.id), eq(schema.device.organizationId, input.organizationId)),
        );

      yield* updateAndroidDevice(input.db, row.id, {
        state: "DELETED",
        // Nothing is applied any more, so do not keep a superseded policy
        // alive on the strength of a retired device's stale mapping.
        policyId: null,
        policyHash: null,
        appliedPolicyName: null,
        appliedPolicyVersion: null,
        lastSyncedAt: removedAt,
      });

      removed += 1;
      yield* writeSystemAudit(
        input.db,
        {
          organizationId: input.organizationId,
          action: SYSTEM_AUDIT_ACTIONS.deviceUnenrolled,
          targetType: "device",
          targetId: row.id,
          metadata: { platform: "android", reconciled: true, reason: "not listed by Google" },
        },
        { authSecret: input.authSecret },
      ).pipe(Effect.catch(() => Effect.void));
    }

    // Command results also arrive over Pub/Sub; polling closes the gap when a
    // notification was lost, which would otherwise leave the action spinning
    // until its budget expired.
    const commands = yield* reconcileAndroidCommands({
      db: input.db,
      authSecret: input.authSecret,
      organizationId: input.organizationId,
    }).pipe(Effect.mapError(toAndroidDeliveryError));

    const sync = yield* syncAndroidPoliciesForTenant({
      db: input.db,
      config,
      organizationId: input.organizationId,
    });

    // Every device-specific policy is a new Google-side resource, so the
    // enterprise would otherwise accumulate one per policy edit forever. Keep
    // the baseline and anything a device currently references.
    const keep = new Set<string>([config.defaultPolicyId ?? DEFAULT_ANDROID_POLICY_ID]);

    const mappings = yield* input.db
      .select({
        policyId: schema.androidDevice.policyId,
        appliedPolicyName: schema.androidDevice.appliedPolicyName,
      })
      .from(schema.androidDevice)
      .where(eq(schema.androidDevice.organizationId, input.organizationId));

    for (const mapping of mappings) {
      if (mapping.policyId) keep.add(mapping.policyId);

      if (mapping.appliedPolicyName)
        keep.add(mapping.appliedPolicyName.split("/").at(-1) ?? mapping.appliedPolicyName);
    }

    let policiesPruned = 0;
    let policyPageToken: string | undefined;
    let policyPages = 0;

    do {
      const page = yield* android
        .listPolicies({ enterpriseName, pageToken: policyPageToken })
        .pipe(
          Effect.catch((error) =>
            Effect.logWarning(
              `Could not list Android policies for ${enterpriseName}: ${describeAndroidError(error)}`,
            ).pipe(Effect.as({ policies: [], nextPageToken: undefined })),
          ),
        );

      for (const policy of page.policies) {
        const name = Option.getOrUndefined(
          Schema.decodeUnknownOption(Schema.String)(policy["name"]),
        );

        if (!name) continue;
        const policyId = name.split("/").at(-1);

        if (!policyId || !policyId.startsWith("mattrax-") || keep.has(policyId)) continue;

        const deleted = yield* android
          .deletePolicy({ enterpriseName, policyId })
          .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));

        if (deleted) policiesPruned += 1;
      }

      policyPageToken = page.nextPageToken;
      policyPages += 1;
    } while (policyPageToken && policyPages < ANDROID_RECONCILE_MAX_PAGES);

    return {
      ...sync,
      reconciled,
      removed,
      commands,
      policiesPruned,
    };
  }).pipe(mapAndroidError);

export type AndroidPubSubResult = {
  readonly status: "ok" | "duplicate" | "ignored";
  readonly type?: string;
  readonly reason?: string;
};

type ApplyNotificationInput = {
  readonly db: EnterpriseDb;
  readonly config: AndroidDeliveryConfig;
  readonly authSecret?: string;
  readonly enterprise: AndroidEnterpriseRow;
  readonly notificationType: string;
  readonly data: Schema.Json;
  readonly planLimits?: PlanLimitsConfig;
};

type ApplyNotificationResult = {
  readonly status: "ok" | "ignored";
  readonly reason?: string;
};

const applyDeviceNotification = (
  input: ApplyNotificationInput,
): Effect.Effect<ApplyNotificationResult, unknown, AndroidManagement> =>
  Effect.gen(function* () {
    const enterpriseName = input.enterprise.enterpriseName;

    if (!enterpriseName)
      return { status: "ignored" as const, reason: "enterprise has no Google name" };
    const resource = parseAndroidDeviceResource(input.data, enterpriseName);

    if (!resource) return { status: "ignored" as const, reason: "notification is not a device" };

    if (resource.enterpriseName !== enterpriseName)
      return { status: "ignored" as const, reason: "device belongs to another enterprise" };

    if (!deviceNameBelongs(enterpriseName, resource.name))
      return { status: "ignored" as const, reason: "device resource is outside the enterprise" };

    // Reuse the enterprise's owning tenant; never trust a tenant id in the
    // notification payload.
    const organizationId = input.enterprise.organizationId;

    const device = yield* upsertAndroidDevice({
      db: input.db,
      organizationId,
      enterpriseName,
      resource,
      planLimits: input.planLimits,
    });

    if (device.limitReached)
      return { status: "ignored" as const, reason: "tenant device limit reached" };

    // Android has no device-initiated connection: a Pub/Sub notification is
    // the check-in. There is no device address to store (Google is the
    // caller), so `ip` stays null and the notification type is the context.
    yield* writeSystemAudit(
      input.db,
      {
        organizationId,
        action: SYSTEM_AUDIT_ACTIONS.mdmCheckin,
        targetType: "device",
        targetId: device.deviceId,
        deviceId: device.deviceId,
        protocol: "android",
        metadata: {
          platform: "android",
          channel: "pubsub",
          channels: ["android"],
          notificationType: input.notificationType,
        },
        coalesce: true,
      },
      { authSecret: input.authSecret },
    ).pipe(Effect.catch(() => Effect.void));

    if (input.notificationType === "STATUS_REPORT")
      yield* writeSystemAudit(
        input.db,
        {
          organizationId,
          action: SYSTEM_AUDIT_ACTIONS.mdmStatusReport,
          targetType: "device",
          targetId: device.deviceId,
          deviceId: device.deviceId,
          protocol: "android",
          metadata: { platform: "android", inventory: true, state: resource.state ?? null },
          // A device can deliver several status notifications in one poll
          // window; fold them the same way check-ins are folded.
          coalesce: true,
        },
        { authSecret: input.authSecret },
      ).pipe(Effect.catch(() => Effect.void));

    yield* syncDynamicGroupsForDevice(input.db, organizationId, device.deviceId, {
      now: now(),
    }).pipe(Effect.catch(() => Effect.void));

    if (device.created || (device.previousStatus !== "enrolled" && resource.state === "ACTIVE")) {
      yield* writeSystemAudit(
        input.db,
        {
          organizationId,
          action: SYSTEM_AUDIT_ACTIONS.deviceEnrolled,
          targetType: "device",
          targetId: device.deviceId,
          metadata: {
            platform: "android",
            serial: resource.serial ?? null,
            model: resource.model ?? null,
          },
        },
        { authSecret: input.authSecret },
      ).pipe(Effect.catch(() => Effect.void));
    }

    if (resource.state === "DELETED" && device.previousStatus === "enrolled") {
      yield* writeSystemAudit(
        input.db,
        {
          organizationId,
          action: SYSTEM_AUDIT_ACTIONS.deviceUnenrolled,
          targetType: "device",
          targetId: device.deviceId,
          metadata: { platform: "android", state: resource.state },
        },
        { authSecret: input.authSecret },
      ).pipe(Effect.catch(() => Effect.void));
    }

    // Policy delivery is best-effort: a Google outage must not cause Pub/Sub
    // to redeliver an enrollment forever.
    yield* syncAndroidPoliciesForTenant({
      db: input.db,
      config: input.config,
      organizationId,
      deviceIds: [device.deviceId],
    }).pipe(Effect.catch(() => Effect.void));

    return { status: "ok" as const };
  });

/**
 * Detail stored on a successfully reconciled command.
 *
 * `REQUEST_DEVICE_INFO` is the one command whose result is a value rather than
 * an acknowledgement, and the Operation is the only place Google returns it.
 * Keep the EID status JSON on the row so the device page can show it. Every
 * other command finishes without a detail.
 */
const commandResultDetail = (
  operation: Record<string, Schema.Json> | undefined,
  requestType: string,
): string | null => {
  if (requestType !== "AndroidRequestDeviceInfo") return null;
  const metadata = recordOf(operation?.["metadata"]);
  const status = metadata?.["requestDeviceInfoStatus"];

  if (status === undefined) return null;

  return JSON.stringify(status).slice(0, 2000);
};

const applyCommandNotification = (
  input: ApplyNotificationInput,
): Effect.Effect<ApplyNotificationResult, unknown> =>
  Effect.gen(function* () {
    const enterpriseName = input.enterprise.enterpriseName;

    if (!enterpriseName) return { status: "ignored" as const, reason: "enterprise has no name" };
    const record = recordOf(input.data);
    const operationName = stringOf(record?.["name"]);
    const metadata = recordOf(record?.["metadata"]);

    const deviceName =
      stringOf(metadata?.["deviceName"]) ??
      (operationName
        ? /^(enterprises\/[^/]+\/devices\/[^/]+)/.exec(operationName)?.[1]
        : undefined);

    if (!deviceName) return { status: "ignored" as const, reason: "operation has no device" };

    if (!deviceNameBelongs(enterpriseName, deviceName))
      return { status: "ignored" as const, reason: "device belongs to another enterprise" };

    const mapping = yield* input.db.query.androidDevice.findFirst({
      where: { organizationId: input.enterprise.organizationId, deviceName },
    });

    if (!mapping) return { status: "ignored" as const, reason: "device is not enrolled" };

    const status = commandStatus({ data: input.data });

    const nextStatus = COMMAND_STATUS_OUTCOME.get(status);

    if (nextStatus) {
      const candidates = yield* input.db
        .select()
        .from(schema.deviceCommand)
        .where(
          and(
            eq(schema.deviceCommand.deviceId, mapping.deviceId),
            eq(schema.deviceCommand.status, "sent"),
          ),
        )
        .orderBy(desc(schema.deviceCommand.createdAt))
        .limit(20);

      // Match the AMAPI operation stored when the command was queued. Falling
      // back to the newest sent command is only safe when the payload has no
      // operation (legacy rows); otherwise two in-flight commands could swap
      // their results.
      const commandPayloadSchema = Schema.Struct({
        operationName: Schema.optional(Schema.String),
      });

      const commandPayload = (candidate: (typeof candidates)[number]) =>
        Option.getOrUndefined(Schema.decodeUnknownOption(commandPayloadSchema)(candidate.payload));

      const command = operationName
        ? (candidates.find(
            (candidate) => commandPayload(candidate)?.operationName === operationName,
          ) ??
          candidates.find((candidate) => commandPayload(candidate)?.operationName === undefined))
        : candidates[0];

      if (command) {
        yield* input.db
          .update(schema.deviceCommand)
          .set({
            status: nextStatus,
            dedupeKey: null,
            resultStatus: status ?? null,
            resultDetail:
              nextStatus === "failed"
                ? describeAndroidError(input.data)
                : commandResultDetail(record, command.requestType),
            updatedAt: now(),
          })
          .where(eq(schema.deviceCommand.id, command.id));

        if (nextStatus === "failed") {
          yield* writeSystemAudit(
            input.db,
            {
              organizationId: input.enterprise.organizationId,
              action: SYSTEM_AUDIT_ACTIONS.commandFailed,
              targetType: "device_command",
              targetId: command.id,
              deviceId: mapping.deviceId,
              protocol: "android",
              metadata: {
                platform: "android",
                deviceId: mapping.deviceId,
                requestType: command.requestType,
                resultStatus: status ?? null,
              },
            },
            { authSecret: input.authSecret },
          ).pipe(Effect.catch(() => Effect.void));
        } else if (nextStatus === "succeeded" && command.status !== "succeeded") {
          yield* writeSystemAudit(
            input.db,
            {
              organizationId: input.enterprise.organizationId,
              action: SYSTEM_AUDIT_ACTIONS.mdmCommandResult,
              targetType: "device_command",
              targetId: command.id,
              deviceId: mapping.deviceId,
              protocol: "android",
              metadata: {
                platform: "android",
                deviceId: mapping.deviceId,
                requestType: command.requestType,
                resultStatus: status ?? null,
              },
            },
            { authSecret: input.authSecret },
          ).pipe(Effect.catch(() => Effect.void));
        }
      }
    }

    yield* input.db
      .update(schema.device)
      .set({ lastSeenAt: now() })
      .where(eq(schema.device.id, mapping.deviceId));

    return { status: "ok" as const };
  });

/**
 * Verify and apply one Pub/Sub push. Delivery is idempotent by
 * `message.messageId`, and every device/enterprise lookup is tenant-scoped by
 * the Google enterprise name in the payload.
 */
export const handleAndroidPubSub = (input: {
  readonly db: EnterpriseDb;
  readonly config?: AndroidDeliveryConfig;
  readonly authSecret?: string;
  readonly origin: string;
  readonly authorization?: string;
  readonly body: Schema.Json;
  readonly planLimits?: PlanLimitsConfig;
}): Effect.Effect<
  AndroidPubSubResult,
  AndroidDeliveryError,
  AndroidManagement | PubSubOidcVerifier
> =>
  Effect.gen(function* () {
    const config = input.config;

    if (!isAndroidConfigured(config)) return yield* Effect.fail(notConfigured());
    const token = bearerToken(input.authorization);

    if (!token)
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "unauthorized",
          message: "Missing Pub/Sub OIDC bearer token.",
        }),
      );
    const verifier = yield* PubSubOidcVerifier;

    yield* verifier.verify(token).pipe(
      Effect.mapError(
        (cause) =>
          new AndroidDeliveryError({
            kind: "unauthorized",
            message: "Pub/Sub authentication failed.",
            cause,
          }),
      ),
    );

    const push = yield* decodePubSubPush(input.body).pipe(
      Effect.mapError(
        (cause) =>
          new AndroidDeliveryError({
            kind: "invalid_payload",
            message: cause.message,
            cause,
          }),
      ),
    );

    const notificationType = push.notificationType ?? "UNKNOWN";
    const enterpriseName = enterpriseNameFromResource(push.data);

    if (!enterpriseName)
      return {
        status: "ignored",
        type: notificationType,
        reason: "no enterprise resource",
      } satisfies AndroidPubSubResult;

    const enterprise = yield* findAndroidEnterpriseByName(input.db, enterpriseName);

    if (!enterprise || enterprise.status !== "active")
      return {
        status: "ignored",
        type: notificationType,
        reason: "enterprise is not active",
      } satisfies AndroidPubSubResult;

    const seen = yield* input.db.query.androidPubSubMessage.findFirst({
      where: { messageId: push.messageId },
    });

    if (seen) return { status: "duplicate", type: notificationType } satisfies AndroidPubSubResult;

    const context: ApplyNotificationInput = {
      db: input.db,
      config,
      authSecret: input.authSecret,
      enterprise,
      notificationType,
      data: push.data,
      planLimits: input.planLimits,
    };

    const result: ApplyNotificationResult =
      notificationType === "ENROLLMENT" || notificationType === "STATUS_REPORT"
        ? yield* applyDeviceNotification(context)
        : notificationType === "COMMAND"
          ? yield* applyCommandNotification(context)
          : { status: "ok" };

    // Record the ledger only after the notification has been applied. Pub/Sub
    // is at-least-once: if the apply fails we must not mark the message seen,
    // otherwise the retry is discarded and the event is lost forever.
    yield* input.db.insert(schema.androidPubSubMessage).ignore().values({
      messageId: push.messageId,
      organizationId: enterprise.organizationId,
      notificationType,
      receivedAt: now(),
    });

    if (result.status === "ok") {
      yield* ignoreDbFailure(
        updateAndroidEnterprise(input.db, enterprise.organizationId, {
          lastSyncedAt: now(),
          lastError: null,
        }),
      );
    }

    return {
      status: result.status,
      type: notificationType,
      reason: result.reason,
    } satisfies AndroidPubSubResult;
  }).pipe(mapAndroidError);

/**
 * Map a device action onto a Google command. Returns null for a plain sync and
 * for actions that are not AMAPI commands. Ownership can be relinquished with
 * a command; the unenrolment endpoint instead deletes the device resource, so
 * it never passes through here.
 */
export const androidCommandForAction = (
  action: string,
): { readonly type: string; readonly requestType: string } | null => {
  switch (action) {
    case "wipe":
      return { type: "WIPE", requestType: "AndroidWipe" };
    case "restart":
      return { type: "REBOOT", requestType: "AndroidReboot" };
    case "lock":
      return { type: "LOCK", requestType: "AndroidLock" };
    case "start-lost-mode":
      return { type: "START_LOST_MODE", requestType: "AndroidStartLostMode" };
    case "stop-lost-mode":
      return { type: "STOP_LOST_MODE", requestType: "AndroidStopLostMode" };
    case "reset-password":
      return { type: "RESET_PASSWORD", requestType: "AndroidResetPassword" };
    case "clear-app-data":
      return { type: "CLEAR_APP_DATA", requestType: "AndroidClearAppData" };
    case "request-device-info":
      return { type: "REQUEST_DEVICE_INFO", requestType: "AndroidRequestDeviceInfo" };
    case "relinquish-ownership":
      return { type: "RELINQUISH_OWNERSHIP", requestType: "AndroidRelinquishOwnership" };
    default:
      return null;
  }
};

/** What a lost device shows on its lock screen. */
const ANDROID_LOST_MODE_MESSAGE =
  "This device has been reported lost. Please return it to your organisation.";

/**
 * Password classes for a temporary Android password. The alphabet omits
 * look-alike characters (0/O, 1/l/I) because the password is entered by hand.
 */
const PASSWORD_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";

const PASSWORD_LOWER = "abcdefghijkmnopqrstuvwxyz";

const PASSWORD_DIGITS = "23456789";

const PASSWORD_ALPHABET = `${PASSWORD_UPPER}${PASSWORD_LOWER}${PASSWORD_DIGITS}`;

const randomCharacter = (alphabet: string): string => {
  const [value] = crypto.getRandomValues(new Uint32Array(1));

  return alphabet[value % alphabet.length];
};

/**
 * A temporary password for `RESET_PASSWORD`.
 *
 * The value only exists for the lifetime of the request: it is passed straight
 * to Google and is never written to the command payload, the audit log or the
 * API response. Three required character classes satisfy the stricter device
 * password policies, and the result is shuffled so the classes are not
 * predictable by position.
 */
const generateAndroidPassword = (length = 16): string => {
  const characters = [
    randomCharacter(PASSWORD_UPPER),
    randomCharacter(PASSWORD_LOWER),
    randomCharacter(PASSWORD_DIGITS),
  ];

  while (characters.length < length) characters.push(randomCharacter(PASSWORD_ALPHABET));

  for (let index = characters.length - 1; index > 0; index--) {
    const swap = Number(crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1));
    [characters[index], characters[swap]] = [characters[swap], characters[index]];
  }

  return characters.join("");
};

/**
 * Flags Mattrax always sends with a password reset. `REQUIRE_ENTRY` stops
 * another administrator from replacing the password before the user has seen
 * it, and `LOCK_NOW` returns the device to the lock screen so the new password
 * is needed immediately.
 */
const ANDROID_RESET_PASSWORD_FLAGS = ["REQUIRE_ENTRY", "LOCK_NOW"] as const;

/**
 * Issue a direct AMAPI command and record it for the device timeline.
 *
 * The operation name is stored on the command so the `COMMAND` Pub/Sub
 * notification can reconcile the terminal status onto the right row. Command
 * payloads never carry secrets: a reset password is generated, sent to Google
 * and dropped.
 */
export const issueAndroidCommand = (input: {
  readonly db: EnterpriseDb;
  readonly config?: AndroidDeliveryConfig;
  readonly organizationId: string;
  readonly device: { readonly id: string; readonly dmIdentifier: string | null };
  readonly action: string;
}): Effect.Effect<
  { readonly operationName: string; readonly commandId: string } | null,
  AndroidDeliveryError,
  AndroidManagement
> =>
  Effect.gen(function* () {
    const config = input.config;

    if (!isAndroidConfigured(config)) return yield* Effect.fail(notConfigured());
    const command = androidCommandForAction(input.action);

    if (!command) return null;
    const enterprise = yield* loadAndroidEnterprise(input.db, input.organizationId);

    if (enterprise?.status !== "active" || !enterprise.enterpriseName)
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "conflict",
          message: "Android Enterprise is not connected for this tenant.",
        }),
      );

    if (
      !input.device.dmIdentifier ||
      !deviceNameBelongs(enterprise.enterpriseName, input.device.dmIdentifier)
    )
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "invalid_payload",
          message: "This device is not linked to the tenant's Android enterprise.",
        }),
      );
    const android = yield* AndroidManagement;
    const timestamp = now();
    const dedupePayload = { type: command.type };

    const dedupeKey = yield* commandDedupeKeyEffect(command.requestType, dedupePayload);

    // Android issues commands directly, so de-duplicate before the network
    // call: a double-clicked erase must not reach Google twice. Rows queued
    // before the lifecycle columns existed have no key, so the request type is
    // a safe fallback for these singleton actions.
    const active = yield* input.db
      .select()
      .from(schema.deviceCommand)
      .where(
        and(
          eq(schema.deviceCommand.deviceId, input.device.id),
          inArray(schema.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES]),
        ),
      )
      .orderBy(desc(schema.deviceCommand.createdAt))
      .limit(50);

    const duplicate = active
      .filter((row) => !commandIsExpired(row, timestamp))
      .find((row) => row.dedupeKey === dedupeKey || row.requestType === command.requestType);

    if (duplicate) {
      const payload = Schema.is(Schema.JsonObject)(duplicate.payload) ? duplicate.payload : {};
      const operationName = payload.operationName;

      return {
        operationName: Schema.is(Schema.String)(operationName) ? operationName : "",
        commandId: duplicate.id,
      };
    }

    // A wipe erases the device, so every other pending action is moot. Cancel
    // them before issuing it rather than leaving work that can never run.
    if (command.requestType === "AndroidWipe" && active.length > 0)
      yield* input.db
        .update(schema.deviceCommand)
        .set({
          status: "cancelled",
          dedupeKey: null,
          resultStatus: RECONCILED_RESULT_STATUS,
          resultDetail: "The device was wiped before this action could run.",
          updatedAt: timestamp,
        })
        .where(
          inArray(
            schema.deviceCommand.id,
            active.map((row) => row.id),
          ),
        );

    const extra: Mutable<Omit<IssueCommandParams, "type">> = {};

    switch (command.requestType) {
      case "AndroidResetPassword":
        extra.newPassword = generateAndroidPassword();
        extra.resetPasswordFlags = [...ANDROID_RESET_PASSWORD_FLAGS];
        break;
      case "AndroidStartLostMode":
        // Google requires at least one field other than the organisation name
        // to put a device into lost mode.
        extra.startLostModeParams = {
          lostMessage: { defaultMessage: ANDROID_LOST_MODE_MESSAGE },
        };
        break;
      case "AndroidStopLostMode":
        extra.stopLostModeParams = {};
        break;
      case "AndroidRequestDeviceInfo":
        // EID is the only device information AMAPI exposes today.
        extra.requestDeviceInfoParams = { deviceInfo: "EID" };
        break;
      case "AndroidClearAppData": {
        // The compiled policy is exactly what Google applies, so it includes
        // apps declared by policy fragments as well as catalogue assignments.
        // Reading only `assignedAndroidApplications` would silently skip the
        // fragment-declared apps the confirmation promises to clear.
        const compiled = yield* compileEffectiveAndroidPolicy({
          db: input.db,
          organizationId: input.organizationId,
          deviceId: input.device.id,
        });

        const packageNames = managedAndroidPackageNames(compiled.policy);

        if (packageNames.length === 0)
          return yield* Effect.fail(
            new AndroidDeliveryError({
              kind: "invalid_payload",
              message: "This device has no managed Android applications whose data can be cleared.",
            }),
          );

        extra.clearAppsDataParams = { packageNames };
        break;
      }

      default:
        break;
    }

    const commandId = crypto.randomUUID();

    const operation = yield* android
      .issueCommand({
        deviceName: input.device.dmIdentifier,
        type: command.type,
        ...extra,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new AndroidDeliveryError({
              kind: "upstream",
              message: `Could not send the Android command: ${describeAndroidError(cause)}`,
              cause,
            }),
        ),
      );

    yield* input.db.insert(schema.deviceCommand).values({
      id: commandId,
      organizationId: input.organizationId,
      deviceId: input.device.id,
      requestType: command.requestType,
      payload: { type: command.type, operationName: operation.operationName },
      status: "sent",
      dedupeKey,
      expiresAt: deviceCommandExpiresAt(command.requestType, timestamp),
      resultStatus: null,
      resultDetail: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return { operationName: operation.operationName, commandId };
  }).pipe(mapAndroidError);

export type AndroidUnenrollResult = {
  readonly deviceId: string;
};

/**
 * Retire an Android device by deleting its Google Enterprise record.
 *
 * `enterprises.devices.delete` is the only AMAPI path that ends management
 * without the device's cooperation: Google removes Android Device Policy and
 * the work data it manages, and the device row becomes `unenrolled`. Active
 * commands are cancelled first so a queued wipe or lock cannot fire during
 * retirement. Deleting a device Google has already removed is treated as
 * success so a retried unenroll is idempotent.
 */
export const unenrollAndroidDevice = (input: {
  readonly db: EnterpriseDb;
  readonly config?: AndroidDeliveryConfig;
  readonly organizationId: string;
  readonly device: { readonly id: string; readonly dmIdentifier: string | null };
}): Effect.Effect<AndroidUnenrollResult, AndroidDeliveryError, AndroidManagement> =>
  Effect.gen(function* () {
    const config = input.config;

    if (!isAndroidConfigured(config)) return yield* Effect.fail(notConfigured());
    const enterprise = yield* loadAndroidEnterprise(input.db, input.organizationId);

    if (enterprise?.status !== "active" || !enterprise.enterpriseName)
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "conflict",
          message: "Android Enterprise is not connected for this tenant.",
        }),
      );

    if (
      !input.device.dmIdentifier ||
      !deviceNameBelongs(enterprise.enterpriseName, input.device.dmIdentifier)
    )
      return yield* Effect.fail(
        new AndroidDeliveryError({
          kind: "invalid_payload",
          message: "This device is not linked to the tenant's Android enterprise.",
        }),
      );
    const android = yield* AndroidManagement;

    yield* android.deleteDevice({ deviceName: input.device.dmIdentifier }).pipe(
      Effect.catchIf(
        (cause) => cause instanceof GoogleApiError && cause.status === 404,
        () => Effect.void,
      ),
      Effect.mapError(
        (cause) =>
          new AndroidDeliveryError({
            kind: "upstream",
            message: `Could not unenroll the Android device: ${describeAndroidError(cause)}`,
            cause,
          }),
      ),
    );

    const timestamp = now();

    yield* input.db
      .update(schema.device)
      .set({ status: "unenrolled" })
      .where(
        and(
          eq(schema.device.id, input.device.id),
          eq(schema.device.organizationId, input.organizationId),
        ),
      );

    yield* input.db
      .update(schema.androidDevice)
      .set({ state: "DELETED", updatedAt: timestamp })
      .where(
        and(
          eq(schema.androidDevice.deviceId, input.device.id),
          eq(schema.androidDevice.organizationId, input.organizationId),
        ),
      );

    yield* input.db
      .update(schema.deviceCommand)
      .set({
        status: "cancelled",
        dedupeKey: null,
        resultStatus: RECONCILED_RESULT_STATUS,
        resultDetail: "The device was unenrolled before the command was delivered.",
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(schema.deviceCommand.deviceId, input.device.id),
          inArray(schema.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES]),
        ),
      );

    return { deviceId: input.device.id };
  }).pipe(mapAndroidError);

/** Prune the Pub/Sub idempotency ledger during daily maintenance. */
export const pruneAndroidPubSubMessages = (db: EnterpriseDb, before: Date) =>
  db.delete(schema.androidPubSubMessage).where(lt(schema.androidPubSubMessage.receivedAt, before));

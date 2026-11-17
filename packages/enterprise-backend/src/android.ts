import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { Data, Effect, Option, Schema } from "effect";
import {
  AndroidManagement,
  androidPolicyHash,
  compileAndroidPolicy,
  decodePubSubPush,
  androidPolicyIdForHash,
  bearerToken,
  commandStatus,
  isAndroidPackageName,
  mergeAssignedAndroidApplications,
  verifyPubSubOidcToken,
  type AndroidPolicyConfiguration,
} from "@mattrax/dm-android";
import {
  deviceLimitForOrganization,
  replaceDeviceApplications,
  schema,
  type EnterpriseDb,
  type PlanLimitsConfig,
} from "@mattrax/enterprise-core";
import { selectInstaller, shouldApplyReportedName } from "@mattrax/enterprise-domain";

/** Command notification statuses mapped to the device command lifecycle. */
const COMMAND_STATUS_OUTCOME = new Map<string | undefined, "succeeded" | "failed" | "sent">([
  ["COMPLETED", "succeeded"],
  ["FAILED", "failed"],
  ["CANCELLED", "failed"],
  ["PENDING", "sent"],
]);

import {
  ACTIVE_COMMAND_STATUSES,
  commandDedupeKey,
  commandIsExpired,
  deviceCommandExpiresAt,
  resolveEffectivePolicyForDevice,
  syncDynamicGroupsForDevice,
  writeSystemAudit,
  SYSTEM_AUDIT_ACTIONS,
} from "@mattrax/management-backend-enterprise";
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
 * Status reporting Mattrax always requests. Google only reports
 * `softwareInfo` and `applicationReports` when the applied policy opts in, so
 * without this baseline every Android device would show no OS build, no patch
 * level and no installed applications. An explicit tenant value still wins,
 * which lets an operator switch reporting off.
 */
const STATUS_REPORTING_BASELINE = {
  softwareInfoEnabled: true,
  applicationReportsEnabled: true,
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
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\s+/g, " ")
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

export type AndroidEnrollmentTokenResult = {
  readonly value: string;
  readonly qrCode?: string;
  readonly policyName?: string;
  readonly expiresAt?: string;
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

    const token = yield* android
      .createEnrollmentToken({
        enterpriseName: row.enterpriseName,
        policyName: config.defaultPolicyId ?? DEFAULT_ANDROID_POLICY_ID,
        additionalData: input.organizationId,
        oneTimeOnly: true,
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

    const result: Mutable<AndroidEnrollmentTokenResult> = { value: token.value };

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

function androidDeviceStatus(value: string | undefined): "enrolling" | "enrolled" | "unenrolled" {
  switch (value) {
    case "ACTIVE":
      return "enrolled";
    case "DELETED":
    case "DISABLED":
    case "LOST":
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
    const direct = yield* db
      .select({ applicationId: schema.applicationDevice.applicationId })
      .from(schema.applicationDevice)
      .where(eq(schema.applicationDevice.deviceId, input.deviceId));

    const groups = yield* db
      .select({ groupId: schema.groupDevice.groupId })
      .from(schema.groupDevice)
      .where(eq(schema.groupDevice.deviceId, input.deviceId));

    const groupApplications = groups.length
      ? yield* db
          .select({ applicationId: schema.applicationGroup.applicationId })
          .from(schema.applicationGroup)
          .where(
            inArray(
              schema.applicationGroup.groupId,
              groups.map((group) => group.groupId),
            ),
          )
      : [];

    const ids = [
      ...new Set([
        ...direct.map((row) => row.applicationId),
        ...groupApplications.map((row) => row.applicationId),
      ]),
    ];

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

    const effective = yield* resolveEffectivePolicyForDevice(input.db, {
      id: input.device.id,
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
      (configuration) => ({ kind: configuration.kind, data: configuration.data }),
    );

    // Managed Google Play delivery is the policy's `applications` array. Assigned
    // catalogue apps are merged underneath the tenant's own policy fragments, so
    // an explicit `installType` or managed configuration always wins.
    const assignedApplications = yield* assignedAndroidApplications(input.db, {
      organizationId: input.organizationId,
      deviceId: input.device.id,
    });

    for (const application of assignedApplications) {
      if (!isAndroidPackageName(application.packageName))
        yield* Effect.logWarning(
          `Android application ${application.applicationId} has an invalid package name and was not added to the policy for ${input.device.id}`,
        );
    }

    const compiled = yield* Effect.tryPromise({
      try: async () => {
        // Mattrax needs software and application status to inventory a
        // device, and Google disables both by default. The baseline sits
        // underneath the tenant's own reporting settings, so an operator can
        // still turn either off (at the cost of that inventory).
        const policy = mergeAssignedAndroidApplications(
          withStatusReporting(compileAndroidPolicy(configurations)),
          assignedApplications,
        );

        return { policy, hash: await androidPolicyHash(policy) };
      },
      catch: (cause) =>
        new AndroidDeliveryError({
          kind: "invalid_payload",
          message: `Could not compile the Android policy: ${describeAndroidError(cause)}`,
          cause,
        }),
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
              inArray(schema.device.id, scopedIds),
            )
          : and(
              eq(schema.device.organizationId, input.organizationId),
              eq(schema.device.proto, "android"),
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
      if (outcome.status === "updated") updated += 1;
      else if (outcome.status === "skipped") skipped += 1;
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
            action: "android.policy_sync_failed",
            targetType: "device",
            targetId: outcome.device.id,
            metadata: { message: error.message },
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
            resultDetail: nextStatus === "failed" ? describeAndroidError(input.data) : null,
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
              metadata: { deviceId: mapping.deviceId, requestType: command.requestType },
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
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  readonly planLimits?: PlanLimitsConfig;
}): Effect.Effect<AndroidPubSubResult, AndroidDeliveryError, AndroidManagement> =>
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
    yield* verifyPubSubOidcToken(token, {
      audience:
        config.pubsubAudience ?? `${input.origin.replace(/\/+$/, "")}/api/v1/android/pubsub`,
      serviceAccountEmail: config.serviceAccount.clientEmail,
      jwksUri: config.jwksUri,
      fetch: input.fetch,
      now: input.now,
    }).pipe(
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

/** Map a device action onto a Google command. Returns null for a plain sync. */
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
    default:
      return null;
  }
};

/** Issue a direct AMAPI command and record it for the device timeline. */
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

    const dedupeKey = yield* Effect.promise(() =>
      commandDedupeKey(command.requestType, dedupePayload),
    );

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
          resultStatus: "Reconciled",
          resultDetail: "The device was wiped before this action could run.",
          updatedAt: timestamp,
        })
        .where(
          inArray(
            schema.deviceCommand.id,
            active.map((row) => row.id),
          ),
        );

    const commandId = crypto.randomUUID();

    const operation = yield* android
      .issueCommand({
        deviceName: input.device.dmIdentifier,
        type: command.type,
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

/** Prune the Pub/Sub idempotency ledger during daily maintenance. */
export const pruneAndroidPubSubMessages = (db: EnterpriseDb, before: Date) =>
  db.delete(schema.androidPubSubMessage).where(lt(schema.androidPubSubMessage.receivedAt, before));

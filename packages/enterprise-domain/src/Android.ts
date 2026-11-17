import { Schema } from "effect";
import { NullableString } from "./Errors.js";

export const PlatformEnrollment = Schema.Union([
  Schema.Struct({ error: Schema.String }),
  Schema.Struct({ profile: Schema.String }),
  Schema.Literal("available"),
  /** The platform toggle is on, but delivery is not wired up in this build. */
  Schema.Literal("unavailable"),
]);

export type PlatformEnrollment = typeof PlatformEnrollment.Type;

/** Android Enterprise signup/delivery state exposed to administrators. */
export const AndroidEnterpriseStatus = Schema.Literals(["pending", "active", "error", "disabled"]);

export type AndroidEnterpriseStatus = typeof AndroidEnterpriseStatus.Type;

/**
 * Tenant-facing Android Enterprise configuration.
 *
 * `configured` describes the deployment (Google credentials are present);
 * `status` describes this tenant's signup. An endpoint that needs Google access
 * fails with `EnterpriseNotConfigured` when `configured` is false.
 */
export const AndroidEnterpriseInfo = Schema.Struct({
  configured: Schema.Boolean,
  status: AndroidEnterpriseStatus,
  /** `enterprises/{enterpriseId}` once signup completes. */
  enterpriseName: Schema.optional(NullableString),
  pubsubTopic: Schema.optional(NullableString),
  pubsubSubscription: Schema.optional(NullableString),
  serviceAccountEmail: Schema.optional(NullableString),
  lastError: Schema.optional(NullableString),
  lastSyncedAt: Schema.optional(NullableString),
  /** Android devices known to this tenant and linked to the enterprise. */
  deviceCount: Schema.Number,
  /** True when the public enrollment page can issue an enrollment token. */
  available: Schema.Boolean,
  createdAt: Schema.optional(NullableString),
  updatedAt: Schema.optional(NullableString),
});

export type AndroidEnterpriseInfo = typeof AndroidEnterpriseInfo.Type;

/** Starts the Google-hosted Android Enterprise signup flow. */
export const AndroidSignupResponse = Schema.Struct({ url: Schema.String });

export type AndroidSignupResponse = typeof AndroidSignupResponse.Type;

export const PatchTenantAndroidRequest = Schema.Struct({
  /**
   * `false` disables Android delivery for the tenant without deleting the
   * Google enterprise. `true` re-enables an existing enterprise, or returns to
   * pending if signup never completed.
   */
  enabled: Schema.optional(Schema.Boolean),
});

export type PatchTenantAndroidRequest = typeof PatchTenantAndroidRequest.Type;

/**
 * Public enrollment details for an Android device.
 *
 * Google returns an enrollment token plus a QR payload. There is no documented
 * universal deep link for AMAPI enrollment: consumers scan the QR code from the
 * setup wizard, or enter `afw#setup` and then the token value manually.
 */
export const AndroidEnrollment = Schema.Union([
  Schema.Struct({ error: Schema.String }),
  Schema.Struct({
    /** JSON string to encode as a QR code. */
    qrCode: Schema.optional(NullableString),
    /** Manual token value used after `afw#setup`. */
    enrollmentToken: Schema.String,
    policyName: Schema.optional(NullableString),
    expiresAt: Schema.optional(NullableString),
  }),
  /** No enterprise is connected; the page shows setup instructions. */
  Schema.Literal("unavailable"),
]);

export type AndroidEnrollment = typeof AndroidEnrollment.Type;

/** Result of an explicit Android policy sync. */
export const AndroidSyncResponse = Schema.Struct({
  devices: Schema.Number,
  updated: Schema.Number,
  skipped: Schema.Number,
  failed: Schema.Number,
});

export type AndroidSyncResponse = typeof AndroidSyncResponse.Type;

/** Apple Business Manager credential/sync state for one tenant. */

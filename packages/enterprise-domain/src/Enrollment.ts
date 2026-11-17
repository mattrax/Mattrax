import { EnrollmentQuestion } from "./attributes.js";
import { HttpApiSchema } from "effect/http-api";
import { Schema } from "effect";
import { AndroidEnrollment } from "./Android.js";
import { NullableString } from "./Errors.js";
import { PlatformEnrollment } from "./Android.js";
import { ScepRetiredCaState } from "./Device.js";
import { TenantBranding } from "./Tenant.js";
import { CredentialLevel } from "./Device.js";

/**
 * Windows enrollment is driven by a tenant-scoped discovery URL
 * (`/mdm/windows/discovery?tenant=<signed token>`). The token identifies the
 * organization, so every tenant gets its own link. `expiresAt` tells the UI how
 * long the current link stays valid; reloading the enrollment page mints a new
 * one.
 */
export const WindowsEnrollment = Schema.Union([
  Schema.Struct({ error: Schema.String }),
  Schema.Struct({
    discoveryUrl: Schema.String,
    tenantScoped: Schema.Literal(true),
    expiresAt: Schema.optional(Schema.String),
    /** Autopilot/Entra state so the public page can explain the flow. */
    autopilot: Schema.optional(
      Schema.Struct({
        configured: Schema.Boolean,
        federated: Schema.Boolean,
        authServiceUrl: Schema.optional(NullableString),
        realm: Schema.optional(NullableString),
      }),
    ),
  }),
]);

export type WindowsEnrollment = typeof WindowsEnrollment.Type;

/** Deployment plan device allowance shown on the public enrollment page. */
export const EnrollmentDeviceLimit = Schema.Struct({
  reached: Schema.Boolean,
  plan: Schema.String,
  /** Omitted when the plan is unlimited. */
  limit: Schema.optional(Schema.Number),
  /** Omitted when the plan is unlimited. */
  used: Schema.optional(Schema.Number),
});

export type EnrollmentDeviceLimit = typeof EnrollmentDeviceLimit.Type;

export const EnrollmentResponse = Schema.Union([
  Schema.Struct({
    name: Schema.String,
    branding: TenantBranding,
    authenticated: Schema.Literal(false),
  }),
  Schema.Struct({
    name: Schema.String,
    branding: TenantBranding,
    authenticated: Schema.Literal(true),
    apple: PlatformEnrollment,
    windows: WindowsEnrollment,
    android: AndroidEnrollment,
    assetTag: Schema.Boolean,
    /** Custom questions the enrolling person must answer before enrolling. */
    questions: Schema.optional(Schema.Array(EnrollmentQuestion)),
    deviceLimit: Schema.optional(EnrollmentDeviceLimit),
  }),
]);

export type EnrollmentResponse = typeof EnrollmentResponse.Type;

export const EnrollmentQuery = {
  code: Schema.optional(Schema.String),
  /**
   * The platform the device is enrolling. Optional because the endpoint
   * returns every platform; when omitted the server infers it from the
   * User-Agent for diagnostics.
   */
  platform: Schema.optional(Schema.Literals(["apple", "win", "android"])),
};

/** Public mobileconfig download. The body is a CMS-signed Apple property list. */
export const AppleEnrollmentProfileResponse = Schema.Uint8Array.pipe(
  HttpApiSchema.asUint8Array({ contentType: "application/x-apple-aspen-config" }),
);

export const EnrollmentAttemptPlatform = Schema.Literals(["apple", "win", "android", "unknown"]);

export type EnrollmentAttemptPlatform = typeof EnrollmentAttemptPlatform.Type;

export const EnrollmentAttemptOutcome = Schema.Literals([
  "ok",
  "bad_code",
  "disabled",
  "limit",
  "no_apns",
  "scep_error",
  "other",
]);

export type EnrollmentAttemptOutcome = typeof EnrollmentAttemptOutcome.Type;

export const EnrollmentAttempt = Schema.Struct({
  id: Schema.String,
  enrollmentId: Schema.String,
  platform: EnrollmentAttemptPlatform,
  outcome: EnrollmentAttemptOutcome,
  detail: Schema.optional(NullableString),
  createdAt: Schema.String,
});

export type EnrollmentAttempt = typeof EnrollmentAttempt.Type;

export const EnrollmentAttemptsResponse = Schema.Struct({
  attempts: Schema.Array(EnrollmentAttempt),
});

export type EnrollmentAttemptsResponse = typeof EnrollmentAttemptsResponse.Type;

export const TenantEnrollmentInfo = Schema.Struct({
  id: Schema.String,
  code: Schema.optional(NullableString),
  enabledApple: Schema.Boolean,
  enabledWindows: Schema.Boolean,
  enabledAndroid: Schema.Boolean,
  enabledAssetTag: Schema.Boolean,
  maxDevices: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  /**
   * Tenant-scoped Windows discovery URL with a signed tenant token. Omitted
   * when Windows enrollment is disabled or the deployment has no signing
   * secret; the public enrollment page mints the same URL on demand.
   */
  windowsDiscoveryUrl: Schema.optional(Schema.String),
  windowsDiscoveryExpiresAt: Schema.optional(Schema.String),
  /** True when this tenant can issue Android enrollment tokens right now. */
  androidAvailable: Schema.optional(Schema.Boolean),
  /** `enterprises/{enterpriseId}` when Android Enterprise is connected. */
  androidEnterpriseName: Schema.optional(NullableString),
});

export type TenantEnrollmentInfo = typeof TenantEnrollmentInfo.Type;

/**
 * The tenant's SCEP CA as shown to administrators. The private key is never
 * returned; the fingerprint is enough to verify which CA a device trusts.
 */
export const TenantScepCaInfo = Schema.Struct({
  configured: Schema.Boolean,
  /** Tenant-scoped SCEP endpoint embedded in enrollment profiles. */
  scepUrl: Schema.String,
  source: Schema.optional(Schema.NullOr(Schema.Literals(["generated", "imported"]))),
  commonName: Schema.optional(NullableString),
  /** Lowercase hex SHA-256 of the CA certificate DER. */
  fingerprintSha256: Schema.optional(NullableString),
  serialNumber: Schema.optional(NullableString),
  notBefore: Schema.optional(NullableString),
  notAfter: Schema.optional(NullableString),
  /** Whole days until expiry; null before a CA exists. */
  daysLeft: Schema.optional(Schema.NullOr(Schema.Number)),
  level: Schema.optional(CredentialLevel),
  /** True once the CA is inside the automatic-rotation window. */
  rotationDue: Schema.optional(Schema.Boolean),
  rotationDueAt: Schema.optional(NullableString),
  /** Predecessor CAs still verifying identities issued before rotation. */
  retiring: Schema.optional(Schema.Array(ScepRetiredCaState)),
  unattributedIdentities: Schema.optional(Schema.Number),
  untrustedIdentities: Schema.optional(Schema.Number),
  createdAt: Schema.optional(NullableString),
  rotatedAt: Schema.optional(NullableString),
});

export type TenantScepCaInfo = typeof TenantScepCaInfo.Type;

/**
 * Upload a CA minted outside Mattrax. The key must be an unencrypted PKCS#8 RSA
 * private key and must match the certificate.
 */
export const ImportTenantScepCaRequest = Schema.Struct({
  certificatePem: Schema.String,
  privateKeyPem: Schema.String,
});

export const PatchTenantEnrollmentRequest = Schema.Struct({
  code: Schema.optional(NullableString),
  enabledApple: Schema.optional(Schema.Boolean),
  enabledWindows: Schema.optional(Schema.Boolean),
  enabledAndroid: Schema.optional(Schema.Boolean),
  enabledAssetTag: Schema.optional(Schema.Boolean),
  maxDevices: Schema.optional(
    Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1_000_000 })),
  ),
});

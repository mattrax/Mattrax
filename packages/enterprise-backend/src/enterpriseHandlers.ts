import { Cause, Context, Effect, Exit, Match, Option, Predicate, Schema } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { HttpServerResponse } from "effect/http";
import {
  applicationKey,
  EnterpriseBadRequest,
  EnterpriseConflict,
  EnterpriseDbError,
  EnterpriseForbidden,
  EnterpriseInternal,
  EnterprisePermissionDenied,
  BUILT_IN_ROLE_PERMISSIONS,
  BUILT_IN_ROLE_LABELS,
  BUILT_IN_TENANT_ROLES,
  hasPermission,
  isBuiltInTenantRole,
  EnterpriseLastTenantUser,
  EnterpriseNotFound,
  EnterpriseNotConfigured,
  EnterpriseR2FileNotFound,
  EnterpriseR2InternalError,
  EnterpriseStripeError,
  EnterpriseTenantHasMembers,
  EnterpriseTenantTeardownFailed,
  EnterpriseUpstreamError,
  EnterpriseService,
  enterpriseApi,
  TENANT_EXPORT_MAX_ROWS,
  TENANT_EXPORT_VERSION,
  TENANT_IMPORT_MAX_BYTES,
  type DevicePreRegistrationImportResponse,
  type EnterpriseAuth,
  type DevicePreRegistrationImportRow,
  type TenantImportRequest,
  type TenantImportResponse,
  policyApplicationKey,
  normalizeBrandColor,
  resolveTenantBranding,
  validateTenantBranding,
  dynamicGroupRulesProblem,
  isMacOsDevice,
  DEVICE_SECURITY_INFO_STALE_AFTER_DAYS,
  defaultOverviewWidgets,
  defaultErrorCode,
  applicationsInventoryStale,
  deviceCommandStatusLabel,
  deviceActionUnavailableReason,
  deviceAvailableActions,
  diagnoseError,
  errorDiagnostic,
  evaluateDeviceQuery,
  normalizeDeviceCommandStatus,
  type DashboardQueryRequest,
  DeviceActionName,
  DashboardWidgetType,
  WEBHOOK_EVENT_TYPES,
  webhookUrlProblem,
  DynamicGroupRules,
  DeviceManagementApp,
  type StepUpAction,
  type TenantScepCaInfo,
  type WebhookTestResponse,
} from "@mattrax/enterprise-domain";
import { makeEffectStripeClient } from "@mattrax/effect-stripe";
import type { StripeClientLike, StripeCustomer } from "@mattrax/effect-stripe";
import {
  authCredentials,
  authIdentifiers,
  authPending,
  authSessions,
  countOrganizationDevices,
  deviceLimitForOrganization,
  hasMfaFactor,
  tenantLimitForAccount,
  type PlanLimitsConfig,
} from "@mattrax/enterprise-core";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { HttpServerRequest } from "effect/http/HttpServerRequest";
import {
  certificateDeviceIdsFor,
  createWindowsTenantToken,
  dispatchWebhookEvent,
  enterpriseEnrollmentProfile,
  federatedAuthServiceUrl,
  federatedRealm,
  generateWebhookSecret,
  previewDynamicGroup,
  resolveEffectivePolicyForDevice,
  sendTestWebhook,
  syncDynamicGroup,
  syncDynamicGroupsForDevice,
  toWebhookEndpointInfo,
  webhookEventForAuditAction,
  webhookSecretPrefix,
  windowsTenantTokenExpiresAt,
  WINDOWS_UNENROLL_REQUEST_TYPE,
  windowsUnenrollUri,
  ACTIVE_COMMAND_STATUSES,
  COMMAND_EXPIRED_DETAIL,
  RECONCILED_RESULT_STATUS,
  commandDeadline,
  commandDedupeKey,
  commandIsExpired,
  commandStatusIsActive,
  deviceCommandExpiresAt,
  planCommandQueueing,
  type CommandPayload,
} from "@mattrax/management-backend-enterprise";
import {
  AUTOPILOT_IMPORT_MAX_BYTES,
  AUTOPILOT_IMPORT_MAX_ROWS,
  AutopilotError,
  assignAutopilotProfile,
  autopilotDeviceInfo,
  autopilotProfileInfo,
  createAutopilotProfile,
  deleteAutopilotDevice,
  importAutopilotDevices,
  listAutopilotProfiles,
  normalizeAutopilotSerial,
  parseAutopilotCsv,
  syncAutopilotDevices,
  updateAutopilotProfile,
  validateAutopilotProfileInput,
  type AutopilotProfileValues,
} from "./autopilot.ts";
import {
  ScepRepositoryLive,
  issueScepChallenge,
  validateConfiguration,
} from "@mattrax/management-backend-enterprise";
import { serializePlist } from "@mattrax/plist";
import { certificateDer } from "@mattrax/scep";
import { extractMobileconfigPlist, parseMobileconfigPreview } from "./mobileconfig.ts";
import { tokenScopes } from "./enterpriseAuth.ts";
import { sessionCookie } from "./auth.ts";
import { cookieValue, signSsrRevision, signSsrToken } from "./ssrToken.ts";
import {
  ApnsService,
  NoopPushTransport,
  buildApnsCsr,
  generateApnsKeyPair,
  importApnsKeyJwk,
  makeApnsService,
  parseApnsCertificate,
  validateApnsCertificate,
} from "@mattrax/apns";
import { exportPrivateKeyJwk, openSecret, sealSecret } from "@mattrax/crypto";
import {
  EscrowKeyError,
  escrowKeyInfo,
  generateTenantEscrowKey,
  loadTenantEscrowKey,
  revealRecoveryKey,
  uploadTenantEscrowKey,
} from "./fdeEscrow.ts";
import { applePushService } from "./push.ts";
import { summarizeApplePushHealth } from "./push.ts";
import {
  DEVICE_ACTIVITY_MAX_OFFSET,
  deviceActivityPage,
  normalizeDeviceActivityLimit,
  normalizeDeviceActivityOffset,
} from "./deviceActivity.ts";
import {
  hasOwnerRole,
  isBuiltInOwnerMember,
  normalizePermissions,
  permissionForMethod,
  RequiredPermission,
  resolveTenantRole,
} from "./rbac.ts";
import { invitationEmail } from "./invitationEmail.ts";
import {
  deviceBucket,
  normalizeWidgetConfig,
  normalizeWidgetLayout,
  softwareBucket,
  toBuckets,
} from "./dashboardQuery.ts";
import {
  syncEntraDirectory,
  runEntraDirectorySyncForTenant,
  acquireEntraSyncLock,
} from "./entraSync.ts";
import {
  DEVICE_EXPORT_MAX_ROWS,
  normalizeDeviceSearchQuery,
  platformLabel,
  toCsv,
  type DeviceSearchFilters,
} from "./deviceSearch.ts";
import {
  AUDIT_EXPORT_MAX_ROWS,
  auditCsv,
  auditJson,
  auditOrder,
  auditWhere,
  encodeAuditCursor,
  encodeAuditOffsetCursor,
  normalizeAuditSearchQuery,
  type AuditExportEntry,
  type AuditSearchFilters,
} from "./auditLog.ts";
import {
  ACCOUNT_AUDIT,
  accountAuditEntry,
  accountAuditOrder,
  accountAuditWhere,
  clientAddress,
  recordAccountAudit,
} from "./accountAudit.ts";
import {
  approveAccountRecovery as approveRecoveryRequest,
  createRecoveryLimiter,
  RECOVERY_REQUEST_LIMIT,
  RECOVERY_WINDOW_MILLIS,
  requestAccountRecovery as startRecoveryRequest,
  verifyAccountRecoveryProof as consumeRecoveryProof,
} from "./recovery.ts";
import { canEnrollDevice } from "./enrollmentLimit.ts";
import {
  AndroidDeliveryError,
  androidEnterpriseInfo,
  createAndroidEnrollmentToken,
  createAndroidSignup,
  isAndroidConfigured,
  issueAndroidCommand,
  loadAndroidEnterprise,
  setAndroidEnabled,
  syncAndroidPoliciesForTenant,
  type AndroidDeliveryConfig,
} from "./android.ts";
import {
  detectEnrollmentPlatform,
  ENROLLMENT_ATTEMPT_DEDUPE_MS,
  ENROLLMENT_ATTEMPT_PER_CLIENT_LIMIT,
  evaluateEnrollmentAttempt,
  type EnrollmentAttemptOutcome,
  type EnrollmentAttemptPlatform,
} from "./enrollmentAttempts.ts";
import {
  AppleBusinessManagerError,
  appleBusinessManagerInfo,
  assignAppleBusinessManagerDevice,
  clearAppleBusinessManagerToken,
  createAdeProfileToken,
  loadAppleBusinessManager,
  createAbmClient,
  openAbmCredential,
  readAdeProfileToken,
  saveAppleBusinessManagerToken,
  syncAppleBusinessManagerDevices,
  type AppleApiConfig,
} from "./appleBusinessManager.ts";
import {
  VppError,
  assignVppLicence,
  clearVppToken,
  findVppAsset,
  findVppAssetByStoreId,
  releaseVppLicence,
  saveVppToken,
  syncVppAssets,
  vppInfo,
} from "./volumePurchase.ts";
import {
  countDeviceHealth,
  deriveDeviceHealth,
  groupDeviceHealthReasons,
  normalizeDeviceHealth,
} from "./deviceHealth.ts";
import { loadCredentialHealth } from "./credentialHealth.ts";
import {
  listTenantBackups as listTenantBackupRuns,
  runTenantBackup as runTenantBackupForTenant,
  setBackupRetention,
  deleteBackupRun,
  BackupActionError,
} from "./backup.ts";
import {
  teardownTenant,
  TenantTeardownStepFailed,
  type DeviceUnenrollSummary,
  type UnreachableDevice,
} from "./tenantTeardown.ts";
import { restoreTenantFromBackup, TenantRestoreError } from "./tenantRestore.ts";
import { AndroidManagement } from "@mattrax/dm-android";
import { buildTenantExport } from "./tenantExport.ts";
import type { AzureGraphService } from "@mattrax/azure-graph";
import {
  createAppleProfileSigner,
  signAppleProfilePlist,
  type AppleProfileSigningConfig,
} from "@mattrax/dm-apple";
import {
  describeScepCa,
  ensureScepCa,
  generateScepCa,
  importScepCa,
  replaceScepCa,
  type ScepCaDescription,
} from "@mattrax/scep";
import { listUserSessions, revokeAllUserSessions, revokeUserSession } from "./sessions.ts";
import {
  R2Storage,
  R2StorageLive,
  base64ToBytes,
  bytesToBase64,
  sha256Hex,
} from "./policyApplicationStorage.ts";
import type { R2Bucket } from "./policyApplicationStorage.ts";
import type {
  EnterpriseConfiguration,
  EnterpriseDb,
  EnterpriseDevice,
  EnterpriseEnrollment,
  EnterpriseGroup,
  EnterpriseGroupDevice,
  EnterpriseGroupPolicy,
  EnterpriseApplication,
  EnterpriseOrganization,
  EnterprisePolicy,
  EnterpriseSchema,
} from "./schema.ts";
import type { EmailReplyTo } from "./email.ts";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export type EnterpriseAnalyticsIdentity = {
  readonly userId: string;
  readonly email?: string;
  readonly name?: string;
  readonly tenantId?: string;
  readonly tenantName?: string;
  readonly roleName?: string;
  readonly roleKind?: "built-in" | "custom";
};

/** Request-scoped product analytics sink supplied by the host Worker. */
export type EnterpriseAnalytics = {
  identify(identity: EnterpriseAnalyticsIdentity): void;
  capture(event: string, properties?: Record<string, Schema.Json>): void;
};

/**
 * Request-scoped analytics sink. The API layer is built once per isolate, so
 * the per-request sink is supplied through the handler context instead of the
 * service constructor.
 */
export class EnterpriseAnalyticsService extends Context.Service<
  EnterpriseAnalyticsService,
  EnterpriseAnalytics
>()("@mattrax/enterprise-backend/EnterpriseAnalytics") {}

export type EnterpriseHandlersConfig = {
  readonly origin: string;
  /**
   * Stripe client used for billing. Deployments without Stripe credentials leave
   * this unset; billing handlers then return `EnterpriseStripeError` instead of
   * failing at boot.
   */
  readonly stripeClient?: RawStripeClientLike | ReturnType<typeof makeEffectStripeClient>;
  readonly storage: R2Bucket;
  /** Application secret used to seal/unseal APNs private keys. */
  readonly authSecret?: string;
  /** Microsoft Graph client used by directory sync and Autopilot (optional). */
  readonly azureGraph?: AzureGraphService;
  /** Public Entra app client id, exposed only to build the admin consent URL. */
  readonly azureClientId?: string;
  /** Federated WSTEP state shown in Settings → Management. */
  readonly windowsFederated?: {
    readonly audience?: string;
    readonly authServiceUrl?: (tenantId: string) => string;
  };
  /** Apple MDM vendor certificate/key used to sign APNs CSRs (optional). */
  readonly cloudAppleVendorCert?: string;
  readonly cloudAppleVendorKey?: string;
  /** Push transport. Defaults to a no-op transport when omitted (tests). */
  readonly apns?: ApnsService.Service;
  /** Google Android Enterprise delivery config; omitted when unconfigured. */
  readonly android?: AndroidDeliveryConfig;
  /** ABM/VPP outbound client overrides (tests use an injected fetch). */
  readonly appleApi?: AppleApiConfig;
  /** Injected fetch for outbound webhook deliveries (tests). */
  readonly webhookFetch?: typeof globalThis.fetch;
  /** Per-attempt webhook delivery deadline. Defaults to 5s. */
  readonly webhookTimeoutMs?: number;
  /**
   * Deployment plan catalogue parsed from `MATTRAX_PLAN_LIMITS`. Omit it (or
   * leave it unconfigured) to keep every plan unlimited.
   */
  readonly planLimits?: PlanLimitsConfig;
  /**
   * Deployment identity used to CMS-sign Apple enrollment profile downloads.
   * This is an explicit self-hosted override. When it is omitted, each tenant's
   * own SCEP CA signs the download (bootstrapped on first use).
   */
  readonly appleProfileSigning?: AppleProfileSigningConfig;
  /** Optional static analytics sink; the API supplies a request-scoped one. */
  readonly analytics?: EnterpriseAnalytics;
  /** Transactional email binding. Invitations are returned without email when omitted. */
  readonly email?: {
    send(message: {
      to: string;
      from: { name: string; email: string };
      replyTo?: EmailReplyTo;
      subject: string;
      text?: string;
      html?: string;
    }): Promise<void>;
  };
  /**
   * Verified sender address for invitation email. Must remain an allowed
   * Cloudflare Email sender; defaults to `hello@mattrax.cloud`.
   */
  readonly invitationFromEmail?: string;
};

type ServiceFailure = Error | Schema.Json | null | undefined;

type AnalyticsOperationProperties = {
  method: string;
  tenant_id?: string;
  permission?: string;
  target_id?: string;
  duration_ms: number;
  status: string;
};

const ErrorTag = Schema.Struct({ _tag: Schema.String });

const errorTag = (error: ServiceFailure): string | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(ErrorTag)(error))?._tag;

const isModelledError = (error: ServiceFailure): boolean => {
  const tag = errorTag(error);

  return tag !== undefined && (tag.startsWith("Enterprise") || tag.startsWith("StepUp"));
};

const expectedClientTags = new Set([
  "EnterpriseUnauthorized",
  "EnterpriseForbidden",
  "EnterpriseNotFound",
  "EnterpriseBadRequest",
  "EnterpriseConflict",
  "EnterpriseTenantHasMembers",
  "EnterpriseLastTenantUser",
  "StepUpRequired",
  "StepUpUnavailable",
]);

const ErrorMessage = Schema.Struct({ message: Schema.String });

const logServiceFailure = (error: ServiceFailure, causeText?: string) => {
  const tag = errorTag(error);

  const message =
    error instanceof Error
      ? error.message
      : (Option.getOrUndefined(Schema.decodeUnknownOption(ErrorMessage)(error))?.message ??
        String(error));

  return Effect.logError(
    "Enterprise service failure",
    JSON.stringify({
      tag,
      message,
      code: errorDiagnostic(error)?.code ?? (tag ? defaultErrorCode(tag) : "internal_error"),
      diagnostic: errorDiagnostic(error),
      cause: causeText?.slice(0, 8_000),
    }),
  );
};

/**
 * Every enterprise/auth method is wrapped once here: known tagged failures keep
 * their tag and reduced message; anything else is logged in full and replaced
 * with a serializable internal error. This prevents raw SQL/provider defects
 * from becoming bodyless 500s that clients cannot explain.
 */
const mapServiceErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catchCause((cause) => {
      // SAFETY: Cause.squash always yields the captured Error, tagged data
      // error, primitive, or null/undefined that caused the Effect to fail.
      const error = Cause.squash(cause) as ServiceFailure;

      if (isModelledError(error)) {
        const tag = errorTag(error) ?? "";

        const log = expectedClientTags.has(tag)
          ? Effect.void
          : logServiceFailure(error, Cause.pretty(cause));

        // SAFETY: isModelledError checks the runtime `_tag`; Cause.squash erases
        // the typed error union, so the failure is re-asserted as the channel E.
        return Effect.flatMap(log, () => Effect.fail(error as E));
      }

      const internal = diagnoseError(
        new EnterpriseInternal({
          message: "Something went wrong on our side. Try again shortly.",
        }),
        {
          code: "internal_error",
          retryable: true,
          details: {
            cause: error instanceof Error ? error.message : String(error),
          },
        },
      );

      // SAFETY: diagnoseError's internal error is the caller's declared failure
      // channel; CatchCause must not widen it to the raw defect.
      return Effect.flatMap(logServiceFailure(error, Cause.pretty(cause)), () =>
        Effect.fail(internal as E),
      );
    }),
  );

const PRODUCT_EVENTS = {
  createTenant: "tenant_created",
  importTenant: "tenant_imported",
  exportTenant: "tenant_exported",
  createPolicy: "policy_created",
  duplicatePolicy: "policy_duplicated",
  createApplication: "application_created",
  createGroup: "group_created",
  createDashboard: "dashboard_created",
  createDashboardWidget: "dashboard_widget_created",
  createTenantRole: "role_created",
  inviteTenantUser: "member_invited",
  createApiToken: "api_token_created",
  createScimToken: "scim_token_created",
  createWebhookEndpoint: "webhook_created",
  createAutopilotProfile: "autopilot_profile_created",
  uploadAppleBusinessManagerToken: "abm_token_uploaded",
  uploadVppToken: "vpp_token_uploaded",
  createAndroidSignup: "android_signup_started",
  patchTenantEnrollment: "enrollment_settings_updated",
  resetTenantEnrollment: "enrollment_settings_reset",
  deviceAction: "device_command_sent",
  installApplication: "application_install_requested",
  installVppAsset: "vpp_asset_install_requested",
  runTenantBackup: "backup_started",
  billingPortal: "billing_portal_opened",
  patchTenant: "tenant_updated",
  updateMe: "account_updated",
} satisfies Record<string, string>;

const PRODUCT_EVENT_BY_METHOD = new Map(Object.entries(PRODUCT_EVENTS));

const wrapServiceErrors = <S extends object>(
  service: S,
  permissions = false,
  fallbackAnalytics?: EnterpriseAnalytics,
): S =>
  new Proxy(service, {
    get(_target, property) {
      const value = Object.getOwnPropertyDescriptor(service, property)?.value;

      if (!(value instanceof Function)) return value;

      return (...args: Array<unknown>) => {
        const fn = value;
        const result = fn.apply(service, args);

        if (!Effect.isEffect(result)) return result;
        const method = String(property);
        const permission = permissions ? permissionForMethod(method) : undefined;
        const tenantId = Schema.is(Schema.String)(args[1]) ? args[1] : undefined;
        const startedAt = Date.now();

        const mapped =
          permission && tenantId
            ? Effect.provideService(result, RequiredPermission, {
                permission,
                method,
              })
            : result;

        const withAnalytics = mapped.pipe(
          Effect.tap((value) =>
            Effect.gen(function* () {
              const provided = yield* Effect.serviceOption(EnterpriseAnalyticsService);
              const analytics = Option.isSome(provided) ? provided.value : fallbackAnalytics;

              if (!analytics) return;

              const targetId = Option.getOrUndefined(
                Schema.decodeUnknownOption(Schema.Struct({ id: Schema.String }))(value),
              )?.id;

              const properties: AnalyticsOperationProperties = {
                method,
                duration_ms: Date.now() - startedAt,
                status: "ok",
              };

              if (tenantId) properties.tenant_id = tenantId;

              if (permission) properties.permission = permission;

              if (targetId) properties.target_id = targetId;

              try {
                analytics.capture("api_operation", properties);
                const event = PRODUCT_EVENT_BY_METHOD.get(method);

                if (event) analytics.capture(event, properties);
              } catch {
                // Analytics must never fail a successful API operation.
              }
            }),
          ),
        );

        return mapServiceErrors(withAnalytics);
      };
    },
  });

type EnterpriseServiceConfig = EnterpriseHandlersConfig & {
  readonly db: EnterpriseDb;
  readonly schema: EnterpriseSchema;
  readonly auth?: EnterpriseAuth["Service"];
};

type RawStripeClientLike = StripeClientLike;

type Dynamic = ReturnType<typeof JSON.parse>;

const StripeEffectProperty = Schema.Struct({ effect: Schema.optional(Schema.Json) });

const isEffectStripeClient = (
  client: RawStripeClientLike | ReturnType<typeof makeEffectStripeClient>,
): client is ReturnType<typeof makeEffectStripeClient> => {
  const effect = Option.getOrUndefined(
    Schema.decodeUnknownOption(StripeEffectProperty)(client),
  )?.effect;

  return effect instanceof Function;
};

const now = () => new Date();

/**
 * SCIM bearer-token lifetime policy. Provisioning credentials are long-lived by
 * nature (an IdP connector), so expiry is measured in days and rotation is
 * reminded in the dashboard rather than forced.
 */
const SCIM_TOKEN_DEFAULT_TTL_DAYS = 90;
const SCIM_TOKEN_MAX_TTL_DAYS = 365;
const SCIM_TOKEN_ROTATION_WINDOW_DAYS = 14;
const DAY_MILLIS = 24 * 60 * 60 * 1_000;

/**
 * Resolve the requested SCIM token expiry. `undefined`/empty means the default
 * lifetime; anything else must be a valid future ISO timestamp within the
 * maximum lifetime. A discriminated result keeps the handler free of date
 * parsing branches at every use site.
 */
type ScimTokenExpiry =
  | { readonly ok: true; readonly value: Date }
  | { readonly ok: false; readonly message: string };

const scimTokenExpiry = (requested: string | null | undefined, at: Date): ScimTokenExpiry => {
  const trimmed = requested?.trim();

  if (!trimmed)
    return { ok: true, value: new Date(at.getTime() + SCIM_TOKEN_DEFAULT_TTL_DAYS * DAY_MILLIS) };

  const parsed = new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) return { ok: false, message: "Enter a valid expiry date" };

  if (parsed.getTime() <= at.getTime())
    return { ok: false, message: "The expiry must be in the future" };

  if (parsed.getTime() > at.getTime() + SCIM_TOKEN_MAX_TTL_DAYS * DAY_MILLIS)
    return {
      ok: false,
      message: `SCIM tokens can expire at most ${SCIM_TOKEN_MAX_TTL_DAYS} days from now`,
    };

  return { ok: true, value: parsed };
};

const optionalText = (value: string | null | undefined): string | null | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
};

type BrandingPayload = {
  readonly displayName?: string | null;
  readonly logo?: string | null;
  readonly supportEmail?: string | null;
  readonly brandColor?: string | null;
};

/**
 * Validate and normalise the write payload for tenant branding. Returns the
 * fields to persist, omitting anything the caller did not send.
 */
type BrandingUpdate = {
  displayName?: string | null;
  logo?: string | null;
  supportEmail?: string | null;
  brandColor?: string | null;
};

const brandingUpdate = (body: BrandingPayload): BrandingUpdate => {
  const errors = validateTenantBranding(body);
  const firstError = Object.values(errors)[0];

  if (firstError) throw new EnterpriseBadRequest({ message: firstError });

  const update: BrandingUpdate = {};
  const displayName = optionalText(body.displayName);

  if (displayName !== undefined) update.displayName = displayName;
  const logo = optionalText(body.logo);

  if (logo !== undefined) update.logo = logo;
  const supportEmail = optionalText(body.supportEmail);

  if (supportEmail !== undefined) update.supportEmail = supportEmail;
  const brandColor = optionalText(body.brandColor);

  if (brandColor !== undefined)
    update.brandColor = brandColor ? normalizeBrandColor(brandColor) : null;

  return update;
};

/** Throwing here keeps the validation helper usable from Effect.gen. */
const brandingOrFail = (body: BrandingPayload) =>
  Effect.try({
    try: () => brandingUpdate(body),
    catch: (cause) =>
      cause instanceof EnterpriseBadRequest
        ? cause
        : new EnterpriseBadRequest({ message: "Invalid tenant branding" }),
  });

const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);
const ok = { status: "ok" as const };

const APPLE_PROFILE_WINDOW_MS = 60_000;
const APPLE_PROFILE_PER_IP_LIMIT = 60;
const appleProfileWindows = new Map<string, { count: number; resetAt: number }>();

/**
 * Best-effort per-isolate limiter for the public mobileconfig endpoint. It is
 * deliberately cheap: the goal is to stop accidental QR-refresh loops and
 * trivial download floods, not to be a global quota (that belongs at the edge).
 */
const allowAppleProfileRequest = (ip: string | null | undefined) => {
  const key = ip?.trim() || "local";
  const timestamp = Date.now();
  const entry = appleProfileWindows.get(key);

  if (!entry || entry.resetAt <= timestamp) {
    appleProfileWindows.set(key, { count: 1, resetAt: timestamp + APPLE_PROFILE_WINDOW_MS });

    // Bound the map so rotating addresses cannot grow it without limit.
    if (appleProfileWindows.size > 10_000) {
      for (const [candidate, value] of appleProfileWindows)
        if (value.resetAt <= timestamp) appleProfileWindows.delete(candidate);
    }

    return true;
  }

  entry.count += 1;

  return entry.count <= APPLE_PROFILE_PER_IP_LIMIT;
};

/**
 * Break-glass recovery limiter. Keys are transient: they are held in this
 * isolate's memory only, matched per account and per client, and never written
 * to the database or a log.
 */
const recoveryLimiter = createRecoveryLimiter({
  limit: RECOVERY_REQUEST_LIMIT,
  windowMillis: RECOVERY_WINDOW_MILLIS,
});

/** Filesystem-safe tenant name for the mobileconfig `Content-Disposition`. */
const safeFilename = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "tenant";

/** Slug candidates are derived from tenant input and bounded for MySQL indexes. */
const slugBase = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 240);

/** Compact bundle validation helper; mirrors the limits used by write handlers. */
const importString = (value: Schema.Json | undefined, max: number): string | null => {
  const text = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(value));

  if (text === undefined) return null;
  const trimmed = text.trim();

  return trimmed ? trimmed.slice(0, max) : null;
};

/**
 * Build the download response for an Apple enrollment profile. The body is
 * either a CMS-signed profile or a plain plist when no signing identity is
 * available yet. Exported so the content type, attachment filename and cache
 * policy can be asserted without standing up the whole HTTP API.
 */
export const appleEnrollmentProfileResponse = (result: {
  readonly profile: Uint8Array;
  readonly filename: string;
}) =>
  HttpServerResponse.uint8Array(result.profile, {
    contentType: "application/x-apple-aspen-config",
    headers: {
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    },
  });

/** Render the stored capability JSON for CSV export without losing entries. */
const capabilityText = (value: Schema.Json | undefined): string => {
  if (value == null) return "";

  if (Array.isArray(value)) return value.map((entry) => String(entry)).join("; ");

  if (Schema.is(Schema.String)(value)) return value;

  return JSON.stringify(value);
};

/** Public audit row shape shared by list, search and export endpoints. */
const auditEntry = (entry: {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  actorUserId?: string | null;
  actorEmail?: string | null;
  metadata?: Schema.Json;
  createdAt: Date;
}): AuditExportEntry => ({
  id: entry.id,
  action: entry.action,
  targetType: entry.targetType,
  targetId: entry.targetId,
  actorUserId: entry.actorUserId ?? null,
  actorEmail: entry.actorEmail ?? null,
  metadata: entry.metadata ?? null,
  createdAt: iso(entry.createdAt),
});

/** Serialise a backup row for the API without exposing anything but metadata. */
const backupRunInfo = (run: {
  id: string;
  status: string;
  trigger: string;
  retention: string;
  r2Key?: string | null;
  sizeBytes?: number | null;
  startedAt: Date | number;
  completedAt?: Date | number | null;
  error?: string | null;
}) => ({
  id: run.id,
  status: run.status,
  trigger: run.trigger,
  retention: run.retention,
  r2Key: run.r2Key ?? null,
  sizeBytes: run.sizeBytes ?? null,
  startedAt: iso(run.startedAt),
  completedAt: run.completedAt == null ? null : iso(run.completedAt),
  error: run.error ?? null,
});

const headersFromRequest = (request: HttpServerRequest) => {
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else if (value !== undefined) {
      headers.set(key, value);
    }
  }

  return headers;
};

const webRequestFromRequest = (request: HttpServerRequest, origin: string) =>
  new Request(origin, { headers: headersFromRequest(request) });

/** Require a recent step-up for a sensitive action. */
const requireStepUp = (
  auth: { requireStepUp: (...args: any[]) => Effect.Effect<any, any, any> },
  request: HttpServerRequest,
  action: StepUpAction,
) => auth.requireStepUp(request, action);

const exportHeaders = (
  filename: string,
  result: { readonly truncated: boolean; readonly rowCount: number },
) => {
  const headers = new Map<string, string>([
    ["Content-Disposition", `attachment; filename="${filename}"`],
    ["X-Export-Rows", String(result.rowCount)],
  ]);

  if (result.truncated) headers.set("X-Export-Truncated", "true");

  return Object.fromEntries(headers);
};

const iso = (date: Date | number | null | undefined) => {
  if (date == null) return new Date(0).toISOString();

  return (date instanceof Date ? date : new Date(date)).toISOString();
};

/** ISO timestamp for values that are genuinely absent (null, never 1970). */
const isoOrNull = (date: Date | number | null | undefined) => (date == null ? null : iso(date));

/** Copy bytes into a plain ArrayBuffer so WebCrypto never sees a shared buffer. */
const bytesToArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return copy.buffer;
};

const hashJson = (value: Schema.Json) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))),
  ).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    ),
  );

const TENANT_ROLES = new Set(["owner", "admin", "member", "auditor"]);

const BUILT_IN_ROLE_LABEL_BY_ROLE = new Map(Object.entries(BUILT_IN_ROLE_LABELS));

const rolesOf = (role: string) =>
  role
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const validRoles = (role: string) => {
  const roles = rolesOf(role);

  return roles.length > 0 && roles.every((item) => TENANT_ROLES.has(item));
};

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PENDING_INVITATIONS_PER_TENANT = 50;
const INVITATION_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEFAULT_INVITATION_FROM = "hello@mattrax.cloud";

/** Normalise an invitation target at the transport boundary. */
const normalizeInvitationEmail = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase();

const validInvitationEmail = (email: string) =>
  email.length > 0 && email.length <= 320 && INVITATION_EMAIL_PATTERN.test(email);

/** Mask an address without ever returning the full local part or domain. */
const maskInvitationEmail = (email: string) => {
  const at = email.lastIndexOf("@");

  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const suffix = dot > 0 ? domain.slice(dot) : "";
  const localMask = `${local[0]}***`;
  const domainMask = domain ? `${domain[0]}***${suffix}` : "";

  return domainMask ? `${localMask}@${domainMask}` : localMask;
};

const invitationIsExpired = (invitation: { status: string; expiresAt: Date }) =>
  invitation.status === "pending" && invitation.expiresAt <= now();

const invitationRoleName = (
  invitation: { role: string | null; customRoleId?: string | null },
  customRoles: ReadonlyMap<string, string>,
) => {
  if (invitation.customRoleId) return customRoles.get(invitation.customRoleId) ?? "Member";

  return invitation.role
    ? (BUILT_IN_ROLE_LABEL_BY_ROLE.get(invitation.role) ?? invitation.role)
    : "Member";
};

const newInvitationToken = () =>
  bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const invitationTokenHash = (token: string) =>
  sha256Hex(bytesToArrayBuffer(new TextEncoder().encode(token)));

const invitationUrl = (origin: string, token: string) =>
  `${origin.replace(/\/+$/, "")}/accept-invitation?token=${encodeURIComponent(token)}`;

type InvitationAuditMetadata = {
  email: string;
  role: string;
  emailSent: boolean;
  roleId?: string;
  roleName?: string;
  permissionCeiling?: string;
};

type MemberJoinedAuditMetadata = {
  invitationId: string;
  role: string;
  roleId: string | null;
  roleFallback?: string;
};

/**
 * Permissions that stay with owners even when delegated. Custom roles may hold
 * them, but only an owner can create, edit or assign such a role. Every other
 * permission is itself a ceiling: an actor can only grant what their own
 * resolved role already holds.
 */
const OWNER_ONLY_PERMISSIONS: ReadonlySet<string> = new Set([
  "tenant.delete",
  "tenant.export",
  "backups.read",
  "backups.write",
]);

/**
 * Role matrix:
 * - owner: read, write, delete
 * - admin: read, write
 * - member: read (baseline tenant access)
 * - auditor: read only (compliance/read-only access; cannot write)
 *
 * There is no `operator` role: device-only writes would require every handler
 * to declare a resource class, and this layer only distinguishes read/write.
 */
const canWriteTenant = (role: string) =>
  role.split(",").some((item) => item === "owner" || item === "admin");

const canDeleteTenant = (role: string) => role.split(",").includes("owner");

/** The action response, with the optional fields built conditionally. */
type DeviceActionOutcome = {
  status: "ok";
  pin?: string;
  commandId?: string;
  deduplicated?: boolean;
  activationLockWarning?: string;
};

/** Whether the last security report is older than the refresh window. */
const securityInfoIsStale = (updatedAt: Date | null, at: Date): boolean =>
  updatedAt === null ||
  at.getTime() - updatedAt.getTime() > DEVICE_SECURITY_INFO_STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;

export const createEnterpriseService = ({
  db,
  schema,
  origin,
  stripeClient,
  storage,
  auth: authService,
  authSecret,
  cloudAppleVendorCert,
  cloudAppleVendorKey,
  apns: apnsService,
  android: androidConfig,
  appleApi,
  email,
  invitationFromEmail,
  azureGraph,
  azureClientId,
  windowsFederated,
  webhookFetch,
  webhookTimeoutMs,
  planLimits,
  appleProfileSigning,
  analytics,
}: EnterpriseServiceConfig) => {
  if (!authService) throw new Error("EnterpriseAuth service is required");

  const auth = wrapServiceErrors(authService);

  const identifyUser = (
    user: { readonly id: string; readonly email: string; readonly name?: string | null },
    tenant?: {
      readonly id: string;
      readonly name?: string;
      readonly displayName?: string | null;
      readonly roleName?: string;
      readonly roleKind?: "built-in" | "custom";
    },
  ) =>
    Effect.gen(function* () {
      const provided = yield* Effect.serviceOption(EnterpriseAnalyticsService);
      const sink = Option.isSome(provided) ? provided.value : analytics;

      if (!sink) return;

      try {
        const identity: Mutable<EnterpriseAnalyticsIdentity> = {
          userId: user.id,
          email: user.email,
        };

        if (user.name) identity.name = user.name;

        if (tenant) {
          identity.tenantId = tenant.id;

          const tenantName = tenant.displayName ?? tenant.name;

          if (tenantName) identity.tenantName = tenantName;

          if (tenant.roleName) identity.roleName = tenant.roleName;

          if (tenant.roleKind) identity.roleKind = tenant.roleKind;
        }

        sink.identify(identity);
      } catch {
        // Analytics must never fail an authenticated request.
      }
    });

  const apns = apnsService ?? makeApnsService(NoopPushTransport());

  const applePush = applePushService({
    db,
    schema,
    apns,
    authSecret,
    webhookFetch: webhookFetch ? webhookFetch : undefined,
  });

  const webhookOptions = {
    authSecret: authSecret ? authSecret : undefined,
    fetch: webhookFetch ? webhookFetch : undefined,
    timeoutMs: webhookTimeoutMs !== undefined ? webhookTimeoutMs : undefined,
  };

  const stripe = stripeClient
    ? isEffectStripeClient(stripeClient)
      ? stripeClient
      : makeEffectStripeClient(stripeClient)
    : undefined;

  const billingConfigured = Boolean(stripe);

  const billingNotConfigured = () =>
    new EnterpriseStripeError({
      message: "Billing is not configured for this deployment.",
    });

  const billingUnavailable = () =>
    new EnterpriseStripeError({
      message: "Billing is temporarily unavailable. Try again shortly.",
    });

  /**
   * Translate an Android delivery failure into the API's stable error tags.
   * Provider messages are already redacted/truncated by the Android module.
   */
  const androidFailure = (error: AndroidDeliveryError) => {
    switch (error.kind) {
      case "not_configured":
        return new EnterpriseNotConfigured({ message: error.message });
      case "conflict":
        return new EnterpriseConflict({ message: error.message });
      case "not_found":
        return new EnterpriseNotFound({ message: error.message });
      case "unauthorized":
      case "invalid_state":
      case "invalid_payload":
        return new EnterpriseBadRequest({ message: error.message });
      case "upstream":
        return new EnterpriseUpstreamError({ message: error.message });
    }
  };

  const mapAndroidFailure = <A, R>(effect: Effect.Effect<A, AndroidDeliveryError, R>) =>
    effect.pipe(Effect.mapError(androidFailure));

  const androidConfigured = () => isAndroidConfigured(androidConfig);

  const appleFailure = (error: AppleBusinessManagerError) => {
    switch (error.kind) {
      case "not_configured":
        return new EnterpriseNotConfigured({ message: error.message });
      case "conflict":
        return new EnterpriseConflict({ message: error.message });
      case "not_found":
        return new EnterpriseNotFound({ message: error.message });
      case "invalid_token":
      case "expired":
      case "unauthorized":
      case "forbidden":
      case "invalid_response":
        return new EnterpriseBadRequest({ message: error.message });
      case "upstream":
        return new EnterpriseUpstreamError({ message: error.message });
    }
  };

  const mapAppleFailure = <A, R>(effect: Effect.Effect<A, AppleBusinessManagerError, R>) =>
    effect.pipe(Effect.mapError(appleFailure));

  const vppFailure = (error: VppError) => {
    switch (error.kind) {
      case "not_configured":
        return new EnterpriseNotConfigured({ message: error.message });
      case "conflict":
        return new EnterpriseConflict({ message: error.message });
      case "not_found":
        return new EnterpriseNotFound({ message: error.message });
      case "invalid_token":
      case "expired":
      case "unauthorized":
      case "forbidden":
      case "no_license":
      case "invalid_response":
        return new EnterpriseBadRequest({ message: error.message });
      case "upstream":
        return new EnterpriseUpstreamError({ message: error.message });
    }
  };

  const mapVppFailure = <A, R>(effect: Effect.Effect<A, VppError, R>) =>
    effect.pipe(Effect.mapError(vppFailure));

  const appleServerName = (organization: { name: string; displayName?: string | null }) =>
    `Mattrax ${organization.displayName ?? organization.name}`.slice(0, 100);

  const syncAndroidDevices = (organizationId: string, deviceIds?: ReadonlyArray<string>) =>
    syncAndroidPoliciesForTenant({
      db,
      config: androidConfig,
      organizationId,
      deviceIds: deviceIds ? deviceIds : undefined,
    }).pipe(Effect.catch(() => Effect.void));

  const r2Layer = R2StorageLive(storage);

  const requireTenant = (
    request: HttpServerRequest,
    tenantId: string,
    access: "read" | "write" | "delete" = "read",
  ) =>
    Effect.gen(function* () {
      const { user, apiToken, oauth } = yield* auth.requireUser({ headers: request.headers });

      // An unverified address cannot reach tenant data through either a
      // browser session or a bearer token. Tokens resolve to their owner's user
      // row, so this also closes the token-creation bypass.
      if (!user.emailVerified)
        return yield* Effect.fail(
          new EnterpriseForbidden({
            message: "Verify your email address before accessing this tenant.",
          }),
        );

      if (apiToken) {
        // A tenant-bound token cannot be used against another tenant. Report it
        // as missing so token holders cannot probe tenant existence.
        if (apiToken.tenantId && apiToken.tenantId !== tenantId)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant not found" }));
        const scopes = tokenScopes(apiToken.scopes);

        if (access === "read" && !scopes.has("read"))
          return yield* Effect.fail(
            diagnoseError(
              new EnterpriseForbidden({ message: "This token is not allowed to read this tenant" }),
              { code: "token_scope", reason: "read_scope_missing" },
            ),
          );

        if ((access === "write" || access === "delete") && !scopes.has("write"))
          return yield* Effect.fail(
            diagnoseError(
              new EnterpriseForbidden({
                message: "This token is read-only and cannot modify this tenant",
              }),
              { code: "token_scope", reason: "write_scope_missing" },
            ),
          );
      }

      const member = yield* db.query.member.findFirst({
        where: { userId: user.id, organizationId: tenantId },
      });

      if (!member)
        return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant not found" }));

      const role = yield* resolveTenantRole(db, member);
      const required = yield* Effect.serviceOption(RequiredPermission);
      const requiredPermission = Option.isSome(required) ? required.value.permission : undefined;

      const deny = (permission: string) =>
        diagnoseError(
          new EnterprisePermissionDenied({
            message: `Your role (${role.roleName}) does not include the ${permission} permission.`,
            permission,
            roleName: role.roleName,
            roleKind: role.roleKind,
          }),
          {
            code: "forbidden",
            reason: "missing_permission",
            details: {
              permission,
              roleId: role.roleId,
              roleKey: role.roleKey,
            },
          },
        );

      if (requiredPermission && !hasPermission(role.permissions, requiredPermission))
        return yield* Effect.fail(deny(requiredPermission));

      // Direct/internal calls without the method-level permission still need a
      // safe fallback. Custom roles use their explicit permissions.
      if (!requiredPermission) {
        if (role.roleKind === "custom") {
          let fallback: "tenant.delete" | "tenant.write" | "tenant.read" = "tenant.read";

          if (access === "delete") fallback = "tenant.delete";
          else if (access === "write") fallback = "tenant.write";

          if (!hasPermission(role.permissions, fallback)) return yield* Effect.fail(deny(fallback));
        } else {
          if (access === "write" && !canWriteTenant(member.role))
            return yield* Effect.fail(new EnterpriseForbidden({ message: "Forbidden" }));

          if (access === "delete" && !canDeleteTenant(member.role))
            return yield* Effect.fail(new EnterpriseForbidden({ message: "Forbidden" }));
        }
      }

      const organization = yield* db.query.organization.findFirst({
        where: { id: member.organizationId },
      });

      if (!organization)
        return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant not found" }));

      // A tenant-wide MFA requirement applies to every role, including viewers
      // and auditors: read access to tenant data is exactly what an attacker
      // with a borrowed session is after. Account endpoints are not
      // tenant-scoped, so a blocked member can always reach Account settings to
      // enrol a factor.
      if (!hasMfaFactor(user) && organization.requireMfa)
        return yield* Effect.fail(
          new EnterpriseForbidden({
            message:
              "This tenant requires multi-factor authentication. Add a passkey or authenticator app to your account first.",
          }),
        );

      const credential = apiToken
        ? { type: "api_token" as const, id: apiToken.id, name: apiToken.name }
        : oauth
          ? {
              type: "oauth" as const,
              id: oauth.connectionId,
              name: oauth.clientName,
              clientId: oauth.clientId,
            }
          : undefined;

      yield* identifyUser(user, {
        id: organization.id,
        name: organization.name,
        displayName: organization.displayName,
        roleName: role.roleName,
        roleKind: role.roleKind,
      });

      return {
        user,
        organization,
        member,
        role,
        credential,
        rbac: requiredPermission
          ? {
              permission: requiredPermission,
              roleName: role.roleName,
              roleKind: role.roleKind,
              roleId: role.roleId,
            }
          : {
              roleName: role.roleName,
              roleKind: role.roleKind,
              roleId: role.roleId,
            },
      };
    });

  /**
   * A custom role is a delegation, never a privilege escalation. The actor's
   * resolved permissions are the ceiling, and owner-only permissions need an
   * owner regardless of what the actor's custom role happens to contain.
   */
  const assertPermissionsWithinActor = (
    ctx: {
      readonly member: { readonly role: string };
      readonly role: { readonly permissions: ReadonlySet<string> };
    },
    permissions: ReadonlyArray<string>,
  ) =>
    Effect.gen(function* () {
      const notHeld = permissions.filter(
        (permission) => !hasPermission(ctx.role.permissions, permission),
      );

      if (notHeld.length)
        return yield* Effect.fail(
          new EnterpriseForbidden({
            message: `You cannot grant permissions your own role does not hold: ${notHeld.join(", ")}.`,
          }),
        );

      if (!isBuiltInOwnerMember(ctx.member)) {
        const ownerOnly = permissions.filter((permission) =>
          OWNER_ONLY_PERMISSIONS.has(permission),
        );

        if (ownerOnly.length)
          return yield* Effect.fail(
            new EnterpriseForbidden({
              message: `Only an owner can grant owner-only permissions: ${ownerOnly.join(", ")}.`,
            }),
          );
      }
    });

  /**
   * Assigning a built-in role is a delegation too. `admin`, `member` and
   * `auditor` cannot exceed the actor's own permissions, and the built-in owner
   * role stays behind the owner-only gate. Legacy comma-separated roles are
   * checked part by part.
   */
  const assertBuiltInRoleAssignable = (
    ctx: {
      readonly member: { readonly role: string; readonly customRoleId?: string | null };
      readonly role: { readonly permissions: ReadonlySet<string> };
    },
    role: string,
  ) =>
    Effect.gen(function* () {
      for (const item of rolesOf(role)) {
        if (!isBuiltInTenantRole(item)) continue;

        if (item === "owner") {
          if (!isBuiltInOwnerMember(ctx.member))
            return yield* Effect.fail(
              new EnterpriseForbidden({ message: "Only an owner can assign the owner role" }),
            );

          continue;
        }

        yield* assertPermissionsWithinActor(
          ctx,
          // A non-owner delegating a built-in role cannot hand out owner-only
          // permissions, but the built-in role's own definition of those stays
          // authoritative. Compare the rest against the actor's ceiling so an
          // administrator can still assign `member`/`auditor`/`admin`.
          isBuiltInOwnerMember(ctx.member)
            ? BUILT_IN_ROLE_PERMISSIONS[item]
            : BUILT_IN_ROLE_PERMISSIONS[item].filter(
                (permission) => !OWNER_ONLY_PERMISSIONS.has(permission),
              ),
        );
      }
    });

  const snapshotPolicy = (
    ctx: { readonly user: { readonly id: string }; readonly organization: { readonly id: string } },
    policyId: string,
  ) =>
    Effect.gen(function* () {
      const configurations = yield* db
        .select()
        .from(schema.configuration)
        .where(eq(schema.configuration.policyId, policyId));

      const snapshot = Object.fromEntries(
        configurations.map((configuration: any) => [configuration.kind, configuration.data]),
      );

      // `max(version)` can come from a stale Hyperdrive replica, so the first
      // INSERT may collide with the unique (policy_id, version) index even
      // though the read said the slot was free. Retry with a higher version
      // instead of trusting a fresh read: every retry is a lower-bound + n, so
      // it eventually lands above the true maximum without waiting for the
      // replica to catch up.
      const [current] = yield* db
        .select({ version: schema.policyDeployment.version })
        .from(schema.policyDeployment)
        .where(eq(schema.policyDeployment.policyId, policyId))
        .orderBy(desc(schema.policyDeployment.version))
        .limit(1);

      const base = current?.version ?? 0;
      let attempt = 1;

      const insertOnce = Effect.suspend(() => {
        const version = base + attempt;
        attempt += 1;

        return Effect.gen(function* () {
          yield* db.insert(schema.policyDeployment).values({
            id: id(),
            organizationId: ctx.organization.id,
            policyId,
            version,
            snapshot,
            createdByUserId: ctx.user.id,
            createdAt: now(),
          });
        });
      });

      yield* Effect.retry(insertOnce, { times: 20 });
    });

  /**
   * Apply the tenant-wide MFA requirement and record the change.
   *
   * The requirement binds every role, so enabling it is refused while any
   * member cannot satisfy it: a member who cannot would lose all tenant access
   * (Account settings stay reachable, so they can enrol and retry).
   */
  const setTenantMfaPolicy = (
    ctx: {
      readonly user: {
        readonly id: string;
        readonly email: string;
        readonly totpEnabled?: boolean | null;
        readonly passkeyEnabled?: boolean | null;
      };
      readonly organization: { readonly id: string; readonly requireMfa: boolean };
      readonly credential?:
        | { readonly type: "api_token"; readonly id: string; readonly name: string }
        | {
            readonly type: "oauth";
            readonly id: string;
            readonly name: string;
            readonly clientId: string;
          };
      readonly rbac?: {
        readonly permission?: string;
        readonly roleName: string;
        readonly roleKind: "built-in" | "custom";
        readonly roleId?: string | null;
      };
    },
    requireMfa: boolean,
  ) =>
    Effect.gen(function* () {
      if (requireMfa && !ctx.organization.requireMfa) {
        if (!hasMfaFactor(ctx.user))
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message:
                "Add a passkey or authenticator app to your own account before requiring MFA for this tenant.",
            }),
          );

        const members = yield* db
          .select({
            role: schema.member.role,
            totpEnabled: schema.user.totpEnabled,
            passkeyEnabled: schema.user.passkeyEnabled,
          })
          .from(schema.member)
          .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
          .where(eq(schema.member.organizationId, ctx.organization.id));

        const missing = members.filter((member) => !hasMfaFactor(member)).length;

        if (missing > 0)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: `${missing} member account${missing === 1 ? " has" : "s have"} not enrolled a factor. Ask them to enrol before enabling this requirement.`,
            }),
          );
      }

      if (ctx.organization.requireMfa !== requireMfa) {
        yield* db
          .update(schema.organization)
          .set({ requireMfa, updatedAt: now() })
          .where(eq(schema.organization.id, ctx.organization.id));

        yield* audit(ctx, "tenant.mfa_policy_updated", "tenant", ctx.organization.id, {
          requireMfa,
        });
      }

      return requireMfa;
    });

  const audit = (
    ctx: {
      readonly user: { readonly id: string; readonly email: string };
      readonly organization: { readonly id: string };
      readonly credential?:
        | { readonly type: "api_token"; readonly id: string; readonly name: string }
        | {
            readonly type: "oauth";
            readonly id: string;
            readonly name: string;
            readonly clientId: string;
          };
      readonly rbac?: {
        readonly permission?: string;
        readonly roleName: string;
        readonly roleKind: "built-in" | "custom";
        readonly roleId?: string | null;
      };
    },
    action: string,
    targetType: string,
    targetId: string | null = null,
    metadata?: Schema.Json,
  ) =>
    Effect.gen(function* () {
      const metadataObject = Schema.is(Schema.JsonObject)(metadata)
        ? metadata
        : metadata === undefined
          ? {}
          : { value: metadata };

      const enrichedMetadata = { ...metadataObject };

      if (ctx.credential) Object.assign(enrichedMetadata, { credential: ctx.credential });

      if (ctx.rbac) Object.assign(enrichedMetadata, { rbac: ctx.rbac });

      yield* db.insert(schema.auditLog).values({
        id: id(),
        organizationId: ctx.organization.id,
        actorUserId: ctx.user.id,
        actorEmail: ctx.user.email,
        action,
        targetType,
        targetId,
        metadata: Object.keys(enrichedMetadata).length === 0 ? null : enrichedMetadata,
        createdAt: now(),
      });

      if (ctx.credential?.type === "oauth")
        yield* db
          .update(schema.mcpOAuthConnection)
          .set({
            lastUsedAt: now(),
            lastAction: action,
            requestCount: sql`${schema.mcpOAuthConnection.requestCount} + 1`,
          })
          .where(eq(schema.mcpOAuthConnection.id, ctx.credential.id));
      // A small set of administrator actions are also customer-facing. Device
      // lifecycle events are mostly emitted from the protocol path; deletion
      // only exists here.
      const webhookEvent = webhookEventForAuditAction(action);

      if (!webhookEvent) return;

      const context = Schema.is(Schema.JsonObject)(metadata)
        ? metadata
        : metadata === undefined
          ? {}
          : { metadata };

      yield* dispatchWebhookEvent(
        db,
        {
          organizationId: ctx.organization.id,
          type: webhookEvent,
          data: { ...context, targetType, targetId },
        },
        webhookOptions,
      );
    });

  const WEBHOOK_EVENTS = new Set<string>(WEBHOOK_EVENT_TYPES);

  /**
   * Compose and send the branded invitation. Returns whether a provider
   * accepted the message; failures never expose the token or full address.
   */
  const sendInvitationEmail = (
    organization: {
      readonly name: string;
      readonly displayName?: string | null;
      readonly logo?: string | null;
      readonly supportEmail?: string | null;
      readonly brandColor?: string | null;
    },
    inviterName: string,
    input: {
      readonly email: string;
      readonly roleName: string;
      readonly inviteUrl: string;
      readonly expiresAt: Date;
    },
  ) =>
    Effect.gen(function* () {
      if (!email) {
        yield* Effect.logWarning("Invitation email skipped: the deployment has no email binding");

        return false;
      }

      const branding = resolveTenantBranding(organization);

      const message = invitationEmail({
        tenantName: branding.displayName,
        logoUrl: branding.logo,
        brandColor: branding.brandColor,
        roleLabel: input.roleName,
        inviterName,
        invitedEmail: input.email,
        inviteUrl: input.inviteUrl,
        expiresAt: input.expiresAt,
        supportEmail: branding.supportEmail,
      });

      const configuredSupport = organization.supportEmail?.trim();

      const replyTo =
        configuredSupport && INVITATION_EMAIL_PATTERN.test(configuredSupport)
          ? { name: branding.displayName, email: configuredSupport }
          : undefined;

      return yield* Effect.tryPromise({
        try: () =>
          email.send({
            to: input.email,
            from: {
              name: branding.displayName,
              email: invitationFromEmail ?? DEFAULT_INVITATION_FROM,
            },
            replyTo,
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
        catch: (cause) => cause,
      }).pipe(
        Effect.as(true),
        Effect.catch(() =>
          Effect.logWarning("Invitation email could not be sent").pipe(Effect.as(false)),
        ),
      );
    });

  const normalizeWebhookEvents = (events: ReadonlyArray<string>): string[] => [
    ...new Set(events.filter((event) => WEBHOOK_EVENTS.has(event))),
  ];

  const webhookDescription = (value: string | null | undefined): string | null => {
    const trimmed = value?.trim();

    if (!trimmed) return null;

    if (trimmed.length > 500)
      throw new EnterpriseBadRequest({ message: "Description must be 500 characters or fewer" });

    return trimmed;
  };

  const requireWebhookUrl = (url: string): string => {
    const problem = webhookUrlProblem(url);

    if (problem) throw new EnterpriseBadRequest({ message: problem });

    return url.trim();
  };

  const requireWebhookSigning = (): string => {
    if (!authSecret)
      throw new EnterpriseBadRequest({
        message: "Webhook signing is not configured on this deployment",
      });

    return authSecret;
  };

  const loadWebhookEndpoint = (organizationId: string, webhookId: string) =>
    Effect.gen(function* () {
      const endpoint = yield* db.query.webhookEndpoint.findFirst({
        where: { id: webhookId, organizationId },
      });

      if (!endpoint)
        return yield* Effect.fail(
          new EnterpriseNotFound({ message: "Webhook endpoint not found" }),
        );

      return endpoint;
    });

  const insertWebhookEndpoint = (input: {
    readonly organizationId: string;
    readonly url: string;
    readonly description: string | null;
    readonly events: string[];
    readonly enabled: boolean;
  }) =>
    Effect.gen(function* () {
      const signingSecret = yield* Effect.try({
        try: () => requireWebhookSigning(),
        catch: (cause) =>
          cause instanceof EnterpriseBadRequest
            ? cause
            : new EnterpriseBadRequest({ message: "Webhook signing is not configured" }),
      });

      const secret = generateWebhookSecret();

      const sealed = yield* Effect.tryPromise({
        try: () => sealSecret(signingSecret, secret),
        catch: () =>
          new EnterpriseBadRequest({ message: "Could not encrypt the webhook signing secret" }),
      });

      const webhookId = id();
      const timestamp = now();
      yield* db.insert(schema.webhookEndpoint).values({
        id: webhookId,
        organizationId: input.organizationId,
        url: input.url,
        secret: sealed,
        secretPrefix: webhookSecretPrefix(secret),
        description: input.description,
        eventFilters: input.events,
        enabled: input.enabled,
        lastDeliveryAt: null,
        lastDeliveryStatus: null,
        consecutiveFailures: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      const endpoint = yield* db.query.webhookEndpoint.findFirst({
        where: { id: webhookId, organizationId: input.organizationId },
      });

      if (!endpoint)
        return yield* Effect.fail(
          new EnterpriseInternal({ message: "Webhook endpoint write did not persist" }),
        );

      return { endpoint, secret };
    });

  /**
   * Report a partial/total APNs wake-up failure for a policy change as
   * `policy.deployment_failed`. The customer-facing policy write still
   * succeeds; devices converge on their next poll.
   */
  const reportPolicyDeliveryFailure = (
    organizationId: string,
    context: Record<string, Schema.Json>,
    result: {
      readonly requested: number;
      readonly failed: ReadonlyArray<{ readonly deviceId: string }>;
    },
  ) =>
    // A deployment with no push transport is not a policy deployment failure;
    // devices still converge on their next poll.
    apns.available && result.failed.length > 0
      ? dispatchWebhookEvent(
          db,
          {
            organizationId,
            type: "policy.deployment_failed",
            data: {
              ...context,
              requested: result.requested,
              failed: result.failed.length,
              devices: result.failed.slice(0, 25).map((failure) => failure.deviceId),
            },
          },
          webhookOptions,
        )
      : Effect.void;

  const pushPolicyDevices = (
    organizationId: string,
    context: Record<string, Schema.Json>,
    deviceIds: ReadonlyArray<string>,
  ) =>
    Effect.gen(function* () {
      const result = yield* applePush.pushAppleDevices(deviceIds);
      yield* reportPolicyDeliveryFailure(organizationId, context, result);

      return result;
    });

  /**
   * Wake Apple devices and resync Android after a membership change.
   *
   * Delivery failures are reported through the same webhook as direct policy
   * assignment instead of being swallowed; Windows has no push transport and
   * converges on its next scheduled OMA-DM check-in.
   */
  const refreshDevicePolicies = (
    organizationId: string,
    deviceIds: ReadonlyArray<string>,
    policyId?: string,
  ) =>
    Effect.gen(function* () {
      if (deviceIds.length === 0) return;

      yield* pushPolicyDevices(
        organizationId,
        policyId ? { policyId } : { reason: "user-assignment" },
        deviceIds,
      );
      yield* syncAndroidDevices(organizationId, deviceIds);
    });

  /**
   * Directory sync reports membership and enabled-state changes by user; map
   * them to linked devices so their policy is recomputed and pushed.
   */
  const refreshDevicesForDirectoryUsers = (
    organizationId: string,
    userIds: ReadonlyArray<string>,
  ) =>
    Effect.gen(function* () {
      const ids = [...new Set(userIds)];

      if (ids.length === 0) return;

      const links = yield* db
        .select({ deviceId: schema.deviceUser.deviceId })
        .from(schema.deviceUser)
        .where(
          and(
            eq(schema.deviceUser.organizationId, organizationId),
            inArray(schema.deviceUser.userId, ids),
          ),
        );

      yield* refreshDevicePolicies(organizationId, [
        ...new Set(links.map((link) => link.deviceId)),
      ]);
    });

  const ensureStripeCustomer = (organization: EnterpriseOrganization) =>
    Effect.gen(function* () {
      if (organization.stripeCustomerId) return organization.stripeCustomerId;

      if (!stripe) return yield* Effect.fail(billingNotConfigured());

      // Search is the cheap path. Some Stripe accounts/API versions reject
      // search, so fall back to a single bounded page instead of iterating the
      // entire customer list.
      const search = yield* Effect.exit(
        stripe.customers.search({
          query: `metadata["organizationId"]:"${organization.id}" AND metadata["customerType"]:"organization"`,
          limit: 1,
        }),
      );

      let stripeCustomer: StripeCustomer | undefined = Exit.isSuccess(search)
        ? search.value.data[0]
        : undefined;

      if (!stripeCustomer && Exit.isFailure(search)) {
        const page = yield* stripe
          .effect((client: StripeClientLike) => client.customers.list({ limit: 100 }))
          .pipe(Effect.mapError(() => billingUnavailable()));

        stripeCustomer = page.data.find(
          (customer: StripeCustomer) =>
            customer.metadata?.organizationId === organization.id &&
            customer.metadata?.customerType === "organization",
        );
      }

      stripeCustomer ??= yield* stripe.customers
        .create({
          name: organization.name,
          metadata: { organizationId: organization.id, customerType: "organization" },
        })
        .pipe(Effect.mapError(() => billingUnavailable()));

      yield* db
        .update(schema.organization)
        .set({ stripeCustomerId: stripeCustomer.id })
        .where(eq(schema.organization.id, organization.id));

      return stripeCustomer.id;
    });

  const listTenantInfo = (userId: string) =>
    Effect.gen(function* () {
      const rows = yield* db
        .select({
          id: schema.organization.id,
          name: schema.organization.name,
          slug: schema.organization.slug,
          logo: schema.organization.logo,
          displayName: schema.organization.displayName,
          supportEmail: schema.organization.supportEmail,
          brandColor: schema.organization.brandColor,
          role: schema.member.role,
          customRoleId: schema.member.customRoleId,
        })
        .from(schema.member)
        .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
        .where(eq(schema.member.userId, userId));

      return yield* Effect.forEach(rows, (row: any) =>
        Effect.gen(function* () {
          const role = yield* resolveTenantRole(db, {
            role: row.role,
            organizationId: row.id,
            customRoleId: row.customRoleId ?? null,
          });

          return {
            id: row.id,
            name: row.name,
            slug: row.slug,
            logo: row.logo ?? null,
            displayName: row.displayName ?? null,
            supportEmail: row.supportEmail ?? null,
            brandColor: row.brandColor ?? null,
            role: row.role,
            roleId: role.roleId,
            roleName: role.roleName,
            roleKind: role.roleKind,
            permissions: [...role.permissions],
          };
        }),
      );
    });

  const memberCount = (tenantId: string) =>
    Effect.gen(function* () {
      const [members] = yield* db
        .select({ value: count() })
        .from(schema.member)
        .where(eq(schema.member.organizationId, tenantId));

      return members?.value ?? 0;
    });

  const ownerCount = (tenantId: string) =>
    Effect.gen(function* () {
      const members = yield* db
        .select({ role: schema.member.role, customRoleId: schema.member.customRoleId })
        .from(schema.member)
        .where(eq(schema.member.organizationId, tenantId));

      return members.filter((member) => isBuiltInOwnerMember(member)).length;
    });

  const assertTenantDevices = (tenantId: string, ids: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      if (ids.length === 0) return;

      const rows = yield* db
        .select({ id: schema.device.id })
        .from(schema.device)
        .where(
          and(eq(schema.device.organizationId, tenantId), inArray(schema.device.id, [...ids])),
        );

      if (rows.length !== new Set(ids).size)
        return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
    });

  const assertTenantPolicies = (tenantId: string, ids: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      if (ids.length === 0) return;

      const rows = yield* db
        .select({ id: schema.policy.id })
        .from(schema.policy)
        .where(
          and(eq(schema.policy.organizationId, tenantId), inArray(schema.policy.id, [...ids])),
        );

      if (rows.length !== new Set(ids).size)
        return yield* Effect.fail(new EnterpriseNotFound({ message: "Policy not found" }));
    });

  const assertTenantUsers = (tenantId: string, ids: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      if (ids.length === 0) return;

      const rows = yield* db
        .select({ id: schema.member.userId })
        .from(schema.member)
        .where(
          and(eq(schema.member.organizationId, tenantId), inArray(schema.member.userId, [...ids])),
        );

      if (rows.length !== new Set(ids).size)
        return yield* Effect.fail(
          new EnterpriseBadRequest({
            message: "One or more users are not members of this tenant.",
          }),
        );
    });

  const assertTenantUserGroups = (tenantId: string, ids: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      if (ids.length === 0) return;

      const rows = yield* db
        .select({ id: schema.userGroup.id })
        .from(schema.userGroup)
        .where(
          and(
            eq(schema.userGroup.organizationId, tenantId),
            inArray(schema.userGroup.id, [...ids]),
          ),
        );

      if (rows.length !== new Set(ids).size)
        return yield* Effect.fail(
          new EnterpriseBadRequest({
            message: "One or more directory groups are not part of this tenant.",
          }),
        );
    });

  const assertTenantApplications = (tenantId: string, ids: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      if (ids.length === 0) return;

      const rows = yield* db
        .select({ id: schema.application.id })
        .from(schema.application)
        .where(
          and(
            eq(schema.application.organizationId, tenantId),
            inArray(schema.application.id, [...ids]),
          ),
        );

      if (rows.length !== new Set(ids).size)
        return yield* Effect.fail(new EnterpriseNotFound({ message: "Application not found" }));
    });

  const applicationAssignedDeviceIds = (organizationId: string, applicationId: string) =>
    Effect.gen(function* () {
      const groups = yield* db
        .select()
        .from(schema.applicationGroup)
        .where(eq(schema.applicationGroup.applicationId, applicationId));

      const direct = yield* db
        .select()
        .from(schema.applicationDevice)
        .where(eq(schema.applicationDevice.applicationId, applicationId));

      const groupDevices = groups.length
        ? yield* db
            .select()
            .from(schema.groupDevice)
            .where(
              inArray(
                schema.groupDevice.groupId,
                groups.map((group) => group.groupId),
              ),
            )
        : [];

      const ids = new Set<string>([
        ...direct.map((row) => row.deviceId),
        ...groupDevices.map((row) => row.deviceId),
      ]);

      if (ids.size === 0) return [];

      const devices = yield* db
        .select()
        .from(schema.device)
        .where(
          and(
            eq(schema.device.organizationId, organizationId),
            inArray(schema.device.id, [...ids]),
          ),
        );

      return devices;
    });

  /** InstallApplication payload for a device-assigned VPP licence. */
  const vppInstallPayload = (adamId: string) => ({
    iTunesStoreID: Number(adamId),
    ManagementFlags: 1,
    InstallAsManaged: true,
    Options: { PurchaseMethod: 1 },
  });

  /** Active commands for one device, newest first; the input to queue planning. */
  const activeDeviceCommands = (deviceId: string) =>
    db
      .select()
      .from(schema.deviceCommand)
      .where(
        and(
          eq(schema.deviceCommand.deviceId, deviceId),
          inArray(schema.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES]),
        ),
      )
      .orderBy(desc(schema.deviceCommand.createdAt));

  /**
   * Queue an imperative command with its delivery budget, de-duplication and
   * supersede rules applied.
   *
   * Identical work that is still queued or in flight is returned instead of
   * inserted, so double-clicking "Erase" queues one erase. The unique index on
   * `(deviceId, dedupeKey)` makes that safe across concurrent requests: the
   * insert that loses the race reads back the winner.
   */
  const queueDeviceCommand = (input: {
    readonly organizationId: string;
    readonly deviceId: string;
    readonly requestType: string;
    readonly payload: CommandPayload;
    readonly at: Date;
  }): Effect.Effect<
    { readonly id: string; readonly payload: CommandPayload; readonly deduplicated: boolean },
    unknown,
    never
  > =>
    Effect.gen(function* () {
      const active = yield* activeDeviceCommands(input.deviceId);

      // A command past its deadline can never run, so it must not block an
      // identical new request either.
      const expired = active.filter(
        (row) => commandStatusIsActive(row.status) && commandIsExpired(row, input.at),
      );

      if (expired.length > 0)
        yield* db
          .update(schema.deviceCommand)
          .set({
            status: "expired",
            dedupeKey: null,
            resultStatus: RECONCILED_RESULT_STATUS,
            resultDetail: COMMAND_EXPIRED_DETAIL,
            updatedAt: input.at,
          })
          .where(
            and(
              eq(schema.deviceCommand.deviceId, input.deviceId),
              inArray(
                schema.deviceCommand.id,
                expired.map((row) => row.id),
              ),
            ),
          );

      const expiredIds = new Set(expired.map((row) => row.id));

      const plan = planCommandQueueing(
        active
          .filter((row) => !expiredIds.has(row.id))
          .map((row) => ({
            id: row.id,
            requestType: row.requestType,
            payload: row.payload,
            status: row.status,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            expiresAt: row.expiresAt,
          })),
        { requestType: input.requestType, payload: input.payload, now: input.at },
      );

      if (plan.duplicate)
        return {
          id: plan.duplicate.id,
          payload: plan.duplicate.payload ?? null,
          deduplicated: true,
        };

      if (plan.supersedeIds.length > 0)
        yield* db
          .update(schema.deviceCommand)
          .set({
            status: "superseded",
            dedupeKey: null,
            resultStatus: RECONCILED_RESULT_STATUS,
            resultDetail: `Superseded by ${input.requestType}.`,
            updatedAt: input.at,
          })
          .where(
            and(
              eq(schema.deviceCommand.deviceId, input.deviceId),
              inArray(schema.deviceCommand.id, [...plan.supersedeIds]),
            ),
          );

      const id = crypto.randomUUID();

      const dedupeKey = yield* Effect.promise(() =>
        commandDedupeKey(input.requestType, input.payload),
      );

      const insertValues = {
        id,
        organizationId: input.organizationId,
        deviceId: input.deviceId,
        requestType: input.requestType,
        payload: input.payload,
        status: "queued",
        dedupeKey,
        expiresAt: deviceCommandExpiresAt(input.requestType, input.at),
        resultStatus: null,
        resultDetail: null,
        createdAt: input.at,
        updatedAt: input.at,
      };

      // A concurrent click may have inserted the same work first. The no-op
      // update leaves that row untouched (bumping `updatedAt` would postpone
      // its retry timer).
      yield* db
        .insert(schema.deviceCommand)
        .values(insertValues)
        .onDuplicateKeyUpdate({ set: { requestType: input.requestType } });

      const winnerFor = () =>
        db
          .select({
            id: schema.deviceCommand.id,
            status: schema.deviceCommand.status,
            payload: schema.deviceCommand.payload,
          })
          .from(schema.deviceCommand)
          .where(
            and(
              eq(schema.deviceCommand.deviceId, input.deviceId),
              eq(schema.deviceCommand.dedupeKey, dedupeKey),
            ),
          )
          .limit(1);

      const [winner] = yield* winnerFor();

      if (!winner) return { id, payload: input.payload, deduplicated: false };

      if (commandStatusIsActive(winner.status))
        return {
          id: winner.id,
          payload: winner.payload,
          deduplicated: winner.id !== id,
        };

      // A terminal row can only still hold the key if it was closed by a path
      // that predates the lifecycle. Release it and queue the work again.
      yield* db
        .update(schema.deviceCommand)
        .set({ dedupeKey: null })
        .where(
          and(
            eq(schema.deviceCommand.deviceId, input.deviceId),
            eq(schema.deviceCommand.id, winner.id),
          ),
        );

      yield* db.insert(schema.deviceCommand).values(insertValues);

      return { id, payload: input.payload, deduplicated: false };
    });

  const assertTenantGroup = (tenantId: string, groupId: string) =>
    Effect.gen(function* () {
      const group = yield* db.query.enterpriseGroup.findFirst({
        where: { id: groupId, organizationId: tenantId },
      });

      if (!group) return yield* Effect.fail(new EnterpriseNotFound({ message: "Group not found" }));

      return group;
    });

  /**
   * Plan and usage for a tenant. The subscription row is authoritative for the
   * plan name; enforcement falls back to the configured default when the
   * subscription is absent or lapsed.
   */
  const billingSummary = (organizationId: string, userId: string) =>
    Effect.gen(function* () {
      const [subscription] = yield* db
        .select()
        .from(schema.subscription)
        .where(eq(schema.subscription.referenceId, organizationId))
        .limit(1);

      const [devices] = yield* db
        .select({ value: count() })
        .from(schema.device)
        .where(
          and(
            eq(schema.device.organizationId, organizationId),
            eq(schema.device.status, "enrolled"),
          ),
        );

      const planLimitDbError = () =>
        new EnterpriseDbError({ message: "Could not check plan limits" });

      const devicesUsed = yield* countOrganizationDevices(db, organizationId).pipe(
        Effect.mapError(planLimitDbError),
      );

      const deviceStatus = yield* deviceLimitForOrganization({
        db,
        organizationId,
        config: planLimits,
      }).pipe(Effect.mapError(planLimitDbError));

      const tenantStatus = yield* tenantLimitForAccount({
        db,
        userId,
        config: planLimits,
      }).pipe(Effect.mapError(planLimitDbError));

      return {
        plan: deviceStatus.plan,
        status: subscription?.status,
        billableDevices: devices?.value ?? 0,
        deviceLimit: deviceStatus.limit,
        tenantLimit: tenantStatus.limit,
        devicesUsed,
        tenantsUsed: tenantStatus.used,
        overDeviceLimit: deviceStatus.overLimit,
        overTenantLimit: tenantStatus.overLimit,
        limitsConfigured: Boolean(planLimits?.configured),
        subscriptionId: subscription?.stripeSubscriptionId ?? null,
        periodEnd: subscription?.periodEnd ? iso(subscription.periodEnd) : null,
        cancelAtPeriodEnd: Boolean(subscription?.cancelAtPeriodEnd),
        configured: billingConfigured,
      };
    });

  const PLAN_DEVICE_LIMIT_MESSAGE =
    "The device limit for this plan has been reached. Contact your administrator to upgrade.";

  /** Reject tenant creation when the account's plan does not allow another. */
  const assertTenantCreationAllowed = (userId: string) =>
    Effect.gen(function* () {
      const status = yield* tenantLimitForAccount({ db, userId, config: planLimits }).pipe(
        Effect.mapError(() => new EnterpriseDbError({ message: "Could not check plan limits" })),
      );

      if (!status.reached) return;

      return yield* Effect.fail(
        new EnterpriseForbidden({
          message: `Your plan allows ${status.limit ?? 0} tenant${
            status.limit === 1 ? "" : "s"
          }. Upgrade your plan or delete a tenant before creating another.`,
        }),
      );
    });

  /** Windows security inventory, shared by the device row and health endpoint. */
  const rowWindowsSecurity = (
    row: Pick<
      EnterpriseDevice,
      | "bitLockerEnabled"
      | "bitLockerStatus"
      | "tpmVersion"
      | "secureBootState"
      | "domainName"
      | "entraDeviceId"
      | "securityUpdatedAt"
    >,
  ) => ({
    bitLockerEnabled: row.bitLockerEnabled,
    bitLockerStatus: row.bitLockerStatus,
    tpmVersion: row.tpmVersion,
    secureBootState: row.secureBootState,
    domainName: row.domainName,
    entraDeviceId: row.entraDeviceId,
    updatedAt: row.securityUpdatedAt ? iso(row.securityUpdatedAt) : null,
  });

  /**
   * Persisted Windows policy delivery state. `pendingUris` are nodes delivered
   * but not acknowledged; `pendingRevertUris` are nodes whose `Delete` is in
   * flight. The deployment view uses this to distinguish applied, pending and
   * reverted settings.
   */
  const rowWindowsPolicy = (
    row: Pick<
      EnterpriseDevice,
      | "windowsPolicyApplied"
      | "windowsPolicyDelivered"
      | "windowsPolicyReverting"
      | "windowsPolicyFailures"
      | "windowsPolicyUpdatedAt"
      | "windowsPolicyRevertedAt"
    >,
  ) => {
    const applied = row.windowsPolicyApplied ?? [];
    const appliedSet = new Set(applied);
    const reverting = new Set(row.windowsPolicyReverting ?? []);

    return {
      appliedUris: [...applied],
      pendingUris: (row.windowsPolicyDelivered ?? [])
        .map((node) => node.uri)
        .filter((uri) => !appliedSet.has(uri) && !reverting.has(uri)),
      pendingRevertUris: [...reverting],
      failed: (row.windowsPolicyFailures ?? []).map((failure) => ({
        uri: failure.uri,
        resultStatus: failure.resultStatus,
        detail: failure.detail,
        at: failure.at,
      })),
      updatedAt: row.windowsPolicyUpdatedAt ? iso(row.windowsPolicyUpdatedAt) : null,
      revertedAt: row.windowsPolicyRevertedAt ? iso(row.windowsPolicyRevertedAt) : null,
    };
  };

  /** A random Recovery Lock password the operator can read back from the device page. */
  const recoveryLockPassword = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");

  /** The escrowed Recovery Lock password in plaintext, or null when unset. */
  const resolveRecoveryLockPassword = (device: { readonly id: string }) =>
    Effect.gen(function* () {
      if (!authSecret) return null;

      const [secret] = yield* db
        .select({ sealedValue: schema.deviceSecret.sealedValue })
        .from(schema.deviceSecret)
        .where(
          and(
            eq(schema.deviceSecret.deviceId, device.id),
            eq(schema.deviceSecret.kind, "recovery_lock_password"),
          ),
        )
        .limit(1);

      if (!secret) return null;

      return yield* Effect.tryPromise(() => openSecret(authSecret, secret.sealedValue)).pipe(
        Effect.orElseSucceed(() => null),
      );
    });

  /**
   * Payload for `RotateFileVaultKey`.
   *
   * Changing the personal recovery key requires the current key as the
   * FileVault password, and Apple wraps the replacement key for
   * `ReplyEncryptionCertificate` — the tenant escrow certificate, so the new key
   * is escrowable by the same reveal path.
   */
  const rotateFileVaultKeyPayload = (device: {
    readonly id: string;
    readonly organizationId: string;
  }) =>
    Effect.gen(function* () {
      if (!authSecret)
        return yield* Effect.fail(
          new EnterpriseNotConfigured({
            message: "FileVault key rotation requires AUTH_SECRET to unseal the current key",
          }),
        );

      const escrowKey = yield* loadTenantEscrowKey(db, device.organizationId);

      if (!escrowKey)
        return yield* Effect.fail(
          new EnterpriseBadRequest({
            message:
              "Generate or upload a FileVault escrow key before rotating a recovery key, otherwise the new key cannot be escrowed.",
          }),
        );

      const [secret] = yield* db
        .select({
          sealedValue: schema.deviceSecret.sealedValue,
          format: schema.deviceSecret.format,
        })
        .from(schema.deviceSecret)
        .where(
          and(
            eq(schema.deviceSecret.deviceId, device.id),
            eq(schema.deviceSecret.kind, "filevault_recovery_key"),
          ),
        )
        .limit(1);

      if (!secret)
        return yield* Effect.fail(
          new EnterpriseBadRequest({
            message:
              "No FileVault recovery key is escrowed for this device, so the key cannot be rotated. Collect security info first.",
          }),
        );

      const password = yield* revealRecoveryKey({
        db,
        organizationId: device.organizationId,
        sealedValue: secret.sealedValue,
        format: secret.format,
        authSecret,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new EnterpriseBadRequest({
              message:
                cause instanceof EscrowKeyError
                  ? cause.message
                  : "The escrowed recovery key could not be read",
            }),
        ),
      );

      let certificate: string;

      try {
        const der = certificateDer(escrowKey.certificatePem);
        let binary = "";

        for (const byte of der) binary += String.fromCharCode(byte);
        certificate = btoa(binary);
      } catch {
        return yield* Effect.fail(
          new EnterpriseInternal({
            message: "The stored FileVault escrow certificate could not be encoded",
          }),
        );
      }

      return {
        KeyType: "personal",
        FileVaultUnlock: { Password: password },
        ReplyEncryptionCertificate: certificate,
      } satisfies CommandPayload;
    });

  /**
   * Fingerprint of the tenant's FileVault escrow certificate, used to reject a
   * profile that pins a certificate Mattrax holds no private key for.
   */
  const tenantEscrowFingerprint = (organizationId: string) =>
    loadTenantEscrowKey(db, organizationId).pipe(
      Effect.map((row) => row?.certificateFingerprintSha256 ?? null),
      Effect.orElseSucceed(() => null),
    );

  const rowDevice = (row: EnterpriseDevice) => ({
    id: row.id,
    proto: row.proto,
    name: row.name,
    model: row.model,
    modelIdentifier: row.modelIdentifier,
    serial: row.serial,
    status: row.status,
    enrolledAt: iso(row.enrolledAt),
    lastSeenAt: iso(row.lastSeenAt),
    assetTag: row.assetTag,
    notes: row.notes,
    physicalName: row.physicalName,
    vendor: row.vendor,
    osEdition: row.osEdition,
    osVersion: row.osVersion,
    osBuild: row.osBuild,
    diskTotal: row.diskTotal,
    diskUsed: row.diskUsed,
    fileVaultEnabled: row.fileVaultEnabled,
    fileVaultStatus:
      row.fileVaultEnabled === null || row.fileVaultEnabled === undefined
        ? null
        : row.fileVaultEnabled
          ? ("enabled" as const)
          : ("disabled" as const),
    batteryHealth: row.batteryHealth,
    capabilities: row.capabilities,
    modelNumber: row.modelNumber,
    passcodePresent: row.passcodePresent,
    passcodeCompliant: row.passcodeCompliant,
    osUpdateInstallState: row.osUpdateInstallState,
    osUpdatePendingVersion: row.osUpdatePendingVersion,
    osUpdatePendingBuild: row.osUpdatePendingBuild,
    osUpdateFailureReason: row.osUpdateFailureReason,
    osUpdateFailureCount: row.osUpdateFailureCount,
    osUpdateFailedAt: row.osUpdateFailedAt ? iso(row.osUpdateFailedAt) : null,
    securityLockdownMode: row.securityLockdownMode,
    managedCertificateCount: row.managedCertificateCount,
    managementApps: Option.getOrNull(
      Schema.decodeUnknownOption(Schema.Array(DeviceManagementApp))(row.managementApps),
    ),
    inventoryUpdatedAt: row.inventoryUpdatedAt ? iso(row.inventoryUpdatedAt) : null,
    applicationsUpdatedAt: row.applicationsUpdatedAt ? iso(row.applicationsUpdatedAt) : null,
    // Staleness is derived rather than stored so a device that stops reporting
    // becomes stale without any write: Apple refreshes daily, Windows daily and
    // Android on every status notification.
    applicationsStale: applicationsInventoryStale({ updatedAt: row.applicationsUpdatedAt }),
    windows:
      row.proto === "win"
        ? { security: rowWindowsSecurity(row), policy: rowWindowsPolicy(row) }
        : null,
    actions: deviceAvailableActions({
      proto: row.proto,
      status: row.status,
      capabilities: Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.Json)(row.capabilities),
      ),
    }),
  });

  /** Android Management API fields shown on the device page. */
  const rowAndroidDevice = (row: typeof schema.androidDevice.$inferSelect) => ({
    managementMode: row.managementMode,
    ownership: row.ownership,
    state: row.state,
    apiLevel: row.apiLevel,
    securityPatchLevel: row.securityPatchLevel,
    appliedPolicyName: row.appliedPolicyName,
    appliedPolicyVersion: row.appliedPolicyVersion,
    enrollmentTokenName: row.enrollmentTokenName,
    disabledReason: row.disabledReason,
    networkOperator: row.networkOperator,
    totalRam: row.totalRam,
  });

  const rowDeviceApplication = (row: typeof schema.deviceApplication.$inferSelect) => ({
    bundleId: row.bundleId,
    name: row.name,
    version: row.version,
    shortVersion: row.shortVersion,
    publisher: row.publisher,
    bundleSize: row.bundleSize,
    dynamicSize: row.dynamicSize,
    hasUpdateAvailable: row.hasUpdateAvailable,
    isManaged: row.isManaged,
    lastReportedAt: iso(row.lastReportedAt),
  });

  /** Map Autopilot helper failures onto the public API error contract. */
  const autopilotApiError = (cause: unknown) => {
    if (cause instanceof AutopilotError) {
      if (cause.reason === "not_configured")
        return new EnterpriseNotConfigured({ message: cause.message });

      if (cause.reason === "invalid") return new EnterpriseBadRequest({ message: cause.message });

      return new EnterpriseUpstreamError({ message: cause.message });
    }

    return diagnoseError(
      new EnterpriseUpstreamError({
        message: "Microsoft Autopilot returned an unexpected response. Try again shortly.",
      }),
      { code: "upstream_error", details: { cause: String(cause) } },
    );
  };

  /**
   * Graph credentials plus the tenant's Entra id are both required. Missing
   * configuration fails closed before any Graph call.
   */
  const autopilotContext = (organizationId: string) =>
    Effect.gen(function* () {
      if (!azureGraph)
        return yield* Effect.fail(
          new EnterpriseNotConfigured({
            message:
              "Microsoft Graph is not configured for this deployment. Set AZURE_CLIENT_ID and AZURE_CLIENT_SECRET.",
          }),
        );

      const [config] = yield* db
        .select({ azureTenantId: schema.ssoConfig.azureTenantId })
        .from(schema.ssoConfig)
        .where(eq(schema.ssoConfig.organizationId, organizationId))
        .limit(1);

      const azureTenantId = config?.azureTenantId?.trim();

      if (!azureTenantId)
        return yield* Effect.fail(
          new EnterpriseNotConfigured({
            message:
              "Connect Entra ID for this tenant (Settings → Identity) before using Windows Autopilot.",
          }),
        );

      return { graph: azureGraph, azureTenantId };
    });

  const autopilotDevicesFor = (organizationId: string, limit = 1_000) =>
    db
      .select()
      .from(schema.autopilotDevice)
      .where(eq(schema.autopilotDevice.organizationId, organizationId))
      .orderBy(asc(schema.autopilotDevice.serial))
      .limit(limit);

  const deviceDeclarationsFor = (deviceId: string) =>
    db
      .select()
      .from(schema.deviceDeclaration)
      .where(eq(schema.deviceDeclaration.deviceId, deviceId));

  /** Public view of `device_apple` delivery telemetry (never the token). */
  const rowPushInfo = (apple: any) => ({
    configured: Boolean(apple?.token && apple?.pushMagic),
    lastAttemptAt: apple?.lastPushAt ? iso(apple.lastPushAt) : null,
    lastSuccessAt: apple?.lastPushOkAt ? iso(apple.lastPushOkAt) : null,
    lastError: apple?.lastPushError ?? null,
    lastErrorCode: apple?.lastPushErrorCode ?? null,
    consecutiveFailures: apple?.consecutivePushFailures ?? 0,
    invalidToken: apple?.lastPushErrorCode === "invalid_token",
  });

  type CertificateDevice = Pick<EnterpriseDevice, "id" | "dmIdentifier">;

  const certificateIdsForDevices = (devices: ReadonlyArray<CertificateDevice>) => [
    ...new Set(devices.flatMap((device) => certificateDeviceIdsFor(device))),
  ];

  const deviceCertificatesFor = (organizationId: string, device: CertificateDevice) =>
    db
      .select()
      .from(schema.scepIssuedCertificate)
      .where(
        and(
          eq(schema.scepIssuedCertificate.organizationId, organizationId),
          // Newly issued rows are keyed by the internal `device.id`; legacy
          // Windows rows used the DeviceID (`device.dmIdentifier`). Both must
          // resolve so health and revocation work across upgrades.
          inArray(schema.scepIssuedCertificate.deviceId, certificateDeviceIdsFor(device)),
        ),
      )
      .orderBy(desc(schema.scepIssuedCertificate.createdAt));

  /**
   * Mark every active identity certificate issued to these devices as revoked.
   * Returns the number of certificates that changed state. Tenant scoping is
   * applied in SQL so a crafted device id cannot revoke another tenant's certs.
   */
  const revokeDeviceCertificates = (
    organizationId: string,
    devices: ReadonlyArray<CertificateDevice>,
  ) =>
    Effect.gen(function* () {
      const deviceIds = certificateIdsForDevices(devices);

      if (deviceIds.length === 0) return 0;

      const active = yield* db
        .select({ serial: schema.scepIssuedCertificate.serial })
        .from(schema.scepIssuedCertificate)
        .where(
          and(
            eq(schema.scepIssuedCertificate.organizationId, organizationId),
            inArray(schema.scepIssuedCertificate.deviceId, deviceIds),
            isNull(schema.scepIssuedCertificate.revokedAt),
          ),
        );

      if (active.length === 0) return 0;
      const revokedAt = now();
      yield* db
        .update(schema.scepIssuedCertificate)
        .set({ revokedAt })
        .where(
          and(
            eq(schema.scepIssuedCertificate.organizationId, organizationId),
            inArray(schema.scepIssuedCertificate.deviceId, deviceIds),
            isNull(schema.scepIssuedCertificate.revokedAt),
          ),
        );

      return active.length;
    });

  const rowDeviceHealth = (
    device: Pick<
      EnterpriseDevice,
      | "status"
      | "lastSeenAt"
      | "diskTotal"
      | "diskUsed"
      | "proto"
      | "model"
      | "osEdition"
      | "fileVaultEnabled"
      | "batteryHealth"
      | "bitLockerEnabled"
      | "bitLockerStatus"
      | "tpmVersion"
      | "secureBootState"
      | "domainName"
      | "entraDeviceId"
      | "securityUpdatedAt"
    >,
    declarations: ReadonlyArray<{
      readonly identifier?: string;
      readonly declarationType?: string;
      readonly valid?: string | null;
      readonly active?: boolean;
      readonly reasons?: unknown;
    }>,
  ) =>
    deriveDeviceHealth({
      status: device.status,
      lastSeenAt: device.lastSeenAt,
      declarations,
      diskTotal: device.diskTotal,
      diskUsed: device.diskUsed,
      proto: device.proto,
      model: device.model,
      osEdition: device.osEdition,
      fileVaultEnabled: device.fileVaultEnabled,
      batteryHealth: device.batteryHealth,
      bitLockerEnabled: device.bitLockerEnabled,
      bitLockerStatus: device.bitLockerStatus,
      tpmVersion: device.tpmVersion,
      secureBootState: device.secureBootState,
      domainName: device.domainName,
      entraDeviceId: device.entraDeviceId,
      windowsSecurityReported: device.securityUpdatedAt != null,
    });

  const rowCertificate = (row: typeof schema.scepIssuedCertificate.$inferSelect) => ({
    serial: row.serial,
    notAfter: iso(row.notAfter),
    revokedAt: row.revokedAt ? iso(row.revokedAt) : null,
    createdAt: iso(row.createdAt),
  });

  const rowDeclaration = (declaration: any) => ({
    identifier: declaration.identifier,
    declarationType: declaration.declarationType,
    active: declaration.active,
    valid: declaration.valid,
    serverToken: declaration.serverToken,
    reasons: declaration.reasons,
    updatedAt: iso(declaration.updatedAt),
  });

  const rowGroup = (row: EnterpriseGroup, devicesCount = 0, policiesCount = 0) => ({
    id: row.id,
    name: row.name,
    notes: row.notes,
    kind: row.kind ?? ("manual" as const),
    rules:
      Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.NullOr(DynamicGroupRules))(row.rules),
      ) ?? null,
    lastEvaluatedAt: row.lastEvaluatedAt ? iso(row.lastEvaluatedAt) : null,
    devicesCount,
    policiesCount,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });

  const rowPolicy = (row: EnterprisePolicy, withConfigurations = false) =>
    Effect.gen(function* () {
      const base = {
        id: row.id,
        name: row.name,
        notes: row.notes,
        priority: row.priority ?? 0,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      };

      if (withConfigurations) {
        const configurations = yield* db
          .select()
          .from(schema.configuration)
          .where(eq(schema.configuration.policyId, row.id));

        Object.assign(base, {
          configurations: Object.fromEntries(configurations.map((item) => [item.kind, item.data])),
        });
      }

      return base;
    });

  const rowApplication = (row: EnterpriseApplication, groupsCount = 0, devicesCount = 0) => ({
    id: row.id,
    name: row.name,
    platform: row.platform,
    bundleId: row.bundleId,
    version: row.version,
    source: row.source,
    manifestUrl: row.manifestUrl,
    storeId: row.storeId,
    fileName: row.fileName,
    contentType: row.contentType,
    size: row.size ?? undefined,
    sha256: row.sha256,
    notes: row.notes,
    groupsCount,
    devicesCount,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });

  const rowEnrollment = (row: EnterpriseEnrollment) => ({
    id: row.id,
    code: row.code,
    enabledApple: row.enabledApple,
    enabledWindows: row.enabledWindows,
    enabledAndroid: row.enabledAndroid,
    enabledAssetTag: row.enabledAssetTag,
    maxDevices: row.maxDevices,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });

  const rowPreRegistration = (
    row: typeof schema.devicePreRegistration.$inferSelect,
    groupName: string | null,
  ) => ({
    id: row.id,
    serial: row.serial,
    name: row.name,
    assetTag: row.assetTag,
    notes: row.notes,
    groupId: row.groupId,
    groupName,
    consumedDeviceId: row.consumedDeviceId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });

  const getOrCreateEnrollment = (organizationId: string) =>
    Effect.gen(function* () {
      const existing = yield* db.query.enterpriseEnrollment.findFirst({
        where: { organizationId: organizationId },
      });

      if (existing) return existing;
      const timestamp = now();
      const enrollment = { id: id(), organizationId, createdAt: timestamp, updatedAt: timestamp };
      yield* db.insert(schema.enterpriseEnrollment).ignore().values(enrollment);

      return (
        (yield* db.query.enterpriseEnrollment.findFirst({
          where: { organizationId: organizationId },
        })) ?? {
          ...enrollment,
          code: null,
          enabledApple: true,
          enabledWindows: true,
          enabledAndroid: false,
          enabledAssetTag: false,
          maxDevices: 100,
        }
      );
    });

  /**
   * Append an enrollment diagnostic. Diagnostics must never break enrollment,
   * so every failure (including a malformed table in a half-migrated
   * deployment) is swallowed.
   */
  const recordEnrollmentAttempt = (input: {
    readonly organizationId: string;
    readonly enrollmentId: string;
    readonly platform: EnrollmentAttemptPlatform;
    readonly outcome: EnrollmentAttemptOutcome;
    readonly detail?: string;
    readonly ip?: string | null;
    readonly userAgent?: string | null;
  }) =>
    Effect.catchCause(
      Effect.gen(function* () {
        let ipHash: string | null = null;

        // Without a deployment secret a salted digest would be trivially
        // reversible (or identical across deployments), so do not persist an
        // address-derived value at all.
        if (input.ip && authSecret) {
          const bytes = new TextEncoder().encode(`${authSecret}:${input.ip}`);
          ipHash = (yield* sha256Hex(bytesToArrayBuffer(bytes))).slice(0, 32);
        }

        const timestamp = now();
        const cutoff = new Date(timestamp.getTime() - ENROLLMENT_ATTEMPT_DEDUPE_MS);

        const recent = yield* db
          .select()
          .from(schema.enrollmentAttempt)
          .where(
            and(
              eq(schema.enrollmentAttempt.organizationId, input.organizationId),
              eq(schema.enrollmentAttempt.enrollmentId, input.enrollmentId),
              gte(schema.enrollmentAttempt.createdAt, cutoff),
            ),
          );

        const duplicate = recent.some((row) => {
          const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);

          return (
            !Number.isNaN(createdAt.getTime()) &&
            createdAt >= cutoff &&
            (row.ipHash ?? null) === ipHash &&
            row.outcome === input.outcome
          );
        });

        const sameClient = recent.filter((row) => (row.ipHash ?? null) === ipHash).length;

        if (duplicate || sameClient >= ENROLLMENT_ATTEMPT_PER_CLIENT_LIMIT) return;
        yield* db.insert(schema.enrollmentAttempt).values({
          id: id(),
          organizationId: input.organizationId,
          enrollmentId: input.enrollmentId,
          platform: input.platform,
          outcome: input.outcome,
          detail: input.detail?.slice(0, 255) ?? null,
          ipHash,
          userAgent: input.userAgent?.slice(0, 255) ?? null,
          createdAt: timestamp,
        });

        // Only failed attempts are customer-actionable. Dedupe above already
        // stops a page-refresh loop from producing a delivery per request.
        if (input.outcome !== "ok")
          yield* dispatchWebhookEvent(
            db,
            {
              organizationId: input.organizationId,
              type: "enrollment.attempt_failed",
              occurredAt: timestamp,
              data: {
                enrollmentId: input.enrollmentId,
                platform: input.platform,
                outcome: input.outcome,
                detail: input.detail?.slice(0, 255) ?? null,
              },
            },
            webhookOptions,
          );
      }),
      () => Effect.void,
    );

  const requireApnsSecret = () =>
    Effect.gen(function* () {
      if (!authSecret)
        return yield* Effect.fail(
          new EnterpriseBadRequest({
            message: "APNs certificate management is not configured on this server",
          }),
        );

      return authSecret;
    });

  const escapeLike = (value: string) =>
    value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");

  /**
   * Build the tenant-scoped `WHERE` clause shared by the device search and CSV
   * export endpoints. Group filtering resolves the membership list up front
   * (one extra query) instead of joining per row.
   */
  const deviceSearchWhere = (organizationId: string, filters: DeviceSearchFilters) =>
    Effect.gen(function* () {
      const conditions: SQL[] = [eq(schema.device.organizationId, organizationId)];

      if (filters.q) {
        const pattern = `%${escapeLike(filters.q)}%`;

        const condition = or(
          like(schema.device.name, pattern),
          like(schema.device.physicalName, pattern),
          like(schema.device.serial, pattern),
          like(schema.device.model, pattern),
          like(schema.device.dmIdentifier, pattern),
          like(schema.device.assetTag, pattern),
          like(schema.device.notes, pattern),
        );

        if (condition) conditions.push(condition);
      }

      if (filters.status) conditions.push(eq(schema.device.status, filters.status));

      if (filters.proto) conditions.push(eq(schema.device.proto, filters.proto));

      if (filters.notSeenBefore)
        conditions.push(lt(schema.device.lastSeenAt, filters.notSeenBefore));

      if (filters.groupId) {
        const group = yield* db.query.enterpriseGroup.findFirst({
          where: { id: filters.groupId, organizationId },
        });

        if (!group)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Group not found" }));
        // Keep the membership set in SQL so large groups do not inflate the
        // parameter list (the group_device primary key covers this lookup).
        conditions.push(
          inArray(
            schema.device.id,
            db
              .select({ deviceId: schema.groupDevice.deviceId })
              .from(schema.groupDevice)
              .where(eq(schema.groupDevice.groupId, filters.groupId)),
          ),
        );
      }

      if (filters.health) {
        // Health is derived from declarations and inventory fields, not a
        // stored column. Resolving the matching ids in application code keeps
        // the filter exactly consistent with the dashboard counts. The scan is
        // bounded to one tenant (and the preceding SQL filters); a stored
        // health column would need a schema redesign and backfill.
        const devices = yield* db
          .select()
          .from(schema.device)
          .where(and(...conditions));

        const deviceIds = devices.map((device: EnterpriseDevice) => device.id);

        const declarations = deviceIds.length
          ? yield* db
              .select()
              .from(schema.deviceDeclaration)
              .where(inArray(schema.deviceDeclaration.deviceId, deviceIds))
          : [];

        const byDevice = new Map<string, Array<any>>();

        for (const declaration of declarations) {
          const list = byDevice.get(declaration.deviceId) ?? [];
          list.push(declaration);
          byDevice.set(declaration.deviceId, list);
        }

        const matching = devices
          .filter((device: EnterpriseDevice) => {
            const health = rowDeviceHealth(device, byDevice.get(device.id) ?? []);

            return filters.health === "stale" ? health.stale : health.level === filters.health;
          })
          .map((device: EnterpriseDevice) => device.id);

        conditions.push(
          matching.length > 0
            ? inArray(schema.device.id, matching)
            : // A sentinel id keeps the generated SQL valid when nothing matches.
              eq(schema.device.id, "__no_matching_health__"),
        );
      }

      if (filters.push) {
        // Resolve matching devices from `device_apple` up front, like the
        // health filter. The final device condition remains tenant-scoped, so
        // ids from other tenants can never leak rows.
        const appleRows = yield* db
          .select()
          .from(schema.deviceApple)
          .where(
            filters.push === "invalid"
              ? eq(schema.deviceApple.lastPushErrorCode, "invalid_token")
              : gt(schema.deviceApple.consecutivePushFailures, 0),
          );

        const deviceIds = appleRows.map((row: { deviceId: string }) => row.deviceId);
        conditions.push(
          deviceIds.length > 0
            ? inArray(schema.device.id, deviceIds)
            : eq(schema.device.id, "__no_matching_push__"),
        );
      }

      return and(...conditions);
    });

  const deviceOrderColumn = (sort: DeviceSearchFilters["sort"]) => {
    switch (sort) {
      case "lastSeenAt":
        return schema.device.lastSeenAt;
      case "enrolledAt":
        return schema.device.enrolledAt;
      case "status":
        return schema.device.status;
      default:
        return schema.device.name;
    }
  };

  const deviceOrder = (filters: DeviceSearchFilters) => {
    const column = deviceOrderColumn(filters.sort);

    const primary = filters.direction === "desc" ? desc(column) : asc(column);

    // A stable tiebreaker keeps offset pagination deterministic.
    return [primary, asc(schema.device.id)];
  };

  /** Load group memberships for a page of devices in one query (avoids N+1). */
  const deviceGroupsFor = (organizationId: string, deviceIds: string[]) =>
    Effect.gen(function* () {
      const groups = new Map<
        string,
        Array<{ id: string; name: string; source: "manual" | "dynamic" }>
      >();

      if (deviceIds.length === 0) return groups;

      const rows = yield* db
        .select({
          deviceId: schema.groupDevice.deviceId,
          id: schema.enterpriseGroup.id,
          name: schema.enterpriseGroup.name,
          source: schema.groupDevice.source,
        })
        .from(schema.groupDevice)
        .innerJoin(
          schema.enterpriseGroup,
          eq(schema.groupDevice.groupId, schema.enterpriseGroup.id),
        )
        .where(
          and(
            inArray(schema.groupDevice.deviceId, deviceIds),
            eq(schema.enterpriseGroup.organizationId, organizationId),
          ),
        );

      for (const row of rows) {
        const list = groups.get(row.deviceId) ?? [];
        list.push({ id: row.id, name: row.name, source: row.source });
        groups.set(row.deviceId, list);
      }

      return groups;
    });

  const loadAuditEntries = (organizationId: string, filters: AuditSearchFilters, take: number) =>
    Effect.gen(function* () {
      const rows = yield* db
        .select()
        .from(schema.auditLog)
        .where(auditWhere(schema, organizationId, filters))
        .orderBy(...auditOrder(schema))
        .limit(take)
        .offset(filters.offset);

      return rows;
    });

  /** Account-scoped equivalent: the subject column is the tenant boundary. */
  const loadAccountAuditEntries = (
    subjectUserId: string,
    filters: AuditSearchFilters,
    take: number,
  ) =>
    Effect.gen(function* () {
      const rows = yield* db
        .select()
        .from(schema.accountAuditLog)
        .where(accountAuditWhere(schema, subjectUserId, filters))
        .orderBy(...accountAuditOrder(schema))
        .limit(take)
        .offset(filters.offset);

      return rows;
    });

  /**
   * `normalizeAuditSearchQuery` throws for bad dates/cursors. Wrap the call so
   * a synchronous throw becomes a typed 400 instead of an Effect defect (500).
   */
  const normalizedAuditFilters = (query: Parameters<typeof normalizeAuditSearchQuery>[0]) =>
    Effect.try({
      try: () => normalizeAuditSearchQuery(query),
      catch: (cause) =>
        cause instanceof EnterpriseBadRequest
          ? cause
          : new EnterpriseBadRequest({ message: "Invalid audit filters" }),
    });

  /**
   * Return the private key for the tenant's in-progress CSR. We reuse the
   * pending key (multiple tabs) or the key from an existing certificate
   * (renewal) before generating a fresh one.
   */
  const loadApnsKey = (organizationId: string) =>
    Effect.gen(function* () {
      const secret = yield* requireApnsSecret();

      const pending = yield* db.query.applePushKey.findFirst({
        where: { organizationId },
      });

      if (pending) {
        const jwk: JsonWebKey = JSON.parse(
          yield* Effect.tryPromise({
            try: () => openSecret(secret, pending.encryptedPrivateKeyJwk),
            catch: () =>
              new EnterpriseBadRequest({ message: "Could not read the pending APNs key" }),
          }),
        );

        return { jwk, pending: true };
      }

      const certificate = yield* db.query.applePushCertificate.findFirst({
        where: { organizationId },
      });

      if (certificate?.encryptedKey) {
        const jwk: JsonWebKey = JSON.parse(
          yield* Effect.tryPromise({
            try: () => openSecret(secret, certificate.encryptedKey!),
            catch: () =>
              new EnterpriseBadRequest({ message: "Could not read the existing APNs key" }),
          }),
        );

        return { jwk, pending: false };
      }

      const keyPair = yield* Effect.tryPromise({
        try: () => generateApnsKeyPair(),
        catch: () => new EnterpriseBadRequest({ message: "Could not generate an APNs key pair" }),
      });

      const jwk = yield* Effect.tryPromise({
        try: () => exportPrivateKeyJwk(keyPair.privateKey),
        catch: () => new EnterpriseBadRequest({ message: "Could not export the APNs key" }),
      });

      const encryptedPrivateKeyJwk = yield* Effect.tryPromise({
        try: () => sealSecret(secret, JSON.stringify(jwk)),
        catch: () => new EnterpriseBadRequest({ message: "Could not seal the APNs key" }),
      });

      const timestamp = now();
      yield* db
        .insert(schema.applePushKey)
        .values({
          organizationId,
          encryptedPrivateKeyJwk,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .onDuplicateKeyUpdate({
          set: { encryptedPrivateKeyJwk, updatedAt: timestamp },
        });

      return { jwk, pending: true };
    });

  const remoteApnsVendor = () =>
    cloudAppleVendorCert && cloudAppleVendorKey
      ? { certificatePem: cloudAppleVendorCert, privateKeyPem: cloudAppleVendorKey }
      : undefined;

  const appleProfileSigner = appleProfileSigning
    ? createAppleProfileSigner(appleProfileSigning)
    : undefined;

  const appleProfileSigningFailed = (cause: unknown) =>
    Effect.logError(
      "Apple enrollment profile signing failed",
      cause instanceof Error ? cause.message : String(cause),
    ).pipe(
      Effect.flatMap(() =>
        Effect.fail(
          new EnterpriseInternal({
            message:
              "The Apple enrollment profile could not be signed. Contact your administrator.",
          }),
        ),
      ),
    );

  /**
   * Sign an enrollment profile download.
   *
   * An explicit deployment signing identity (`APPLE_PROFILE_SIGNING_*`) is a
   * self-hosted override and wins when configured. Otherwise the owning tenant's
   * SCEP CA signs the download, bootstrapping that CA on first use exactly like
   * the SCEP endpoints do. There is deliberately no unsigned fallback: a profile
   * that cannot be signed fails the download, so a device never installs an
   * unverified profile that could have been modified in transit.
   */
  const signAppleEnrollmentProfile = (plist: string, organizationId: string) =>
    Effect.gen(function* () {
      if (appleProfileSigner) {
        return yield* Effect.tryPromise({
          try: () => appleProfileSigner.sign(plist),
          catch: (cause) => cause,
        }).pipe(Effect.catch((cause) => appleProfileSigningFailed(cause)));
      }

      const ca = yield* ensureScepCa(ScepRepositoryLive.make(db, { authSecret }), {
        organizationId,
      }).pipe(Effect.catch((cause) => appleProfileSigningFailed(cause)));

      return yield* Effect.tryPromise({
        try: () =>
          signAppleProfilePlist(plist, {
            certificatePem: ca.certPem,
            privateKey: ca.privateKey,
          }),
        catch: (cause) => cause,
      }).pipe(Effect.catch((cause) => appleProfileSigningFailed(cause)));
    });

  /**
   * Public SCEP endpoint for a tenant. The tenant id is part of the path because
   * SCEP clients append their own `?operation=...` query to the configured URL.
   */
  const scepUrlFor = (organizationId: string) =>
    `${origin}/mdm/apple/scep/${encodeURIComponent(organizationId)}`;

  const tenantScepCaInfo = (
    organizationId: string,
    row: typeof schema.scepCa.$inferSelect,
    description: ScepCaDescription,
  ): TenantScepCaInfo => ({
    configured: true,
    scepUrl: scepUrlFor(organizationId),
    source: row.source,
    commonName: description.commonName,
    fingerprintSha256: description.fingerprintSha256,
    notAfter: iso(description.notAfter),
    createdAt: iso(row.createdAt),
    rotatedAt: row.rotatedAt ? iso(row.rotatedAt) : null,
  });

  /**
   * Assignment payloads accept either a bare id (legacy callers, defaults to
   * include) or `{ id, mode }`. Unassign ignores the mode.
   */
  const assignmentRefs = (
    values: ReadonlyArray<string | { id: string; mode?: "include" | "exclude" }> | undefined,
  ) =>
    (values ?? []).map((value) =>
      Schema.is(Schema.String)(value)
        ? { id: value, mode: "include" as const }
        : { id: value.id, mode: value.mode ?? "include" },
    );

  const dashboardWidgetRow = (row: typeof schema.dashboardWidget.$inferSelect) => ({
    id: row.id,
    type: Schema.decodeUnknownSync(DashboardWidgetType)(row.type),
    title: row.title,
    config: row.config,
    x: row.x,
    y: row.y,
    w: row.w,
    h: row.h,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });

  const dashboardSummaryRow = (row: typeof schema.dashboard.$inferSelect, widgetCount: number) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    isDefault: row.isDefault,
    widgetCount,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });

  const requireDashboard = (organizationId: string, dashboardId: string) =>
    Effect.gen(function* () {
      const row = yield* db.query.dashboard.findFirst({
        where: { id: dashboardId, organizationId },
      });

      if (!row)
        return yield* Effect.fail(new EnterpriseNotFound({ message: "Dashboard not found" }));

      return row;
    });

  const loadDashboardWidgets = (dashboardId: string) =>
    db
      .select()
      .from(schema.dashboardWidget)
      .where(eq(schema.dashboardWidget.dashboardId, dashboardId))
      .orderBy(asc(schema.dashboardWidget.y), asc(schema.dashboardWidget.x));

  const touchDashboard = (dashboardId: string) =>
    db
      .update(schema.dashboard)
      .set({ updatedAt: now() })
      .where(eq(schema.dashboard.id, dashboardId));

  /**
   * Load every device in a tenant with the derived health and application
   * inventory the shared query evaluator needs. Dashboard queries are
   * evaluated in application code so they have exactly the same semantics as
   * dynamic-group membership.
   */
  const loadDeviceSnapshots = (
    organizationId: string,
    candidates?: ReadonlyArray<typeof schema.device.$inferSelect>,
  ) =>
    Effect.gen(function* () {
      const rows = candidates
        ? [...candidates]
        : yield* db
            .select()
            .from(schema.device)
            .where(eq(schema.device.organizationId, organizationId))
            .orderBy(asc(schema.device.name), asc(schema.device.id));

      const ids = rows.map((row) => row.id);

      const declarations = ids.length
        ? yield* db
            .select()
            .from(schema.deviceDeclaration)
            .where(inArray(schema.deviceDeclaration.deviceId, ids))
        : [];

      const applications = ids.length
        ? yield* db
            .select({
              deviceId: schema.deviceApplication.deviceId,
              bundleId: schema.deviceApplication.bundleId,
              name: schema.deviceApplication.name,
            })
            .from(schema.deviceApplication)
            .where(
              and(
                eq(schema.deviceApplication.organizationId, organizationId),
                inArray(schema.deviceApplication.deviceId, ids),
              ),
            )
        : [];

      const declarationsByDevice = new Map<string, Array<any>>();

      for (const declaration of declarations) {
        const list = declarationsByDevice.get(declaration.deviceId) ?? [];
        list.push(declaration);
        declarationsByDevice.set(declaration.deviceId, list);
      }

      const applicationsByDevice = new Map<
        string,
        Array<{ bundleId: string; name: string | null }>
      >();

      for (const application of applications) {
        const list = applicationsByDevice.get(application.deviceId) ?? [];
        list.push({ bundleId: application.bundleId, name: application.name });
        applicationsByDevice.set(application.deviceId, list);
      }

      return rows.map((row) => ({
        row,
        health: rowDeviceHealth(row, declarationsByDevice.get(row.id) ?? []),
        applications: applicationsByDevice.get(row.id) ?? [],
      }));
    });

  const builtInRoleDescription = (role: string) => {
    switch (role) {
      case "owner":
        return "Full control including deleting the tenant.";
      case "admin":
        return "Runs the tenant but cannot delete it.";
      default:
        return "Read-only access to tenant data.";
    }
  };

  const groupBucketOrder = (groupBy: string | undefined): ReadonlyArray<string> | undefined => {
    switch (groupBy) {
      case "health":
        return ["Healthy", "Attention", "Critical", "Unknown"];
      case "platform":
        return ["Apple", "Windows", "Android", "Unknown"];
      default:
        return undefined;
    }
  };

  const runDashboardQuery = (organizationId: string, payload: DashboardQueryRequest) =>
    Effect.gen(function* () {
      const timestamp = now();
      const limit = Math.min(Math.max(Math.trunc(Number(payload.limit ?? 100)) || 100, 1), 500);

      const snapshots = (yield* loadDeviceSnapshots(organizationId)).filter((snapshot) =>
        evaluateDeviceQuery(
          payload.query,
          {
            ...snapshot.row,
            health: snapshot.health,
            applications: snapshot.applications,
          },
          { now: timestamp },
        ),
      );

      if (payload.dataset === "devices") {
        const buckets = payload.groupBy
          ? toBuckets(
              snapshots.map((snapshot) =>
                deviceBucket(snapshot.row, payload.groupBy!, snapshot.health, timestamp),
              ),
              groupBucketOrder(payload.groupBy),
            )
          : [];

        return {
          total: snapshots.length,
          buckets,
          rows: snapshots.slice(0, limit).map((snapshot) => ({
            id: snapshot.row.id,
            name: snapshot.row.name,
            platform: snapshot.row.proto,
            osVersion: snapshot.row.osVersion,
            model: snapshot.row.model,
            serial: snapshot.row.serial,
            status: snapshot.row.status,
            health: snapshot.health.level,
            lastSeenAt: iso(snapshot.row.lastSeenAt),
            enrolledAt: iso(snapshot.row.enrolledAt),
          })),
        };
      }

      const matchingIds = snapshots.map((snapshot) => snapshot.row.id);

      const applications = matchingIds.length
        ? yield* db
            .select()
            .from(schema.deviceApplication)
            .where(
              and(
                eq(schema.deviceApplication.organizationId, organizationId),
                inArray(schema.deviceApplication.deviceId, matchingIds),
              ),
            )
        : [];

      type SoftwareGroup = {
        bundleId: string;
        name: string | null;
        version: string | null;
        isManaged: boolean;
        hasUpdateAvailable: boolean;
        devices: Set<string>;
      };

      const groups = new Map<string, SoftwareGroup>();

      for (const application of applications) {
        const group = groups.get(application.bundleId) ?? {
          bundleId: application.bundleId,
          name: application.name,
          version: application.version,
          isManaged: false,
          hasUpdateAvailable: false,
          devices: new Set<string>(),
        };

        group.name ??= application.name;
        group.version ??= application.version;
        group.isManaged ||= application.isManaged;
        group.hasUpdateAvailable ||= application.hasUpdateAvailable;
        group.devices.add(application.deviceId);
        groups.set(application.bundleId, group);
      }

      const software = [...groups.values()].sort((left, right) =>
        (left.name ?? left.bundleId).localeCompare(right.name ?? right.bundleId),
      );

      const buckets = payload.groupBy
        ? toBuckets(
            software.map((application) =>
              payload.groupBy === "name"
                ? (application.name ?? application.bundleId)
                : softwareBucket(application, payload.groupBy!),
            ),
            payload.groupBy === "managed"
              ? ["Managed", "Unmanaged"]
              : payload.groupBy === "updates" || payload.groupBy === "hasUpdate"
                ? ["Update available", "Up to date"]
                : undefined,
          )
        : [];

      return {
        total: software.length,
        buckets,
        rows: software.slice(0, limit).map((application) => ({
          id: application.bundleId,
          name: application.name ?? application.bundleId,
          bundleId: application.bundleId,
          version: application.version,
          managed: application.isManaged,
          deviceCount: application.devices.size,
        })),
      };
    });

  const mePayload = (user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly emailVerified: boolean;
    readonly image?: string | null;
    readonly totpEnabled?: boolean | null;
    readonly passkeyEnabled?: boolean | null;
  }) =>
    Effect.gen(function* () {
      // Do not disclose tenant membership to an unverified account. The
      // verification screen only needs the user record.
      const tenants = user.emailVerified ? yield* listTenantInfo(user.id) : [];

      const memberships = yield* db.query.member.findMany({
        where: { userId: user.id },
      });

      // The requirement is a tenant property and binds every role, so it is
      // reported for any membership rather than only owner/admin ones.
      const mfaRequired = yield* Effect.gen(function* () {
        const organizationIds = memberships.map((membership) => membership.organizationId);

        if (organizationIds.length === 0) return false;

        const requiring = yield* db
          .select({ id: schema.organization.id })
          .from(schema.organization)
          .where(
            and(
              inArray(schema.organization.id, organizationIds),
              eq(schema.organization.requireMfa, true),
            ),
          )
          .limit(1);

        return requiring.length > 0;
      });

      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          image: user.image,
          mfaEnabled: hasMfaFactor(user),
          totpEnabled: user.totpEnabled === true,
          passkeyEnabled: user.passkeyEnabled === true,
          mfaRequired,
        },
        tenants,
      };
    });

  /**
   * The Windows MDM provider id is fixed by the provisioning document issued
   * by the management backend. The server-initiated unenroll Exec node must
   * address the same provider, or the device ignores the command.
   */
  const WINDOWS_MDM_PROVIDER_ID = "Mattrax";

  const backupActionFailure = (error: BackupActionError) => {
    switch (error.reason) {
      case "not_found":
        return new EnterpriseNotFound({ message: error.message });
      case "running":
        return new EnterpriseConflict({ message: error.message });
      case "not_restorable":
        return new EnterpriseBadRequest({ message: error.message });
      case "storage":
        return new EnterpriseR2InternalError({ message: error.message });
      case "database":
        return new EnterpriseDbError({ message: error.message });
    }
  };

  const restoreFailure = (error: TenantRestoreError) => {
    switch (error.reason) {
      case "invalid_bundle":
        return new EnterpriseBadRequest({ message: error.message });
      case "snapshot_failed":
        return new EnterpriseInternal({ message: error.message });
      case "write_failed":
        return new EnterpriseInternal({ message: error.message });
    }
  };

  /**
   * Send every enrolled device its platform's unenroll signal before the rows
   * disappear. Unreachable devices do not abort the teardown (an offline laptop
   * must not pin a tenant forever); they are reported to the operator instead.
   */
  const teardownDevices = (organizationId: string) =>
    Effect.gen(function* () {
      const devices = yield* db
        .select()
        .from(schema.device)
        .where(
          and(
            eq(schema.device.organizationId, organizationId),
            inArray(schema.device.status, ["enrolled", "unenrolling"]),
          ),
        );

      const unreachable: UnreachableDevice[] = [];
      let contacted = 0;
      const byId = new Map(devices.map((device) => [device.id, device]));
      const apple = devices.filter((device) => device.proto === "apple");
      const alreadyUnenrolling = apple.filter((device) => device.status === "unenrolling");

      const toPush = apple
        .filter((device) => device.status === "enrolled")
        .map((device) => device.id);

      contacted += alreadyUnenrolling.length;

      if (toPush.length > 0) {
        const pushed = yield* applePush.pushAppleDevices(toPush, { concurrency: 4 });

        contacted += pushed.succeeded.length;

        for (const deviceId of pushed.failed.map((failure) => failure.deviceId))
          unreachable.push({
            id: deviceId,
            name: byId.get(deviceId)?.name ?? deviceId,
            platform: "apple",
            reason: "The APNs push failed, so the device did not receive its unenroll request.",
          });

        for (const deviceId of pushed.skipped)
          unreachable.push({
            id: deviceId,
            name: byId.get(deviceId)?.name ?? deviceId,
            platform: "apple",
            reason: "No APNs push token or push certificate is available for this device.",
          });

        // While the row still exists, a check-in from any pushed device now
        // receives the protocol's unenroll response (410) instead of Idle.
        yield* db
          .update(schema.device)
          .set({ status: "unenrolling" })
          .where(
            and(
              eq(schema.device.organizationId, organizationId),
              inArray(schema.device.id, toPush),
            ),
          );
      }

      for (const device of devices.filter((candidate) => candidate.proto === "win")) {
        const existing = yield* db.query.deviceCommand.findFirst({
          where: {
            deviceId: device.id,
            requestType: "WindowsUnenroll",
            status: "queued",
          },
        });

        // Queue the real unenroll CSP command in case the device checks in
        // during this request. Windows only applies it on a client-initiated
        // session, so the tenant row is usually gone before it is delivered;
        // the device is reported as needing manual retirement either way.
        if (!existing) {
          const timestamp = now();

          yield* db.insert(schema.deviceCommand).values({
            id: id(),
            organizationId,
            deviceId: device.id,
            requestType: "WindowsUnenroll",
            payload: {
              locURI: `./Vendor/MSFT/DMClient/Provider/${WINDOWS_MDM_PROVIDER_ID}/Unenroll`,
              data: WINDOWS_MDM_PROVIDER_ID,
            },
            status: "queued",
            resultStatus: null,
            resultDetail: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }

        unreachable.push({
          id: device.id,
          name: device.name,
          platform: "win",
          reason:
            "Windows only applies an unenroll command on its next check-in, which cannot happen once the tenant is removed. Retire the device from Windows Settings or wipe it.",
        });
      }

      const androidDevices = devices.filter((device) => device.proto === "android");

      if (androidDevices.length > 0) {
        const android = yield* Effect.serviceOption(AndroidManagement);

        const enterprise = yield* loadAndroidEnterprise(db, organizationId).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
        );

        const canDeprovision =
          Option.isSome(android) &&
          isAndroidConfigured(androidConfig) &&
          enterprise?.status === "active" &&
          Boolean(enterprise.enterpriseName);

        for (const device of androidDevices) {
          const linked =
            canDeprovision &&
            enterprise?.enterpriseName &&
            device.dmIdentifier?.startsWith(`${enterprise.enterpriseName}/devices/`);

          if (!linked || !Option.isSome(android)) {
            unreachable.push({
              id: device.id,
              name: device.name,
              platform: "android",
              reason:
                "This device is not linked to an active Android enterprise, so it could not be deprovisioned.",
            });
            continue;
          }

          const removed = yield* android.value
            .deleteDevice({ deviceName: device.dmIdentifier! })
            .pipe(
              Effect.match({
                onFailure: () => false,
                onSuccess: () => true,
              }),
            );

          if (removed) contacted++;
          else
            unreachable.push({
              id: device.id,
              name: device.name,
              platform: "android",
              reason: "Google rejected the device removal request.",
            });
        }
      }

      return {
        total: devices.length,
        contacted,
        unreachable,
      } satisfies DeviceUnenrollSummary;
    });

  /**
   * Cancel the tenant's Stripe subscription before the row disappears. A
   * deployment without Stripe credentials cannot cancel a subscription that
   * exists, so the teardown fails instead of silently billing a deleted tenant.
   */
  const teardownSubscription = (organization: EnterpriseOrganization) =>
    Effect.gen(function* () {
      const [row] = yield* db
        .select()
        .from(schema.subscription)
        .where(eq(schema.subscription.referenceId, organization.id))
        .limit(1);

      if (!row?.stripeSubscriptionId) return "none" as const;

      if (!stripe)
        return yield* Effect.fail(
          new Error(
            "This tenant has a Stripe subscription but billing is not configured on this deployment.",
          ),
        );

      const cancelled = yield* stripe.subscriptions.cancel(row.stripeSubscriptionId).pipe(
        // Stripe keeps cancelled subscriptions readable; a missing one means a
        // previous attempt already removed it.
        Effect.catchIf(
          (cause) => cause.statusCode === 404 || cause.code === "resource_missing",
          () => Effect.succeed(null),
        ),
      );

      return cancelled?.cancel_at_period_end ? ("at_period_end" as const) : ("cancelled" as const);
    });

  /**
   * The same check as `teardownSubscription` without cancelling anything, so a
   * deployment that cannot settle billing fails before devices are contacted.
   */
  const preflightTeardown = (organization: EnterpriseOrganization) =>
    Effect.gen(function* () {
      const [row] = yield* db
        .select({ stripeSubscriptionId: schema.subscription.stripeSubscriptionId })
        .from(schema.subscription)
        .where(eq(schema.subscription.referenceId, organization.id))
        .limit(1);

      if (row?.stripeSubscriptionId && !stripe)
        return yield* Effect.fail(
          new Error(
            "This tenant has a Stripe subscription but billing is not configured on this deployment.",
          ),
        );
    });

  const service = {
    /**
     * The account and tenant shell. Kept as one helper so bootstrap reuses the
     * exact `me` payload (and its database work) instead of issuing a second
     * query set behind a `getSession` call.
     */
    me: (request) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });
        yield* identifyUser(user);

        return yield* mePayload(user);
      }),
    bootstrap: (request) =>
      Effect.gen(function* () {
        const { user, session } = yield* auth.requireUser({ headers: request.headers });
        yield* identifyUser(user);

        const me = yield* mePayload(user);

        // A bearer-token caller has no browser session to snapshot. The web
        // Worker only calls bootstrap with the session cookie, so this is a
        // defensive answer rather than a supported sign-in path.
        if (!session)
          return {
            session: null,
            me,
            ssrToken: null,
            ssrTokenExpiresAt: null,
            ssrRevision: null,
            ssrRevisionExpiresAt: null,
          };

        const boundCookie = cookieValue(request.headers.cookie, sessionCookie);

        const signed =
          authSecret && boundCookie
            ? yield* signSsrToken(authSecret, {
                subjectId: user.id,
                sessionId: session.sessionId,
                sessionCookie: boundCookie,
                name: user.name,
                email: user.email,
                emailVerified: user.emailVerified,
                authRevision: user.authRevision,
                user: me.user,
                tenants: me.tenants,
              }).pipe(Effect.catch(() => Effect.succeed(undefined)))
            : undefined;

        // The revision cookie is what makes `ver` enforceable at the edge. It
        // is only useful alongside a token, so it shares the token's fate.
        const revision =
          signed && authSecret
            ? yield* signSsrRevision(authSecret, {
                sessionId: session.sessionId,
                authRevision: user.authRevision,
              }).pipe(Effect.catch(() => Effect.succeed(undefined)))
            : undefined;

        return {
          session: {
            sessionId: session.sessionId,
            subjectId: session.subjectId,
            claims: {
              name: session.claims.name,
              email: session.claims.email,
              emailVerified: session.claims.emailVerified,
            },
          },
          me,
          ssrToken: signed?.token ?? null,
          ssrTokenExpiresAt: signed?.expiresAt ?? null,
          ssrRevision: revision?.token ?? null,
          ssrRevisionExpiresAt: revision?.expiresAt ?? null,
        };
      }),
    updateMe: (request, payload) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });
        yield* identifyUser(user);
        const body: { name?: string; image?: string | null } = payload;
        yield* db
          .update(schema.user)
          .set({
            name: body.name ?? user.name,
            image: body.image === undefined ? user.image : body.image,
            updatedAt: now(),
          })
          .where(eq(schema.user.id, user.id));

        return ok;
      }),
    deleteMe: (request) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });
        yield* identifyUser(user);

        // Remove solo tenants with the account; keep shared tenants for the
        // remaining administrators.
        const memberships = yield* db.query.member.findMany({
          where: { userId: user.id },
        });

        for (const membership of memberships) {
          const [members] = yield* db
            .select({ value: count() })
            .from(schema.member)
            .where(eq(schema.member.organizationId, membership.organizationId));

          if ((members?.value ?? 0) <= 1) {
            yield* db
              .delete(schema.organization)
              .where(eq(schema.organization.id, membership.organizationId));
          } else {
            if (
              isBuiltInOwnerMember(membership) &&
              (yield* ownerCount(membership.organizationId)) <= 1
            )
              return yield* Effect.fail(
                new EnterpriseForbidden({
                  message: "Transfer ownership of this tenant before deleting your account.",
                }),
              );
            yield* db.delete(schema.member).where(eq(schema.member.id, membership.id));
          }
        }

        yield* db.delete(schema.deviceUser).where(eq(schema.deviceUser.userId, user.id));
        yield* db.delete(schema.accountApiToken).where(eq(schema.accountApiToken.userId, user.id));
        yield* db.delete(schema.invitation).where(eq(schema.invitation.inviterId, user.id));
        yield* db.delete(schema.member).where(eq(schema.member.userId, user.id));

        // Yielded Auth owns these tables; remove the subject's auth state.
        // In-flight passkey ceremonies carry no subject column and expire on
        // their own.
        const authTables = [authPending, authSessions, authCredentials, authIdentifiers];

        for (const table of authTables) {
          if (table) yield* db.delete(table).where(eq(table.subjectId, user.id));
        }

        yield* db
          .delete(schema.authPasskeyCredentials)
          .where(eq(schema.authPasskeyCredentials.subjectId, user.id));
        yield* db
          .delete(schema.authTotpFactors)
          .where(
            sql`JSON_UNQUOTE(JSON_EXTRACT(${schema.authTotpFactors.state}, '$.subjectId')) = ${user.id}`,
          );

        // The audit row outlives the account: `subject_user_id` is set null by
        // the foreign key and the email snapshot remains until retention
        // prunes it, so the deletion itself is still answerable later.
        yield* recordAccountAudit(db, {
          subjectUserId: user.id,
          subjectEmail: user.email,
          action: ACCOUNT_AUDIT.deleted,
          targetType: "account",
        }).pipe(Effect.catchCause(() => Effect.void));

        yield* db.delete(schema.user).where(eq(schema.user.id, user.id));

        return ok;
      }).pipe(Effect.tapCause((cause) => Effect.logError(`deleteMe failed: ${String(cause)}`))),
    listAccountSessions: (request) =>
      Effect.gen(function* () {
        const resolved = yield* auth.requireUser({ headers: request.headers });
        yield* identifyUser(resolved.user);

        return {
          sessions: yield* listUserSessions(db, resolved.user.id, resolved.session?.sessionId),
        };
      }),
    revokeAccountSession: (request, sessionId) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });
        yield* identifyUser(user);
        const revoked = yield* revokeUserSession(db, user.id, sessionId);

        if (!revoked)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Session not found" }));

        yield* recordAccountAudit(db, {
          subjectUserId: user.id,
          subjectEmail: user.email,
          action: ACCOUNT_AUDIT.sessionRevoked,
          targetType: "session",
          targetId: sessionId,
        }).pipe(Effect.catchCause(() => Effect.void));

        return ok;
      }),
    /**
     * Sign out everywhere. Every session row for the account is deleted,
     * including the caller's, and the security revision is bumped so any signed
     * artifact minted from a session is stale too.
     */
    revokeAllAccountSessions: (request) =>
      Effect.gen(function* () {
        const { user } = yield* requireStepUp(auth, request, "sessions-revoke-all");

        const { revoked } = yield* revokeAllUserSessions(db, user.id);

        yield* db
          .update(schema.user)
          .set({ authRevision: id(), updatedAt: now() })
          .where(eq(schema.user.id, user.id));

        yield* recordAccountAudit(db, {
          subjectUserId: user.id,
          subjectEmail: user.email,
          action: ACCOUNT_AUDIT.sessionsRevoked,
          targetType: "session",
          metadata: { revoked },
        }).pipe(Effect.catchCause(() => Effect.void));

        return { status: "ok" as const, revoked };
      }),
    searchAccountAuditLog: (request, query) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });
        yield* identifyUser(user);
        const filters = yield* normalizedAuditFilters(query);

        const rows = yield* loadAccountAuditEntries(user.id, filters, filters.limit + 1);
        const hasMore = rows.length > filters.limit;
        const page = hasMore ? rows.slice(0, filters.limit) : rows;
        let nextCursor: string | null = null;

        if (hasMore && page.length > 0) {
          const last = page[page.length - 1]!;

          nextCursor = filters.offsetPaging
            ? encodeAuditOffsetCursor(filters.offset + filters.limit)
            : encodeAuditCursor({ createdAt: last.createdAt, id: last.id });
        }

        return { entries: page.map((entry: any) => accountAuditEntry(entry)), nextCursor };
      }),
    exportAccountAuditLog: (request, query) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });
        yield* identifyUser(user);
        const format = query.format ?? "csv";

        // Exports always start at the newest matching row; a cursor from an
        // interactive page would silently export only the remainder.
        const filters = {
          ...(yield* normalizedAuditFilters(query)),
          cursor: undefined,
          offset: 0,
        };

        const rows = yield* loadAccountAuditEntries(user.id, filters, AUDIT_EXPORT_MAX_ROWS + 1);

        const truncated = rows.length > AUDIT_EXPORT_MAX_ROWS;

        const entries = (truncated ? rows.slice(0, AUDIT_EXPORT_MAX_ROWS) : rows).map(
          (entry: any) => accountAuditEntry(entry),
        );

        return {
          format,
          body: format === "json" ? auditJson(entries) : auditCsv(entries),
          truncated,
          rowCount: entries.length,
        };
      }),
    /**
     * Start the break-glass recovery ceremony. The answer is identical for
     * every address so the endpoint cannot be used to discover accounts.
     */
    requestAccountRecovery: (request, payload) =>
      Effect.gen(function* () {
        const email = payload.email.trim().toLowerCase();
        const address = clientAddress(request.headers);

        // Two independent windows: one per account and one per client, so
        // neither a single mailbox nor a single host can drive a loop.
        const allowed =
          recoveryLimiter.allow(`account:${email}`) &&
          recoveryLimiter.allow(`client:${address ?? "unknown"}`);

        if (!allowed)
          return yield* Effect.fail(
            diagnoseError(
              new EnterpriseBadRequest({
                message: "Too many recovery requests. Try again in an hour.",
              }),
              { code: "rate_limited", retryable: true },
            ),
          );

        return yield* startRecoveryRequest(
          { db, authSecret: authSecret ?? "", origin, email },
          { email },
        );
      }),
    verifyAccountRecovery: (request, payload) =>
      Effect.gen(function* () {
        // The proof link is rate limited as well: token guessing is otherwise
        // the only barrier for a 256-bit secret.
        const address = clientAddress(request.headers);

        if (!recoveryLimiter.allow(`verify:${address ?? "unknown"}`))
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Too many recovery attempts. Try again in an hour.",
            }),
          );

        // Recovery failures are typed internally; the public contract returns a
        // 400 so the caller never learns which check rejected the link.
        return yield* consumeRecoveryProof(
          { db, authSecret: authSecret ?? "", origin, email },
          payload,
        ).pipe(
          Effect.catchTag("RecoveryRejected", (error) =>
            Effect.fail(new EnterpriseBadRequest({ message: error.message })),
          ),
        );
      }),
    cancelEmailChange: (_request, payload) => auth.cancelEmailChange(payload),
    listTenants: (request) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });
        yield* identifyUser(user);

        if (!user.emailVerified)
          return yield* Effect.fail(
            new EnterpriseForbidden({
              message: "Verify your email address before accessing tenants.",
            }),
          );
        const tenants = yield* listTenantInfo(user.id);

        return { tenants };
      }),
    createTenant: (request, payload) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });
        yield* identifyUser(user);

        if (!user.emailVerified)
          return yield* Effect.fail(
            new EnterpriseForbidden({
              message: "Verify your email address before creating a tenant.",
            }),
          );

        const body: {
          name: string;
          slug: string;
          logo?: string | null;
          displayName?: string | null;
          supportEmail?: string | null;
          brandColor?: string | null;
          metadata?: Record<string, Schema.Json>;
        } = payload;

        yield* assertTenantCreationAllowed(user.id);

        const existing = yield* db.query.organization.findFirst({
          where: { slug: body.slug },
        });

        if (existing)
          return yield* Effect.fail(
            diagnoseError(
              new EnterpriseBadRequest({ message: "That tenant slug is already in use" }),
              { code: "slug_taken", field: "slug" },
            ),
          );
        const branding = yield* brandingOrFail(body);
        const tenantId = id();
        const timestamp = now();
        yield* db.insert(schema.organization).values({
          id: tenantId,
          name: body.name,
          slug: body.slug,
          logo: null,
          displayName: null,
          supportEmail: null,
          brandColor: null,
          ...branding,
          metadata: body.metadata ? JSON.stringify(body.metadata) : null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        yield* db.insert(schema.member).values({
          id: id(),
          organizationId: tenantId,
          userId: user.id,
          role: "owner",
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        yield* db.insert(schema.enterpriseEnrollment).ignore().values({
          id: tenantId,
          organizationId: tenantId,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        yield* audit(
          { user, organization: { id: tenantId } },
          "tenant.created",
          "tenant",
          tenantId,
          {
            name: body.name,
            slug: body.slug,
          },
        );

        return { id: tenantId };
      }),
    getTenant: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        return {
          ...ctx.organization,
          logo: ctx.organization.logo ?? null,
          displayName: ctx.organization.displayName ?? null,
          supportEmail: ctx.organization.supportEmail ?? null,
          brandColor: ctx.organization.brandColor ?? null,
          role: ctx.member.role,
          roleId: ctx.role.roleId,
          roleName: ctx.role.roleName,
          roleKind: ctx.role.roleKind,
          permissions: [...ctx.role.permissions],
          createdAt: iso(ctx.organization.createdAt),
        };
      }),
    exportTenant: (request, tenantId, query) =>
      Effect.gen(function* () {
        // The method-level RBAC permission (tenant.export) gates this bundle,
        // which contains member emails, application metadata and policy data.
        const ctx = yield* requireTenant(request, tenantId, "read");

        return yield* buildTenantExport(db, ctx.organization, {
          includeAudit: query?.includeAudit === "true" || query?.includeAudit === "1",
        });
      }),
    runTenantBackup: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const result = yield* runTenantBackupForTenant(db, storage, ctx.organization.id, "manual", {
          actor: { userId: ctx.user.id, email: ctx.user.email },
        }).pipe(
          Effect.mapError(
            () => new EnterpriseDbError({ message: "Could not record the backup run" }),
          ),
        );

        return backupRunInfo(result);
      }),
    listTenantBackups: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "read");

        const rows = yield* listTenantBackupRuns(db, ctx.organization.id).pipe(
          Effect.mapError(() => new EnterpriseDbError({ message: "Could not load backup runs" })),
        );

        return { backups: rows.map(backupRunInfo) };
      }),
    downloadTenantBackup: (request, tenantId, backupId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "read");
        yield* requireStepUp(auth, request, "backup-download");

        // Scoped lookup: an id from another tenant must look missing.
        const run = yield* db.query.backupRun.findFirst({
          where: { id: backupId, organizationId: ctx.organization.id },
        });

        if (!run || !run.r2Key || run.status !== "succeeded")
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "Backup not found or not restorable" }),
          );
        const r2 = yield* R2Storage;
        const object = yield* r2.get(run.r2Key);

        if (!object)
          return yield* Effect.fail(
            new EnterpriseR2FileNotFound({ message: "The backup object is no longer available" }),
          );

        const content = yield* Effect.tryPromise({
          try: () => object.text(),
          catch: () => new EnterpriseR2InternalError({ message: "Could not read the backup" }),
        });

        return {
          content,
          filename: `tenant-${safeFilename(ctx.organization.slug)}-backup-${iso(
            run.startedAt,
          ).slice(0, 10)}.json`,
        };
      }).pipe(Effect.provide(r2Layer)),
    pinTenantBackup: (request, tenantId, backupId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* requireStepUp(auth, request, "backup-pin");

        const run = yield* setBackupRetention(db, ctx.organization.id, backupId, "pinned", {
          userId: ctx.user.id,
          email: ctx.user.email,
        }).pipe(Effect.mapError(backupActionFailure));

        return backupRunInfo(run);
      }),
    unpinTenantBackup: (request, tenantId, backupId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* requireStepUp(auth, request, "backup-pin");

        const run = yield* setBackupRetention(db, ctx.organization.id, backupId, "default", {
          userId: ctx.user.id,
          email: ctx.user.email,
        }).pipe(Effect.mapError(backupActionFailure));

        return backupRunInfo(run);
      }),
    deleteTenantBackup: (request, tenantId, backupId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* requireStepUp(auth, request, "backup-delete");

        yield* deleteBackupRun(db, storage, ctx.organization.id, backupId, {
          userId: ctx.user.id,
          email: ctx.user.email,
        }).pipe(Effect.mapError(backupActionFailure));

        return ok;
      }),
    restoreTenantBackup: (request, tenantId, backupId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* requireStepUp(auth, request, "backup-restore");

        const body: { confirm?: string } = payload ?? {};

        return yield* restoreTenantFromBackup(db, storage, ctx.organization, {
          backupId,
          actor: { userId: ctx.user.id, email: ctx.user.email },
          confirm: body.confirm ?? "",
        }).pipe(
          Effect.mapError((error) =>
            error instanceof BackupActionError ? backupActionFailure(error) : restoreFailure(error),
          ),
        );
      }),
    importTenant: (request, payload) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });
        yield* identifyUser(user);
        const bundle: TenantImportRequest = payload;

        // The payload has already been decoded, so this bounds what a caller
        // can make us hold in memory (and what could be written in one go).
        const bytes = new TextEncoder().encode(JSON.stringify(bundle)).byteLength;

        if (bytes > TENANT_IMPORT_MAX_BYTES)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: `The bundle is too large (${Math.ceil(
                bytes / 1024,
              )} KB). The limit is ${TENANT_IMPORT_MAX_BYTES / 1024} KB.`,
            }),
          );
        const declaredBytes = Number(request.headers?.["content-length"]);

        if (Number.isFinite(declaredBytes) && declaredBytes > TENANT_IMPORT_MAX_BYTES)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: `The bundle is too large. The limit is ${TENANT_IMPORT_MAX_BYTES / 1024} KB.`,
            }),
          );

        if (bundle.version !== TENANT_EXPORT_VERSION)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: `Unsupported tenant bundle version ${String(
                bundle.version,
              )}. This server imports version ${TENANT_EXPORT_VERSION}.`,
            }),
          );

        const profile = bundle.tenant;

        if (!profile)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "The bundle is missing tenant details" }),
          );
        const name = importString(profile.name, 255);

        if (!name)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "The bundle tenant name is required" }),
          );

        if ((profile.name ?? "").trim().length > 255)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "The tenant name is longer than 255 characters" }),
          );
        const branding = yield* brandingOrFail(profile);
        const metadata = profile.metadata ? JSON.stringify(profile.metadata) : null;

        if (metadata && metadata.length > 60_000)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "The tenant metadata is too large (limit 60000 characters)",
            }),
          );
        const requestedSlug = slugBase((profile.slug ?? "").trim() || name);

        if (!requestedSlug)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "The bundle tenant slug is not usable" }),
          );

        const groups = bundle.groups ?? [];
        const policies = bundle.policies ?? [];
        const applications = bundle.applications ?? [];
        const preRegistrations = bundle.preRegistrations ?? [];

        for (const [label, rows] of [
          ["groups", groups],
          ["policies", policies],
          ["applications", applications],
          ["pre-registrations", preRegistrations],
        ] as const) {
          if (rows.length > TENANT_EXPORT_MAX_ROWS)
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `The bundle contains too many ${label} (${rows.length}); the limit is ${TENANT_EXPORT_MAX_ROWS}.`,
              }),
            );
        }

        const groupKeys = new Set<string>();

        for (const group of groups) {
          const key = importString(group.key, 255);

          if (!key)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Every group needs a key" }),
            );

          if (groupKeys.has(key))
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: `Duplicate group key "${key}"` }),
            );
          groupKeys.add(key);
          const groupName = importString(group.name, 255);

          if (!groupName)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: `Group "${key}" needs a name` }),
            );

          if ((group.notes ?? "").length > 10_000)
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Group "${groupName}" has notes longer than 10000 characters`,
              }),
            );

          if (!Array.isArray(group.policyKeys))
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Group "${groupName}" must list its policy assignments`,
              }),
            );
        }

        const policyKeys = new Set<string>();
        const policyConfigurations = new Map<string, Array<[string, Schema.Json]>>();

        for (const policy of policies) {
          const key = importString(policy.key, 255);

          if (!key)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Every policy needs a key" }),
            );

          if (policyKeys.has(key))
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: `Duplicate policy key "${key}"` }),
            );
          policyKeys.add(key);
          const policyName = importString(policy.name, 255);

          if (!policyName)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: `Policy "${key}" needs a name` }),
            );

          if ((policy.notes ?? "").length > 10_000)
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Policy "${policyName}" has notes longer than 10000 characters`,
              }),
            );
          const configurations = policy.configurations ?? {};

          if (!Schema.is(Schema.JsonObject)(configurations))
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Policy "${policyName}" has invalid configuration data`,
              }),
            );
          const entries: Array<[string, Schema.Json]> = [];

          for (const [kind, data] of Object.entries(configurations)) {
            if (data === null || data === undefined)
              return yield* Effect.fail(
                new EnterpriseBadRequest({
                  message: `Policy "${policyName}" has an empty "${kind}" configuration`,
                }),
              );

            const configuration = Option.getOrUndefined(
              Schema.decodeUnknownOption(Schema.Json)(data),
            );

            if (configuration === undefined)
              return yield* Effect.fail(
                new EnterpriseBadRequest({
                  message: `Policy "${policyName}" has invalid configuration data`,
                }),
              );
            // An imported bundle has no escrow key yet: a FileVault escrow
            // profile is rejected until the operator adds one and re-saves it.
            yield* validateConfiguration(kind, configuration, {
              escrowCertificateFingerprintSha256: null,
            }).pipe(
              Effect.mapError(
                (message) =>
                  new EnterpriseBadRequest({
                    message: `Policy "${policyName}": ${message}`,
                  }),
              ),
            );
            entries.push([kind, configuration]);
          }

          policyConfigurations.set(key, entries);
        }

        for (const group of groups) {
          for (const policyKey of group.policyKeys) {
            if (!policyKeys.has(policyKey))
              return yield* Effect.fail(
                new EnterpriseBadRequest({
                  message: `Group "${group.name}" references policy "${policyKey}", which is not in this bundle`,
                }),
              );
          }
        }

        const applicationKeys = new Set<string>();
        let applicationsWithoutFiles = 0;

        for (const application of applications) {
          const key = importString(application.key, 255);

          if (!key)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Every application needs a key" }),
            );

          if (applicationKeys.has(key))
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: `Duplicate application key "${key}"` }),
            );
          applicationKeys.add(key);
          const applicationName = importString(application.name, 255);

          if (!applicationName)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: `Application "${key}" needs a name` }),
            );

          if ((application.notes ?? "").length > 10_000)
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Application "${applicationName}" has notes longer than 10000 characters`,
              }),
            );

          if (
            application.platform !== "apple" &&
            application.platform !== "win" &&
            application.platform !== "android"
          )
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Application "${applicationName}" has an unknown platform`,
              }),
            );

          if (
            application.source !== "manifest" &&
            application.source !== "store" &&
            application.source !== "upload"
          )
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Application "${applicationName}" has an unknown source`,
              }),
            );

          if (application.platform === "apple" && application.source === "manifest") {
            if (!application.manifestUrl?.trim())
              return yield* Effect.fail(
                new EnterpriseBadRequest({
                  message: `Apple manifest application "${applicationName}" requires a manifest URL`,
                }),
              );
          }

          if (application.source === "store" && !Number.isSafeInteger(Number(application.storeId)))
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Application "${applicationName}" must have a whole-number store ID`,
              }),
            );

          if (
            application.size !== null &&
            application.size !== undefined &&
            (!Number.isSafeInteger(application.size) ||
              application.size < 0 ||
              application.size > 2_147_483_647)
          )
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Application "${applicationName}" has an invalid file size`,
              }),
            );

          if (!Array.isArray(application.groupKeys))
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Application "${applicationName}" must list its group assignments`,
              }),
            );

          for (const groupKey of application.groupKeys) {
            if (!groupKeys.has(groupKey))
              return yield* Effect.fail(
                new EnterpriseBadRequest({
                  message: `Application "${applicationName}" references group "${groupKey}", which is not in this bundle`,
                }),
              );
          }

          // Bundle bytes are metadata-only, so an uploaded object cannot be
          // restored and must be re-uploaded after import.
          if (application.source === "upload" || application.r2Key) applicationsWithoutFiles++;
        }

        const serials = new Set<string>();

        for (const row of preRegistrations) {
          const serial = importString(row.serial, 255);

          if (!serial)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Every pre-registration needs a serial" }),
            );

          if (serials.has(serial.toLowerCase()))
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Duplicate pre-registration serial "${serial}"`,
              }),
            );
          serials.add(serial.toLowerCase());

          if (row.groupKey && !groupKeys.has(row.groupKey))
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `Pre-registration "${serial}" references group "${row.groupKey}", which is not in this bundle`,
              }),
            );
        }

        const enrollment = bundle.enrollment;

        if (enrollment) {
          if (
            !Number.isSafeInteger(enrollment.maxDevices) ||
            enrollment.maxDevices < 0 ||
            enrollment.maxDevices > 1_000_000
          )
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: "The enrollment device limit must be a whole number between 0 and 1000000",
              }),
            );

          if (
            enrollment.code !== null &&
            enrollment.code !== undefined &&
            enrollment.code.length > 255
          )
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: "The enrollment code must be 255 characters or fewer",
              }),
            );
        }

        yield* assertTenantCreationAllowed(user.id);

        const timestamp = now();
        const tenantId = id();

        const result = yield* db.transaction((tx) =>
          Effect.gen(function* () {
            let slug = requestedSlug;
            let available = yield* tx.query.organization.findFirst({ where: { slug } });

            for (let attempt = 2; available && attempt <= 100; attempt++) {
              slug = `${requestedSlug.slice(0, 240)}-${attempt}`;
              available = yield* tx.query.organization.findFirst({ where: { slug } });
            }

            if (available)
              return yield* Effect.fail(
                new EnterpriseConflict({
                  message: "Could not derive a unique tenant slug for this import",
                }),
              );

            yield* tx.insert(schema.organization).values({
              id: tenantId,
              name,
              slug,
              logo: null,
              displayName: null,
              supportEmail: null,
              brandColor: null,
              ...branding,
              metadata,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
            yield* tx.insert(schema.member).values({
              id: id(),
              organizationId: tenantId,
              userId: user.id,
              role: "owner",
              createdAt: timestamp,
              updatedAt: timestamp,
            });
            yield* tx.insert(schema.enterpriseEnrollment).values({
              id: tenantId,
              organizationId: tenantId,
              code: enrollment?.code?.trim() || null,
              enabledApple: enrollment?.enabledApple,
              enabledWindows: enrollment?.enabledWindows,
              enabledAndroid: enrollment?.enabledAndroid,
              enabledAssetTag: enrollment?.enabledAssetTag,
              maxDevices: enrollment?.maxDevices,
              createdAt: timestamp,
              updatedAt: timestamp,
            });

            const policyIdByKey = new Map<string, string>();

            for (const policy of policies) {
              const policyId = id();
              policyIdByKey.set(policy.key, policyId);
              yield* tx.insert(schema.policy).values({
                id: policyId,
                organizationId: tenantId,
                name: importString(policy.name, 255)!,
                notes: policy.notes ?? null,
                createdAt: timestamp,
                updatedAt: timestamp,
              });
              const configurations = policyConfigurations.get(policy.key) ?? [];

              if (configurations.length > 0) {
                const values = yield* Effect.all(
                  configurations.map(([kind, data]) =>
                    Effect.map(hashJson(data), (hash) => ({ policyId, kind, data, hash })),
                  ),
                );

                yield* tx.insert(schema.configuration).values(values);
              }

              yield* tx.insert(schema.policyDeployment).values({
                id: id(),
                organizationId: tenantId,
                policyId,
                version: 1,
                snapshot: Object.fromEntries(configurations),
                createdByUserId: user.id,
                createdAt: timestamp,
              });
            }

            const groupIdByKey = new Map<string, string>();

            for (const group of groups) {
              const groupId = id();
              groupIdByKey.set(group.key, groupId);
              yield* tx.insert(schema.enterpriseGroup).values({
                id: groupId,
                organizationId: tenantId,
                name: importString(group.name, 255)!,
                notes: group.notes ?? null,
                createdAt: timestamp,
                updatedAt: timestamp,
              });
            }

            const groupPolicyValues: Array<{ groupId: string; policyId: string }> = [];

            for (const group of groups) {
              const groupId = groupIdByKey.get(group.key)!;

              for (const policyKey of group.policyKeys) {
                const policyId = policyIdByKey.get(policyKey);

                if (policyId) groupPolicyValues.push({ groupId, policyId });
              }
            }

            if (groupPolicyValues.length > 0)
              yield* tx.insert(schema.groupPolicy).ignore().values(groupPolicyValues);

            const applicationIdByKey = new Map<string, string>();

            for (const application of applications) {
              const applicationId = id();
              applicationIdByKey.set(application.key, applicationId);
              yield* tx.insert(schema.application).values({
                id: applicationId,
                organizationId: tenantId,
                name: importString(application.name, 255)!,
                platform: application.platform,
                bundleId: importString(application.bundleId, 255),
                version: importString(application.version, 255),
                source: application.source,
                manifestUrl: application.manifestUrl ?? null,
                storeId: importString(application.storeId, 255),
                fileName: importString(application.fileName, 255),
                contentType: importString(application.contentType, 255),
                size: application.size ?? null,
                sha256: importString(application.sha256, 255),
                // Object bytes are not in the bundle; never point a new tenant
                // at the source tenant's R2 key.
                r2Key: null,
                notes: application.notes ?? null,
                createdAt: timestamp,
                updatedAt: timestamp,
              });
            }

            const applicationGroupValues: Array<{ groupId: string; applicationId: string }> = [];

            for (const application of applications) {
              const applicationId = applicationIdByKey.get(application.key)!;

              for (const groupKey of application.groupKeys) {
                const groupId = groupIdByKey.get(groupKey);

                if (groupId) applicationGroupValues.push({ groupId, applicationId });
              }
            }

            if (applicationGroupValues.length > 0)
              yield* tx.insert(schema.applicationGroup).ignore().values(applicationGroupValues);

            for (const row of preRegistrations)
              yield* tx.insert(schema.devicePreRegistration).values({
                id: id(),
                organizationId: tenantId,
                serial: importString(row.serial, 255)!,
                name: importString(row.name, 255),
                assetTag: importString(row.assetTag, 255),
                notes: importString(row.notes, 10_000),
                groupId: row.groupKey ? (groupIdByKey.get(row.groupKey) ?? null) : null,
                consumedDeviceId: null,
                createdAt: timestamp,
                updatedAt: timestamp,
              });

            yield* tx.insert(schema.auditLog).values({
              id: id(),
              organizationId: tenantId,
              actorUserId: user.id,
              actorEmail: user.email,
              action: "tenant.imported",
              targetType: "tenant",
              targetId: tenantId,
              metadata: {
                sourceTenant: profile.slug ?? null,
                bundleVersion: bundle.version,
                counts: {
                  groups: groups.length,
                  policies: policies.length,
                  applications: applications.length,
                  preRegistrations: preRegistrations.length,
                },
              },
              createdAt: timestamp,
            });

            return { slug };
          }),
        );

        return {
          tenantId,
          slug: result.slug,
          counts: {
            groups: groups.length,
            policies: policies.length,
            applications: applications.length,
            preRegistrations: preRegistrations.length,
          },
          skipped: {
            members: bundle.members?.length ?? 0,
            devices: groups.reduce((total, group) => total + (group.devices?.length ?? 0), 0),
            certificates: bundle.scepCertificates?.length ?? 0,
            auditLog: bundle.auditLog?.length ?? 0,
          },
          applicationsWithoutFiles,
        } satisfies TenantImportResponse;
      }),
    patchTenant: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const body: {
          name?: string;
          slug?: string;
          logo?: string | null;
          displayName?: string | null;
          supportEmail?: string | null;
          brandColor?: string | null;
          metadata?: Record<string, Schema.Json> | null;
        } = payload;

        if (body.slug) {
          const claimed = yield* db.query.organization.findFirst({
            where: { slug: body.slug },
          });

          if (claimed && claimed.id !== tenantId)
            return yield* Effect.fail(
              diagnoseError(
                new EnterpriseBadRequest({ message: "That tenant URL is already in use" }),
                { code: "slug_taken", field: "slug" },
              ),
            );
        }

        const branding = yield* brandingOrFail(body);
        const name = optionalText(body.name);

        if (body.name !== undefined && name === null)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Tenant name cannot be empty" }),
          );
        yield* db
          .update(schema.organization)
          .set({
            name: name !== undefined && name !== null ? name : undefined,
            slug: body.slug !== undefined ? body.slug : undefined,
            ...branding,
            metadata:
              body.metadata === undefined
                ? undefined
                : body.metadata === null
                  ? null
                  : JSON.stringify(body.metadata),
            updatedAt: now(),
          })
          .where(eq(schema.organization.id, tenantId));
        yield* audit(ctx, "tenant.updated", "tenant", tenantId, { fields: Object.keys(body) });

        return ok;
      }),
    deleteTenant: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "delete");
        yield* requireStepUp(auth, request, "tenant-delete");
        const count = yield* memberCount(tenantId);

        if (count > 1)
          return yield* Effect.fail(
            diagnoseError(
              new EnterpriseTenantHasMembers({
                message: "Cannot delete a tenant with more than one user",
              }),
              { code: "tenant_has_members" },
            ),
          );

        // Teardown contacts devices, cancels billing and deletes every
        // tenant-prefixed object before removing the row. A failed step keeps
        // the tenant intact so repeating DELETE resumes; the `tenant_deletion`
        // journal records each reclaimed resource for support.
        const result = yield* teardownTenant(db, storage, {
          organizationId: ctx.organization.id,
          actor: { id: ctx.user.id, email: ctx.user.email },
          deps: {
            preflight: () => preflightTeardown(ctx.organization),
            unenrollDevices: teardownDevices,
            cancelSubscription: teardownSubscription,
          },
        }).pipe(
          Effect.mapError((error: TenantTeardownStepFailed) =>
            diagnoseError(
              new EnterpriseTenantTeardownFailed({
                message: `${error.message} The tenant was kept so the deletion can be retried.`,
                step: error.step,
              }),
              { code: "teardown_failed", details: { step: error.step } },
            ),
          ),
        );

        return {
          status: "ok" as const,
          reclaimed: {
            devices: result.devices.total,
            contacted: result.devices.contacted,
            unreachableDevices: [...result.devices.unreachable],
            objects: result.objectsDeleted,
            subscription: result.subscription,
          },
        };
      }),
    getEntraDirectorySync: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const config = yield* db.query.ssoConfig.findFirst({
          where: { organizationId: ctx.organization.id },
        });

        const state = yield* db.query.entraDirectorySync.findFirst({
          where: { organizationId: ctx.organization.id },
        });

        return {
          configured: Boolean(azureGraph && azureClientId),
          enabled: state?.enabled ?? false,
          status: state?.status ?? "idle",
          azureTenantId: config?.azureTenantId ?? null,
          lastSyncedAt: state?.lastSyncedAt ? iso(state.lastSyncedAt) : null,
          lastAttemptedAt: state?.lastAttemptedAt ? iso(state.lastAttemptedAt) : null,
          lastRunTrigger: state?.lastRunTrigger ?? null,
          lastError: state?.lastError ?? null,
          lastCounts: state?.lastCounts ?? null,
          syncIntervalMinutes: state?.syncIntervalMinutes ?? 0,
          nextSyncAt: state?.nextSyncAt ? iso(state.nextSyncAt) : null,
          consentUrl:
            azureGraph && config?.azureTenantId
              ? azureGraph.consentUrl(config.azureTenantId)
              : null,
        };
      }),
    patchEntraDirectorySync: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body: { enabled?: boolean; syncIntervalMinutes?: number } = payload;

        if (body.syncIntervalMinutes !== undefined) {
          if (
            !Number.isInteger(body.syncIntervalMinutes) ||
            body.syncIntervalMinutes < 0 ||
            body.syncIntervalMinutes > 525_600
          )
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: "Sync interval must be a whole number of minutes between 0 and 525600.",
              }),
            );
        }

        const existing = yield* db.query.entraDirectorySync.findFirst({
          where: { organizationId: ctx.organization.id },
        });

        const enabled = body.enabled ?? existing?.enabled ?? false;
        const interval = body.syncIntervalMinutes ?? existing?.syncIntervalMinutes ?? 0;
        const timestamp = now();

        const intervalChanged =
          body.syncIntervalMinutes !== undefined &&
          body.syncIntervalMinutes !== (existing?.syncIntervalMinutes ?? 0);

        // Keep `nextSyncAt` aligned with the cadence: changing the interval
        // resets the clock, a schedule that is already due (or has no next
        // run) waits a full interval, and a zero/disabled schedule clears it.
        const existingNextAt =
          existing?.nextSyncAt instanceof Date
            ? existing.nextSyncAt.getTime()
            : existing?.nextSyncAt
              ? Date.parse(String(existing.nextSyncAt))
              : null;

        const nextSyncAt =
          interval <= 0
            ? null
            : intervalChanged ||
                existingNextAt === null ||
                !Number.isFinite(existingNextAt) ||
                existingNextAt <= timestamp.getTime()
              ? new Date(timestamp.getTime() + interval * 60_000)
              : (existing?.nextSyncAt ?? null);

        if (existing)
          yield* db
            .update(schema.entraDirectorySync)
            .set({
              enabled,
              syncIntervalMinutes: interval,
              nextSyncAt,
              updatedAt: timestamp,
            })
            .where(eq(schema.entraDirectorySync.organizationId, ctx.organization.id));
        else
          yield* db.insert(schema.entraDirectorySync).values({
            organizationId: ctx.organization.id,
            enabled,
            status: "idle",
            syncIntervalMinutes: interval,
            nextSyncAt,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        yield* audit(ctx, "entra.directory_updated", "entra", ctx.organization.id, {
          enabled,
          syncIntervalMinutes: interval,
        });

        return ok;
      }),
    syncEntraDirectory: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const outcome = yield* runEntraDirectorySyncForTenant({
          db,
          graph: azureGraph,
          organizationId: ctx.organization.id,
          trigger: "manual",
          onMembershipsChanged: (organizationId, userIds) =>
            refreshDevicesForDirectoryUsers(organizationId, userIds),
        });

        if (outcome.status === "not_configured")
          return yield* Effect.fail(new EnterpriseBadRequest({ message: outcome.message }));

        if (outcome.status === "locked")
          return yield* Effect.fail(
            new EnterpriseConflict({
              message:
                "A directory sync is already running for this tenant. Wait for it to finish, or retry after the lock becomes stale.",
            }),
          );

        if (outcome.status === "error") {
          yield* audit(ctx, "entra.sync_failed", "entra", ctx.organization.id, {
            message: outcome.message.slice(0, 500),
          });

          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: `Directory sync failed: ${outcome.message}` }),
          );
        }

        yield* audit(ctx, "entra.sync_completed", "entra", ctx.organization.id, {
          users: outcome.users,
          groups: outcome.groups,
          domains: outcome.domains,
        });

        return {
          status: "ok" as const,
          users: outcome.users,
          groups: outcome.groups,
          domains: outcome.domains,
        };
      }),
    listEntraDomains: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const rows = yield* db
          .select()
          .from(schema.ssoDomain)
          .where(eq(schema.ssoDomain.organizationId, ctx.organization.id));

        return {
          domains: rows.map((row: (typeof rows)[number]) => ({
            domain: row.domain,
            source: row.source,
            isVerified: row.isVerified,
            verifiedAt: row.verifiedAt ? iso(row.verifiedAt) : null,
          })),
        };
      }),
    refreshEntraDomains: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        if (!azureGraph)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Microsoft Graph is not configured." }),
          );

        const config = yield* db.query.ssoConfig.findFirst({
          where: { organizationId: ctx.organization.id },
        });

        if (!config?.azureTenantId)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Enable Entra ID SSO with a tenant id first." }),
          );

        const lock = yield* acquireEntraSyncLock({
          db,
          organizationId: ctx.organization.id,
        });

        if (!lock.acquired) {
          return yield* Effect.fail(
            new EnterpriseConflict({
              message:
                "A directory sync is already running for this tenant. Wait for it to finish, or retry after the lock becomes stale.",
            }),
          );
        }

        const exit = yield* Effect.exit(
          syncEntraDirectory({
            db,
            graph: azureGraph,
            organizationId: ctx.organization.id,
            azureTenantId: config.azureTenantId,
            autoProvision: config.autoProvision,
            syncUsersAndGroups: false,
          }),
        );

        if (Exit.isFailure(exit)) {
          yield* db
            .update(schema.entraDirectorySync)
            .set({
              status: "error",
              lastError: String(exit.cause).slice(0, 2000),
              updatedAt: now(),
            })
            .where(eq(schema.entraDirectorySync.organizationId, ctx.organization.id));

          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: `Domain refresh failed: ${String(exit.cause)}`,
            }),
          );
        }

        yield* db
          .update(schema.entraDirectorySync)
          .set({
            status: "idle",
            lastError: null,
            domainsSyncedAt: now(),
            updatedAt: now(),
          })
          .where(eq(schema.entraDirectorySync.organizationId, ctx.organization.id));

        const rows = yield* db
          .select()
          .from(schema.ssoDomain)
          .where(eq(schema.ssoDomain.organizationId, ctx.organization.id));

        yield* audit(ctx, "entra.domains_refreshed", "entra", ctx.organization.id, {
          count: rows.length,
        });

        return {
          domains: rows.map((row: (typeof rows)[number]) => ({
            domain: row.domain,
            source: row.source,
            isVerified: row.isVerified,
            verifiedAt: row.verifiedAt ? iso(row.verifiedAt) : null,
          })),
        };
      }),
    getAutopilotSettings: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const sso = yield* db.query.ssoConfig.findFirst({
          where: { organizationId: ctx.organization.id },
        });

        const devices = yield* db
          .select({ value: count() })
          .from(schema.autopilotDevice)
          .where(eq(schema.autopilotDevice.organizationId, ctx.organization.id));

        const linked = yield* db
          .select({ value: count() })
          .from(schema.autopilotDevice)
          .where(
            and(
              eq(schema.autopilotDevice.organizationId, ctx.organization.id),
              isNotNull(schema.autopilotDevice.deviceId),
            ),
          );

        const profiles = yield* db
          .select({ value: count() })
          .from(schema.autopilotProfile)
          .where(eq(schema.autopilotProfile.organizationId, ctx.organization.id));

        const latest = yield* db
          .select({ lastSyncedAt: schema.autopilotDevice.lastSyncedAt })
          .from(schema.autopilotDevice)
          .where(eq(schema.autopilotDevice.organizationId, ctx.organization.id))
          .orderBy(desc(schema.autopilotDevice.lastSyncedAt))
          .limit(1);

        const azureTenantId = sso?.azureTenantId?.trim() || null;
        const audience = windowsFederated?.audience ?? azureClientId;
        const federatedEnabled = Boolean(audience && azureTenantId);

        const authServiceUrl = federatedEnabled
          ? (windowsFederated?.authServiceUrl?.(azureTenantId!) ??
            federatedAuthServiceUrl(
              azureTenantId!,
              azureClientId ? { clientId: azureClientId } : {},
            ))
          : null;

        return {
          configured: Boolean(azureGraph && azureTenantId),
          graphConfigured: Boolean(azureGraph),
          azureTenantId,
          consentUrl: azureGraph && azureTenantId ? azureGraph.consentUrl(azureTenantId) : null,
          deviceCount: Number(devices[0]?.value ?? 0),
          linkedDeviceCount: Number(linked[0]?.value ?? 0),
          profileCount: Number(profiles[0]?.value ?? 0),
          lastSyncedAt: latest[0]?.lastSyncedAt ? iso(latest[0].lastSyncedAt) : null,
          federatedEnrollment: {
            enabled: federatedEnabled,
            realm: federatedEnabled ? federatedRealm(azureTenantId!) : null,
            authServiceUrl,
          },
        };
      }),
    listAutopilotDevices: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const rows = yield* autopilotDevicesFor(ctx.organization.id);

        return { devices: rows.map(autopilotDeviceInfo) };
      }),
    importAutopilotDevices: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const body: {
          content?: string;
          format?: "csv" | "text";
          maxRows?: number;
        } = payload;

        const content = body.content ?? "";

        if (!content.trim())
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Paste at least one serial and hardware hash." }),
          );

        if (new TextEncoder().encode(content).length > AUTOPILOT_IMPORT_MAX_BYTES)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: `Autopilot import content must be ${AUTOPILOT_IMPORT_MAX_BYTES} bytes or less.`,
            }),
          );
        const maxRows = body.maxRows ?? AUTOPILOT_IMPORT_MAX_ROWS;

        if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > AUTOPILOT_IMPORT_MAX_ROWS)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: `maxRows must be a whole number between 1 and ${AUTOPILOT_IMPORT_MAX_ROWS}.`,
            }),
          );
        const parsed = parseAutopilotCsv(content, { maxRows });
        const { graph, azureTenantId } = yield* autopilotContext(ctx.organization.id);

        const result = yield* importAutopilotDevices({
          db,
          graph,
          organizationId: ctx.organization.id,
          azureTenantId,
          rows: parsed.rows,
          skipped: parsed.skipped,
          errors: parsed.errors,
          truncated: parsed.truncated,
        }).pipe(Effect.mapError(autopilotApiError));

        const devices = yield* autopilotDevicesFor(ctx.organization.id);
        yield* audit(ctx, "autopilot.devices_imported", "autopilot", ctx.organization.id, {
          imported: result.imported,
          skipped: result.skipped,
          errors: result.errors.length,
        });

        return { ...result, devices: devices.map(autopilotDeviceInfo) };
      }),
    syncAutopilotDevices: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const { graph, azureTenantId } = yield* autopilotContext(ctx.organization.id);

        const result = yield* syncAutopilotDevices({
          db,
          graph,
          organizationId: ctx.organization.id,
          azureTenantId,
        }).pipe(Effect.mapError(autopilotApiError));

        yield* audit(ctx, "autopilot.devices_synced", "autopilot", ctx.organization.id, {
          synced: result.synced,
          linked: result.linked,
        });

        return { status: "ok" as const, ...result };
      }),
    deleteAutopilotDevice: (request, tenantId, serial) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const { graph, azureTenantId } = yield* autopilotContext(ctx.organization.id);

        const deleted = yield* deleteAutopilotDevice({
          db,
          graph,
          organizationId: ctx.organization.id,
          azureTenantId,
          serial: String(serial),
        }).pipe(Effect.mapError(autopilotApiError));

        if (!deleted)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "Autopilot device not found" }),
          );
        yield* audit(ctx, "autopilot.device_deleted", "autopilot", ctx.organization.id, {
          serial: normalizeAutopilotSerial(String(serial)),
        });

        return { status: "ok" as const };
      }),
    listAutopilotProfiles: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const profiles = yield* listAutopilotProfiles(db, ctx.organization.id).pipe(
          Effect.mapError(autopilotApiError),
        );

        return { profiles: profiles.map(autopilotProfileInfo) };
      }),
    createAutopilotProfile: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const validation = validateAutopilotProfileInput(payload);

        if (!validation.ok)
          return yield* Effect.fail(new EnterpriseBadRequest({ message: validation.message }));
        const { graph, azureTenantId } = yield* autopilotContext(ctx.organization.id);

        const profile = yield* createAutopilotProfile({
          db,
          graph,
          organizationId: ctx.organization.id,
          azureTenantId,
          values: validation.value,
        }).pipe(Effect.mapError(autopilotApiError));

        yield* audit(ctx, "autopilot.profile_created", "autopilot", ctx.organization.id, {
          profileId: profile.id,
          name: profile.name,
        });

        return autopilotProfileInfo(profile);
      }),
    updateAutopilotProfile: (request, tenantId, profileId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const [existing] = yield* db
          .select()
          .from(schema.autopilotProfile)
          .where(
            and(
              eq(schema.autopilotProfile.id, profileId),
              eq(schema.autopilotProfile.organizationId, ctx.organization.id),
            ),
          )
          .limit(1);

        if (!existing)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "Autopilot profile not found" }),
          );
        const body: Partial<Record<keyof AutopilotProfileValues, Schema.Json>> = payload;

        const merged = {
          name: body.name ?? existing.name,
          description: body.description !== undefined ? body.description : existing.description,
          deploymentMode: body.deploymentMode ?? existing.deploymentMode,
          joinType: body.joinType ?? existing.joinType,
          deviceNameTemplate:
            body.deviceNameTemplate !== undefined
              ? body.deviceNameTemplate
              : existing.deviceNameTemplate,
          locale: body.locale !== undefined ? body.locale : existing.locale,
          timezone: body.timezone !== undefined ? body.timezone : existing.timezone,
          enableDevicePreparation:
            body.enableDevicePreparation !== undefined
              ? body.enableDevicePreparation
              : existing.enableDevicePreparation,
          assignedGroupId:
            body.assignedGroupId !== undefined ? body.assignedGroupId : existing.assignedGroupId,
        };

        const validation = validateAutopilotProfileInput(merged);

        if (!validation.ok)
          return yield* Effect.fail(new EnterpriseBadRequest({ message: validation.message }));
        const { graph, azureTenantId } = yield* autopilotContext(ctx.organization.id);

        const profile = yield* updateAutopilotProfile({
          db,
          graph,
          organizationId: ctx.organization.id,
          azureTenantId,
          profileId,
          values: validation.value,
        }).pipe(Effect.mapError(autopilotApiError));

        yield* audit(ctx, "autopilot.profile_updated", "autopilot", ctx.organization.id, {
          profileId,
          name: profile.name,
        });

        return autopilotProfileInfo(profile);
      }),
    assignAutopilotProfile: (request, tenantId, profileId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body: { groupId?: string } = payload;

        if (!body.groupId?.trim())
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "An Entra group id is required." }),
          );

        const [existing] = yield* db
          .select()
          .from(schema.autopilotProfile)
          .where(
            and(
              eq(schema.autopilotProfile.id, profileId),
              eq(schema.autopilotProfile.organizationId, ctx.organization.id),
            ),
          )
          .limit(1);

        if (!existing)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "Autopilot profile not found" }),
          );

        const validation = validateAutopilotProfileInput({
          name: existing.name,
          description: existing.description,
          deploymentMode: existing.deploymentMode,
          joinType: existing.joinType,
          deviceNameTemplate: existing.deviceNameTemplate,
          locale: existing.locale,
          timezone: existing.timezone,
          enableDevicePreparation: existing.enableDevicePreparation,
          assignedGroupId: body.groupId,
        });

        if (!validation.ok)
          return yield* Effect.fail(new EnterpriseBadRequest({ message: validation.message }));
        const { graph, azureTenantId } = yield* autopilotContext(ctx.organization.id);

        const profile = yield* assignAutopilotProfile({
          db,
          graph,
          organizationId: ctx.organization.id,
          azureTenantId,
          profileId,
          groupId: body.groupId.trim(),
        }).pipe(Effect.mapError(autopilotApiError));

        yield* audit(ctx, "autopilot.profile_assigned", "autopilot", ctx.organization.id, {
          profileId,
          groupId: body.groupId.trim(),
        });

        return autopilotProfileInfo(profile);
      }),
    /**
     * The tenant-wide MFA requirement binds every role, so enabling it is
     * refused while any member cannot satisfy it. A member who loses tenant
     * access as a result is still able to reach Account settings and enrol a
     * factor; turning the requirement on is what closes the read-only gap.
     */
    getTenantSecurity: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        return { requireMfa: ctx.organization.requireMfa };
      }),
    patchTenantSecurity: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* requireStepUp(auth, request, "tenant-mfa-policy");

        return { requireMfa: yield* setTenantMfaPolicy(ctx, payload.requireMfa) };
      }),
    approveAccountRecovery: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* requireStepUp(auth, request, "recovery-approve");

        return yield* approveRecoveryRequest(
          { db, authSecret: authSecret ?? "", origin, email },
          {
            token: payload.token,
            organizationId: ctx.organization.id,
            approverUserId: ctx.user.id,
          },
        ).pipe(
          Effect.catchTag("RecoveryRejected", (error) =>
            Effect.fail(new EnterpriseBadRequest({ message: error.message })),
          ),
        );
      }),
    getSsoConfig: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const config = yield* db.query.ssoConfig.findFirst({
          where: { organizationId: ctx.organization.id },
        });

        return {
          enabled: config?.enabled ?? false,
          azureTenantId: config?.azureTenantId ?? null,
          autoProvision: config?.autoProvision ?? true,
          // The MFA requirement is a tenant property, not an SSO one. It is
          // still reported here so the existing SSO form keeps working.
          requireMfa: ctx.organization.requireMfa,
        };
      }),
    patchSsoConfig: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* requireStepUp(auth, request, "sso-policy");

        const body: {
          enabled?: boolean;
          azureTenantId?: string | null;
          autoProvision?: boolean;
          requireMfa?: boolean;
        } = payload;

        const existing = yield* db.query.ssoConfig.findFirst({
          where: { organizationId: ctx.organization.id },
        });

        const nextAzureTenantId =
          body.azureTenantId === undefined ? (existing?.azureTenantId ?? null) : body.azureTenantId;

        if (nextAzureTenantId) {
          const claimed = yield* db.query.ssoConfig.findFirst({
            where: { azureTenantId: nextAzureTenantId },
          });

          if (claimed && claimed.organizationId !== ctx.organization.id)
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: "That Entra tenant is already linked to another tenant",
              }),
            );
        }

        const requireMfa =
          body.requireMfa === undefined
            ? ctx.organization.requireMfa
            : yield* setTenantMfaPolicy(ctx, body.requireMfa);

        const timestamp = now();

        if ((existing?.azureTenantId ?? null) !== nextAzureTenantId) {
          // Delta cursors and imported domains belong to the previous Entra
          // tenant and cannot be reused after a change.
          yield* db
            .update(schema.entraDirectorySync)
            .set({
              usersDeltaLink: null,
              groupsDeltaLink: null,
              status: "idle",
              lastError: null,
              updatedAt: timestamp,
            })
            .where(eq(schema.entraDirectorySync.organizationId, ctx.organization.id));
          yield* db
            .delete(schema.ssoDomain)
            .where(
              and(
                eq(schema.ssoDomain.organizationId, ctx.organization.id),
                eq(schema.ssoDomain.source, "entra"),
              ),
            );
        }

        if (existing) {
          yield* db
            .update(schema.ssoConfig)
            .set({
              enabled: body.enabled !== undefined ? body.enabled : undefined,
              azureTenantId: body.azureTenantId !== undefined ? body.azureTenantId : undefined,
              autoProvision: body.autoProvision !== undefined ? body.autoProvision : undefined,
              updatedAt: timestamp,
            })
            .where(eq(schema.ssoConfig.organizationId, ctx.organization.id));
        } else {
          yield* db.insert(schema.ssoConfig).values({
            organizationId: ctx.organization.id,
            enabled: body.enabled ?? false,
            azureTenantId: body.azureTenantId ?? null,
            autoProvision: body.autoProvision ?? true,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }

        yield* audit(ctx, "sso.updated", "sso", ctx.organization.id, {
          fields: Object.keys(body),
        });

        const config = yield* db.query.ssoConfig.findFirst({
          where: { organizationId: ctx.organization.id },
        });

        return {
          enabled: config?.enabled ?? false,
          azureTenantId: config?.azureTenantId ?? null,
          autoProvision: config?.autoProvision ?? true,
          requireMfa,
        };
      }),
    listScimTokens: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const timestamp = now();

        const rows = yield* db
          .select()
          .from(schema.scimToken)
          .where(
            and(
              eq(schema.scimToken.organizationId, ctx.organization.id),
              isNull(schema.scimToken.revokedAt),
            ),
          )
          .orderBy(asc(schema.scimToken.createdAt));

        return {
          tokens: rows.map((row: any) => {
            const expiresAt = row.expiresAt ? new Date(row.expiresAt) : null;

            return {
              id: row.id,
              name: row.name,
              createdAt: iso(row.createdAt),
              lastUsedAt: row.lastUsedAt ? iso(row.lastUsedAt) : null,
              expiresAt: expiresAt ? iso(expiresAt) : null,
              rotationDue:
                expiresAt !== null &&
                expiresAt.getTime() <=
                  timestamp.getTime() + SCIM_TOKEN_ROTATION_WINDOW_DAYS * DAY_MILLIS,
            };
          }),
        };
      }),
    createScimToken: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body: { name: string; expiresAt?: string | null } = payload;
        const name = body.name.trim();

        if (name.length === 0)
          return yield* Effect.fail(new EnterpriseBadRequest({ message: "Enter a token name" }));

        if (name.length > 255)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Token names must be 255 characters or fewer" }),
          );

        const timestamp = now();
        const expiry = scimTokenExpiry(body.expiresAt, timestamp);

        if (!expiry.ok)
          return yield* Effect.fail(new EnterpriseBadRequest({ message: expiry.message }));

        const expiresAt = expiry.value;

        const raw = `scim_${bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replace(/=+$/, "")}`;

        const tokenHash = yield* sha256Hex(bytesToArrayBuffer(new TextEncoder().encode(raw)));
        const scimId = id();
        yield* db.insert(schema.scimToken).values({
          id: scimId,
          organizationId: ctx.organization.id,
          name,
          tokenHash,
          lastUsedAt: null,
          expiresAt,
          revokedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        yield* audit(ctx, "scim.token_created", "scim_token", scimId, {
          name,
          expiresAt: iso(expiresAt),
        });

        return {
          id: scimId,
          name,
          token: raw,
          baseUrl: `${origin}/scim/v2/${ctx.organization.id}`,
          expiresAt: iso(expiresAt),
        };
      }),
    revokeScimToken: (request, tenantId, tokenId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* db
          .update(schema.scimToken)
          .set({ revokedAt: now(), updatedAt: now() })
          .where(
            and(
              eq(schema.scimToken.id, tokenId),
              eq(schema.scimToken.organizationId, ctx.organization.id),
            ),
          );
        yield* audit(ctx, "scim.token_revoked", "scim_token", tokenId);

        return ok;
      }),
    listWebhookEndpoints: (request, tenantId) =>
      Effect.gen(function* () {
        // Delivery health is operationally sensitive, so even the list is
        // owner/admin-only rather than available to read-only members.
        const ctx = yield* requireTenant(request, tenantId, "write");

        const rows = yield* db
          .select()
          .from(schema.webhookEndpoint)
          .where(eq(schema.webhookEndpoint.organizationId, ctx.organization.id))
          .orderBy(asc(schema.webhookEndpoint.createdAt));

        return { endpoints: rows.map(toWebhookEndpointInfo) };
      }),
    createWebhookEndpoint: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const body: {
          url: string;
          description?: string | null;
          events: ReadonlyArray<string>;
          enabled?: boolean;
        } = payload;

        const validated = yield* Effect.try({
          try: () => ({
            url: requireWebhookUrl(body.url),
            description: webhookDescription(body.description),
          }),
          catch: (cause) =>
            cause instanceof EnterpriseBadRequest
              ? cause
              : new EnterpriseBadRequest({ message: "Invalid webhook endpoint" }),
        });

        const { endpoint, secret } = yield* insertWebhookEndpoint({
          organizationId: ctx.organization.id,
          url: validated.url,
          description: validated.description,
          events: normalizeWebhookEvents(body.events),
          enabled: body.enabled ?? true,
        });

        yield* audit(ctx, "webhook.created", "webhook_endpoint", endpoint.id, {
          url: endpoint.url,
          events: endpoint.eventFilters ?? [],
        });

        return { endpoint: toWebhookEndpointInfo(endpoint), secret };
      }),
    patchWebhookEndpoint: (request, tenantId, webhookId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const body: {
          url?: string;
          description?: string | null;
          events?: ReadonlyArray<string>;
          enabled?: boolean;
        } = payload;

        const existing = yield* loadWebhookEndpoint(ctx.organization.id, webhookId);

        const validated = yield* Effect.try({
          try: () => ({
            url: body.url === undefined ? undefined : requireWebhookUrl(body.url),
            description:
              body.description === undefined ? undefined : webhookDescription(body.description),
          }),
          catch: (cause) =>
            cause instanceof EnterpriseBadRequest
              ? cause
              : new EnterpriseBadRequest({ message: "Invalid webhook endpoint" }),
        });

        const update: Partial<typeof schema.webhookEndpoint.$inferInsert> = {
          updatedAt: now(),
        };

        if (validated.url !== undefined) update.url = validated.url;

        if (validated.description !== undefined) update.description = validated.description;

        if (body.events !== undefined) update.eventFilters = normalizeWebhookEvents(body.events);

        if (body.enabled !== undefined) update.enabled = body.enabled;
        yield* db
          .update(schema.webhookEndpoint)
          .set(update)
          .where(
            and(
              eq(schema.webhookEndpoint.id, existing.id),
              eq(schema.webhookEndpoint.organizationId, ctx.organization.id),
            ),
          );
        const updated = yield* loadWebhookEndpoint(ctx.organization.id, webhookId);
        yield* audit(ctx, "webhook.updated", "webhook_endpoint", updated.id, {
          fields: Object.keys(update).filter((field) => field !== "updatedAt"),
        });

        return toWebhookEndpointInfo(updated);
      }),
    deleteWebhookEndpoint: (request, tenantId, webhookId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const existing = yield* loadWebhookEndpoint(ctx.organization.id, webhookId);
        yield* db
          .delete(schema.webhookEndpoint)
          .where(
            and(
              eq(schema.webhookEndpoint.id, existing.id),
              eq(schema.webhookEndpoint.organizationId, ctx.organization.id),
            ),
          );
        yield* audit(ctx, "webhook.deleted", "webhook_endpoint", existing.id, {
          url: existing.url,
        });

        return ok;
      }),
    rotateWebhookSecret: (request, tenantId, webhookId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const existing = yield* loadWebhookEndpoint(ctx.organization.id, webhookId);

        const signingSecret = yield* Effect.try({
          try: () => requireWebhookSigning(),
          catch: (cause) =>
            cause instanceof EnterpriseBadRequest
              ? cause
              : new EnterpriseBadRequest({ message: "Webhook signing is not configured" }),
        });

        const secret = generateWebhookSecret();

        const sealed = yield* Effect.tryPromise({
          try: () => sealSecret(signingSecret, secret),
          catch: () =>
            new EnterpriseBadRequest({ message: "Could not encrypt the webhook signing secret" }),
        });

        yield* db
          .update(schema.webhookEndpoint)
          .set({
            secret: sealed,
            secretPrefix: webhookSecretPrefix(secret),
            updatedAt: now(),
          })
          .where(
            and(
              eq(schema.webhookEndpoint.id, existing.id),
              eq(schema.webhookEndpoint.organizationId, ctx.organization.id),
            ),
          );
        yield* audit(ctx, "webhook.secret_rotated", "webhook_endpoint", existing.id);

        return { secret };
      }),
    testWebhookEndpoint: (request, tenantId, webhookId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const existing = yield* loadWebhookEndpoint(ctx.organization.id, webhookId);
        const outcome = yield* sendTestWebhook(db, existing, webhookOptions);
        yield* audit(ctx, "webhook.tested", "webhook_endpoint", existing.id, {
          status: outcome.status,
          responseStatus: outcome.responseStatus,
        });

        const response: WebhookTestResponse = {
          status: outcome.status,
          responseStatus: outcome.responseStatus,
          error: outcome.error,
          durationMs: outcome.durationMs,
        };

        return response;
      }),
    listAuditLog: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        // Kept for older dashboard bundles; new callers use `/audit/search`.
        const entries = yield* db
          .select()
          .from(schema.auditLog)
          .where(eq(schema.auditLog.organizationId, ctx.organization.id))
          .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
          .limit(200);

        return { entries: entries.map((entry: any) => auditEntry(entry)) };
      }),
    searchAuditLog: (request, tenantId, query) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const filters = yield* normalizedAuditFilters(query);
        // Fetch one extra row to detect more pages without a second count.
        const rows = yield* loadAuditEntries(ctx.organization.id, filters, filters.limit + 1);
        const hasMore = rows.length > filters.limit;
        const page = hasMore ? rows.slice(0, filters.limit) : rows;
        let nextCursor: string | null = null;

        if (hasMore && page.length > 0) {
          const last = page[page.length - 1]!;
          nextCursor = filters.offsetPaging
            ? encodeAuditOffsetCursor(filters.offset + filters.limit)
            : encodeAuditCursor({ createdAt: last.createdAt, id: last.id });
        }

        return { entries: page.map((entry: any) => auditEntry(entry)), nextCursor };
      }),
    exportAuditLog: (request, tenantId, query) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const format = query.format ?? "csv";

        // Exports always start at the newest matching row; a cursor from an
        // interactive page would silently export only the remainder.
        const filters = {
          ...(yield* normalizedAuditFilters(query)),
          cursor: undefined,
          offset: 0,
        };

        const rows = yield* loadAuditEntries(
          ctx.organization.id,
          filters,
          AUDIT_EXPORT_MAX_ROWS + 1,
        );

        const truncated = rows.length > AUDIT_EXPORT_MAX_ROWS;

        const entries = (truncated ? rows.slice(0, AUDIT_EXPORT_MAX_ROWS) : rows).map(
          (entry: any) => auditEntry(entry),
        );

        return {
          format,
          body: format === "json" ? auditJson(entries) : auditCsv(entries),
          truncated,
          rowCount: entries.length,
        };
      }),
    listTenantRoles: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const custom = yield* db
          .select()
          .from(schema.tenantRole)
          .where(eq(schema.tenantRole.organizationId, tenantId))
          .orderBy(asc(schema.tenantRole.name));

        const members = yield* db
          .select({ role: schema.member.role, customRoleId: schema.member.customRoleId })
          .from(schema.member)
          .where(eq(schema.member.organizationId, tenantId));

        const counts = new Map<string, number>();

        for (const member of members)
          if (member.customRoleId)
            counts.set(member.customRoleId, (counts.get(member.customRoleId) ?? 0) + 1);

        const builtIns = BUILT_IN_TENANT_ROLES.map((key) => ({
          id: `builtin:${key}`,
          name: BUILT_IN_ROLE_LABELS[key],
          description: builtInRoleDescription(key),
          permissions: [...BUILT_IN_ROLE_PERMISSIONS[key]],
          memberCount: members.filter(
            (member) => !member.customRoleId && member.role.split(",").includes(key),
          ).length,
          builtIn: true,
          createdAt: iso(ctx.organization.createdAt),
          updatedAt: iso(ctx.organization.updatedAt),
        }));

        return {
          roles: [
            ...builtIns,
            ...custom.map((role) => ({
              id: role.id,
              name: role.name,
              description: role.description,
              permissions: normalizePermissions(
                Array.isArray(role.permissions) ? role.permissions : [],
              ),
              memberCount: counts.get(role.id) ?? 0,
              builtIn: false,
              createdAt: iso(role.createdAt),
              updatedAt: iso(role.updatedAt),
            })),
          ],
        };
      }),
    createTenantRole: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const body: {
          name?: string;
          description?: string | null;
          permissions?: ReadonlyArray<string>;
        } = payload;

        const name = body.name?.trim();

        if (!name)
          return yield* Effect.fail(new EnterpriseBadRequest({ message: "Give the role a name" }));

        if (isBuiltInTenantRole(name.toLowerCase()))
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "That name is reserved for a built-in role" }),
          );
        const permissions = normalizePermissions(body.permissions ?? []);

        if (permissions.length === 0)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Choose at least one permission" }),
          );

        // A role can never be created above the creating member's own ceiling.
        yield* assertPermissionsWithinActor(ctx, permissions);

        const existing = yield* db.query.tenantRole.findFirst({
          where: { organizationId: tenantId, name },
        });

        if (existing)
          return yield* Effect.fail(
            new EnterpriseConflict({ message: "A role with that name already exists" }),
          );
        const roleId = id();
        const timestamp = now();
        yield* db.insert(schema.tenantRole).values({
          id: roleId,
          organizationId: tenantId,
          name: name.slice(0, 80),
          description: body.description?.trim().slice(0, 500) || null,
          permissions,
          createdByUserId: ctx.user.id,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        yield* audit(ctx, "role.created", "role", roleId, {
          name,
          permissions,
          permissionCeiling: "actor",
        });

        return { id: roleId };
      }),
    patchTenantRole: (request, tenantId, roleId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const role = yield* db.query.tenantRole.findFirst({
          where: { id: roleId, organizationId: tenantId },
        });

        if (!role) return yield* Effect.fail(new EnterpriseNotFound({ message: "Role not found" }));

        const body: {
          name?: string;
          description?: string | null;
          permissions?: ReadonlyArray<string>;
        } = payload;

        const name = body.name?.trim();

        if (name !== undefined && !name)
          return yield* Effect.fail(new EnterpriseBadRequest({ message: "Give the role a name" }));

        if (name && isBuiltInTenantRole(name.toLowerCase()))
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "That name is reserved for a built-in role" }),
          );

        if (name && name !== role.name) {
          const claimed = yield* db.query.tenantRole.findFirst({
            where: { organizationId: tenantId, name },
          });

          if (claimed)
            return yield* Effect.fail(
              new EnterpriseConflict({ message: "A role with that name already exists" }),
            );
        }

        const permissions =
          body.permissions === undefined ? undefined : normalizePermissions(body.permissions);

        if (permissions && permissions.length === 0)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Choose at least one permission" }),
          );

        // Editing a role is another delegation point: the new permission set
        // cannot exceed the editing member's own resolved permissions.
        if (permissions) yield* assertPermissionsWithinActor(ctx, permissions);

        yield* db
          .update(schema.tenantRole)
          .set({
            name: name !== undefined ? name.slice(0, 80) : undefined,
            description:
              body.description !== undefined
                ? body.description?.trim().slice(0, 500) || null
                : undefined,
            permissions: permissions !== undefined ? permissions : undefined,
            updatedAt: now(),
          })
          .where(eq(schema.tenantRole.id, role.id));
        const roleAudit = { fields: Object.keys(body) };

        if (name !== undefined) Object.assign(roleAudit, { name });

        if (permissions !== undefined)
          Object.assign(roleAudit, { permissions, permissionCeiling: "actor" });

        yield* audit(ctx, "role.updated", "role", role.id, roleAudit);

        return ok;
      }),
    deleteTenantRole: (request, tenantId, roleId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const role = yield* db.query.tenantRole.findFirst({
          where: { id: roleId, organizationId: tenantId },
        });

        if (!role) return yield* Effect.fail(new EnterpriseNotFound({ message: "Role not found" }));

        const [assigned] = yield* db
          .select({ value: count() })
          .from(schema.member)
          .where(
            and(
              eq(schema.member.organizationId, tenantId),
              eq(schema.member.customRoleId, role.id),
            ),
          );

        if (Number(assigned?.value ?? 0) > 0)
          return yield* Effect.fail(
            new EnterpriseConflict({
              message: "Reassign the members using this role before deleting it",
            }),
          );

        const [invited] = yield* db
          .select({ value: count() })
          .from(schema.invitation)
          .where(
            and(
              eq(schema.invitation.organizationId, tenantId),
              eq(schema.invitation.customRoleId, role.id),
              eq(schema.invitation.status, "pending"),
            ),
          );

        if (Number(invited?.value ?? 0) > 0)
          return yield* Effect.fail(
            new EnterpriseConflict({
              message: "Cancel pending invitations using this role before deleting it",
            }),
          );

        yield* db.delete(schema.tenantRole).where(eq(schema.tenantRole.id, role.id));
        yield* audit(ctx, "role.deleted", "role", role.id, { name: role.name });

        return ok;
      }),
    listTenantUsers: (request, tenantId) =>
      Effect.gen(function* () {
        yield* requireTenant(request, tenantId);

        const users = yield* db
          .select({
            memberId: schema.member.id,
            userId: schema.user.id,
            name: schema.user.name,
            email: schema.user.email,
            role: schema.member.role,
            customRoleId: schema.member.customRoleId,
            createdAt: schema.member.createdAt,
          })
          .from(schema.member)
          .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
          .where(eq(schema.member.organizationId, tenantId));

        const customRoles = yield* db
          .select({ id: schema.tenantRole.id, name: schema.tenantRole.name })
          .from(schema.tenantRole)
          .where(eq(schema.tenantRole.organizationId, tenantId));

        const custom = new Map(customRoles.map((role) => [role.id, role.name]));

        return {
          users: users.map((user) => {
            const builtInName = user.role
              .split(",")
              .map((raw) => {
                const part = raw.trim();

                return isBuiltInTenantRole(part) ? BUILT_IN_ROLE_LABELS[part] : part;
              })
              .join(", ");

            return {
              memberId: user.memberId,
              userId: user.userId,
              name: user.name,
              email: user.email,
              role: user.role,
              roleId: user.customRoleId ?? null,
              roleName: user.customRoleId
                ? (custom.get(user.customRoleId) ?? builtInName)
                : builtInName,
              roleKind: user.customRoleId ? ("custom" as const) : ("built-in" as const),
              createdAt: iso(user.createdAt),
            };
          }),
        };
      }),
    inviteTenantUser: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const { user } = ctx;

        const body: {
          email: string;
          role?: string;
          roleId?: string | null;
        } = payload;

        const email = normalizeInvitationEmail(body.email);

        if (!validInvitationEmail(email))
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Enter a valid email address" }),
          );

        const roleId = body.roleId ?? null;

        const customRole = roleId
          ? yield* db.query.tenantRole.findFirst({
              where: { id: roleId, organizationId: tenantId },
            })
          : undefined;

        if (roleId && !customRole)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Role not found" }));

        const requestedRole = body.role?.trim();

        if (customRole && requestedRole && requestedRole !== "member")
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "When a custom role is selected, the built-in fallback must be member",
            }),
          );

        // With a custom role the legacy built-in column is only a fallback and
        // is always `member`. The custom role's permissions stay authoritative.
        const role = customRole ? "member" : (requestedRole ?? "member");

        if (!validRoles(role))
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: customRole ? "Choose a valid fallback role" : "Choose a valid tenant role",
            }),
          );

        // Owner authority is never delegable unless the actor is a built-in
        // owner themselves.
        if (hasOwnerRole(role) && !isBuiltInOwnerMember(ctx.member))
          return yield* Effect.fail(
            new EnterpriseForbidden({ message: "Only an owner can assign the owner role" }),
          );

        // Inviting someone to a custom role delegates that role's permissions.
        // The inviter cannot hand out more than they hold themselves.
        if (customRole)
          yield* assertPermissionsWithinActor(
            ctx,
            normalizePermissions(
              Array.isArray(customRole.permissions) ? customRole.permissions : [],
            ),
          );
        else yield* assertBuiltInRoleAssignable(ctx, role);

        // A tenant email address can only have one membership. Compare
        // case-insensitively because older rows were not normalised at write.
        const tenantMembers = yield* db
          .select({ email: schema.user.email })
          .from(schema.member)
          .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
          .where(eq(schema.member.organizationId, tenantId));

        if (
          tenantMembers.some(
            (member: { email: string }) => member.email.trim().toLowerCase() === email,
          )
        )
          return yield* Effect.fail(
            new EnterpriseConflict({ message: "That person is already a member of this tenant" }),
          );

        const pending = yield* db
          .select({ id: schema.invitation.id, email: schema.invitation.email })
          .from(schema.invitation)
          .where(
            and(
              eq(schema.invitation.organizationId, tenantId),
              eq(schema.invitation.status, "pending"),
            ),
          );

        const sameEmailPending = pending.filter(
          (item: { email: string }) => item.email.trim().toLowerCase() === email,
        );

        if (pending.length >= MAX_PENDING_INVITATIONS_PER_TENANT && sameEmailPending.length === 0)
          return yield* Effect.fail(
            new EnterpriseConflict({
              message: `This tenant already has ${MAX_PENDING_INVITATIONS_PER_TENANT} pending invitations. Cancel one before sending another.`,
            }),
          );

        const invitationId = id();
        const timestamp = now();
        const expiresAt = new Date(timestamp.getTime() + INVITATION_TTL_MS);
        const rawToken = newInvitationToken();
        const tokenHash = yield* invitationTokenHash(rawToken);
        const inviteUrl = invitationUrl(origin, rawToken);
        const roleLabel = customRole?.name ?? BUILT_IN_ROLE_LABEL_BY_ROLE.get(role) ?? role;

        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            // Re-inviting the same address invalidates every live link for it.
            for (const previous of sameEmailPending)
              yield* tx
                .update(schema.invitation)
                .set({ status: "superseded", tokenHash: null, updatedAt: timestamp })
                .where(eq(schema.invitation.id, previous.id));

            yield* tx.insert(schema.invitation).values({
              id: invitationId,
              organizationId: tenantId,
              inviterId: user.id,
              email,
              role,
              customRoleId: customRole?.id ?? null,
              status: "pending",
              tokenHash,
              expiresAt,
              lastSentAt: timestamp,
              sendCount: 1,
              acceptedAt: null,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
          }),
        );

        const emailSent = yield* sendInvitationEmail(ctx.organization, user.name, {
          email,
          roleName: roleLabel,
          inviteUrl,
          expiresAt,
        });

        const invitationAudit: InvitationAuditMetadata = { email, role, emailSent };

        if (customRole)
          Object.assign(invitationAudit, {
            roleId: customRole.id,
            roleName: customRole.name,
            permissionCeiling: "actor",
          });

        yield* audit(ctx, "member.invited", "invitation", invitationId, invitationAudit);

        return { id: invitationId, inviteUrl, expiresAt: iso(expiresAt), emailSent };
      }),
    acceptInvitation: (request, payload) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });
        yield* identifyUser(user);
        const body: { token: string } = payload;

        // Accepting grants tenant access, so the address must be proven first.
        // The token is deliberately not consumed by an unverified account.
        if (!user.emailVerified)
          return yield* Effect.fail(
            new EnterpriseForbidden({
              message: "Verify your email address before accepting this invitation.",
            }),
          );

        const tokenHash = yield* invitationTokenHash(body.token);

        const invitation = yield* db.query.invitation.findFirst({
          where: { tokenHash },
        });

        if (!invitation)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "Invitation not found or already used" }),
          );

        if (invitation.status === "accepted") {
          const member = yield* db.query.member.findFirst({
            where: { userId: user.id, organizationId: invitation.organizationId },
          });

          if (member) return { tenantId: invitation.organizationId, alreadyMember: true };

          return yield* Effect.fail(
            new EnterpriseConflict({
              message: "This invitation was already accepted but the membership no longer exists",
            }),
          );
        }

        if (invitation.status === "canceled" || invitation.status === "superseded")
          return yield* Effect.fail(
            new EnterpriseConflict({
              message:
                invitation.status === "canceled"
                  ? "This invitation was canceled"
                  : "This invitation was replaced by a newer invitation",
            }),
          );

        if (invitation.status === "expired")
          return yield* Effect.fail(
            diagnoseError(new EnterpriseBadRequest({ message: "Invitation expired" }), {
              code: "invitation_expired",
            }),
          );

        if (invitation.status !== "pending")
          return yield* Effect.fail(
            new EnterpriseConflict({ message: "This invitation can no longer be accepted" }),
          );

        if (invitation.expiresAt <= now()) {
          yield* db
            .update(schema.invitation)
            .set({ status: "expired", updatedAt: now() })
            .where(
              and(eq(schema.invitation.id, invitation.id), eq(schema.invitation.status, "pending")),
            );

          return yield* Effect.fail(
            diagnoseError(new EnterpriseBadRequest({ message: "Invitation expired" }), {
              code: "invitation_expired",
            }),
          );
        }

        if (invitation.email.trim().toLowerCase() !== user.email.trim().toLowerCase())
          return yield* Effect.fail(
            new EnterpriseForbidden({
              message: "Sign in with the email address this invitation was sent to",
            }),
          );

        // Re-validate the delegated role at accept time. A deleted custom role
        // falls back to the least-privileged built-in role instead of failing
        // the invitation or granting stale permissions.
        const customRole = invitation.customRoleId
          ? yield* db.query.tenantRole.findFirst({
              where: { id: invitation.customRoleId, organizationId: invitation.organizationId },
            })
          : undefined;

        const roleFallback = Boolean(invitation.customRoleId) && !customRole;

        // A custom role's built-in fallback is never authoritative. Store
        // `member` so deleting the role later cannot promote the member.
        const role = invitation.customRoleId
          ? "member"
          : invitation.role && validRoles(invitation.role)
            ? invitation.role
            : "member";

        const assignedCustomRoleId = roleFallback ? null : (customRole?.id ?? null);

        const existing = yield* db.query.member.findFirst({
          where: { userId: user.id, organizationId: invitation.organizationId },
        });

        const siblings = yield* db
          .select({ id: schema.invitation.id })
          .from(schema.invitation)
          .where(
            and(
              eq(schema.invitation.organizationId, invitation.organizationId),
              eq(schema.invitation.email, invitation.email),
              eq(schema.invitation.status, "pending"),
            ),
          );

        const siblingIds = siblings
          .map((item: { id: string }) => item.id)
          .filter((id: string) => id !== invitation.id);

        const acceptedAt = now();

        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            // Conditional update keeps a concurrent accept from reviving a row
            // that another request already moved out of `pending`.
            yield* tx
              .update(schema.invitation)
              .set({ status: "accepted", acceptedAt, updatedAt: acceptedAt })
              .where(
                and(
                  eq(schema.invitation.id, invitation.id),
                  eq(schema.invitation.status, "pending"),
                ),
              );

            if (!existing)
              yield* tx.insert(schema.member).ignore().values({
                id: id(),
                organizationId: invitation.organizationId,
                userId: user.id,
                role,
                customRoleId: assignedCustomRoleId,
                createdAt: acceptedAt,
                updatedAt: acceptedAt,
              });

            for (const siblingId of siblingIds)
              yield* tx
                .update(schema.invitation)
                .set({ status: "superseded", tokenHash: null, updatedAt: acceptedAt })
                .where(eq(schema.invitation.id, siblingId));
          }),
        );

        const joinedAudit: MemberJoinedAuditMetadata = {
          invitationId: invitation.id,
          role,
          roleId: assignedCustomRoleId,
        };

        if (roleFallback) Object.assign(joinedAudit, { roleFallback: "member" });

        yield* audit(
          { user, organization: { id: invitation.organizationId } },
          "member.joined",
          "user",
          user.id,
          joinedAudit,
        );

        return { tenantId: invitation.organizationId, alreadyMember: Boolean(existing) };
      }),
    previewInvitation: (_request, query) =>
      Effect.gen(function* () {
        const invitation = yield* db.query.invitation.findFirst({
          where: { tokenHash: yield* invitationTokenHash(query.token) },
        });

        if (!invitation) return { state: "unknown" as const };

        const state: "valid" | "expired" | "accepted" | "canceled" | "superseded" = Match.value(
          invitation.status,
        ).pipe(
          Match.when("pending", () =>
            invitation.expiresAt <= now() ? ("expired" as const) : ("valid" as const),
          ),
          Match.when("accepted", () => "accepted" as const),
          Match.when("canceled", () => "canceled" as const),
          Match.when("expired", () => "expired" as const),
          Match.orElse(() => "superseded" as const),
        );

        // A canceled or superseded token reveals nothing beyond its state.
        if (state === "canceled" || state === "superseded") return { state };

        const organization = yield* db.query.organization.findFirst({
          where: { id: invitation.organizationId },
        });

        if (!organization) return { state: "unknown" as const };

        const customRoles = yield* db
          .select({ id: schema.tenantRole.id, name: schema.tenantRole.name })
          .from(schema.tenantRole)
          .where(eq(schema.tenantRole.organizationId, invitation.organizationId));

        const custom = new Map(customRoles.map((role) => [role.id, role.name]));

        return {
          state,
          tenant: {
            name: organization.name,
            displayName: organization.displayName ?? null,
            logo: organization.logo ?? null,
            brandColor: organization.brandColor ?? null,
          },
          roleName: invitationRoleName(invitation, custom),
          invitedEmailMasked: maskInvitationEmail(invitation.email),
          expiresAt: iso(invitation.expiresAt),
        };
      }),
    listTenantInvitations: (request, tenantId, query) =>
      Effect.gen(function* () {
        yield* requireTenant(request, tenantId, "read");

        const status = query?.status;
        const limit = Math.min(Math.max(Math.floor(query?.limit ?? 100), 1), 200);

        const invitations = yield* db
          .select()
          .from(schema.invitation)
          .where(
            status
              ? and(
                  eq(schema.invitation.organizationId, tenantId),
                  eq(schema.invitation.status, status),
                )
              : eq(schema.invitation.organizationId, tenantId),
          )
          .orderBy(desc(schema.invitation.createdAt))
          .limit(limit);

        const customRoles = yield* db
          .select({ id: schema.tenantRole.id, name: schema.tenantRole.name })
          .from(schema.tenantRole)
          .where(eq(schema.tenantRole.organizationId, tenantId));

        const custom = new Map(customRoles.map((role) => [role.id, role.name]));

        const inviterIds = [...new Set(invitations.map((item: any) => item.inviterId))];

        const inviters = inviterIds.length
          ? yield* db
              .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
              .from(schema.user)
              .where(inArray(schema.user.id, inviterIds))
          : [];

        const inviterById = new Map(inviters.map((inviter) => [inviter.id, inviter]));

        return {
          invitations: invitations.map((item: any) => {
            const inviter = inviterById.get(item.inviterId);

            return {
              id: item.id,
              email: item.email,
              role: item.role ?? null,
              roleId: item.customRoleId ?? null,
              customRoleId: item.customRoleId ?? null,
              roleName: invitationRoleName(item, custom),
              status: item.status,
              isExpired: invitationIsExpired(item),
              invitedBy: inviter
                ? { id: inviter.id, name: inviter.name, email: inviter.email }
                : undefined,
              createdAt: iso(item.createdAt),
              expiresAt: iso(item.expiresAt),
              lastSentAt: iso(item.lastSentAt ?? item.createdAt),
              sendCount: item.sendCount ?? 1,
              acceptedAt: item.acceptedAt ? iso(item.acceptedAt) : null,
            };
          }),
        };
      }),
    getTenantInvitationOptions: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "read");
        const actorIsOwner = isBuiltInOwnerMember(ctx.member);

        const builtIn = BUILT_IN_TENANT_ROLES.map((role) => {
          const required = actorIsOwner
            ? BUILT_IN_ROLE_PERMISSIONS[role]
            : BUILT_IN_ROLE_PERMISSIONS[role].filter(
                (permission) => !OWNER_ONLY_PERMISSIONS.has(permission),
              );

          const missing = role === "owner" && !actorIsOwner ? ["owner authority"] : [];

          const unheld = required.filter(
            (permission) => !hasPermission(ctx.role.permissions, permission),
          );

          return {
            role,
            roleId: null,
            label: BUILT_IN_ROLE_LABELS[role],
            assignable: missing.length === 0 && unheld.length === 0,
            blockedReason:
              missing.length > 0
                ? "Only an owner can assign the owner role"
                : unheld.length > 0
                  ? `Your role does not include: ${unheld.join(", ")}`
                  : null,
          };
        });

        const customRoles = yield* db
          .select({
            id: schema.tenantRole.id,
            name: schema.tenantRole.name,
            permissions: schema.tenantRole.permissions,
          })
          .from(schema.tenantRole)
          .where(eq(schema.tenantRole.organizationId, tenantId));

        const custom = customRoles.map((role: any) => {
          const permissions = normalizePermissions(
            Array.isArray(role.permissions) ? role.permissions : [],
          );

          const unheld = permissions.filter(
            (permission) => !hasPermission(ctx.role.permissions, permission),
          );

          const ownerOnly = permissions.filter((permission) =>
            OWNER_ONLY_PERMISSIONS.has(permission),
          );

          const blockedReason =
            unheld.length > 0
              ? "You cannot grant permissions your own role does not hold"
              : ownerOnly.length > 0 && !actorIsOwner
                ? "Only an owner can grant owner-only permissions"
                : null;

          return {
            roleId: role.id,
            label: role.name,
            assignable: blockedReason === null,
            blockedReason,
          };
        });

        return {
          roles: [
            ...builtIn,
            ...custom.sort((left: { label: string }, right: { label: string }) =>
              left.label.localeCompare(right.label),
            ),
          ],
        };
      }),
    cancelTenantInvitation: (request, tenantId, invitationId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const invitation = yield* db.query.invitation.findFirst({
          where: { id: invitationId, organizationId: tenantId },
        });

        if (!invitation)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Invitation not found" }));

        if (invitation.status !== "pending" && invitation.status !== "expired")
          return yield* Effect.fail(
            new EnterpriseConflict({
              message: "Only pending or expired invitations can be canceled",
            }),
          );

        yield* db
          .update(schema.invitation)
          .set({ status: "canceled", tokenHash: null, updatedAt: now() })
          .where(eq(schema.invitation.id, invitationId));

        yield* audit(ctx, "member.invitation_canceled", "invitation", invitation.id, {
          email: invitation.email,
          role: invitation.role,
          roleId: invitation.customRoleId ?? null,
        });

        return ok;
      }),
    resendTenantInvitation: (request, tenantId, invitationId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const invitation = yield* db.query.invitation.findFirst({
          where: { id: invitationId, organizationId: tenantId },
        });

        if (!invitation)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Invitation not found" }));

        if (
          invitation.status !== "pending" &&
          invitation.status !== "expired" &&
          invitation.status !== "superseded"
        )
          return yield* Effect.fail(
            new EnterpriseConflict({
              message: "Only pending, expired or superseded invitations can be resent",
            }),
          );

        const customRole = invitation.customRoleId
          ? yield* db.query.tenantRole.findFirst({
              where: { id: invitation.customRoleId, organizationId: tenantId },
            })
          : undefined;

        const rawToken = newInvitationToken();
        const tokenHash = yield* invitationTokenHash(rawToken);
        const timestamp = now();
        const expiresAt = new Date(timestamp.getTime() + INVITATION_TTL_MS);
        const sendCount = (invitation.sendCount ?? 1) + 1;
        const inviteUrl = invitationUrl(origin, rawToken);

        const roleLabel = invitationRoleName(
          invitation,
          new Map(customRole ? [[customRole.id, customRole.name]] : []),
        );

        yield* db
          .update(schema.invitation)
          .set({
            status: "pending",
            tokenHash,
            expiresAt,
            lastSentAt: timestamp,
            sendCount,
            acceptedAt: null,
            updatedAt: timestamp,
          })
          .where(eq(schema.invitation.id, invitation.id));

        const emailSent = yield* sendInvitationEmail(ctx.organization, ctx.user.name, {
          email: invitation.email,
          roleName: roleLabel,
          inviteUrl,
          expiresAt,
        });

        yield* audit(ctx, "member.invitation_resent", "invitation", invitation.id, {
          email: invitation.email,
          role: invitation.role,
          roleId: invitation.customRoleId ?? null,
          sendCount,
          emailSent,
        });

        return {
          id: invitation.id,
          inviteUrl,
          expiresAt: iso(expiresAt),
          emailSent,
        };
      }),
    patchTenantUser: (request, tenantId, memberId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const member = yield* db.query.member.findFirst({
          where: { id: memberId, organizationId: tenantId },
        });

        if (!member)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant user not found" }));
        const body: { role?: string; roleId?: string | null } = payload;
        const selectingCustomRole = body.roleId !== undefined && body.roleId !== null;

        // A custom role's built-in fallback is always `member`; otherwise a
        // later role deletion (ON DELETE SET NULL) would promote the member to
        // a privileged built-in role.
        if (selectingCustomRole && body.role !== undefined && body.role !== "member")
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "When a custom role is selected, the built-in fallback must be member",
            }),
          );

        const customRole = selectingCustomRole
          ? yield* db.query.tenantRole.findFirst({
              where: { id: body.roleId!, organizationId: tenantId },
            })
          : undefined;

        if (body.roleId && !customRole)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Role not found" }));

        // Assigning a custom role is the same delegation boundary as inviting:
        // the assigned permissions cannot exceed the actor's own permissions.
        if (customRole)
          yield* assertPermissionsWithinActor(
            ctx,
            normalizePermissions(
              Array.isArray(customRole.permissions) ? customRole.permissions : [],
            ),
          );

        if (body.role === undefined && body.roleId === undefined)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Choose a role for this member" }),
          );

        // The built-in fallback role is validated on every write. Assigning a
        // custom role forces `member`; clearing one keeps the current built-in.
        const role = selectingCustomRole ? "member" : (body.role ?? member.role);

        if (!validRoles(role))
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: customRole ? "Choose a valid fallback role" : "Choose a valid tenant role",
            }),
          );

        if (!customRole) yield* assertBuiltInRoleAssignable(ctx, role);

        const targetIsOwner = isBuiltInOwnerMember(member);
        const assignsOwner = !customRole && hasOwnerRole(role);

        if ((targetIsOwner || assignsOwner) && !isBuiltInOwnerMember(ctx.member))
          return yield* Effect.fail(
            new EnterpriseForbidden({ message: "Only an owner can change owner roles" }),
          );

        const removingOwner = targetIsOwner && !assignsOwner;

        if (removingOwner && (yield* ownerCount(tenantId)) <= 1)
          return yield* Effect.fail(
            new EnterpriseForbidden({ message: "Cannot remove the last tenant owner" }),
          );
        yield* db
          .update(schema.member)
          .set({
            role,
            customRoleId: customRole?.id ?? null,
            updatedAt: now(),
          })
          .where(eq(schema.member.id, memberId));
        const roleAudit = { memberId, role };

        if (customRole)
          Object.assign(roleAudit, {
            roleId: customRole.id,
            roleName: customRole.name,
            permissionCeiling: "actor",
          });

        yield* audit(ctx, "member.role_changed", "user", member.userId, roleAudit);

        return ok;
      }),
    removeTenantUser: (request, tenantId, memberId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const count = yield* memberCount(tenantId);

        if (count <= 1)
          return yield* Effect.fail(
            diagnoseError(
              new EnterpriseLastTenantUser({
                message: "Cannot remove the last tenant user; delete the tenant instead",
              }),
              { code: "last_tenant_user" },
            ),
          );

        const member = yield* db.query.member.findFirst({
          where: { id: memberId, organizationId: tenantId },
        });

        if (!member)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant user not found" }));

        if (isBuiltInOwnerMember(member)) {
          // Removing an owner is an owner-level action even when other owners
          // remain; an administrator can never remove their superior.
          if (!isBuiltInOwnerMember(ctx.member))
            return yield* Effect.fail(
              new EnterpriseForbidden({ message: "Only an owner can remove an owner" }),
            );

          if ((yield* ownerCount(tenantId)) <= 1)
            return yield* Effect.fail(
              new EnterpriseForbidden({ message: "Cannot remove the last tenant owner" }),
            );
        }

        const linkedDevices = yield* db
          .select({ deviceId: schema.deviceUser.deviceId })
          .from(schema.deviceUser)
          .where(
            and(
              eq(schema.deviceUser.organizationId, tenantId),
              eq(schema.deviceUser.userId, member.userId),
            ),
          );

        const targetUser = yield* db.query.user.findFirst({ where: { id: member.userId } });
        const targetEmail = targetUser?.email.trim().toLowerCase();

        const pendingInvitations = targetEmail
          ? yield* db
              .select({ id: schema.invitation.id, email: schema.invitation.email })
              .from(schema.invitation)
              .where(
                and(
                  eq(schema.invitation.organizationId, tenantId),
                  eq(schema.invitation.status, "pending"),
                ),
              )
          : [];

        for (const invitation of pendingInvitations)
          if (invitation.email.trim().toLowerCase() === targetEmail)
            yield* db
              .update(schema.invitation)
              .set({ status: "canceled", tokenHash: null, updatedAt: now() })
              .where(eq(schema.invitation.id, invitation.id));

        yield* db.delete(schema.member).where(eq(schema.member.id, memberId));
        // A removed member must not keep granting user-assigned policies.
        yield* db
          .delete(schema.deviceUser)
          .where(
            and(
              eq(schema.deviceUser.organizationId, tenantId),
              eq(schema.deviceUser.userId, member.userId),
            ),
          );
        yield* audit(ctx, "member.removed", "user", member.userId, { memberId });
        yield* refreshDevicePolicies(tenantId, [
          ...new Set(linkedDevices.map((device) => device.deviceId)),
        ]);

        return ok;
      }),
    getEnrollment: (
      enrollmentId,
      code,
      options?: {
        readonly platform?: string | null;
        readonly ip?: string | null;
        readonly userAgent?: string | null;
      },
    ) =>
      Effect.gen(function* () {
        const enrollment = yield* db.query.enterpriseEnrollment.findFirst({
          where: { id: enrollmentId },
        });

        if (!enrollment)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Enrollment not found" }));

        const organization = yield* db.query.organization.findFirst({
          where: { id: enrollment.organizationId },
        });

        if (!organization)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Enrollment not found" }));
        const branding = resolveTenantBranding(organization);

        const platform = detectEnrollmentPlatform(options?.userAgent, options?.platform);

        const record = (outcome: EnrollmentAttemptOutcome, detail: string): Effect.Effect<void> =>
          recordEnrollmentAttempt({
            organizationId: organization.id,
            enrollmentId: enrollment.id,
            platform,
            outcome,
            detail,
            ip: options?.ip,
            userAgent: options?.userAgent,
          });

        if (enrollment.code && enrollment.code !== code) {
          yield* record("bad_code", "The enrollment password did not match");

          return { name: organization.name, branding, authenticated: false as const };
        }

        const apns = yield* db.query.applePushCertificate.findFirst({
          where: { organizationId: organization.id },
        });

        const [deviceCount] = yield* db
          .select({ value: count() })
          .from(schema.device)
          .where(eq(schema.device.organizationId, organization.id));

        const tenantLimitReached = !canEnrollDevice(deviceCount?.value ?? 0, enrollment.maxDevices);

        // The deployment plan limit is independent of the tenant's own
        // `maxDevices` setting: whichever is lower wins. Existing devices stay
        // manageable; only new enrollments are blocked.
        const planStatus = yield* deviceLimitForOrganization({
          db,
          organizationId: organization.id,
          config: planLimits,
        }).pipe(
          Effect.mapError(() => new EnterpriseDbError({ message: "Could not check plan limits" })),
        );

        const planLimitReached = planStatus.reached;
        const enabled = !tenantLimitReached && !planLimitReached;

        const androidRow = androidConfigured()
          ? yield* loadAndroidEnterprise(db, organization.id)
          : undefined;

        const androidReady =
          androidConfigured() &&
          androidRow?.status === "active" &&
          Boolean(androidRow.enterpriseName);

        const sso = yield* db.query.ssoConfig.findFirst({
          where: { organizationId: organization.id },
        });

        const autopilotProfileCount = yield* db
          .select({ value: count() })
          .from(schema.autopilotProfile)
          .where(eq(schema.autopilotProfile.organizationId, organization.id));

        const autopilotConfigured =
          Boolean(azureGraph && sso?.azureTenantId) &&
          Number(autopilotProfileCount[0]?.value ?? 0) > 0;

        const federatedAudience = windowsFederated?.audience ?? azureClientId;
        const federatedEnabled = Boolean(federatedAudience && sso?.azureTenantId);

        const federatedAuthUrl = federatedEnabled
          ? (windowsFederated?.authServiceUrl?.(sso!.azureTenantId!) ??
            federatedAuthServiceUrl(
              sso!.azureTenantId!,
              azureClientId ? { clientId: azureClientId } : {},
            ))
          : null;

        // Only create a SCEP challenge when the Apple branch is actually
        // usable. A failure is reported as a platform error instead of failing
        // the whole enrollment page, and is recorded for administrators.
        let challenge: string | null = null;
        let appleScepFailed = false;

        if (enabled && enrollment.enabledApple && apns?.topic) {
          challenge = yield* issueScepChallenge(db, {
            enrollmentId: enrollment.id,
            organizationId: enrollment.organizationId,
            authSecret: authSecret ?? "",
            // Enrollment profiles are shareable links; allow a week before the
            // challenge goes stale. The persisted row makes it one-time.
            ttlSeconds: 7 * 24 * 60 * 60,
          }).pipe(
            Effect.match({
              onFailure: () => {
                appleScepFailed = true;

                return null;
              },
              onSuccess: (value) => value.challenge,
            }),
          );
        }

        const evaluation = evaluateEnrollmentAttempt({
          platform,
          limitReached: !enabled,
          appleEnabled: enrollment.enabledApple,
          windowsEnabled: enrollment.enabledWindows,
          androidEnabled: enrollment.enabledAndroid,
          androidAvailable: androidReady,
          apnsConfigured: Boolean(apns?.topic),
          appleScepFailed,
        });

        yield* record(evaluation.outcome, evaluation.detail);

        // Windows discovery has no built-in tenant identity, so bind the tenant
        // into a short-lived signed token that travels in the discovery URL and
        // is preserved through policy/enroll. This replaces the old
        // deployment-wide pin for Cloud. Regenerated on every page load.
        const windowsToken =
          enabled && enrollment.enabledWindows && authSecret
            ? yield* Effect.tryPromise({
                try: () => createWindowsTenantToken(organization.id, authSecret),
                catch: () =>
                  new EnterpriseBadRequest({
                    message: "Could not create the Windows enrollment link",
                  }),
              }).pipe(Effect.catch(() => Effect.succeed(null)))
            : null;

        const windowsExpiry = windowsToken ? windowsTenantTokenExpiresAt(windowsToken) : null;

        const apple = yield* Effect.gen(function* () {
          if (planLimitReached) return { error: PLAN_DEVICE_LIMIT_MESSAGE };

          if (!enabled || !enrollment.enabledApple)
            return { error: "Apple enrollment is disabled! Contact your administrator." };

          if (!apns?.topic)
            return { error: "Apple management is not configured! Contact your administrator." };

          if (appleScepFailed || !challenge)
            return {
              error: "Apple enrollment is temporarily unavailable! Contact your administrator.",
            };

          return {
            profile: yield* serializePlist(
              enterpriseEnrollmentProfile({
                origin,
                topic: apns.topic,
                organizationId: organization.id,
                organizationName: branding.displayName,
                supportEmail: branding.supportEmail,
                challenge,
              }),
            ),
          };
        });

        const windows = (() => {
          if (planLimitReached) return { error: PLAN_DEVICE_LIMIT_MESSAGE };

          if (!enabled || !enrollment.enabledWindows)
            return { error: "Windows enrollment is disabled! Contact your administrator." };

          if (!windowsToken)
            return {
              error: "Windows enrollment is temporarily unavailable! Contact your administrator.",
            };

          return {
            discoveryUrl: `${origin}/mdm/windows/discovery?tenant=${encodeURIComponent(windowsToken)}`,
            tenantScoped: true as const,
            expiresAt: windowsExpiry ? windowsExpiry.toISOString() : undefined,
            autopilot: {
              configured: autopilotConfigured,
              federated: federatedEnabled,
              authServiceUrl: federatedAuthUrl,
              realm: federatedEnabled ? federatedRealm(sso!.azureTenantId!) : null,
            },
          };
        })();

        const android = yield* Effect.gen(function* () {
          if (planLimitReached) return { error: PLAN_DEVICE_LIMIT_MESSAGE };

          if (!enabled || !enrollment.enabledAndroid)
            return { error: "Android enrollment is disabled! Contact your administrator." };

          if (!androidConfigured())
            return {
              error: "Android Enterprise is not configured! Contact your administrator.",
            };

          if (!androidReady)
            return { error: "Android Enterprise is not connected! Contact your administrator." };

          return yield* createAndroidEnrollmentToken({
            db,
            config: androidConfig,
            organizationId: organization.id,
          }).pipe(
            Effect.map((token) => ({
              qrCode: token.qrCode ? token.qrCode : undefined,
              enrollmentToken: token.value,
              policyName: token.policyName ? token.policyName : undefined,
              expiresAt: token.expiresAt ? token.expiresAt : undefined,
            })),
            Effect.catch(() =>
              Effect.gen(function* () {
                yield* record("other", "Android enrollment token could not be created");

                return {
                  error:
                    "Android enrollment is temporarily unavailable! Contact your administrator.",
                };
              }),
            ),
          );
        });

        return {
          name: organization.name,
          branding,
          authenticated: true as const,
          deviceLimit: {
            reached: planLimitReached,
            plan: planStatus.plan,
            limit: planStatus.limit !== null ? planStatus.limit : undefined,
            used: planStatus.used !== null ? planStatus.used : undefined,
          },
          apple,
          windows,
          android,
          assetTag: enabled && enrollment.enabledAssetTag,
        };
      }),
    getAppleEnrollmentProfile: (
      enrollmentId,
      code,
      options?: {
        readonly platform?: string | null;
        readonly ip?: string | null;
        readonly userAgent?: string | null;
      },
    ): Effect.Effect<{ profile: Uint8Array; filename: string }, Dynamic, Dynamic> =>
      Effect.gen(function* () {
        if (!allowAppleProfileRequest(options?.ip))
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Too many profile downloads. Wait a minute and scan the QR code again.",
            }),
          );

        const result: {
          name: string;
          authenticated: boolean;
          apple?: { error: string } | { profile: string };
        } = yield* service.getEnrollment(enrollmentId, code, {
          platform: options?.platform ?? "apple",
          ip: options?.ip ?? null,
          userAgent: options?.userAgent ?? null,
        });

        if (!result.authenticated)
          return yield* Effect.fail(
            new EnterpriseForbidden({ message: "The enrollment password is invalid." }),
          );

        if (!result.apple || "error" in result.apple)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: result.apple?.error ?? "Apple enrollment profile is unavailable.",
            }),
          );

        if (!("profile" in result.apple))
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Apple enrollment is temporarily unavailable! Contact your administrator.",
            }),
          );

        // The profile endpoint is public, so resolve the tenant's display name
        // from the enrollment row rather than trusting a caller-supplied value.
        const enrollment = yield* db.query.enterpriseEnrollment.findFirst({
          where: { id: enrollmentId },
        });

        const organization = enrollment
          ? yield* db.query.organization.findFirst({ where: { id: enrollment.organizationId } })
          : undefined;

        if (!enrollment)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant not found." }));

        const filename = `${safeFilename(
          organization?.slug ??
            resolveTenantBranding(organization ?? { name: "tenant" }).displayName,
        )}-enrollment.mobileconfig`;

        return {
          profile: yield* signAppleEnrollmentProfile(
            result.apple.profile,
            enrollment.organizationId,
          ),
          filename,
        };
      }),
    getAdeEnrollmentProfile: (token: string) =>
      Effect.gen(function* () {
        if (!authSecret)
          return yield* Effect.fail(
            new EnterpriseNotConfigured({
              message: "AUTH_SECRET is required to serve ADE enrollment profiles.",
            }),
          );
        const signed = yield* mapAppleFailure(readAdeProfileToken({ authSecret, token }));
        const abm = yield* loadAppleBusinessManager(db, signed.organizationId);

        if (!abm)
          return yield* Effect.fail(
            new EnterpriseNotConfigured({
              message: "Apple Business Manager is not configured for this tenant.",
            }),
          );

        const device = yield* db.query.abmDevice.findFirst({
          where: { organizationId: signed.organizationId, serial: signed.serial },
        });

        if (!device || device.enrollmentState === "REMOVED")
          return yield* Effect.fail(
            new EnterpriseNotFound({
              message: "This ABM device is no longer in the organization.",
            }),
          );

        if (device.enrollmentState !== "ASSIGNED")
          return yield* Effect.fail(
            new EnterpriseForbidden({
              message:
                "Assign this device to Mattrax in Apple Business Manager before downloading its ADE profile.",
            }),
          );

        if (device.assignedProfileUuid && device.assignedProfileUuid !== signed.profileUuid)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "This ADE profile link is for a different profile revision.",
            }),
          );

        const apns = yield* db.query.applePushCertificate.findFirst({
          where: { organizationId: signed.organizationId },
        });

        if (!apns?.topic)
          return yield* Effect.fail(
            new EnterpriseNotConfigured({
              message: "Apple push notifications are not configured for this tenant.",
            }),
          );

        const organization = yield* db.query.organization.findFirst({
          where: { id: signed.organizationId },
        });

        if (!organization)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant not found." }));
        const branding = resolveTenantBranding(organization);
        // SCEP verifies the challenge against an `enterprise_enrollment` row
        // and derives the certificate OU from that tenant. Use the tenant's
        // enrollment id (not an ADE-specific string) so ADE identities resolve.
        const enrollment = yield* getOrCreateEnrollment(signed.organizationId);

        const { challenge } = yield* issueScepChallenge(db, {
          enrollmentId: enrollment.id,
          organizationId: enrollment.organizationId,
          authSecret: authSecret!,
          ttlSeconds: 7 * 24 * 60 * 60,
        }).pipe(
          Effect.mapError(
            () =>
              new EnterpriseBadRequest({
                message: "Could not create the SCEP challenge for the ADE profile.",
              }),
          ),
        );

        const plist = yield* serializePlist(
          enterpriseEnrollmentProfile({
            origin,
            topic: apns.topic,
            organizationId: organization.id,
            organizationName: branding.displayName,
            supportEmail: branding.supportEmail,
            challenge,
            displayName: `${branding.displayName} Automated Device Enrollment`,
            identifier: `com.mattrax.ade.${signed.profileUuid}`,
            profileUuid: signed.profileUuid,
          }),
        );

        return {
          profile: yield* signAppleEnrollmentProfile(plist, organization.id),
          filename: `${safeFilename(signed.serial)}.mobileconfig`,
        };
      }),
    getTenantScepCa: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const organizationId = ctx.organization.id;

        const [row] = yield* db
          .select()
          .from(schema.scepCa)
          .where(eq(schema.scepCa.organizationId, organizationId))
          .limit(1);

        if (!row)
          return {
            configured: false as const,
            scepUrl: scepUrlFor(organizationId),
            source: null,
            commonName: null,
            fingerprintSha256: null,
            notAfter: null,
            createdAt: null,
            rotatedAt: null,
          } satisfies TenantScepCaInfo;

        const description = yield* describeScepCa(row.certPem).pipe(
          Effect.mapError(
            () => new EnterpriseDbError({ message: "The stored SCEP CA certificate is invalid." }),
          ),
        );

        return tenantScepCaInfo(organizationId, row, description);
      }),
    rotateTenantScepCa: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const organizationId = ctx.organization.id;
        const repository = ScepRepositoryLive.make(db, { authSecret });

        // Rotation is deliberately explicit: every identity issued by the
        // previous CA stops being usable for renewal or mTLS check-in once the
        // tenant CA changes, so they are revoked and the devices must re-enroll.
        yield* generateScepCa(organizationId).pipe(
          Effect.flatMap((candidate) => replaceScepCa(repository, { organizationId }, candidate)),
          Effect.mapError(
            () => new EnterpriseInternal({ message: "Could not rotate the tenant SCEP CA." }),
          ),
        );

        yield* db
          .update(schema.scepIssuedCertificate)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(schema.scepIssuedCertificate.organizationId, organizationId),
              isNull(schema.scepIssuedCertificate.revokedAt),
            ),
          )
          .pipe(
            Effect.mapError(
              () => new EnterpriseDbError({ message: "Could not revoke the old identities." }),
            ),
          );

        const [row] = yield* db
          .select()
          .from(schema.scepCa)
          .where(eq(schema.scepCa.organizationId, organizationId))
          .limit(1);

        const description = yield* describeScepCa(row!.certPem).pipe(
          Effect.mapError(
            () => new EnterpriseInternal({ message: "Could not read the rotated SCEP CA." }),
          ),
        );

        return tenantScepCaInfo(organizationId, row!, description);
      }),
    importTenantScepCa: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const organizationId = ctx.organization.id;
        const repository = ScepRepositoryLive.make(db, { authSecret });

        const material = yield* importScepCa({
          certificatePem: payload.certificatePem,
          privateKeyPem: payload.privateKeyPem,
        }).pipe(Effect.mapError((cause) => new EnterpriseBadRequest({ message: cause.message })));

        yield* replaceScepCa(repository, { organizationId }, material).pipe(
          Effect.mapError(
            () => new EnterpriseInternal({ message: "Could not store the supplied SCEP CA." }),
          ),
        );

        // Importing a different CA invalidates every identity issued by the old
        // one for renewal purposes. Revoke them so health and device views are
        // truthful; devices must re-enroll against the new CA.
        yield* db
          .update(schema.scepIssuedCertificate)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(schema.scepIssuedCertificate.organizationId, organizationId),
              isNull(schema.scepIssuedCertificate.revokedAt),
            ),
          )
          .pipe(
            Effect.mapError(
              () => new EnterpriseDbError({ message: "Could not revoke the old identities." }),
            ),
          );

        const [row] = yield* db
          .select()
          .from(schema.scepCa)
          .where(eq(schema.scepCa.organizationId, organizationId))
          .limit(1);

        const description = yield* describeScepCa(row!.certPem).pipe(
          Effect.mapError(
            () => new EnterpriseInternal({ message: "Could not read the supplied SCEP CA." }),
          ),
        );

        return tenantScepCaInfo(organizationId, row!, description);
      }),
    getTenantEnrollment: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const enrollment = yield* getOrCreateEnrollment(ctx.organization.id);

        const windowsToken =
          enrollment.enabledWindows && authSecret
            ? yield* Effect.tryPromise({
                try: () => createWindowsTenantToken(ctx.organization.id, authSecret),
                catch: () =>
                  new EnterpriseBadRequest({
                    message: "Could not create the Windows enrollment link",
                  }),
              }).pipe(Effect.catch(() => Effect.succeed(null)))
            : null;

        const windowsExpiry = windowsToken ? windowsTenantTokenExpiresAt(windowsToken) : null;

        const androidRow = androidConfigured()
          ? yield* loadAndroidEnterprise(db, ctx.organization.id)
          : undefined;

        const androidAvailable =
          androidConfigured() &&
          androidRow?.status === "active" &&
          Boolean(androidRow.enterpriseName);

        return {
          ...rowEnrollment(enrollment),
          androidAvailable,
          androidEnterpriseName: androidRow?.enterpriseName ?? null,
          windowsDiscoveryUrl: windowsToken
            ? `${origin}/mdm/windows/discovery?tenant=${encodeURIComponent(windowsToken)}`
            : undefined,
          windowsDiscoveryExpiresAt:
            windowsToken && windowsExpiry ? windowsExpiry.toISOString() : undefined,
        };
      }),
    listEnrollmentAttempts: (request, tenantId, query = {}) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const requested = Number(query.limit ?? 50);
        const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 50, 1), 200);

        const attempts = yield* db
          .select()
          .from(schema.enrollmentAttempt)
          .where(eq(schema.enrollmentAttempt.organizationId, ctx.organization.id))
          .orderBy(desc(schema.enrollmentAttempt.createdAt))
          .limit(limit);

        return {
          attempts: attempts.map((attempt: any) => ({
            id: attempt.id,
            enrollmentId: attempt.enrollmentId,
            platform: attempt.platform,
            outcome: attempt.outcome,
            detail: attempt.detail,
            createdAt: iso(attempt.createdAt),
          })),
        };
      }),
    patchTenantEnrollment: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* getOrCreateEnrollment(ctx.organization.id);

        const body: {
          code?: string | null;
          enabledApple?: boolean;
          enabledWindows?: boolean;
          enabledAndroid?: boolean;
          enabledAssetTag?: boolean;
          maxDevices?: number;
        } = payload;

        yield* db
          .update(schema.enterpriseEnrollment)
          .set({
            code: body.code !== undefined ? body.code : undefined,
            enabledApple: body.enabledApple !== undefined ? body.enabledApple : undefined,
            enabledWindows: body.enabledWindows !== undefined ? body.enabledWindows : undefined,
            enabledAndroid: body.enabledAndroid !== undefined ? body.enabledAndroid : undefined,
            enabledAssetTag: body.enabledAssetTag !== undefined ? body.enabledAssetTag : undefined,
            maxDevices: body.maxDevices !== undefined ? body.maxDevices : undefined,
            updatedAt: now(),
          })
          .where(eq(schema.enterpriseEnrollment.organizationId, ctx.organization.id));
        yield* audit(ctx, "enrollment.updated", "enrollment", null, {
          fields: Object.keys(body),
        });

        return ok;
      }),
    resetTenantEnrollment: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* getOrCreateEnrollment(ctx.organization.id);
        const newId = id();
        yield* db
          .update(schema.enterpriseEnrollment)
          .set({ id: newId, updatedAt: now() })
          .where(eq(schema.enterpriseEnrollment.organizationId, ctx.organization.id));
        yield* audit(ctx, "enrollment.reset", "enrollment", newId);

        return { id: newId };
      }),
    getAppleBusinessManager: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        return yield* mapAppleFailure(appleBusinessManagerInfo(db, ctx.organization.id));
      }),
    uploadAppleBusinessManagerToken: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const body: {
          content: string;
          encoding?: "text" | "base64";
          fileName?: string;
          clientId?: string;
          keyId?: string;
          teamId?: string;
          orgId?: string;
          orgName?: string;
          scope?: "business.api" | "school.api";
        } = payload;

        const info = yield* mapAppleFailure(
          saveAppleBusinessManagerToken({
            db,
            organizationId: ctx.organization.id,
            authSecret,
            upload: body,
            config: appleApi ? appleApi : undefined,
          }),
        );

        yield* audit(ctx, "abm.token_uploaded", "apple_business_manager", ctx.organization.id, {
          credentialType: info.credentialType,
          fileName: body.fileName ?? null,
        });

        return info;
      }),
    deleteAppleBusinessManagerToken: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* mapAppleFailure(
          clearAppleBusinessManagerToken({ db, organizationId: ctx.organization.id }),
        );
        yield* audit(ctx, "abm.token_deleted", "apple_business_manager", ctx.organization.id);

        return ok;
      }),
    syncAppleBusinessManager: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const result = yield* mapAppleFailure(
          syncAppleBusinessManagerDevices({
            db,
            organizationId: ctx.organization.id,
            authSecret,
            config: appleApi ? appleApi : undefined,
          }),
        );

        yield* audit(ctx, "abm.synced", "apple_business_manager", ctx.organization.id, result);

        return result;
      }),
    listAbmDevices: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const rows = yield* db
          .select()
          .from(schema.abmDevice)
          .where(eq(schema.abmDevice.organizationId, ctx.organization.id));

        return {
          devices: rows.map((device: typeof schema.abmDevice.$inferSelect) => ({
            serial: device.serial,
            model: device.model,
            deviceFamily: device.deviceFamily,
            os: device.os,
            profileStatus: device.profileStatus,
            assignedProfileUuid: device.assignedProfileUuid,
            enrollmentState: device.enrollmentState,
            assignedServerId: device.assignedServerId,
            lastSeenAt: iso(device.lastSeenAt),
            updatedAt: iso(device.updatedAt)!,
          })),
        };
      }),
    getAbmDevice: (request, tenantId, serial) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const device = yield* db.query.abmDevice.findFirst({
          where: { organizationId: ctx.organization.id, serial },
        });

        if (!device)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "This serial is not in the ABM inventory" }),
          );

        return {
          serial: device.serial,
          model: device.model,
          deviceFamily: device.deviceFamily,
          os: device.os,
          profileStatus: device.profileStatus,
          assignedProfileUuid: device.assignedProfileUuid,
          enrollmentState: device.enrollmentState,
          assignedServerId: device.assignedServerId,
          lastSeenAt: iso(device.lastSeenAt),
          updatedAt: iso(device.updatedAt)!,
        };
      }),
    assignAppleBusinessManagerDevice: (request, tenantId, serial) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const apnsRow = yield* db.query.applePushCertificate.findFirst({
          where: { organizationId: ctx.organization.id },
        });

        const result = yield* mapAppleFailure(
          assignAppleBusinessManagerDevice({
            db,
            organizationId: ctx.organization.id,
            serial,
            authSecret,
            serverName: appleServerName(ctx.organization),
            certificatePem: apnsRow?.certPem ? apnsRow.certPem : undefined,
            config: appleApi ? appleApi : undefined,
          }),
        );

        yield* audit(ctx, "abm.device_assigned", "abm_device", serial, {
          mdmServerId: result.mdmServerId,
          activityId: result.activityId ?? null,
        });

        return { status: "ok" as const, ...result };
      }),
    getAbmDeviceProfileUrl: (request, tenantId, serial) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        if (!authSecret)
          return yield* Effect.fail(
            new EnterpriseNotConfigured({
              message: "AUTH_SECRET is required to sign ADE profile links.",
            }),
          );
        const abm = yield* loadAppleBusinessManager(db, ctx.organization.id);

        if (!abm)
          return yield* Effect.fail(
            new EnterpriseNotConfigured({
              message: "Apple Business Manager is not configured for this tenant.",
            }),
          );

        const device = yield* db.query.abmDevice.findFirst({
          where: { organizationId: ctx.organization.id, serial },
        });

        if (!device)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "This serial is not in the ABM inventory" }),
          );

        if (device.enrollmentState !== "ASSIGNED" || device.profileStatus === "removed")
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message:
                "Assign this device to Mattrax in Apple Business Manager before generating an ADE profile link.",
            }),
          );
        const profileUuid = device.assignedProfileUuid ?? abm.profileUuid;

        if (!profileUuid)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "No ADE profile UUID is recorded for this tenant.",
            }),
          );

        const signed = yield* mapAppleFailure(
          createAdeProfileToken({
            authSecret,
            organizationId: ctx.organization.id,
            serial,
            profileUuid,
          }),
        );

        yield* audit(ctx, "abm.profile_url_created", "abm_device", serial, {
          profileUuid,
        });

        return {
          serial,
          profileUuid,
          url: `${origin.replace(/\/+$/, "")}/api/v1/abm/ade/${encodeURIComponent(signed.token)}`,
          expiresAt: signed.expiresAt.toISOString(),
        };
      }),
    getVpp: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        return yield* mapVppFailure(vppInfo(db, ctx.organization.id));
      }),
    uploadVppToken: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const body: {
          content: string;
          encoding?: "text" | "base64";
          fileName?: string;
        } = payload;

        const info = yield* mapVppFailure(
          saveVppToken({
            db,
            organizationId: ctx.organization.id,
            authSecret,
            upload: body,
            config: appleApi ? appleApi : undefined,
          }),
        );

        yield* audit(ctx, "vpp.token_uploaded", "vpp_token", ctx.organization.id, {
          fileName: body.fileName ?? null,
        });

        return info;
      }),
    deleteVppToken: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* mapVppFailure(clearVppToken({ db, organizationId: ctx.organization.id }));
        yield* audit(ctx, "vpp.token_deleted", "vpp_token", ctx.organization.id);

        return ok;
      }),
    syncVpp: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        // Enrich VPP assets with app names/bundle ids when an ABM API
        // credential is available. Failure here is not fatal: the VPP counts
        // are still valid and the catalogue fallback supplies a display name.
        const appMetadata = yield* Effect.gen(function* () {
          if (!authSecret) return undefined;
          const abm = yield* loadAppleBusinessManager(db, ctx.organization.id);

          if (!abm) return undefined;

          const credential = yield* Effect.tryPromise({
            try: () => openAbmCredential(authSecret, abm.encryptedToken),
            catch: () => new Error("ABM credential unavailable"),
          });

          if (credential.kind !== "abm_api") return undefined;
          const client = createAbmClient(appleApi, credential.scope);
          const token = yield* Effect.tryPromise(() => client.exchangeAccessToken(credential));
          const apps = yield* Effect.tryPromise(() => client.listApps(token.accessToken));

          return new Map(
            apps.map((app) => [
              app.id,
              {
                name: app.name ? app.name : undefined,
                bundleId: app.bundleId ? app.bundleId : undefined,
              },
            ]),
          );
        }).pipe(Effect.catch(() => Effect.succeed(undefined)));

        const result = yield* mapVppFailure(
          syncVppAssets({
            db,
            organizationId: ctx.organization.id,
            authSecret,
            config: appleApi ? appleApi : undefined,
            appMetadata: appMetadata ? appMetadata : undefined,
          }),
        );

        yield* audit(ctx, "vpp.synced", "vpp_token", ctx.organization.id, result);

        return result;
      }),
    listVppAssets: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const rows = yield* db
          .select()
          .from(schema.vppAsset)
          .where(eq(schema.vppAsset.organizationId, ctx.organization.id));

        return {
          assets: rows.map((asset: typeof schema.vppAsset.$inferSelect) => ({
            adamId: asset.adamId,
            name: asset.name,
            bundleId: asset.bundleId,
            totalLicenses: asset.totalLicenses,
            availableLicenses: asset.availableLicenses,
            assignedLicenses: asset.assignedLicenses,
            retiredLicenses: asset.retiredLicenses,
            pricingParam: asset.pricingParam,
            deviceAssignable: asset.deviceAssignable,
            revocable: asset.revocable,
            productType: asset.productType,
            supportedPlatforms: Array.isArray(asset.supportedPlatforms)
              ? asset.supportedPlatforms
              : undefined,
            lastSyncedAt: iso(asset.lastSyncedAt),
          })),
        };
      }),
    listVppAssignments: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const rows = yield* db
          .select()
          .from(schema.deviceVppAssignment)
          .where(eq(schema.deviceVppAssignment.organizationId, ctx.organization.id));

        return {
          assignments: rows.map((assignment: typeof schema.deviceVppAssignment.$inferSelect) => ({
            deviceId: assignment.deviceId,
            serial: assignment.serial,
            adamId: assignment.adamId,
            state: assignment.state,
            eventId: assignment.eventId,
            lastError: assignment.lastError,
            updatedAt: iso(assignment.updatedAt)!,
          })),
        };
      }),
    installVppAsset: (request, tenantId, adamId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        if (!/^\d+$/.test(adamId))
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "A VPP adamId must be numeric." }),
          );
        const body: { devices?: string[]; groups?: string[] } = payload;

        const asset = yield* findVppAsset(db, ctx.organization.id, adamId);

        if (!asset)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "No VPP licence pool exists for this app" }),
          );
        const groupIds = body.groups ?? [];

        for (const groupId of groupIds) yield* assertTenantGroup(ctx.organization.id, groupId);
        yield* assertTenantDevices(ctx.organization.id, body.devices ?? []);

        const groupDevices = groupIds.length
          ? yield* db
              .select({ deviceId: schema.groupDevice.deviceId })
              .from(schema.groupDevice)
              .where(inArray(schema.groupDevice.groupId, groupIds))
          : [];

        const ids = new Set<string>([
          ...(body.devices ?? []),
          ...groupDevices.map((row) => row.deviceId),
        ]);

        if (ids.size === 0)
          return {
            status: "ok" as const,
            assigned: 0,
            queued: 0,
            skipped: 0,
            failed: 0,
            message: "Select at least one device or group.",
          };

        const devices = yield* db
          .select()
          .from(schema.device)
          .where(
            and(
              eq(schema.device.organizationId, ctx.organization.id),
              inArray(schema.device.id, [...ids]),
            ),
          );

        const appleDevices = devices.filter(
          (device) => device.proto === "apple" && device.status === "enrolled",
        );

        const skipped = devices.length - appleDevices.length;
        let assigned = 0;
        let failed = 0;
        const queuedDevices: Array<EnterpriseDevice> = [];

        for (const device of appleDevices) {
          const outcome = yield* mapVppFailure(
            assignVppLicence({
              db,
              organizationId: ctx.organization.id,
              deviceId: device.id,
              adamId,
              authSecret,
              config: appleApi ? appleApi : undefined,
            }),
          ).pipe(Effect.result);

          if (Predicate.isTagged(outcome, "Failure")) {
            failed++;
            continue;
          }

          assigned++;
          queuedDevices.push(device);
        }

        if (queuedDevices.length > 0) {
          const at = now();

          for (const device of queuedDevices)
            yield* queueDeviceCommand({
              organizationId: ctx.organization.id,
              deviceId: device.id,
              requestType: "InstallApplication",
              payload: vppInstallPayload(adamId),
              at,
            });

          yield* applePush.pushAppleDevices(queuedDevices.map((device) => device.id));
        }

        yield* audit(ctx, "vpp.install_queued", "vpp_asset", adamId, {
          assigned,
          queued: queuedDevices.length,
          skipped,
          failed,
        });

        return {
          status: "ok" as const,
          assigned,
          queued: queuedDevices.length,
          skipped,
          failed,
          message:
            failed > 0 ? `${failed} device(s) could not be assigned a VPP licence.` : undefined,
        };
      }),
    releaseVppAsset: (request, tenantId, adamId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body: { devices: string[] } = payload;
        yield* assertTenantDevices(ctx.organization.id, body.devices);
        let released = 0;
        let failed = 0;

        for (const deviceId of body.devices) {
          const outcome = yield* mapVppFailure(
            releaseVppLicence({
              db,
              organizationId: ctx.organization.id,
              deviceId,
              adamId,
              authSecret,
              config: appleApi ? appleApi : undefined,
            }),
          ).pipe(Effect.result);

          if (Predicate.isTagged(outcome, "Failure")) failed++;
          else released++;
        }

        yield* audit(ctx, "vpp.licence_released", "vpp_asset", adamId, { released, failed });

        return {
          status: "ok" as const,
          released,
          failed,
          message: failed > 0 ? `${failed} licence(s) could not be returned.` : undefined,
        };
      }),
    getTenantAndroid: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        return yield* mapAndroidFailure(
          androidEnterpriseInfo(db, ctx.organization.id, androidConfig),
        );
      }),
    patchTenantAndroid: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body: { enabled?: boolean } = payload;

        if (body.enabled !== undefined) {
          yield* mapAndroidFailure(
            setAndroidEnabled({
              db,
              config: androidConfig,
              organizationId: ctx.organization.id,
              enabled: body.enabled,
            }),
          );
          yield* audit(
            ctx,
            body.enabled ? "android.enterprise_enabled" : "android.enterprise_disabled",
            "android_enterprise",
            ctx.organization.id,
          );
        }

        return ok;
      }),
    createAndroidSignup: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const result = yield* mapAndroidFailure(
          createAndroidSignup({
            db,
            config: androidConfig,
            authSecret,
            origin,
            organization: {
              id: ctx.organization.id,
              name: ctx.organization.name,
              displayName: ctx.organization.displayName,
              supportEmail: ctx.organization.supportEmail,
            },
          }),
        );

        return result;
      }),
    syncTenantAndroid: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        if (!androidConfigured())
          return yield* Effect.fail(
            new EnterpriseNotConfigured({
              message: "Android Enterprise is not configured for this deployment.",
            }),
          );

        const result = yield* mapAndroidFailure(
          syncAndroidPoliciesForTenant({
            db,
            config: androidConfig,
            organizationId: ctx.organization.id,
          }),
        );

        yield* audit(ctx, "android.policy_sync", "android_enterprise", ctx.organization.id, {
          devices: result.devices,
          updated: result.updated,
          skipped: result.skipped,
          failed: result.failed,
        });

        return result;
      }),
    getApns: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const apns = yield* db.query.applePushCertificate.findFirst({
          where: { organizationId: ctx.organization.id },
        });

        let expiresAt: string | null = null;
        let commonName: string | null = null;

        if (apns) {
          try {
            const parsed = parseApnsCertificate(apns.certPem);
            expiresAt = parsed.notAfter.toISOString();
            commonName = parsed.commonName;
          } catch {
            // A historical certificate may be unparseable; still report it as configured.
          }
        }

        return {
          configured: apns !== undefined,
          email: apns?.email ?? null,
          topic: apns?.topic ?? null,
          expiresAt,
          commonName,
        };
      }),
    getApnsCsr: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const key = yield* loadApnsKey(ctx.organization.id);

        const keyPair = yield* Effect.tryPromise({
          try: async () => {
            const privateKey = await importApnsKeyJwk(key.jwk);

            // WebCrypto cannot derive the public key from a private JWK, but the
            // JWK contains the public parameters; derive a key pair by importing
            // both halves.
            const publicKey = await crypto.subtle.importKey(
              "jwk",
              { kty: key.jwk.kty, n: key.jwk.n, e: key.jwk.e, ext: true },
              { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
              true,
              ["verify"],
            );

            return { privateKey, publicKey };
          },
          catch: () => new EnterpriseBadRequest({ message: "Could not load the pending APNs key" }),
        });

        const result = yield* Effect.tryPromise({
          try: () =>
            buildApnsCsr({
              keyPair,
              subject: {
                organization: ctx.organization.name,
                organizationalUnit: ctx.organization.id,
              },
              vendor: remoteApnsVendor(),
            }),
          catch: () => new EnterpriseBadRequest({ message: "Could not generate the APNs CSR" }),
        });

        return { plist: result.plist };
      }),
    uploadApns: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body: { email: string; cert: string } = payload;

        // Find the private key this certificate should correspond to. A pending
        // CSR key is the normal case; an existing certificate key covers renewals.
        const pending = yield* db.query.applePushKey.findFirst({
          where: { organizationId: ctx.organization.id },
        });

        const existing = yield* db.query.applePushCertificate.findFirst({
          where: { organizationId: ctx.organization.id },
        });

        let encryptedKey: string | undefined;

        if (authSecret && (pending || existing?.encryptedKey)) {
          const encrypted = pending?.encryptedPrivateKeyJwk ?? existing?.encryptedKey;

          if (encrypted) {
            const jwk: JsonWebKey = JSON.parse(
              yield* Effect.tryPromise({
                try: () => openSecret(authSecret, encrypted),
                catch: () =>
                  new EnterpriseBadRequest({ message: "Could not read the pending APNs key" }),
              }),
            );

            const privateKey = yield* Effect.tryPromise({
              try: () => importApnsKeyJwk(jwk),
              catch: () =>
                new EnterpriseBadRequest({ message: "Could not import the pending APNs key" }),
            });

            yield* Effect.tryPromise({
              try: () => validateApnsCertificate(body.cert, { privateKey }),
              catch: (cause) =>
                new EnterpriseBadRequest({
                  message: cause instanceof Error ? cause.message : "Invalid APNs certificate",
                }),
            });
            // Re-seal at rest even though the underlying key is unchanged.
            encryptedKey = yield* Effect.tryPromise({
              try: () => sealSecret(authSecret, JSON.stringify(jwk)),
              catch: () => new EnterpriseBadRequest({ message: "Could not seal the APNs key" }),
            });
          }
        }

        const parsed = yield* Effect.tryPromise({
          try: () => validateApnsCertificate(body.cert),
          catch: (cause) =>
            new EnterpriseBadRequest({
              message: cause instanceof Error ? cause.message : "Invalid APNs certificate",
            }),
        });

        const value = {
          organizationId: ctx.organization.id,
          email: body.email,
          certPem: body.cert,
          topic: parsed.topic,
          updatedAt: now(),
        };

        yield* db
          .insert(schema.applePushCertificate)
          .values({ ...value, encryptedKey: encryptedKey ?? null })
          .onDuplicateKeyUpdate({
            set: {
              email: value.email,
              certPem: value.certPem,
              topic: value.topic,
              updatedAt: value.updatedAt,
              encryptedKey: encryptedKey ? encryptedKey : undefined,
            },
          });

        if (pending)
          yield* db
            .delete(schema.applePushKey)
            .where(eq(schema.applePushKey.organizationId, ctx.organization.id));
        yield* audit(ctx, "apns.certificate_uploaded", "apns", ctx.organization.id, {
          email: body.email,
        });

        return ok;
      }),
    deleteDevices: (request, tenantId, ids) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        // Resolve the rows first: revocation also has to match certificates
        // recorded against the legacy `dmIdentifier`, not just the row id.
        const devices = ids.length
          ? yield* db
              .select()
              .from(schema.device)
              .where(
                and(
                  eq(schema.device.organizationId, ctx.organization.id),
                  inArray(schema.device.id, [...ids]),
                ),
              )
          : [];

        const revoked = yield* revokeDeviceCertificates(ctx.organization.id, devices);

        if (ids.length > 0)
          yield* db
            .delete(schema.device)
            .where(
              and(
                eq(schema.device.organizationId, ctx.organization.id),
                inArray(schema.device.id, [...ids]),
              ),
            );
        yield* audit(ctx, "device.deleted", "device", null, {
          ids: [...ids],
          revokedCertificates: revoked,
        });

        return ok;
      }),
    listDevicePreRegistrations: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const rows = yield* db
          .select()
          .from(schema.devicePreRegistration)
          .where(eq(schema.devicePreRegistration.organizationId, ctx.organization.id))
          .orderBy(desc(schema.devicePreRegistration.createdAt));

        const groups = yield* db
          .select()
          .from(schema.enterpriseGroup)
          .where(eq(schema.enterpriseGroup.organizationId, ctx.organization.id));

        const groupNames = new Map(groups.map((group) => [group.id, group.name]));

        return {
          rows: rows.map((row) =>
            rowPreRegistration(row, row.groupId ? (groupNames.get(row.groupId) ?? null) : null),
          ),
        };
      }),
    importDevicePreRegistrations: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body: { rows?: ReadonlyArray<DevicePreRegistrationImportRow> } = payload;
        const rows = Array.isArray(body.rows) ? body.rows : [];

        if (rows.length === 0)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Add at least one device row to import." }),
          );

        if (rows.length > 1000)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Import at most 1000 devices at a time." }),
          );

        // Pre-registrations reserve device slots before a device enrolls. When
        // the deployment plan caps devices, reject new serials once the
        // remaining capacity is used, while still allowing existing rows to be
        // updated.
        const planStatus = yield* deviceLimitForOrganization({
          db,
          organizationId: ctx.organization.id,
          config: planLimits,
        }).pipe(
          Effect.mapError(() => new EnterpriseDbError({ message: "Could not check plan limits" })),
        );

        const existingPreRegistrations = (yield* db
          .select({ id: schema.devicePreRegistration.id })
          .from(schema.devicePreRegistration)
          .where(
            and(
              eq(schema.devicePreRegistration.organizationId, ctx.organization.id),
              // A consumed row already corresponds to a device row and must
              // not keep reserving a second seat.
              isNull(schema.devicePreRegistration.consumedDeviceId),
            ),
          )).length;

        let remainingCapacity =
          planStatus.limit === null
            ? Number.POSITIVE_INFINITY
            : Math.max(0, planStatus.limit - (planStatus.used ?? 0) - existingPreRegistrations);

        const groups = yield* db
          .select()
          .from(schema.enterpriseGroup)
          .where(eq(schema.enterpriseGroup.organizationId, ctx.organization.id));

        const groupsById = new Map(groups.map((group) => [group.id, group]));
        const groupsByName = new Map<string, Array<EnterpriseGroup>>();

        for (const group of groups) {
          const key = group.name.trim().toLowerCase();
          groupsByName.set(key, [...(groupsByName.get(key) ?? []), group]);
        }

        const text = (value: string | null | undefined, previous: string | null, max: number) => {
          if (value === undefined) return previous;

          if (value === null) return null;
          const trimmed = value.trim();

          return trimmed ? trimmed.slice(0, max) : null;
        };

        const results: Array<NonNullable<DevicePreRegistrationImportResponse["results"][number]>> =
          [];

        for (const row of rows) {
          const result = yield* Effect.gen(function* () {
            const serial = row.serial.trim().slice(0, 255);

            if (!serial)
              return {
                serial: row.serial,
                status: "error" as const,
                error: "Serial is required.",
              };

            const existing = yield* db.query.devicePreRegistration.findFirst({
              where: { organizationId: ctx.organization.id, serial },
            });

            let groupId = existing?.groupId ?? null;
            const wantsGroup = row.groupId !== undefined || row.groupName !== undefined;

            if (wantsGroup) {
              const requestedId = row.groupId?.trim() || "";
              const requestedName = row.groupName?.trim() || "";

              if (requestedId) {
                if (!groupsById.has(requestedId))
                  return {
                    serial,
                    status: "error" as const,
                    error: `Group ${requestedId} does not belong to this tenant.`,
                  };
                groupId = requestedId;
              } else if (requestedName) {
                const matches = groupsByName.get(requestedName.toLowerCase()) ?? [];

                if (matches.length === 0)
                  return {
                    serial,
                    status: "error" as const,
                    error: `Group "${requestedName}" was not found in this tenant.`,
                  };

                if (matches.length > 1)
                  return {
                    serial,
                    status: "error" as const,
                    error: `Group name "${requestedName}" is ambiguous; import a group id instead.`,
                  };
                groupId = matches[0]!.id;
              } else {
                groupId = null;
              }
            }

            const timestamp = now();

            if (existing) {
              yield* db
                .update(schema.devicePreRegistration)
                .set({
                  name: text(row.name, existing.name, 255),
                  assetTag: text(row.assetTag, existing.assetTag, 255),
                  notes: text(row.notes, existing.notes, 10_000),
                  groupId,
                  updatedAt: timestamp,
                })
                .where(
                  and(
                    eq(schema.devicePreRegistration.id, existing.id),
                    eq(schema.devicePreRegistration.organizationId, ctx.organization.id),
                  ),
                );

              return { serial, status: "updated" as const, id: existing.id };
            }

            if (remainingCapacity <= 0)
              return {
                serial,
                status: "error" as const,
                error: PLAN_DEVICE_LIMIT_MESSAGE,
              };
            remainingCapacity -= 1;

            const registrationId = id();
            yield* db.insert(schema.devicePreRegistration).values({
              id: registrationId,
              organizationId: ctx.organization.id,
              serial,
              name: text(row.name, null, 255),
              assetTag: text(row.assetTag, null, 255),
              notes: text(row.notes, null, 10_000),
              groupId,
              consumedDeviceId: null,
              createdAt: timestamp,
              updatedAt: timestamp,
            });

            return { serial, status: "created" as const, id: registrationId };
          }).pipe(
            Effect.catch((error) =>
              Effect.succeed({
                serial: row.serial.trim() ? row.serial : "(missing)",
                status: "error" as const,
                error:
                  Option.getOrUndefined(
                    Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }))(error),
                  )?.message ?? "Could not import this row.",
              }),
            ),
          );

          results.push(result);
        }

        const created = results.filter((result) => result.status === "created").length;
        const updated = results.filter((result) => result.status === "updated").length;
        const failed = results.length - created - updated;
        yield* audit(ctx, "device_pre_registration.imported", "device_pre_registration", null, {
          rows: results.length,
          created,
          updated,
          failed,
        });

        return { results, created, updated, failed };
      }),
    deleteDevicePreRegistration: (request, tenantId, registrationId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const row = yield* db.query.devicePreRegistration.findFirst({
          where: { id: registrationId, organizationId: ctx.organization.id },
        });

        if (!row)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "Pre-registered device not found" }),
          );
        yield* db
          .delete(schema.devicePreRegistration)
          .where(
            and(
              eq(schema.devicePreRegistration.id, registrationId),
              eq(schema.devicePreRegistration.organizationId, ctx.organization.id),
            ),
          );
        yield* audit(
          ctx,
          "device_pre_registration.deleted",
          "device_pre_registration",
          registrationId,
          {
            serial: row.serial,
          },
        );

        return ok;
      }),
    deleteDevicePreRegistrations: (request, tenantId, ids) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        if (ids.length > 0)
          yield* db
            .delete(schema.devicePreRegistration)
            .where(
              and(
                eq(schema.devicePreRegistration.organizationId, ctx.organization.id),
                inArray(schema.devicePreRegistration.id, [...ids]),
              ),
            );
        yield* audit(ctx, "device_pre_registration.deleted", "device_pre_registration", null, {
          ids: [...ids],
        });

        return ok;
      }),
    patchDevice: (request, tenantId, deviceId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body: { name?: string; notes?: string | null; assetTag?: string | null } = payload;
        yield* db
          .update(schema.device)
          .set({ name: body.name, notes: body.notes, assetTag: body.assetTag })
          .where(
            and(
              eq(schema.device.id, deviceId),
              eq(schema.device.organizationId, ctx.organization.id),
            ),
          );
        yield* syncDynamicGroupsForDevice(db, ctx.organization.id, deviceId, { now: now() });
        yield* audit(ctx, "device.updated", "device", deviceId, { fields: Object.keys(body) });

        return ok;
      }),
    deviceAction: (request, tenantId, deviceId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });

        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));

        const body: {
          action?: string;
          manifestUrl?: string;
          iTunesStoreId?: number;
          recoveryLockPassword?: string;
        } = payload ?? {};

        const action = body.action ?? "sync";

        // Capability gating: the platform, enrollment state and the device's
        // own reported capabilities decide which actions are legal. RBAC is
        // still enforced by `requireTenant` above.
        const deviceActionInput = {
          proto: device.proto,
          status: device.status,
          capabilities: Option.getOrUndefined(
            Schema.decodeUnknownOption(Schema.Json)(device.capabilities),
          ),
        };

        const requestedAction = Option.getOrUndefined(
          Schema.decodeUnknownOption(DeviceActionName)(action),
        );

        if (
          device.status === "enrolled" &&
          (!requestedAction || !deviceAvailableActions(deviceActionInput).includes(requestedAction))
        )
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: requestedAction
                ? deviceActionUnavailableReason(deviceActionInput, requestedAction)
                : "Unknown device action",
            }),
          );

        if (!["sync", "collect-security-info", "refresh-applications"].includes(action))
          yield* requireStepUp(auth, request, "device-command");
        let lockPin: string | undefined;
        let command: { commandId: string; deduplicated: boolean } | undefined;
        let activationLockWarning: string | undefined;

        if (device.proto === "android" && device.status === "enrolled" && action === "sync") {
          yield* mapAndroidFailure(
            syncAndroidPoliciesForTenant({
              db,
              config: androidConfig,
              organizationId: ctx.organization.id,
              deviceIds: [device.id],
            }),
          );
          yield* audit(ctx, "device.action", "device", deviceId, {
            action,
            platform: "android",
          });

          return ok;
        }

        if (device.proto === "android" && device.status === "enrolled" && action !== "sync") {
          const command = yield* mapAndroidFailure(
            issueAndroidCommand({
              db,
              config: androidConfig,
              organizationId: ctx.organization.id,
              device: { id: device.id, dmIdentifier: device.dmIdentifier },
              action,
            }),
          );

          if (!command)
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: "Android supports remote erase, restart and lock",
              }),
            );
          yield* audit(ctx, "device.action", "device", deviceId, {
            action,
            platform: "android",
          });

          return ok;
        }

        if (device.status === "enrolled") {
          if (action !== "sync") {
            const windowsCommand =
              device.proto === "win" && (action === "wipe" || action === "restart");

            if (device.proto !== "apple" && !windowsCommand)
              return yield* Effect.fail(
                new EnterpriseBadRequest({
                  message:
                    device.proto === "win"
                      ? "Windows supports remote erase and restart"
                      : "Remote commands are only supported for Apple and Windows devices",
                }),
              );
            const timestamp = now();
            const randomPin = String(Math.floor(100000 + Math.random() * 900000));

            const request = ((): { requestType: string; payload: CommandPayload } | null => {
              if (device.proto === "win") {
                if (action === "wipe")
                  return {
                    requestType: "WindowsWipe",
                    payload: { locURI: "./Device/Vendor/MSFT/RemoteWipe/doWipeProtected" },
                  };

                if (action === "restart")
                  return {
                    requestType: "WindowsReboot",
                    payload: { locURI: "./Device/Vendor/MSFT/Reboot/RebootNow" },
                  };

                return null;
              }

              switch (action) {
                case "lock":
                  lockPin = randomPin;

                  return { requestType: "DeviceLock", payload: { PIN: randomPin } };
                case "wipe": {
                  // Erase flags are explicit rather than defaulted. Proximity
                  // Setup is an iOS/iPadOS key (macOS rejects it), and the
                  // obliteration fallback is pinned so a T2/Apple silicon Mac
                  // erases even when Erase All Content and Settings cannot run.
                  const erase = { PIN: randomPin, ObliterationBehavior: "Default" };

                  const payload = isMacOsDevice(device)
                    ? erase
                    : { ...erase, DisallowProximitySetup: true, PreserveDataPlan: false };

                  return { requestType: "EraseDevice", payload };
                }

                case "restart":
                  return { requestType: "RestartDevice", payload: {} };
                case "shutdown":
                  return { requestType: "ShutdownDevice", payload: {} };
                case "clear-passcode":
                  return { requestType: "ClearPasscode", payload: { UnlockToken: "__STORED__" } };
                case "collect-security-info":
                  // SecurityInfo takes no query payload; the response always
                  // carries FileVault and bootstrap-token escrow state.
                  return { requestType: "SecurityInfo", payload: {} };
                case "collect-activation-lock-code":
                  // The bypass code is a separate command: SecurityInfo only
                  // reports whether Activation Lock is manageable.
                  return { requestType: "ActivationLockBypassCode", payload: {} };
                case "rotate-filevault-key":
                  // The payload is completed below once the escrowed key and
                  // tenant escrow certificate have been read.
                  return { requestType: "RotateFileVaultKey", payload: {} };
                case "set-recovery-lock":
                  return {
                    requestType: "SetRecoveryLock",
                    payload: {
                      NewPassword:
                        body.recoveryLockPassword && body.recoveryLockPassword.length > 0
                          ? body.recoveryLockPassword
                          : recoveryLockPassword(),
                    },
                  };
                case "verify-recovery-lock":
                  // Filled below from the escrowed Recovery Lock password.
                  return { requestType: "VerifyRecoveryLock", payload: {} };
                case "refresh-applications":
                  return {
                    requestType: "InstalledApplicationList",
                    payload: {
                      // Request the fields the inventory table persists. The
                      // identifier is always included by the device.
                      Items: [
                        "Identifier",
                        "Name",
                        "Version",
                        "ShortVersion",
                        "BundleSize",
                        "DynamicSize",
                        "HasUpdateAvailable",
                      ],
                      ManagedAppsOnly: false,
                    },
                  };
                case "install-app":
                  if (body.manifestUrl)
                    return {
                      requestType: "InstallApplication",
                      payload: {
                        ManifestURL: body.manifestUrl,
                        ManagementFlags: 1,
                        InstallAsManaged: true,
                        Options: { PurchaseMethod: 1 },
                      },
                    };

                  if (body.iTunesStoreId)
                    return {
                      requestType: "InstallApplication",
                      payload: {
                        iTunesStoreID: body.iTunesStoreId,
                        ManagementFlags: 1,
                        InstallAsManaged: true,
                        Options: { PurchaseMethod: 1 },
                      },
                    };

                  return null;
                default:
                  return null;
              }
            })();

            if (!request)
              return yield* Effect.fail(
                new EnterpriseBadRequest({
                  message:
                    action === "install-app"
                      ? "Provide a manifest URL or iTunes Store ID to install an app"
                      : "Unknown device action",
                }),
              );

            if (action === "clear-passcode") {
              const [apple] = yield* db
                .select({ unlockToken: schema.deviceApple.unlockToken })
                .from(schema.deviceApple)
                .where(eq(schema.deviceApple.deviceId, device.id))
                .limit(1);

              if (!apple?.unlockToken)
                return yield* Effect.fail(
                  new EnterpriseBadRequest({
                    message: "This device has not provided an unlock token",
                  }),
                );
              request.payload = { UnlockToken: apple.unlockToken };
            }

            if (action === "rotate-filevault-key")
              request.payload = yield* rotateFileVaultKeyPayload(device);

            if (action === "verify-recovery-lock") {
              const password = yield* resolveRecoveryLockPassword(device);

              if (!password)
                return yield* Effect.fail(
                  new EnterpriseBadRequest({
                    message:
                      "No Recovery Lock password is stored for this device. Set one before verifying it.",
                  }),
                );

              request.payload = { Password: password };
            }

            if (action === "wipe" && device.proto === "apple") {
              // A supervised device must not be able to re-enable Activation
              // Lock after the wipe. This is an MDM setting, not an erase key,
              // so it is queued as its own `Settings` command before the erase
              // (delivery is oldest first).
              yield* queueDeviceCommand({
                organizationId: ctx.organization.id,
                deviceId: device.id,
                requestType: "Settings",
                payload: {
                  Settings: [
                    {
                      MDMOptions: {
                        Item: "MDMOptions",
                        MDMOptions: { ActivationLockAllowedWhileSupervised: false },
                      },
                    },
                  ],
                },
                at: new Date(timestamp.getTime() - 2),
              });

              // An erase is the moment a Mac's Recovery Lock password would
              // outlive its purpose. Clear it first (oldest-first delivery)
              // using the password Mattrax stored, then erase.
              const recoveryLock = yield* resolveRecoveryLockPassword(device);

              if (recoveryLock) {
                yield* queueDeviceCommand({
                  organizationId: ctx.organization.id,
                  deviceId: device.id,
                  requestType: "SetRecoveryLock",
                  payload: { CurrentPassword: recoveryLock, NewPassword: "" },
                  at: new Date(timestamp.getTime() - 1),
                });
              }

              const [apple] = yield* db
                .select({
                  isActivationLockManageable: schema.deviceApple.isActivationLockManageable,
                })
                .from(schema.deviceApple)
                .where(eq(schema.deviceApple.deviceId, device.id))
                .limit(1);

              // Never imply Activation Lock is cleared: Apple cannot confirm it,
              // and only a bypass code or the user's Apple Account can remove it.
              if (apple?.isActivationLockManageable !== true)
                activationLockWarning =
                  "Activation Lock cannot be confirmed as manageable for this enrolment. If it is enabled, the device will stay locked after erase until the bypass code is used or the user removes it with their Apple Account.";
            }

            const queued = yield* queueDeviceCommand({
              organizationId: ctx.organization.id,
              deviceId: device.id,
              requestType: request.requestType,
              payload: request.payload,
              at: timestamp,
            });

            command = { commandId: queued.id, deduplicated: queued.deduplicated };

            // Keep the Recovery Lock password so a later verify/erase can use
            // it as `CurrentPassword`. Re-queuing an identical command reuses
            // the password already in flight.
            if (action === "set-recovery-lock" && authSecret) {
              const newPassword = Option.getOrUndefined(
                Schema.decodeUnknownOption(Schema.Struct({ NewPassword: Schema.String }))(
                  request.payload,
                ),
              )?.NewPassword;

              if (newPassword) {
                const sealedValue = yield* Effect.tryPromise(() =>
                  sealSecret(authSecret, newPassword),
                );

                yield* db
                  .insert(schema.deviceSecret)
                  .values({
                    deviceId: device.id,
                    organizationId: ctx.organization.id,
                    kind: "recovery_lock_password",
                    sealedValue,
                    format: "plaintext",
                    createdAt: timestamp,
                    updatedAt: timestamp,
                    rotatedAt: timestamp,
                  })
                  .onDuplicateKeyUpdate({
                    set: { sealedValue, updatedAt: timestamp, rotatedAt: timestamp },
                  });
              }
            }

            // A de-duplicated lock reuses the PIN of the command already in
            // flight, otherwise the administrator would be shown a PIN the
            // device never received.
            if (action === "lock" && queued.deduplicated)
              lockPin = Option.getOrUndefined(
                Schema.decodeUnknownOption(Schema.Struct({ PIN: Schema.String }))(queued.payload),
              )?.PIN;
          }

          yield* applePush.pushAppleDevice(device.id);
        }

        const auditMetadata = { action, deduplicated: command?.deduplicated ?? false };

        yield* audit(ctx, "device.action", "device", deviceId, auditMetadata);

        const response: DeviceActionOutcome = { ...ok, ...command };

        if (lockPin) response.pin = lockPin;

        if (activationLockWarning) response.activationLockWarning = activationLockWarning;

        return response;
      }),
    listDeviceCommands: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });

        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));

        const commands = yield* db
          .select()
          .from(schema.deviceCommand)
          .where(eq(schema.deviceCommand.deviceId, device.id))
          .orderBy(desc(schema.deviceCommand.createdAt))
          .limit(200);

        const at = now();

        return {
          commands: commands.map((command: any) => {
            // A command past its deadline can no longer run, even if no
            // check-in has persisted that transition yet.
            const status = commandIsExpired(command, at)
              ? ("expired" as const)
              : normalizeDeviceCommandStatus(command.status);

            return {
              id: command.id,
              requestType: command.requestType,
              status,
              statusLabel: deviceCommandStatusLabel(status),
              locURI:
                Schema.is(Schema.JsonObject)(command.payload) &&
                Schema.is(Schema.String)(command.payload["locURI"])
                  ? command.payload["locURI"]
                  : null,
              resultStatus: command.resultStatus,
              resultDetail: command.resultDetail,
              createdAt: iso(command.createdAt),
              updatedAt: iso(command.updatedAt),
              expiresAt: isoOrNull(commandDeadline(command)),
            };
          }),
        };
      }),
    listDeviceDeclarations: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });

        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
        const declarations = yield* deviceDeclarationsFor(device.id);

        return { declarations: declarations.map(rowDeclaration) };
      }),
    deviceUnenroll: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });

        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));

        if (device.proto === "android")
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Remote unenroll is only available for Apple and Windows devices.",
            }),
          );

        if (device.status === "enrolled")
          yield* db
            .update(schema.device)
            .set({ status: "unenrolling" })
            .where(
              and(
                eq(schema.device.id, deviceId),
                eq(schema.device.organizationId, ctx.organization.id),
                eq(schema.device.status, "enrolled"),
              ),
            );

        // A device on its way out of management will never run queued work
        // (and a pending wipe or lock must not fire during unenrolment).
        yield* db
          .update(schema.deviceCommand)
          .set({
            status: "cancelled",
            dedupeKey: null,
            resultStatus: RECONCILED_RESULT_STATUS,
            resultDetail: "The device was unenrolled before the command was delivered.",
            updatedAt: now(),
          })
          .where(
            and(
              eq(schema.deviceCommand.deviceId, device.id),
              inArray(schema.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES]),
            ),
          );

        // Windows leaves management with an OMA-DM `Exec` on the provider's
        // `Unenroll` node. The device removes the management account and the
        // settings it applied, then stops syncing; the row moves to
        // `unenrolled` when the device acknowledges the command (or reports
        // the unenroll Generic Alert on a later check-in).
        if (device.proto === "win" && device.status !== "unenrolled")
          yield* queueDeviceCommand({
            organizationId: ctx.organization.id,
            deviceId: device.id,
            requestType: WINDOWS_UNENROLL_REQUEST_TYPE,
            payload: {
              kind: "Exec",
              locURI: windowsUnenrollUri(WINDOWS_MDM_PROVIDER_ID),
              data: WINDOWS_MDM_PROVIDER_ID,
              format: "chr",
            },
            at: now(),
          });

        // mttx pushes both enrolled and already-unenrolling devices so repeated
        // requests still nudge the device.
        if (
          device.proto === "apple" &&
          (device.status === "enrolled" || device.status === "unenrolling")
        )
          yield* applePush.pushAppleDevice(device.id, true);
        // Retiring a device must also invalidate its SCEP identity, otherwise a
        // stolen certificate could renew forever. Windows certificates and
        // Apple certificates bound at check-in are keyed by the internal device
        // id, so this covers both platforms.
        const revoked = yield* revokeDeviceCertificates(ctx.organization.id, [device]);
        yield* audit(ctx, "device.unenrolled", "device", deviceId, {
          revokedCertificates: revoked,
        });

        return ok;
      }),
    getDeviceHealth: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });

        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
        const declarations = yield* deviceDeclarationsFor(device.id);
        const certificates = yield* deviceCertificatesFor(ctx.organization.id, device);

        const apple =
          device.proto === "apple"
            ? yield* db.query.deviceApple.findFirst({ where: { deviceId: device.id } })
            : undefined;

        return {
          health: normalizeDeviceHealth(rowDeviceHealth(device, declarations)),
          declarations: declarations.map(rowDeclaration),
          certificates: certificates.map(rowCertificate),
          push: rowPushInfo(apple),
          windows: device.proto === "win" ? rowWindowsSecurity(device) : null,
        };
      }),
    getDeviceActivity: (request, tenantId, deviceId, query) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });

        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
        const limit = normalizeDeviceActivityLimit(query?.limit);
        const offset = normalizeDeviceActivityOffset(query?.offset);

        // Past the deepest page there is nothing left to merge; skip the reads.
        if (offset >= DEVICE_ACTIVITY_MAX_OFFSET) return { events: [], hasMore: false };

        // Every source contributes at most one page window; the merge picks the
        // newest `offset + limit` entries before slicing out this page.
        const window = offset + limit + 1;

        const auditRows = yield* db
          .select()
          .from(schema.auditLog)
          .where(
            and(
              eq(schema.auditLog.organizationId, ctx.organization.id),
              eq(schema.auditLog.targetType, "device"),
              eq(schema.auditLog.targetId, device.id),
            ),
          )
          .orderBy(desc(schema.auditLog.createdAt))
          .limit(window);

        const audits = auditRows.map((row) => ({
          ...row,
          metadata: Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(row.metadata)),
        }));

        const commandRows = yield* db
          .select()
          .from(schema.deviceCommand)
          .where(eq(schema.deviceCommand.deviceId, device.id))
          .orderBy(desc(schema.deviceCommand.updatedAt))
          .limit(window);

        const at = now();

        // A command past its deadline can no longer run, even before a check-in
        // persists the transition.
        const commands = commandRows.map((row) => ({
          ...row,
          status: commandIsExpired(row, at) ? "expired" : row.status,
        }));

        const declarations = yield* deviceDeclarationsFor(device.id);
        const certificates = yield* deviceCertificatesFor(ctx.organization.id, device);

        return deviceActivityPage(
          {
            audits,
            commands,
            declarations,
            certificates,
            device: {
              enrolledAt: device.enrolledAt,
              lastSeenAt: device.lastSeenAt,
              inventoryUpdatedAt: device.inventoryUpdatedAt,
            },
          },
          { limit, offset },
        );
      }),
    getDeviceHealthSummary: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const devices = yield* db
          .select()
          .from(schema.device)
          .where(eq(schema.device.organizationId, ctx.organization.id));

        const deviceIds = devices.map((device: EnterpriseDevice) => device.id);

        const declarations = deviceIds.length
          ? yield* db
              .select()
              .from(schema.deviceDeclaration)
              .where(inArray(schema.deviceDeclaration.deviceId, deviceIds))
          : [];

        const byDevice = new Map<string, Array<any>>();

        for (const declaration of declarations) {
          const list = byDevice.get(declaration.deviceId) ?? [];
          list.push(declaration);
          byDevice.set(declaration.deviceId, list);
        }

        const summaries = devices.map((device: EnterpriseDevice) =>
          rowDeviceHealth(device, byDevice.get(device.id) ?? []),
        );

        const levelRank = { critical: 0, attention: 1, unknown: 2, healthy: 3 } as const;

        const attention = devices
          .map((device: EnterpriseDevice, index: number) => ({
            device,
            summary: summaries[index]!,
          }))
          .filter((row) => row.summary.level !== "healthy")
          .sort(
            (left, right) =>
              levelRank[left.summary.level] - levelRank[right.summary.level] ||
              (right.summary.lastSeenAt ?? "").localeCompare(left.summary.lastSeenAt ?? ""),
          )
          .slice(0, 6)
          .map(({ device, summary }) => ({
            id: device.id,
            name: device.name,
            level: summary.level,
            reasons: [...summary.reasons],
            lastSeenAt: summary.lastSeenAt,
          }));

        return {
          counts: countDeviceHealth(summaries),
          reasons: groupDeviceHealthReasons(summaries),
          devices: attention,
        };
      }),
    getDevicePushHealth: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const devices = yield* db
          .select()
          .from(schema.device)
          .where(
            and(
              eq(schema.device.organizationId, ctx.organization.id),
              eq(schema.device.proto, "apple"),
            ),
          );

        // Pushes are only attempted for live devices, so retiring devices do
        // not drag the tenant rollup into a failing state forever.
        const eligible = devices.filter(
          (device: EnterpriseDevice) =>
            device.status === "enrolled" || device.status === "unenrolling",
        );

        const deviceIds = eligible.map((device: EnterpriseDevice) => device.id);

        const appleRows = deviceIds.length
          ? yield* db
              .select()
              .from(schema.deviceApple)
              .where(inArray(schema.deviceApple.deviceId, deviceIds))
          : [];

        const names = new Map(eligible.map((device: EnterpriseDevice) => [device.id, device.name]));

        const recentFailures = appleRows
          .filter((row: any) => (row.consecutivePushFailures ?? 0) > 0 && row.lastPushAt)
          .map((row: any) => ({
            deviceId: row.deviceId,
            deviceName: names.get(row.deviceId) ?? row.deviceId,
            at: iso(row.lastPushAt)!,
            error: row.lastPushError ?? null,
            errorCode: row.lastPushErrorCode ?? null,
            consecutiveFailures: row.consecutivePushFailures ?? 0,
          }))
          .sort((left: { at: string }, right: { at: string }) => right.at.localeCompare(left.at))
          .slice(0, 5);

        return { counts: summarizeApplePushHealth(appleRows), recentFailures };
      }),
    getCredentialHealth: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        return yield* loadCredentialHealth(db, ctx.organization.id, now());
      }),
    revokeDeviceIdentity: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });

        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
        const certificates = yield* deviceCertificatesFor(ctx.organization.id, device);

        if (certificates.length === 0)
          return yield* Effect.fail(
            new EnterpriseConflict({
              message: "No issued identity certificates are recorded for this device.",
            }),
          );
        const revoked = yield* revokeDeviceCertificates(ctx.organization.id, [device]);
        yield* audit(ctx, "device.identity_revoked", "device", device.id, {
          revokedCertificates: revoked,
        });

        return { status: "ok" as const, revoked };
      }),
    createGroup: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const body: {
          name: string;
          notes?: string | null;
          kind?: "manual" | "dynamic";
          rules?: DynamicGroupRules | null;
          devices?: Array<string>;
          policies?: Array<string>;
        } = payload;

        const kind = body.kind ?? "manual";
        const rules = kind === "dynamic" ? (body.rules ?? null) : null;

        if (kind === "dynamic") {
          const problem = dynamicGroupRulesProblem(rules);

          if (problem) return yield* Effect.fail(new EnterpriseBadRequest({ message: problem }));

          if (body.devices?.length)
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: "Dynamic groups derive device membership from rules",
              }),
            );
        } else if (body.rules != null) {
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Manual groups do not accept membership rules" }),
          );
        }

        yield* assertTenantDevices(ctx.organization.id, body.devices ?? []);
        yield* assertTenantPolicies(ctx.organization.id, body.policies ?? []);
        const groupId = id();
        yield* db.insert(schema.enterpriseGroup).values({
          id: groupId,
          organizationId: ctx.organization.id,
          name: body.name,
          notes: body.notes ?? null,
          kind,
          rules,
          lastEvaluatedAt: null,
          createdAt: now(),
          updatedAt: now(),
        });

        if (body.devices?.length)
          yield* db
            .insert(schema.groupDevice)
            .ignore()
            .values(
              body.devices.map((deviceId) => ({ groupId, deviceId, source: "manual" as const })),
            );

        if (body.policies?.length)
          yield* db
            .insert(schema.groupPolicy)
            .ignore()
            .values(body.policies.map((policyId) => ({ groupId, policyId })));

        if (kind === "dynamic")
          yield* syncDynamicGroup(db, ctx.organization.id, groupId, { now: now() });

        if (body.devices?.length || body.policies?.length)
          yield* syncAndroidDevices(ctx.organization.id, [
            ...(body.devices ?? []),
            ...(yield* applePush.deviceIdsInGroups([groupId])),
          ]);
        yield* audit(ctx, "group.created", "group", groupId, {
          name: body.name,
          kind,
          devices: body.devices?.length ?? 0,
          policies: body.policies?.length ?? 0,
        });

        return { id: groupId };
      }),
    deleteGroups: (request, tenantId, ids) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const results = yield* Effect.forEach(
          [...ids],
          (groupId) =>
            Effect.gen(function* () {
              // MySQL has no `DELETE ... RETURNING`; probe the tenant-scoped
              // row first, then delete it by the same predicate.
              const existing = yield* db.query.enterpriseGroup.findFirst({
                where: { id: groupId, organizationId: ctx.organization.id },
              });

              if (!existing) return { id: groupId, deleted: false as const, reason: "notFound" };
              const devices = yield* applePush.deviceIdsInGroups([groupId]);
              yield* db
                .delete(schema.enterpriseGroup)
                .where(
                  and(
                    eq(schema.enterpriseGroup.id, groupId),
                    eq(schema.enterpriseGroup.organizationId, ctx.organization.id),
                  ),
                );

              return { id: groupId, deleted: true as const, devices };
            }),
          { concurrency: 10 },
        );

        const deleted = results.filter((row) => row.deleted).map((row) => row.id);

        const failed = results
          .filter((row) => !row.deleted)
          .map((row) => ({ id: row.id, reason: row.reason }));

        const affectedDevices = results.flatMap((row) => (row.deleted ? row.devices : []));
        // Devices in a deleted group lose policies and must re-sync.
        yield* applePush.pushAppleDevices(affectedDevices);
        yield* syncAndroidDevices(ctx.organization.id, affectedDevices);
        yield* audit(ctx, "group.deleted", "group", null, { ids: [...deleted] });

        return { deleted, failed };
      }),
    patchGroup: (request, tenantId, groupId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const existing = yield* assertTenantGroup(ctx.organization.id, groupId);

        const body: {
          name?: string;
          notes?: string | null;
          kind?: "manual" | "dynamic";
          rules?: DynamicGroupRules | null;
        } = payload;

        const kind = body.kind ?? existing.kind ?? "manual";

        const rules =
          kind === "dynamic"
            ? body.rules !== undefined
              ? body.rules
              : (Option.getOrUndefined(
                  Schema.decodeUnknownOption(Schema.NullOr(DynamicGroupRules))(existing.rules),
                ) ?? null)
            : null;

        if (kind === "dynamic") {
          const problem = dynamicGroupRulesProblem(rules);

          if (problem) return yield* Effect.fail(new EnterpriseBadRequest({ message: problem }));
        } else if (body.rules != null) {
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Manual groups do not accept membership rules" }),
          );
        }

        const wasDynamic = existing.kind === "dynamic";
        yield* db
          .update(schema.enterpriseGroup)
          .set({ name: body.name, notes: body.notes, kind, rules, updatedAt: now() })
          .where(
            and(
              eq(schema.enterpriseGroup.id, groupId),
              eq(schema.enterpriseGroup.organizationId, ctx.organization.id),
            ),
          );

        if (kind === "dynamic") {
          yield* syncDynamicGroup(db, ctx.organization.id, groupId, { now: now() });
        } else if (wasDynamic) {
          // Switching to manual keeps administrator rows but drops rule rows.
          yield* db
            .delete(schema.groupDevice)
            .where(
              and(
                eq(schema.groupDevice.groupId, groupId),
                eq(schema.groupDevice.source, "dynamic"),
              ),
            );
          yield* db
            .update(schema.enterpriseGroup)
            .set({ lastEvaluatedAt: null })
            .where(eq(schema.enterpriseGroup.id, groupId));
        }

        yield* audit(ctx, "group.updated", "group", groupId, { fields: Object.keys(body) });

        return ok;
      }),
    patchGroupMembers: (request, tenantId, groupId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const group = yield* assertTenantGroup(ctx.organization.id, groupId);

        const body: {
          assign?: {
            devices?: Array<string>;
            policies?: Array<string | { id: string; mode?: "include" | "exclude" }>;
          };
          unassign?: {
            devices?: Array<string>;
            policies?: Array<string | { id: string; mode?: "include" | "exclude" }>;
          };
        } = payload;

        if (
          group.kind === "dynamic" &&
          ((body.assign?.devices?.length ?? 0) > 0 || (body.unassign?.devices?.length ?? 0) > 0)
        )
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Dynamic group device membership is controlled by its rules",
            }),
          );
        const assignPolicies = assignmentRefs(body.assign?.policies);
        const unassignPolicies = assignmentRefs(body.unassign?.policies);
        yield* assertTenantDevices(ctx.organization.id, [
          ...(body.assign?.devices ?? []),
          ...(body.unassign?.devices ?? []),
        ]);
        yield* assertTenantPolicies(ctx.organization.id, [
          ...assignPolicies.map((assignment) => assignment.id),
          ...unassignPolicies.map((assignment) => assignment.id),
        ]);

        if (body.assign?.devices?.length)
          yield* db
            .insert(schema.groupDevice)
            .ignore()
            .values(
              body.assign.devices.map((deviceId) => ({
                groupId,
                deviceId,
                source: "manual" as const,
              })),
            );

        if (assignPolicies.length) {
          // Upsert by replacing the affected link rows so a mode change is
          // applied atomically even on MySQL versions without RETURNING.
          const unique = [
            ...new Map(assignPolicies.map((assignment) => [assignment.id, assignment])).values(),
          ];

          yield* db.delete(schema.groupPolicy).where(
            and(
              eq(schema.groupPolicy.groupId, groupId),
              inArray(
                schema.groupPolicy.policyId,
                unique.map((assignment) => assignment.id),
              ),
            ),
          );
          yield* db.insert(schema.groupPolicy).values(
            unique.map((assignment) => ({
              groupId,
              policyId: assignment.id,
              mode: assignment.mode,
            })),
          );
        }

        if (body.unassign?.devices?.length)
          yield* db
            .delete(schema.groupDevice)
            .where(
              and(
                eq(schema.groupDevice.groupId, groupId),
                inArray(schema.groupDevice.deviceId, body.unassign.devices),
              ),
            );

        if (unassignPolicies.length)
          yield* db.delete(schema.groupPolicy).where(
            and(
              eq(schema.groupPolicy.groupId, groupId),
              inArray(
                schema.groupPolicy.policyId,
                unassignPolicies.map((assignment) => assignment.id),
              ),
            ),
          );

        // Device membership changes affect those devices; policy membership
        // changes affect every device in the group. Deduplicate in the helper.
        const affectedDevices = [
          ...(body.assign?.devices ?? []),
          ...(body.unassign?.devices ?? []),
        ];

        if (assignPolicies.length || unassignPolicies.length)
          affectedDevices.push(...(yield* applePush.deviceIdsInGroups([groupId])));
        yield* applePush.pushAppleDevices(affectedDevices);
        yield* syncAndroidDevices(ctx.organization.id, affectedDevices);
        yield* audit(ctx, "group.members_changed", "group", groupId, {
          assignDevices: body.assign?.devices?.length ?? 0,
          unassignDevices: body.unassign?.devices?.length ?? 0,
          assignPolicies: assignPolicies.length,
          unassignPolicies: unassignPolicies.length,
        });

        return ok;
      }),
    syncGroups: (request, tenantId, ids) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const affected = yield* Effect.forEach(
          [...ids],
          (groupId) =>
            Effect.gen(function* () {
              const group = yield* db.query.enterpriseGroup.findFirst({
                where: { id: groupId, organizationId: ctx.organization.id },
              });

              if (!group) return [];

              if (group.kind === "dynamic")
                yield* syncDynamicGroup(db, ctx.organization.id, groupId, { now: now() });

              return yield* applePush.deviceIdsInGroups([groupId]);
            }),
          { concurrency: 10 },
        );

        yield* applePush.pushAppleDevices(affected.flat());

        return ok;
      }),
    duplicateGroup: (request, tenantId, groupId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const source = yield* assertTenantGroup(ctx.organization.id, groupId);
        const body: { name?: string } = payload;
        const newId = id();
        const kind = source.kind ?? "manual";
        yield* db.insert(schema.enterpriseGroup).values({
          id: newId,
          organizationId: ctx.organization.id,
          name: body.name ?? `${source.name} [duplicated]`,
          notes: source.notes,
          kind,
          rules:
            kind === "dynamic"
              ? (Option.getOrUndefined(
                  Schema.decodeUnknownOption(Schema.NullOr(DynamicGroupRules))(source.rules),
                ) ?? null)
              : null,
          lastEvaluatedAt: null,
          createdAt: now(),
          updatedAt: now(),
        });

        const devices =
          kind === "manual"
            ? yield* db
                .select()
                .from(schema.groupDevice)
                .where(eq(schema.groupDevice.groupId, groupId))
            : [];

        const policies = yield* db
          .select()
          .from(schema.groupPolicy)
          .where(eq(schema.groupPolicy.groupId, groupId));

        if (devices.length)
          yield* db.insert(schema.groupDevice).values(
            devices.map((d: EnterpriseGroupDevice) => ({
              groupId: newId,
              deviceId: d.deviceId,
              source: d.source ?? ("manual" as const),
            })),
          );

        if (policies.length)
          yield* db.insert(schema.groupPolicy).values(
            policies.map((p: EnterpriseGroupPolicy) => ({
              groupId: newId,
              policyId: p.policyId,
              mode: p.mode ?? "include",
            })),
          );

        if (kind === "dynamic")
          yield* syncDynamicGroup(db, ctx.organization.id, newId, { now: now() });
        yield* audit(ctx, "group.duplicated", "group", newId, { sourceId: groupId });

        return { id: newId };
      }),
    createPolicy: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body: { name: string; notes?: string | null; priority?: number } = payload;

        if (body.priority !== undefined && !Number.isSafeInteger(body.priority))
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Priority must be a whole number" }),
          );
        const policyId = id();
        yield* db.insert(schema.policy).values({
          id: policyId,
          organizationId: ctx.organization.id,
          name: body.name,
          notes: body.notes ?? null,
          priority: body.priority ?? 0,
          createdAt: now(),
          updatedAt: now(),
        });
        yield* audit(ctx, "policy.created", "policy", policyId, { name: body.name });
        yield* snapshotPolicy(ctx, policyId);

        return { id: policyId };
      }),
    deletePolicies: (request, tenantId, ids) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const results = yield* Effect.forEach(
          [...ids],
          (policyId) =>
            Effect.gen(function* () {
              // MySQL has no `DELETE ... RETURNING`; probe the tenant-scoped
              // row first, then delete it by the same predicate.
              const existing = yield* db.query.policy.findFirst({
                where: { id: policyId, organizationId: ctx.organization.id },
              });

              if (!existing) return { id: policyId, deleted: false as const, reason: "notFound" };
              const devices = yield* applePush.deviceIdsInPolicies([policyId]);
              yield* db
                .delete(schema.policy)
                .where(
                  and(
                    eq(schema.policy.id, policyId),
                    eq(schema.policy.organizationId, ctx.organization.id),
                  ),
                );

              return { id: policyId, deleted: true as const, devices };
            }),
          { concurrency: 10 },
        );

        const deleted = results.filter((row) => row.deleted).map((row) => row.id);

        const failed = results
          .filter((row) => !row.deleted)
          .map((row) => ({ id: row.id, reason: row.reason }));

        const affectedDevices = results.flatMap((row) => (row.deleted ? row.devices : []));
        const pushed = yield* applePush.pushAppleDevices(affectedDevices);
        yield* reportPolicyDeliveryFailure(ctx.organization.id, { policyIds: deleted }, pushed);
        yield* syncAndroidDevices(ctx.organization.id, affectedDevices);
        yield* audit(ctx, "policy.deleted", "policy", null, { ids: [...deleted] });

        return { deleted, failed };
      }),
    patchPolicy: (request, tenantId, policyId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const body: {
          name?: string;
          notes?: string | null;
          priority?: number;
          configurations?: Record<string, Schema.Json>;
        } = payload;

        if (body.priority !== undefined && !Number.isSafeInteger(body.priority))
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Priority must be a whole number" }),
          );

        const policy = yield* db.query.policy.findFirst({
          where: { id: policyId, organizationId: ctx.organization.id },
        });

        if (!policy)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Policy not found" }));
        const configurations = Object.entries(body.configurations ?? {});
        const escrowFingerprint = yield* tenantEscrowFingerprint(ctx.organization.id);

        // Validate the whole patch before mutating anything so a bad
        // configuration cannot leave the policy half-updated.
        for (const [kind, data] of configurations) {
          if (data === null) continue;

          const configuration = Option.getOrUndefined(
            Schema.decodeUnknownOption(Schema.Json)(data),
          );

          if (configuration === undefined) continue;
          yield* validateConfiguration(kind, configuration, {
            escrowCertificateFingerprintSha256: escrowFingerprint,
          }).pipe(Effect.mapError((message) => new EnterpriseBadRequest({ message })));
        }

        yield* db
          .update(schema.policy)
          .set({ name: body.name, notes: body.notes, priority: body.priority, updatedAt: now() })
          .where(eq(schema.policy.id, policyId));

        for (const [kind, data] of configurations) {
          if (data === null) {
            yield* db
              .delete(schema.configuration)
              .where(
                and(
                  eq(schema.configuration.policyId, policyId),
                  eq(schema.configuration.kind, kind),
                ),
              );
          } else {
            const hash = yield* hashJson(data);
            yield* db
              .insert(schema.configuration)
              .values({ policyId, kind, data, hash })
              .onDuplicateKeyUpdate({ set: { data, hash } });
          }
        }

        const affectedDevices = yield* applePush.deviceIdsInPolicies([policyId]);
        yield* pushPolicyDevices(ctx.organization.id, { policyId }, affectedDevices);
        yield* syncAndroidDevices(ctx.organization.id, affectedDevices);
        yield* audit(ctx, "policy.updated", "policy", policyId, {
          fields: Object.keys(body),
          configurations: Object.keys(body.configurations ?? {}),
        });
        yield* snapshotPolicy(ctx, policyId);

        return ok;
      }),
    listPolicyDeployments: (request, tenantId, policyId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        yield* assertTenantPolicies(ctx.organization.id, [policyId]);

        const deployments = yield* db
          .select()
          .from(schema.policyDeployment)
          .where(eq(schema.policyDeployment.policyId, policyId))
          .orderBy(desc(schema.policyDeployment.version))
          .limit(100);

        return {
          deployments: deployments.map((deployment: any) => ({
            id: deployment.id,
            version: deployment.version,
            createdAt: iso(deployment.createdAt),
            createdByUserId: deployment.createdByUserId,
          })),
        };
      }),
    rollbackPolicy: (request, tenantId, policyId, deploymentId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* assertTenantPolicies(ctx.organization.id, [policyId]);

        const deployment = yield* db.query.policyDeployment.findFirst({
          where: {
            id: deploymentId,
            policyId,
            organizationId: ctx.organization.id,
          },
        });

        if (!deployment)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "Policy deployment not found" }),
          );
        yield* db.delete(schema.configuration).where(eq(schema.configuration.policyId, policyId));

        const snapshot = Option.getOrElse(
          Schema.decodeUnknownOption(Schema.JsonObject)(deployment.snapshot),
          () => ({}),
        );

        const entries = Object.entries(snapshot ?? {});

        if (entries.length > 0)
          yield* db
            .insert(schema.configuration)
            .values(
              yield* Effect.all(
                entries.map(([kind, data]) =>
                  Effect.map(hashJson(data), (hash) => ({ policyId, kind, data, hash })),
                ),
              ),
            );
        yield* snapshotPolicy(ctx, policyId);
        yield* audit(ctx, "policy.rolled_back", "policy", policyId, { deploymentId });
        yield* syncAndroidDevices(
          ctx.organization.id,
          yield* applePush.deviceIdsInPolicies([policyId]),
        );

        return ok;
      }),
    uploadPolicyApplication: (request, tenantId, policyId, payload) =>
      Effect.gen(function* () {
        const r2 = yield* R2Storage;
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* assertTenantPolicies(ctx.organization.id, [policyId]);
        const body: { fileName: string; contentType?: string; content: string } = payload;
        const bytes = base64ToBytes(body.content);

        const sha256 = yield* sha256Hex(bytesToArrayBuffer(bytes));

        const key = policyApplicationKey(ctx.organization.id, policyId, sha256);
        yield* r2.put(key, bytes, {
          httpMetadata: body.contentType ? { contentType: body.contentType } : undefined,
          customMetadata: { fileName: body.fileName },
        });
        yield* audit(ctx, "policy.application_uploaded", "policy", policyId, {
          fileName: body.fileName,
          sha256,
        });

        return {
          sha256,
          fileName: body.fileName,
          contentType: body.contentType ?? null,
          size: bytes.byteLength,
        };
      }).pipe(Effect.provide(r2Layer)),
    downloadPolicyApplication: (request, tenantId, policyId, sha256) =>
      Effect.gen(function* () {
        const r2 = yield* R2Storage;
        const ctx = yield* requireTenant(request, tenantId);
        yield* assertTenantPolicies(ctx.organization.id, [policyId]);
        const key = policyApplicationKey(ctx.organization.id, policyId, sha256);
        const object = yield* r2.get(key);
        const bytes = yield* r2.arrayBuffer(object);

        return {
          sha256,
          fileName: object.customMetadata?.fileName ?? sha256,
          contentType: object.httpMetadata?.contentType ?? null,
          size: object.size ?? bytes.byteLength,
          content: bytesToBase64(new Uint8Array(bytes)),
        };
      }).pipe(Effect.provide(r2Layer)),
    getPolicyAssignments: (request, tenantId, policyId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        yield* assertTenantPolicies(ctx.organization.id, [policyId]);

        const policy = yield* db.query.policy.findFirst({
          where: { id: policyId, organizationId: ctx.organization.id },
        });

        if (!policy)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Policy not found" }));
        const priority = policy.priority ?? 0;

        const groupLinks = yield* db
          .select({ groupId: schema.groupPolicy.groupId, mode: schema.groupPolicy.mode })
          .from(schema.groupPolicy)
          .where(eq(schema.groupPolicy.policyId, policyId));

        const groups = groupLinks.length
          ? yield* db
              .select({ id: schema.enterpriseGroup.id, name: schema.enterpriseGroup.name })
              .from(schema.enterpriseGroup)
              .where(
                inArray(
                  schema.enterpriseGroup.id,
                  groupLinks.map((link) => link.groupId),
                ),
              )
          : [];

        const groupModes = new Map(
          groupLinks.map((link) => [link.groupId, link.mode ?? ("include" as const)]),
        );

        const deviceLinks = yield* db
          .select({ deviceId: schema.devicePolicy.deviceId, mode: schema.devicePolicy.mode })
          .from(schema.devicePolicy)
          .where(eq(schema.devicePolicy.policyId, policyId));

        const devices = deviceLinks.length
          ? yield* db
              .select({ id: schema.device.id, name: schema.device.name })
              .from(schema.device)
              .where(
                and(
                  eq(schema.device.organizationId, ctx.organization.id),
                  inArray(
                    schema.device.id,
                    deviceLinks.map((link) => link.deviceId),
                  ),
                ),
              )
          : [];

        const deviceModes = new Map(
          deviceLinks.map((link) => [link.deviceId, link.mode ?? ("include" as const)]),
        );

        const userLinks = yield* db
          .select({ userId: schema.userPolicy.userId, mode: schema.userPolicy.mode })
          .from(schema.userPolicy)
          .where(
            and(
              eq(schema.userPolicy.organizationId, ctx.organization.id),
              eq(schema.userPolicy.policyId, policyId),
            ),
          );

        const users = userLinks.length
          ? yield* db
              .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
              .from(schema.user)
              .where(
                inArray(
                  schema.user.id,
                  userLinks.map((link) => link.userId),
                ),
              )
          : [];

        const userModes = new Map(
          userLinks.map((link) => [link.userId, link.mode ?? ("include" as const)]),
        );

        const userGroupLinks = yield* db
          .select({
            groupId: schema.userGroupPolicy.groupId,
            mode: schema.userGroupPolicy.mode,
          })
          .from(schema.userGroupPolicy)
          .where(
            and(
              eq(schema.userGroupPolicy.organizationId, ctx.organization.id),
              eq(schema.userGroupPolicy.policyId, policyId),
            ),
          );

        const userGroups = userGroupLinks.length
          ? yield* db
              .select({ id: schema.userGroup.id, name: schema.userGroup.name })
              .from(schema.userGroup)
              .where(
                and(
                  eq(schema.userGroup.organizationId, ctx.organization.id),
                  inArray(
                    schema.userGroup.id,
                    userGroupLinks.map((link) => link.groupId),
                  ),
                ),
              )
          : [];

        const memberCounts = userGroups.length
          ? yield* db
              .select({ groupId: schema.userGroupMember.groupId, value: count() })
              .from(schema.userGroupMember)
              .where(
                inArray(
                  schema.userGroupMember.groupId,
                  userGroups.map((group) => group.id),
                ),
              )
              .groupBy(schema.userGroupMember.groupId)
          : [];

        const memberCountsByGroup = new Map(
          memberCounts.map((row) => [row.groupId, Number(row.value)]),
        );

        const userGroupModes = new Map(
          userGroupLinks.map((link) => [link.groupId, link.mode ?? ("include" as const)]),
        );

        return {
          groups: groups
            .map((group) => ({
              ...group,
              mode: groupModes.get(group.id) ?? "include",
              priority,
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
          devices: devices
            .map((device) => ({
              ...device,
              mode: deviceModes.get(device.id) ?? "include",
              priority,
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
          users: users
            .map((user) => ({
              ...user,
              mode: userModes.get(user.id) ?? "include",
              priority,
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
          userGroups: userGroups
            .map((group) => ({
              ...group,
              mode: userGroupModes.get(group.id) ?? "include",
              priority,
              memberCount: memberCountsByGroup.get(group.id) ?? 0,
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
        };
      }),
    patchPolicyAssignments: (request, tenantId, policyId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* assertTenantPolicies(ctx.organization.id, [policyId]);

        const body: {
          assign?: Array<string | { id: string; mode?: "include" | "exclude" }>;
          unassign?: Array<string | { id: string; mode?: "include" | "exclude" }>;
          assignUsers?: Array<string | { id: string; mode?: "include" | "exclude" }>;
          unassignUsers?: Array<string | { id: string; mode?: "include" | "exclude" }>;
          assignUserGroups?: Array<string | { id: string; mode?: "include" | "exclude" }>;
          unassignUserGroups?: Array<string | { id: string; mode?: "include" | "exclude" }>;
        } = payload;

        const assign = assignmentRefs(body.assign);
        const unassign = assignmentRefs(body.unassign);
        const assignUsers = assignmentRefs(body.assignUsers);
        const unassignUsers = assignmentRefs(body.unassignUsers);
        const assignUserGroups = assignmentRefs(body.assignUserGroups);
        const unassignUserGroups = assignmentRefs(body.unassignUserGroups);

        // Only additions are validated. A user or group that already left the
        // tenant must still be removable from an assignment.
        yield* assertTenantDevices(
          ctx.organization.id,
          assign.map((assignment) => assignment.id),
        );
        yield* assertTenantUsers(
          ctx.organization.id,
          assignUsers.map((assignment) => assignment.id),
        );
        yield* assertTenantUserGroups(
          ctx.organization.id,
          assignUserGroups.map((assignment) => assignment.id),
        );

        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            if (assign.length) {
              const unique = [
                ...new Map(assign.map((assignment) => [assignment.id, assignment])).values(),
              ];

              yield* tx.delete(schema.devicePolicy).where(
                and(
                  eq(schema.devicePolicy.policyId, policyId),
                  inArray(
                    schema.devicePolicy.deviceId,
                    unique.map((assignment) => assignment.id),
                  ),
                ),
              );
              yield* tx.insert(schema.devicePolicy).values(
                unique.map((assignment) => ({
                  policyId,
                  deviceId: assignment.id,
                  mode: assignment.mode,
                })),
              );
            }

            if (unassign.length)
              yield* tx.delete(schema.devicePolicy).where(
                and(
                  eq(schema.devicePolicy.policyId, policyId),
                  inArray(
                    schema.devicePolicy.deviceId,
                    unassign.map((assignment) => assignment.id),
                  ),
                ),
              );

            if (assignUsers.length) {
              const unique = [
                ...new Map(assignUsers.map((assignment) => [assignment.id, assignment])).values(),
              ];

              yield* tx.delete(schema.userPolicy).where(
                and(
                  eq(schema.userPolicy.organizationId, ctx.organization.id),
                  eq(schema.userPolicy.policyId, policyId),
                  inArray(
                    schema.userPolicy.userId,
                    unique.map((assignment) => assignment.id),
                  ),
                ),
              );
              yield* tx.insert(schema.userPolicy).values(
                unique.map((assignment) => ({
                  organizationId: ctx.organization.id,
                  userId: assignment.id,
                  policyId,
                  mode: assignment.mode,
                  createdAt: now(),
                })),
              );
            }

            if (unassignUsers.length)
              yield* tx.delete(schema.userPolicy).where(
                and(
                  eq(schema.userPolicy.organizationId, ctx.organization.id),
                  eq(schema.userPolicy.policyId, policyId),
                  inArray(
                    schema.userPolicy.userId,
                    unassignUsers.map((assignment) => assignment.id),
                  ),
                ),
              );

            if (assignUserGroups.length) {
              const unique = [
                ...new Map(
                  assignUserGroups.map((assignment) => [assignment.id, assignment]),
                ).values(),
              ];

              yield* tx.delete(schema.userGroupPolicy).where(
                and(
                  eq(schema.userGroupPolicy.organizationId, ctx.organization.id),
                  eq(schema.userGroupPolicy.policyId, policyId),
                  inArray(
                    schema.userGroupPolicy.groupId,
                    unique.map((assignment) => assignment.id),
                  ),
                ),
              );
              yield* tx.insert(schema.userGroupPolicy).values(
                unique.map((assignment) => ({
                  organizationId: ctx.organization.id,
                  groupId: assignment.id,
                  policyId,
                  mode: assignment.mode,
                  createdAt: now(),
                })),
              );
            }

            if (unassignUserGroups.length)
              yield* tx.delete(schema.userGroupPolicy).where(
                and(
                  eq(schema.userGroupPolicy.organizationId, ctx.organization.id),
                  eq(schema.userGroupPolicy.policyId, policyId),
                  inArray(
                    schema.userGroupPolicy.groupId,
                    unassignUserGroups.map((assignment) => assignment.id),
                  ),
                ),
              );
          }),
        );

        const affectedUserIds = [
          ...new Set([
            ...assignUsers.map((assignment) => assignment.id),
            ...unassignUsers.map((assignment) => assignment.id),
          ]),
        ];

        const affectedGroupIds = [
          ...new Set([
            ...assignUserGroups.map((assignment) => assignment.id),
            ...unassignUserGroups.map((assignment) => assignment.id),
          ]),
        ];

        const groupMemberIds = affectedGroupIds.length
          ? yield* db
              .select({ userId: schema.userGroupMember.userId })
              .from(schema.userGroupMember)
              .where(inArray(schema.userGroupMember.groupId, affectedGroupIds))
          : [];

        const linkedUserIds = [
          ...new Set([...affectedUserIds, ...groupMemberIds.map((row) => row.userId)]),
        ];

        const userDevices = linkedUserIds.length
          ? yield* db
              .select({ deviceId: schema.deviceUser.deviceId })
              .from(schema.deviceUser)
              .where(
                and(
                  eq(schema.deviceUser.organizationId, ctx.organization.id),
                  inArray(schema.deviceUser.userId, linkedUserIds),
                ),
              )
          : [];

        const userDeviceIds = [...new Set(userDevices.map((row) => row.deviceId))];

        yield* pushPolicyDevices(ctx.organization.id, { policyId }, [
          ...assign.map((assignment) => assignment.id),
          ...unassign.map((assignment) => assignment.id),
        ]);
        yield* syncAndroidDevices(ctx.organization.id, [
          ...assign.map((assignment) => assignment.id),
          ...unassign.map((assignment) => assignment.id),
        ]);
        yield* refreshDevicePolicies(ctx.organization.id, userDeviceIds, policyId);
        yield* audit(ctx, "policy.assignments_changed", "policy", policyId, {
          assign: assign.length,
          unassign: unassign.length,
          exclude: assign.filter((assignment) => assignment.mode === "exclude").length,
          assignUsers: assignUsers.length,
          unassignUsers: unassignUsers.length,
          assignUserGroups: assignUserGroups.length,
          unassignUserGroups: unassignUserGroups.length,
        });

        return ok;
      }),
    listDirectory: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const userRows = yield* db
          .select({
            id: schema.user.id,
            name: schema.user.name,
            email: schema.user.email,
            emailVerified: schema.user.emailVerified,
            disabled: schema.user.disabled,
            source: schema.user.source,
            role: schema.member.role,
          })
          .from(schema.member)
          .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
          .where(eq(schema.member.organizationId, ctx.organization.id));

        const groups = yield* db
          .select({
            id: schema.userGroup.id,
            name: schema.userGroup.name,
            source: schema.userGroup.source,
          })
          .from(schema.userGroup)
          .where(eq(schema.userGroup.organizationId, ctx.organization.id));

        const counts = groups.length
          ? yield* db
              .select({ groupId: schema.userGroupMember.groupId, value: count() })
              .from(schema.userGroupMember)
              .where(
                inArray(
                  schema.userGroupMember.groupId,
                  groups.map((group) => group.id),
                ),
              )
              .groupBy(schema.userGroupMember.groupId)
          : [];

        const countsByGroup = new Map(counts.map((row) => [row.groupId, Number(row.value)]));

        return {
          users: userRows
            .map((row) => ({
              id: row.id,
              name: row.name,
              email: row.email,
              emailVerified: row.emailVerified,
              disabled: row.disabled,
              role: row.role,
              source: row.source === "graph" ? ("entra" as const) : row.source,
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
          groups: groups
            .map((group) => ({
              ...group,
              memberCount: countsByGroup.get(group.id) ?? 0,
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
        };
      }),
    getDeviceUsers: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        yield* assertTenantDevices(ctx.organization.id, [deviceId]);

        const users = yield* db
          .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
          .from(schema.deviceUser)
          .innerJoin(schema.user, eq(schema.user.id, schema.deviceUser.userId))
          .innerJoin(
            schema.member,
            and(
              eq(schema.member.userId, schema.deviceUser.userId),
              eq(schema.member.organizationId, ctx.organization.id),
            ),
          )
          .where(
            and(
              eq(schema.deviceUser.organizationId, ctx.organization.id),
              eq(schema.deviceUser.deviceId, deviceId),
              eq(schema.user.disabled, false),
            ),
          )
          .orderBy(asc(schema.user.name));

        return { users };
      }),
    setDeviceUsers: (request, tenantId, deviceId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* assertTenantDevices(ctx.organization.id, [deviceId]);

        const body: { readonly userIds: ReadonlyArray<string> } = payload;
        const userIds = [...new Set(body.userIds)];
        yield* assertTenantUsers(ctx.organization.id, userIds);

        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .delete(schema.deviceUser)
              .where(
                and(
                  eq(schema.deviceUser.organizationId, ctx.organization.id),
                  eq(schema.deviceUser.deviceId, deviceId),
                ),
              );

            if (userIds.length)
              yield* tx.insert(schema.deviceUser).values(
                userIds.map((userId) => ({
                  organizationId: ctx.organization.id,
                  deviceId,
                  userId,
                  source: "manual" as const,
                  createdAt: now(),
                })),
              );
          }),
        );

        yield* refreshDevicePolicies(ctx.organization.id, [deviceId]);
        yield* audit(ctx, "device.users_changed", "device", deviceId, {
          users: userIds.length,
        });

        const users = yield* db
          .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
          .from(schema.deviceUser)
          .innerJoin(schema.user, eq(schema.user.id, schema.deviceUser.userId))
          .innerJoin(
            schema.member,
            and(
              eq(schema.member.userId, schema.deviceUser.userId),
              eq(schema.member.organizationId, ctx.organization.id),
            ),
          )
          .where(
            and(
              eq(schema.deviceUser.organizationId, ctx.organization.id),
              eq(schema.deviceUser.deviceId, deviceId),
              eq(schema.user.disabled, false),
            ),
          )
          .orderBy(asc(schema.user.name));

        return { users };
      }),
    listApplications: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const apps = yield* db
          .select()
          .from(schema.application)
          .where(eq(schema.application.organizationId, ctx.organization.id));

        if (apps.length === 0) return { applications: [] };
        const ids = apps.map((app) => app.id);

        const groupLinks = yield* db
          .select()
          .from(schema.applicationGroup)
          .where(inArray(schema.applicationGroup.applicationId, ids));

        const deviceLinks = yield* db
          .select()
          .from(schema.applicationDevice)
          .where(inArray(schema.applicationDevice.applicationId, ids));

        return {
          applications: apps.map((app) =>
            rowApplication(
              app,
              groupLinks.filter((link: { applicationId: string }) => link.applicationId === app.id)
                .length,
              deviceLinks.filter((link: { applicationId: string }) => link.applicationId === app.id)
                .length,
            ),
          ),
        };
      }),
    getApplication: (request, tenantId, applicationId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const app = yield* db.query.application.findFirst({
          where: { id: applicationId, organizationId: ctx.organization.id },
        });

        if (!app)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Application not found" }));

        const groupLinks = yield* db
          .select()
          .from(schema.applicationGroup)
          .where(eq(schema.applicationGroup.applicationId, applicationId));

        const deviceLinks = yield* db
          .select()
          .from(schema.applicationDevice)
          .where(eq(schema.applicationDevice.applicationId, applicationId));

        const groupIds = groupLinks.map((link: { groupId: string }) => link.groupId);
        const deviceIds = deviceLinks.map((link: { deviceId: string }) => link.deviceId);

        const groups = groupIds.length
          ? yield* db
              .select({ id: schema.enterpriseGroup.id, name: schema.enterpriseGroup.name })
              .from(schema.enterpriseGroup)
              .where(inArray(schema.enterpriseGroup.id, groupIds))
          : [];

        const devices = deviceIds.length
          ? yield* db
              .select({ id: schema.device.id, name: schema.device.name })
              .from(schema.device)
              .where(inArray(schema.device.id, deviceIds))
          : [];

        return { ...rowApplication(app, groups.length, devices.length), groups, devices };
      }),
    createApplication: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const body: {
          name: string;
          platform: "apple" | "win" | "android";
          bundleId?: string | null;
          version?: string | null;
          source?: "manifest" | "store" | "upload";
          manifestUrl?: string | null;
          storeId?: string | null;
          notes?: string | null;
        } = payload;

        if (!body.name.trim())
          return yield* Effect.fail(new EnterpriseBadRequest({ message: "Name is required" }));
        const source = body.source ?? (body.storeId ? "store" : "manifest");

        if (body.platform === "apple") {
          if (source === "manifest" && !body.manifestUrl?.trim())
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: "Apple manifest applications require a manifest URL",
              }),
            );

          if (source === "store" && !body.storeId?.trim())
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Apple store applications require a store ID" }),
            );
        }

        if (source === "store" && !Number.isSafeInteger(Number(body.storeId)))
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Store ID must be a whole number" }),
          );
        const applicationId = id();
        yield* db.insert(schema.application).values({
          id: applicationId,
          organizationId: ctx.organization.id,
          name: body.name.trim(),
          platform: body.platform,
          bundleId: body.bundleId ?? null,
          version: body.version ?? null,
          source,
          manifestUrl: body.manifestUrl ?? null,
          storeId: body.storeId ?? null,
          notes: body.notes ?? null,
          createdAt: now(),
          updatedAt: now(),
        });
        yield* audit(ctx, "application.created", "application", applicationId, {
          name: body.name.trim(),
          platform: body.platform,
        });

        return { id: applicationId };
      }),
    patchApplication: (request, tenantId, applicationId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const existing = yield* db.query.application.findFirst({
          where: { id: applicationId, organizationId: ctx.organization.id },
        });

        if (!existing)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Application not found" }));

        const body: {
          name?: string;
          bundleId?: string | null;
          version?: string | null;
          source?: "manifest" | "store" | "upload";
          manifestUrl?: string | null;
          storeId?: string | null;
          notes?: string | null;
        } = payload;

        const source = body.source ?? existing.source;

        const manifestUrl =
          body.manifestUrl === undefined ? existing.manifestUrl : body.manifestUrl;

        const storeId = body.storeId === undefined ? existing.storeId : body.storeId;

        if (body.name !== undefined && !body.name.trim())
          return yield* Effect.fail(new EnterpriseBadRequest({ message: "Name is required" }));

        if (existing.platform === "apple") {
          if (source === "manifest" && !manifestUrl?.trim())
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: "Apple manifest applications require a manifest URL",
              }),
            );

          if (source === "store" && !storeId?.trim())
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "Apple store applications require a store ID" }),
            );
        }

        if (source === "store" && !Number.isSafeInteger(Number(storeId)))
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Store ID must be a whole number" }),
          );
        yield* db
          .update(schema.application)
          .set({
            name: body.name?.trim() ?? existing.name,
            bundleId: body.bundleId === undefined ? existing.bundleId : body.bundleId,
            version: body.version === undefined ? existing.version : body.version,
            source,
            manifestUrl,
            storeId,
            notes: body.notes === undefined ? existing.notes : body.notes,
            updatedAt: now(),
          })
          .where(
            and(
              eq(schema.application.id, applicationId),
              eq(schema.application.organizationId, ctx.organization.id),
            ),
          );
        yield* audit(ctx, "application.updated", "application", applicationId, {
          fields: Object.keys(body),
        });

        return ok;
      }),
    deleteApplications: (request, tenantId, ids) =>
      Effect.gen(function* () {
        const r2 = yield* R2Storage;
        const ctx = yield* requireTenant(request, tenantId, "write");

        const results = yield* Effect.forEach(
          [...ids],
          (applicationId) =>
            Effect.gen(function* () {
              const existing = yield* db.query.application.findFirst({
                where: { id: applicationId, organizationId: ctx.organization.id },
              });

              if (!existing)
                return { id: applicationId, deleted: false as const, reason: "notFound" };
              yield* db
                .delete(schema.application)
                .where(
                  and(
                    eq(schema.application.id, applicationId),
                    eq(schema.application.organizationId, ctx.organization.id),
                  ),
                );

              // Delete the object only after the row is gone. A failure here
              // leaves an orphaned object, never a row pointing at a deleted
              // file, and must not abort the rest of the batch.
              if (existing.r2Key)
                yield* r2
                  .delete(existing.r2Key)
                  .pipe(
                    Effect.catchCause((cause) =>
                      Effect.logWarning(
                        `Failed to delete application object ${applicationId}: ${String(cause)}`,
                      ),
                    ),
                  );

              return { id: applicationId, deleted: true as const };
            }),
          { concurrency: 10 },
        );

        const deleted = results.filter((row) => row.deleted).map((row) => row.id);

        const failed = results
          .filter((row) => !row.deleted)
          .map((row) => ({ id: row.id, reason: row.reason }));

        yield* audit(ctx, "application.deleted", "application", null, { ids: deleted });

        return { deleted, failed };
      }).pipe(Effect.provide(r2Layer)),
    patchApplicationAssignments: (request, tenantId, applicationId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* assertTenantApplications(ctx.organization.id, [applicationId]);

        const body: {
          assign?: { groups?: Array<string>; devices?: Array<string> };
          unassign?: { groups?: Array<string>; devices?: Array<string> };
        } = payload;

        const groupIds = [...(body.assign?.groups ?? []), ...(body.unassign?.groups ?? [])];

        for (const groupId of groupIds) yield* assertTenantGroup(ctx.organization.id, groupId);
        yield* assertTenantDevices(ctx.organization.id, [
          ...(body.assign?.devices ?? []),
          ...(body.unassign?.devices ?? []),
        ]);

        if (body.assign?.groups?.length)
          yield* db
            .insert(schema.applicationGroup)
            .ignore()
            .values(body.assign.groups.map((groupId) => ({ groupId, applicationId })));

        if (body.assign?.devices?.length)
          yield* db
            .insert(schema.applicationDevice)
            .ignore()
            .values(body.assign.devices.map((deviceId) => ({ deviceId, applicationId })));

        if (body.unassign?.groups?.length)
          yield* db
            .delete(schema.applicationGroup)
            .where(
              and(
                eq(schema.applicationGroup.applicationId, applicationId),
                inArray(schema.applicationGroup.groupId, body.unassign.groups),
              ),
            );

        if (body.unassign?.devices?.length)
          yield* db
            .delete(schema.applicationDevice)
            .where(
              and(
                eq(schema.applicationDevice.applicationId, applicationId),
                inArray(schema.applicationDevice.deviceId, body.unassign.devices),
              ),
            );
        const affected = yield* applicationAssignedDeviceIds(ctx.organization.id, applicationId);
        yield* applePush.pushAppleDevices(affected.map((device) => device.id));
        yield* audit(ctx, "application.assignments_changed", "application", applicationId, {
          assignGroups: body.assign?.groups?.length ?? 0,
          assignDevices: body.assign?.devices?.length ?? 0,
          unassignGroups: body.unassign?.groups?.length ?? 0,
          unassignDevices: body.unassign?.devices?.length ?? 0,
        });

        return ok;
      }),
    installApplication: (request, tenantId, applicationId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const app = yield* db.query.application.findFirst({
          where: { id: applicationId, organizationId: ctx.organization.id },
        });

        if (!app)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Application not found" }));

        if (app.platform !== "apple")
          return {
            status: "ok" as const,
            queued: 0,
            skipped: 0,
            message:
              app.platform === "win"
                ? "Windows app delivery is not implemented yet; the catalogue entry was saved."
                : "Android app delivery is not implemented yet; the catalogue entry was saved.",
          };

        if (app.source === "upload")
          return {
            status: "ok" as const,
            queued: 0,
            skipped: 0,
            message:
              "Uploaded installers are stored but not deployable yet. Use a manifest URL or store ID for Apple apps.",
          };
        const devices = yield* applicationAssignedDeviceIds(ctx.organization.id, applicationId);

        const appleDevices = devices.filter(
          (device) => device.proto === "apple" && device.status === "enrolled",
        );

        const skipped = devices.length - appleDevices.length;

        if (appleDevices.length === 0)
          return {
            status: "ok" as const,
            queued: 0,
            skipped,
            message: "No assigned Apple devices.",
          };

        // When Apps and Books is configured, a store app must consume a VPP
        // licence. Falling back to a user-account App Store install would
        // silently bypass the licence pool, so this path fails closed.
        if (app.source === "store" && app.storeId) {
          const storeId = app.storeId;

          const vpp = yield* db.query.vppToken.findFirst({
            where: { organizationId: ctx.organization.id },
          });

          if (vpp) {
            if (vpp.status !== "active")
              return yield* Effect.fail(
                new EnterpriseBadRequest({
                  message:
                    "The Apps and Books token is not active. Re-upload a valid token before installing VPP apps.",
                }),
              );

            const asset = yield* findVppAssetByStoreId(db, ctx.organization.id, storeId);

            if (!asset)
              return {
                status: "ok" as const,
                queued: 0,
                skipped: devices.length,
                message:
                  "No VPP licence pool exists for this app yet. Sync Apps and Books, then try again.",
              };
            let assigned = 0;
            let failed = 0;
            const queuedDevices: Array<EnterpriseDevice> = [];

            for (const device of appleDevices) {
              const outcome = yield* mapVppFailure(
                assignVppLicence({
                  db,
                  organizationId: ctx.organization.id,
                  deviceId: device.id,
                  adamId: storeId,
                  authSecret,
                  config: appleApi ? appleApi : undefined,
                }),
              ).pipe(Effect.result);

              if (Predicate.isTagged(outcome, "Failure")) {
                failed++;
                continue;
              }

              assigned++;
              queuedDevices.push(device);
            }

            if (queuedDevices.length > 0) {
              const at = now();

              for (const device of queuedDevices)
                yield* queueDeviceCommand({
                  organizationId: ctx.organization.id,
                  deviceId: device.id,
                  requestType: "InstallApplication",
                  payload: vppInstallPayload(storeId),
                  at,
                });

              yield* applePush.pushAppleDevices(queuedDevices.map((device) => device.id));
            }

            yield* audit(ctx, "application.install_queued", "application", applicationId, {
              queued: queuedDevices.length,
              skipped: skipped + failed,
              vppAssigned: assigned,
            });

            return {
              status: "ok" as const,
              queued: queuedDevices.length,
              skipped: skipped + failed,
              message:
                failed > 0
                  ? `${failed} device(s) had no available VPP licence and were skipped.`
                  : undefined,
            };
          }
        }

        const payload: CommandPayload =
          app.source === "store"
            ? {
                iTunesStoreID: Number(app.storeId),
                ManagementFlags: 1,
                InstallAsManaged: true,
                Options: { PurchaseMethod: 1 },
              }
            : {
                ManifestURL: app.manifestUrl,
                ManagementFlags: 1,
                InstallAsManaged: true,
                Options: { PurchaseMethod: 1 },
              };

        const at = now();

        for (const device of appleDevices)
          yield* queueDeviceCommand({
            organizationId: ctx.organization.id,
            deviceId: device.id,
            requestType: "InstallApplication",
            payload,
            at,
          });

        yield* applePush.pushAppleDevices(appleDevices.map((device) => device.id));
        yield* audit(ctx, "application.install_queued", "application", applicationId, {
          queued: appleDevices.length,
          skipped,
        });

        return { status: "ok" as const, queued: appleDevices.length, skipped };
      }),
    uploadApplication: (request, tenantId, applicationId, payload) =>
      Effect.gen(function* () {
        const r2 = yield* R2Storage;
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* assertTenantApplications(ctx.organization.id, [applicationId]);

        const existing = yield* db.query.application.findFirst({
          where: { id: applicationId, organizationId: ctx.organization.id },
        });

        const body: { fileName: string; contentType?: string; content: string } = payload;
        const bytes = base64ToBytes(body.content);

        const sha256 = yield* sha256Hex(bytesToArrayBuffer(bytes));

        const key = applicationKey(ctx.organization.id, applicationId, sha256);
        yield* r2.put(key, bytes, {
          httpMetadata: body.contentType ? { contentType: body.contentType } : undefined,
          customMetadata: { fileName: body.fileName },
        });
        yield* db
          .update(schema.application)
          .set({
            fileName: body.fileName,
            contentType: body.contentType ?? null,
            size: bytes.byteLength,
            sha256,
            r2Key: key,
            updatedAt: now(),
          })
          .where(
            and(
              eq(schema.application.id, applicationId),
              eq(schema.application.organizationId, ctx.organization.id),
            ),
          );

        if (existing?.r2Key && existing.r2Key !== key) yield* r2.delete(existing.r2Key);
        yield* audit(ctx, "application.uploaded", "application", applicationId, {
          fileName: body.fileName,
          sha256,
          size: bytes.byteLength,
        });

        return {
          sha256,
          fileName: body.fileName,
          contentType: body.contentType ?? null,
          size: bytes.byteLength,
        };
      }).pipe(Effect.provide(r2Layer)),
    downloadApplication: (request, tenantId, applicationId, sha256) =>
      Effect.gen(function* () {
        const r2 = yield* R2Storage;
        const ctx = yield* requireTenant(request, tenantId);

        const app = yield* db.query.application.findFirst({
          where: { id: applicationId, organizationId: ctx.organization.id },
        });

        if (!app)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Application not found" }));

        if (app.sha256 !== sha256 || !app.r2Key)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "Application file not found" }),
          );

        const object = yield* r2
          .get(app.r2Key)
          .pipe(
            Effect.catchTag("R2FileNotFound", () =>
              Effect.fail(new EnterpriseNotFound({ message: "Application file not found" })),
            ),
          );

        const bytes = yield* r2.arrayBuffer(object);

        return {
          sha256,
          fileName: object.customMetadata?.fileName ?? app.fileName ?? sha256,
          contentType: object.httpMetadata?.contentType ?? app.contentType ?? null,
          size: object.size ?? bytes.byteLength,
          content: bytesToBase64(new Uint8Array(bytes)),
        };
      }).pipe(Effect.provide(r2Layer)),
    syncPolicies: (request, tenantId, ids) =>
      Effect.gen(function* () {
        yield* requireTenant(request, tenantId, "write");

        const affected = yield* Effect.forEach(
          [...ids],
          (policyId) =>
            Effect.gen(function* () {
              const policy = yield* db.query.policy.findFirst({
                where: { id: policyId, organizationId: tenantId },
              });

              return policy ? yield* applePush.deviceIdsInPolicies([policyId]) : [];
            }),
          { concurrency: 10 },
        );

        const pushed = yield* applePush.pushAppleDevices(affected.flat());
        yield* reportPolicyDeliveryFailure(tenantId, { policyIds: [...ids] }, pushed);

        return ok;
      }),
    duplicatePolicy: (request, tenantId, policyId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const source = yield* db.query.policy.findFirst({
          where: { id: policyId, organizationId: ctx.organization.id },
        });

        if (!source)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Policy not found" }));
        const body: { name?: string } = payload;
        const newId = id();
        yield* db.insert(schema.policy).values({
          id: newId,
          organizationId: ctx.organization.id,
          name: body.name ?? `${source.name} [duplicated]`,
          notes: source.notes,
          priority: source.priority ?? 0,
          createdAt: now(),
          updatedAt: now(),
        });

        const configurations = yield* db
          .select()
          .from(schema.configuration)
          .where(eq(schema.configuration.policyId, policyId));

        if (configurations.length)
          yield* db.insert(schema.configuration).values(
            configurations.map((c: EnterpriseConfiguration) => ({
              kind: c.kind,
              policyId: newId,
              data: c.data,
              hash: c.hash,
            })),
          );
        yield* audit(ctx, "policy.duplicated", "policy", newId, { sourceId: policyId });
        yield* snapshotPolicy(ctx, newId);

        return { id: newId };
      }),
    extractMobileconfig: (payload) =>
      Effect.gen(function* () {
        const body: { mobileconfig: string } = payload;

        return yield* Effect.tryPromise({
          try: async () => ({ plist: await extractMobileconfigPlist(body.mobileconfig) }),
          catch: (cause) =>
            new EnterpriseBadRequest({
              message: cause instanceof Error ? cause.message : "Invalid mobileconfig",
            }),
        });
      }),
    previewMobileconfig: (payload) =>
      Effect.gen(function* () {
        const body: { mobileconfig: string } = payload;

        return yield* Effect.tryPromise({
          try: () => parseMobileconfigPreview(body.mobileconfig),
          catch: (cause) =>
            new EnterpriseBadRequest({
              message: cause instanceof Error ? cause.message : "Invalid mobileconfig",
            }),
        });
      }),
    search: (request, tenantId, query) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const term = (query.q ?? "").trim();
        const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);

        if (!term) return { rows: [] };
        const pattern = `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;

        const devices = yield* db
          .select()
          .from(schema.device)
          .where(
            and(
              eq(schema.device.organizationId, ctx.organization.id),
              or(
                like(schema.device.name, pattern),
                like(schema.device.serial, pattern),
                like(schema.device.model, pattern),
                like(schema.device.dmIdentifier, pattern),
              ),
            ),
          )
          .limit(limit);

        const groups = yield* db
          .select()
          .from(schema.enterpriseGroup)
          .where(
            and(
              eq(schema.enterpriseGroup.organizationId, ctx.organization.id),
              like(schema.enterpriseGroup.name, pattern),
            ),
          )
          .limit(limit);

        const policies = yield* db
          .select()
          .from(schema.policy)
          .where(
            and(
              eq(schema.policy.organizationId, ctx.organization.id),
              like(schema.policy.name, pattern),
            ),
          )
          .limit(limit);

        const users = yield* db
          .select({
            id: schema.user.id,
            name: schema.user.name,
            email: schema.user.email,
            role: schema.member.role,
          })
          .from(schema.member)
          .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
          .where(
            and(
              eq(schema.member.organizationId, ctx.organization.id),
              or(like(schema.user.name, pattern), like(schema.user.email, pattern)),
            ),
          )
          .limit(limit);

        return {
          rows: [
            ...devices.map(rowDevice),
            ...groups.map((row: EnterpriseGroup) => rowGroup(row)),
            ...(yield* Effect.all(policies.map((row) => rowPolicy(row)))),
            ...users,
          ],
        };
      }),
    listDevices: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const rows = yield* db
          .select()
          .from(schema.device)
          .where(eq(schema.device.organizationId, ctx.organization.id));

        return { rows: rows.map(rowDevice) };
      }),
    searchDevices: (request, tenantId, query) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const filters = normalizeDeviceSearchQuery(query);
        const where = yield* deviceSearchWhere(ctx.organization.id, filters);

        if (filters.query) {
          // Structured filters use the same evaluator as dynamic groups and
          // dashboards, so derived fields (health, enrolled age, installed
          // apps) behave identically everywhere.
          const candidates = yield* db.select().from(schema.device).where(where);

          const matches = (yield* loadDeviceSnapshots(ctx.organization.id, candidates)).filter(
            (snapshot) =>
              evaluateDeviceQuery(
                filters.query,
                {
                  ...snapshot.row,
                  health: snapshot.health,
                  applications: snapshot.applications,
                },
                { now: now() },
              ),
          );

          const direction = filters.direction === "desc" ? -1 : 1;

          const sortValue = (snapshot: (typeof matches)[number]) => {
            switch (filters.sort) {
              case "lastSeenAt":
                return snapshot.row.lastSeenAt.getTime();
              case "enrolledAt":
                return snapshot.row.enrolledAt.getTime();
              case "status":
                return snapshot.row.status;
              default:
                return snapshot.row.name;
            }
          };

          matches.sort((left, right) => {
            const a = sortValue(left);
            const b = sortValue(right);

            const comparison =
              Schema.is(Schema.Number)(a) && Schema.is(Schema.Number)(b)
                ? a - b
                : String(a).localeCompare(String(b), undefined, { numeric: true });

            return comparison * direction || left.row.id.localeCompare(right.row.id);
          });
          const page = matches.slice(filters.offset, filters.offset + filters.limit);

          const groups = yield* deviceGroupsFor(
            ctx.organization.id,
            page.map((snapshot) => snapshot.row.id),
          );

          return {
            devices: page.map((snapshot) => ({
              ...rowDevice(snapshot.row),
              groups: groups.get(snapshot.row.id) ?? [],
            })),
            total: matches.length,
          };
        }

        const [total] = yield* db.select({ value: count() }).from(schema.device).where(where);

        const rows = yield* db
          .select()
          .from(schema.device)
          .where(where)
          .orderBy(...deviceOrder(filters))
          .limit(filters.limit)
          .offset(filters.offset);

        const groups = yield* deviceGroupsFor(
          ctx.organization.id,
          rows.map((row) => row.id),
        );

        return {
          devices: rows.map((row) => ({ ...rowDevice(row), groups: groups.get(row.id) ?? [] })),
          total: Number(total?.value ?? 0),
        };
      }),
    listDashboards: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const rows = yield* db
          .select()
          .from(schema.dashboard)
          .where(eq(schema.dashboard.organizationId, ctx.organization.id))
          .orderBy(asc(schema.dashboard.name));

        const widgets = yield* db
          .select({ dashboardId: schema.dashboardWidget.dashboardId })
          .from(schema.dashboardWidget)
          .where(eq(schema.dashboardWidget.organizationId, ctx.organization.id));

        const countByDashboard = new Map<string, number>();

        for (const widget of widgets)
          countByDashboard.set(
            widget.dashboardId,
            (countByDashboard.get(widget.dashboardId) ?? 0) + 1,
          );

        return {
          dashboards: rows.map((row) =>
            dashboardSummaryRow(row, countByDashboard.get(row.id) ?? 0),
          ),
        };
      }),
    createDashboard: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body: { name?: string; description?: string | null; template?: string } = payload;
        const name = body.name?.trim();

        if (!name)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Dashboard name is required" }),
          );

        const existing = yield* db
          .select({ id: schema.dashboard.id })
          .from(schema.dashboard)
          .where(eq(schema.dashboard.organizationId, ctx.organization.id))
          .limit(1);

        const dashboardId = id();
        const timestamp = now();
        yield* db.insert(schema.dashboard).values({
          id: dashboardId,
          organizationId: ctx.organization.id,
          name: name.slice(0, 120),
          description: body.description?.trim().slice(0, 2000) || null,
          isDefault: existing.length === 0,
          createdByUserId: ctx.user.id,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        if (body.template === "overview") {
          const widgets = defaultOverviewWidgets();

          if (widgets.length)
            yield* db.insert(schema.dashboardWidget).values(
              widgets.map((widget) => {
                const layout = normalizeWidgetLayout(widget);

                return {
                  id: id(),
                  organizationId: ctx.organization.id,
                  dashboardId,
                  type: widget.type,
                  title: widget.title,
                  config: normalizeWidgetConfig(
                    widget.type,
                    Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(widget.config)),
                  ),
                  ...layout,
                  createdAt: timestamp,
                  updatedAt: timestamp,
                };
              }),
            );
        }

        yield* audit(ctx, "dashboard.created", "dashboard", dashboardId, {
          template: body.template ?? null,
        });

        return { id: dashboardId };
      }),
    getDashboard: (request, tenantId, dashboardId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const row = yield* requireDashboard(ctx.organization.id, dashboardId);
        const widgets = yield* loadDashboardWidgets(row.id);

        return {
          ...dashboardSummaryRow(row, widgets.length),
          widgets: widgets.map(dashboardWidgetRow),
        };
      }),
    patchDashboard: (request, tenantId, dashboardId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const row = yield* requireDashboard(ctx.organization.id, dashboardId);

        const body: {
          name?: string;
          description?: string | null;
          isDefault?: boolean;
        } = payload;

        if (body.name !== undefined && !body.name.trim())
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Dashboard name is required" }),
          );

        if (body.isDefault === true) {
          yield* db
            .update(schema.dashboard)
            .set({ isDefault: false, updatedAt: now() })
            .where(
              and(
                eq(schema.dashboard.organizationId, ctx.organization.id),
                ne(schema.dashboard.id, row.id),
              ),
            );
        }

        yield* db
          .update(schema.dashboard)
          .set({
            name: body.name !== undefined ? body.name.trim().slice(0, 120) : undefined,
            description:
              body.description !== undefined
                ? body.description?.trim().slice(0, 2000) || null
                : undefined,
            isDefault: body.isDefault === true ? true : undefined,
            updatedAt: now(),
          })
          .where(eq(schema.dashboard.id, row.id));
        yield* audit(ctx, "dashboard.updated", "dashboard", row.id, {
          fields: Object.keys(body),
        });

        return ok;
      }),
    deleteDashboard: (request, tenantId, dashboardId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const row = yield* requireDashboard(ctx.organization.id, dashboardId);
        yield* db.delete(schema.dashboard).where(eq(schema.dashboard.id, row.id));

        if (row.isDefault) {
          const [next] = yield* db
            .select({ id: schema.dashboard.id })
            .from(schema.dashboard)
            .where(eq(schema.dashboard.organizationId, ctx.organization.id))
            .orderBy(asc(schema.dashboard.createdAt))
            .limit(1);

          if (next)
            yield* db
              .update(schema.dashboard)
              .set({ isDefault: true, updatedAt: now() })
              .where(eq(schema.dashboard.id, next.id));
        }

        yield* audit(ctx, "dashboard.deleted", "dashboard", row.id);

        return ok;
      }),
    createDashboardWidget: (request, tenantId, dashboardId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const dashboardRow = yield* requireDashboard(ctx.organization.id, dashboardId);

        const body: {
          type?: string;
          title?: string;
          config?: Schema.Json;
          x?: number;
          y?: number;
          w?: number;
          h?: number;
        } = payload;

        const title = body.title?.trim();

        if (!title)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Widget title is required" }),
          );
        const type = Schema.decodeUnknownSync(DashboardWidgetType)(body.type);
        const layout = normalizeWidgetLayout(body);
        const widgetId = id();
        const timestamp = now();
        yield* db.insert(schema.dashboardWidget).values({
          id: widgetId,
          organizationId: ctx.organization.id,
          dashboardId: dashboardRow.id,
          type,
          title: title.slice(0, 120),
          config: normalizeWidgetConfig(type, body.config),
          ...layout,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        yield* touchDashboard(dashboardRow.id);
        yield* audit(ctx, "dashboard.widget_created", "dashboard", dashboardRow.id, {
          widgetId,
          type,
        });

        const [created] = yield* db
          .select()
          .from(schema.dashboardWidget)
          .where(eq(schema.dashboardWidget.id, widgetId));

        return dashboardWidgetRow(created!);
      }),
    patchDashboardWidget: (request, tenantId, dashboardId, widgetId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const dashboardRow = yield* requireDashboard(ctx.organization.id, dashboardId);

        const existing = yield* db.query.dashboardWidget.findFirst({
          where: {
            id: widgetId,
            dashboardId: dashboardRow.id,
            organizationId: ctx.organization.id,
          },
        });

        if (!existing)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Widget not found" }));

        const body: {
          type?: DashboardWidgetType;
          title?: string;
          config?: Schema.Json;
          x?: number;
          y?: number;
          w?: number;
          h?: number;
        } = payload;

        const type = body.type
          ? Schema.decodeUnknownSync(DashboardWidgetType)(body.type)
          : Schema.decodeUnknownSync(DashboardWidgetType)(existing.type);

        const title = body.title?.trim();

        if (body.title !== undefined && !title)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Widget title is required" }),
          );

        const layout = normalizeWidgetLayout(
          {
            x: body.x ?? existing.x,
            y: body.y ?? existing.y,
            w: body.w ?? existing.w,
            h: body.h ?? existing.h,
          },
          { x: existing.x, y: existing.y, w: existing.w, h: existing.h },
        );

        const config =
          body.config !== undefined
            ? normalizeWidgetConfig(type, body.config)
            : body.type !== undefined
              ? normalizeWidgetConfig(
                  type,
                  Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(existing.config)),
                )
              : undefined;

        yield* db
          .update(schema.dashboardWidget)
          .set({
            type: body.type !== undefined ? type : undefined,
            title: title !== undefined ? title.slice(0, 120) : undefined,
            config: config !== undefined ? config : undefined,
            ...layout,
            updatedAt: now(),
          })
          .where(eq(schema.dashboardWidget.id, existing.id));
        yield* touchDashboard(dashboardRow.id);
        yield* audit(ctx, "dashboard.widget_updated", "dashboard", dashboardRow.id, {
          widgetId: existing.id,
          fields: Object.keys(body),
        });

        const [updated] = yield* db
          .select()
          .from(schema.dashboardWidget)
          .where(eq(schema.dashboardWidget.id, existing.id));

        return dashboardWidgetRow(updated!);
      }),
    deleteDashboardWidget: (request, tenantId, dashboardId, widgetId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const dashboardRow = yield* requireDashboard(ctx.organization.id, dashboardId);

        const existing = yield* db.query.dashboardWidget.findFirst({
          where: {
            id: widgetId,
            dashboardId: dashboardRow.id,
            organizationId: ctx.organization.id,
          },
        });

        if (!existing)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Widget not found" }));
        yield* db.delete(schema.dashboardWidget).where(eq(schema.dashboardWidget.id, existing.id));
        yield* touchDashboard(dashboardRow.id);
        yield* audit(ctx, "dashboard.widget_deleted", "dashboard", dashboardRow.id, {
          widgetId: existing.id,
        });

        return ok;
      }),
    patchDashboardLayout: (request, tenantId, dashboardId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const dashboardRow = yield* requireDashboard(ctx.organization.id, dashboardId);

        const body: {
          widgets?: ReadonlyArray<{ id: string; x?: number; y?: number; w?: number; h?: number }>;
        } = payload;

        const current = yield* loadDashboardWidgets(dashboardRow.id);
        const byId = new Map(current.map((widget) => [widget.id, widget]));

        for (const change of body.widgets ?? []) {
          const existing = byId.get(change.id);

          if (!existing) continue;

          const layout = normalizeWidgetLayout(
            {
              x: change.x ?? existing.x,
              y: change.y ?? existing.y,
              w: change.w ?? existing.w,
              h: change.h ?? existing.h,
            },
            { x: existing.x, y: existing.y, w: existing.w, h: existing.h },
          );

          yield* db
            .update(schema.dashboardWidget)
            .set({ ...layout, updatedAt: now() })
            .where(eq(schema.dashboardWidget.id, existing.id));
        }

        yield* touchDashboard(dashboardRow.id);

        return ok;
      }),
    queryDashboard: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        return yield* runDashboardQuery(ctx.organization.id, payload);
      }),
    exportDevices: (request, tenantId, query) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const filters = normalizeDeviceSearchQuery(query);
        const where = yield* deviceSearchWhere(ctx.organization.id, filters);
        // Fetch one extra row so truncation is detected without a second count
        // query; the extra row is never written to the CSV.
        let rows: Array<typeof schema.device.$inferSelect>;

        if (filters.query) {
          const candidates = yield* db.select().from(schema.device).where(where);

          const matches = (yield* loadDeviceSnapshots(ctx.organization.id, candidates)).filter(
            (snapshot) =>
              evaluateDeviceQuery(
                filters.query,
                {
                  ...snapshot.row,
                  health: snapshot.health,
                  applications: snapshot.applications,
                },
                { now: now() },
              ),
          );

          const direction = filters.direction === "desc" ? -1 : 1;

          const sortValue = (snapshot: (typeof matches)[number]) => {
            switch (filters.sort) {
              case "lastSeenAt":
                return snapshot.row.lastSeenAt.getTime();
              case "enrolledAt":
                return snapshot.row.enrolledAt.getTime();
              case "status":
                return snapshot.row.status;
              default:
                return snapshot.row.name;
            }
          };

          matches.sort((left, right) => {
            const a = sortValue(left);
            const b = sortValue(right);

            const comparison =
              Schema.is(Schema.Number)(a) && Schema.is(Schema.Number)(b)
                ? a - b
                : String(a).localeCompare(String(b), undefined, { numeric: true });

            return comparison * direction || left.row.id.localeCompare(right.row.id);
          });
          rows = matches.slice(0, DEVICE_EXPORT_MAX_ROWS + 1).map((snapshot) => snapshot.row);
        } else {
          rows = yield* db
            .select()
            .from(schema.device)
            .where(where)
            .orderBy(...deviceOrder(filters))
            .limit(DEVICE_EXPORT_MAX_ROWS + 1);
        }

        const truncated = rows.length > DEVICE_EXPORT_MAX_ROWS;
        const exportedRows = truncated ? rows.slice(0, DEVICE_EXPORT_MAX_ROWS) : rows;

        const groups = yield* deviceGroupsFor(
          ctx.organization.id,
          exportedRows.map((row) => row.id),
        );

        const csv = toCsv(
          [
            "Name",
            "Serial",
            "Model",
            "Platform",
            "Status",
            "OS version",
            "OS build",
            "Last seen",
            "Enrolled at",
            "Asset tag",
            "Model number",
            "FileVault",
            "Battery health",
            "Capabilities",
            "Inventory updated",
            "Notes",
            "Groups",
          ],
          exportedRows.map((row) => [
            row.name,
            row.serial,
            row.model,
            platformLabel(row.proto),
            row.status,
            row.osVersion,
            row.osBuild,
            iso(row.lastSeenAt),
            iso(row.enrolledAt),
            row.assetTag,
            row.modelNumber,
            row.fileVaultEnabled === null || row.fileVaultEnabled === undefined
              ? ""
              : row.fileVaultEnabled
                ? "Enabled"
                : "Disabled",
            row.batteryHealth,
            capabilityText(
              Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(row.capabilities)),
            ),
            row.inventoryUpdatedAt ? iso(row.inventoryUpdatedAt) : "",
            row.notes,
            (groups.get(row.id) ?? []).map((group) => group.name).join("; "),
          ]),
        );

        return { csv, truncated, rowCount: exportedRows.length };
      }),
    getDevice: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const row = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });

        if (!row)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));

        const secrets = yield* db
          .select({
            kind: schema.deviceSecret.kind,
            format: schema.deviceSecret.format,
            updatedAt: schema.deviceSecret.updatedAt,
            rotatedAt: schema.deviceSecret.rotatedAt,
          })
          .from(schema.deviceSecret)
          .where(
            and(
              eq(schema.deviceSecret.deviceId, row.id),
              eq(schema.deviceSecret.organizationId, ctx.organization.id),
            ),
          );

        const recoveryKey = secrets.find((secret) => secret.kind === "filevault_recovery_key");
        const bootstrapToken = secrets.find((secret) => secret.kind === "bootstrap_token");

        const bypassCode = secrets.find((secret) => secret.kind === "activation_lock_bypass_code");

        const [apple] = yield* db
          .select({
            bootstrapTokenEscrowed: schema.deviceApple.bootstrapTokenEscrowed,
            declarationMode: schema.deviceApple.declarationMode,
            declarationModeReason: schema.deviceApple.declarationModeReason,
            declarationModeUpdatedAt: schema.deviceApple.declarationModeUpdatedAt,
            isActivationLockManageable: schema.deviceApple.isActivationLockManageable,
            securityInfoUpdatedAt: schema.deviceApple.securityInfoUpdatedAt,
          })
          .from(schema.deviceApple)
          .where(eq(schema.deviceApple.deviceId, row.id))
          .limit(1);

        const [autopilot] = yield* db
          .select()
          .from(schema.autopilotDevice)
          .where(
            and(
              eq(schema.autopilotDevice.organizationId, ctx.organization.id),
              row.serial
                ? or(
                    eq(schema.autopilotDevice.deviceId, row.id),
                    eq(schema.autopilotDevice.serial, normalizeAutopilotSerial(row.serial)),
                  )!
                : eq(schema.autopilotDevice.deviceId, row.id),
            ),
          )
          .limit(1);

        const [android] =
          row.proto === "android"
            ? yield* db
                .select()
                .from(schema.androidDevice)
                .where(
                  and(
                    eq(schema.androidDevice.deviceId, row.id),
                    eq(schema.androidDevice.organizationId, ctx.organization.id),
                  ),
                )
                .limit(1)
            : [];

        const groups = yield* deviceGroupsFor(ctx.organization.id, [row.id]);

        // Presence metadata only — the sealed value never leaves the backend.
        return {
          ...rowDevice(row),
          groups: groups.get(row.id) ?? [],
          recoveryKeyEscrowed: Boolean(recoveryKey),
          bootstrapTokenEscrowed: apple?.bootstrapTokenEscrowed ?? Boolean(bootstrapToken),
          recoveryKeyUpdatedAt: recoveryKey ? iso(recoveryKey.updatedAt) : null,
          recoveryKeyRotatedAt: recoveryKey?.rotatedAt ? iso(recoveryKey.rotatedAt) : null,
          recoveryKeyFormat: recoveryKey?.format ?? null,
          bootstrapTokenUpdatedAt: bootstrapToken ? iso(bootstrapToken.updatedAt) : null,
          activationLockBypassCodeEscrowed: Boolean(bypassCode),
          isActivationLockManageable: apple?.isActivationLockManageable ?? null,
          declarationMode: apple?.declarationMode ?? null,
          declarationModeReason: apple?.declarationModeReason ?? null,
          declarationModeUpdatedAt: apple?.declarationModeUpdatedAt
            ? iso(apple.declarationModeUpdatedAt)
            : null,
          securityInfoUpdatedAt: apple?.securityInfoUpdatedAt
            ? iso(apple.securityInfoUpdatedAt)
            : null,
          securityInfoStale: securityInfoIsStale(apple?.securityInfoUpdatedAt ?? null, now()),
          android: android ? rowAndroidDevice(android) : null,
          autopilot: autopilot ? autopilotDeviceInfo(autopilot) : null,
        };
      }),
    listDeviceApplications: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });

        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));

        const applications = yield* db
          .select()
          .from(schema.deviceApplication)
          .where(
            and(
              eq(schema.deviceApplication.deviceId, device.id),
              eq(schema.deviceApplication.organizationId, ctx.organization.id),
            ),
          );

        return {
          applications: applications
            .map(rowDeviceApplication)
            .sort((left, right) =>
              (left.name ?? left.bundleId).localeCompare(right.name ?? right.bundleId),
            ),
        };
      }),
    getDeviceRecoveryKey: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        // Reading a recovery key is a privileged action: the same role check as
        // writes (owner/admin) applies, every reveal is audited, and a fresh
        // step-up is required.
        const ctx = yield* requireTenant(request, tenantId, "write");

        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });

        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
        yield* requireStepUp(auth, request, "recovery-key-reveal");

        if (!authSecret)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Recovery key escrow is not configured on this deployment",
            }),
          );

        const [secret] = yield* db
          .select()
          .from(schema.deviceSecret)
          .where(
            and(
              eq(schema.deviceSecret.deviceId, device.id),
              eq(schema.deviceSecret.organizationId, ctx.organization.id),
              eq(schema.deviceSecret.kind, "filevault_recovery_key"),
            ),
          )
          .limit(1);

        if (!secret)
          return yield* Effect.fail(
            new EnterpriseNotFound({
              message: "No FileVault recovery key has been escrowed for this device",
            }),
          );

        // CMS-wrapped keys are unwrapped with the tenant escrow private key, so
        // the operator receives a key they can type into Recovery Assistant
        // rather than the ciphertext the device returned.
        const recoveryKey = yield* revealRecoveryKey({
          db,
          organizationId: ctx.organization.id,
          sealedValue: secret.sealedValue,
          format: secret.format,
          authSecret,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new EnterpriseBadRequest({
                message:
                  cause instanceof EscrowKeyError
                    ? cause.message
                    : "The escrowed recovery key could not be decrypted",
              }),
          ),
        );

        yield* audit(ctx, "device.recovery_key_viewed", "device", device.id, {
          kind: "filevault_recovery_key",
        });

        return {
          recoveryKey,
          updatedAt: iso(secret.updatedAt),
          rotatedAt: secret.rotatedAt ? iso(secret.rotatedAt) : null,
        };
      }),
    getDeviceActivationLockBypassCode: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        // Same privilege class as the recovery key: the bypass code disables
        // Activation Lock, so it is restricted to owners/admins, requires a
        // fresh step-up and every reveal is audited.
        const ctx = yield* requireTenant(request, tenantId, "write");

        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });

        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
        yield* requireStepUp(auth, request, "recovery-key-reveal");

        if (!authSecret)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Secret escrow is not configured on this deployment",
            }),
          );

        const [secret] = yield* db
          .select()
          .from(schema.deviceSecret)
          .where(
            and(
              eq(schema.deviceSecret.deviceId, device.id),
              eq(schema.deviceSecret.organizationId, ctx.organization.id),
              eq(schema.deviceSecret.kind, "activation_lock_bypass_code"),
            ),
          )
          .limit(1);

        if (!secret)
          return yield* Effect.fail(
            new EnterpriseNotFound({
              message:
                "No Activation Lock bypass code has been collected for this device. Apple only returns one before Activation Lock is enabled, so collect it while the device is still under management.",
            }),
          );

        const bypassCode = yield* Effect.tryPromise({
          try: () => openSecret(authSecret, secret.sealedValue),
          catch: () =>
            new EnterpriseBadRequest({
              message: "The escrowed Activation Lock bypass code could not be decrypted",
            }),
        });

        const [apple] = yield* db
          .select({ isActivationLockManageable: schema.deviceApple.isActivationLockManageable })
          .from(schema.deviceApple)
          .where(eq(schema.deviceApple.deviceId, device.id))
          .limit(1);

        yield* audit(ctx, "device.activation_lock_bypass_code_viewed", "device", device.id, {
          kind: "activation_lock_bypass_code",
        });

        return {
          bypassCode,
          updatedAt: iso(secret.updatedAt),
          rotatedAt: secret.rotatedAt ? iso(secret.rotatedAt) : null,
          isActivationLockManageable: apple?.isActivationLockManageable ?? null,
        };
      }),
    getAppleFdeEscrowKey: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const row = yield* loadTenantEscrowKey(db, ctx.organization.id).pipe(
          Effect.mapError(
            () => new EnterpriseInternal({ message: "Could not read the escrow key" }),
          ),
        );

        return escrowKeyInfo(row);
      }),
    generateAppleFdeEscrowKey: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        if (!authSecret)
          return yield* Effect.fail(
            new EnterpriseNotConfigured({
              message: "FileVault escrow requires AUTH_SECRET to seal the private key",
            }),
          );

        // Idempotent: regenerating would silently invalidate every key already
        // escrowed for the old certificate. Replacing a key is an explicit
        // upload of a new pair.
        const existing = yield* loadTenantEscrowKey(db, ctx.organization.id).pipe(
          Effect.mapError(
            () => new EnterpriseInternal({ message: "Could not read the escrow key" }),
          ),
        );

        if (existing) return escrowKeyInfo(existing);

        const row = yield* generateTenantEscrowKey({
          db,
          organizationId: ctx.organization.id,
          organizationName: ctx.organization.name,
          authSecret,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new EnterpriseInternal({
                message:
                  cause instanceof EscrowKeyError
                    ? cause.message
                    : "The FileVault escrow key could not be generated",
              }),
          ),
        );

        yield* audit(
          ctx,
          "tenant.apple_filevault_escrow_key_generated",
          "tenant",
          ctx.organization.id,
          {
            fingerprintSha256: row.certificateFingerprintSha256,
          },
        );

        return escrowKeyInfo(row);
      }),
    uploadAppleFdeEscrowKey: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        if (!authSecret)
          return yield* Effect.fail(
            new EnterpriseNotConfigured({
              message: "FileVault escrow requires AUTH_SECRET to seal the private key",
            }),
          );

        const row = yield* uploadTenantEscrowKey({
          db,
          organizationId: ctx.organization.id,
          certificatePem: payload.certificatePem,
          privateKeyPem: payload.privateKeyPem,
          authSecret,
        }).pipe(
          Effect.mapError(
            (cause) =>
              new EnterpriseBadRequest({
                message:
                  cause instanceof EscrowKeyError
                    ? cause.message
                    : "The FileVault escrow key could not be stored",
              }),
          ),
        );

        yield* audit(
          ctx,
          "tenant.apple_filevault_escrow_key_uploaded",
          "tenant",
          ctx.organization.id,
          {
            fingerprintSha256: row.certificateFingerprintSha256,
          },
        );

        return escrowKeyInfo(row);
      }),
    getApplicationInventory: (request, tenantId, query) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const filters: {
          q?: string;
          managed?: string;
          updates?: string;
          limit?: number;
          offset?: number;
        } = query ?? {};

        const term = filters.q?.trim().toLowerCase() ?? "";

        let managed: boolean | undefined;

        if (filters.managed === "managed") managed = true;
        else if (filters.managed === "unmanaged") managed = false;

        const updatesOnly = filters.updates === "available";
        const limit = Math.min(Math.max(Math.trunc(Number(filters.limit ?? 100)) || 100, 1), 500);
        const offset = Math.max(Math.trunc(Number(filters.offset ?? 0)) || 0, 0);

        const rows = yield* db
          .select()
          .from(schema.deviceApplication)
          .where(eq(schema.deviceApplication.organizationId, ctx.organization.id));

        type InventoryGroup = {
          bundleId: string;
          name: string | null;
          version: string | null;
          shortVersion: string | null;
          publisher: string | null;
          bundleSize: number | null;
          dynamicSize: number | null;
          hasUpdateAvailable: boolean;
          isManaged: boolean;
          lastReportedAt: Date;
          devices: Set<string>;
        };

        const groups = new Map<string, InventoryGroup>();

        for (const row of rows) {
          const group = groups.get(row.bundleId) ?? {
            bundleId: row.bundleId,
            name: row.name,
            version: row.version,
            shortVersion: row.shortVersion,
            publisher: row.publisher,
            bundleSize: row.bundleSize,
            dynamicSize: row.dynamicSize,
            hasUpdateAvailable: false,
            isManaged: false,
            lastReportedAt: row.lastReportedAt,
            devices: new Set<string>(),
          };

          group.name ??= row.name;
          group.version ??= row.version;
          group.shortVersion ??= row.shortVersion;
          group.publisher ??= row.publisher;
          group.bundleSize ??= row.bundleSize;
          group.dynamicSize ??= row.dynamicSize;
          group.hasUpdateAvailable ||= row.hasUpdateAvailable;
          group.isManaged ||= row.isManaged;

          if (row.lastReportedAt > group.lastReportedAt) group.lastReportedAt = row.lastReportedAt;
          group.devices.add(row.deviceId);
          groups.set(row.bundleId, group);
        }

        const matches = [...groups.values()]
          .filter((group) => {
            if (term) {
              const haystack = `${group.name ?? ""} ${group.bundleId}`.toLowerCase();

              if (!haystack.includes(term)) return false;
            }

            if (managed !== undefined && group.isManaged !== managed) return false;

            if (updatesOnly && !group.hasUpdateAvailable) return false;

            return true;
          })
          .sort((left, right) =>
            (left.name ?? left.bundleId).localeCompare(right.name ?? right.bundleId),
          );

        return {
          total: matches.length,
          applications: matches.slice(offset, offset + limit).map((group) => ({
            id: group.bundleId,
            bundleId: group.bundleId,
            name: group.name,
            version: group.version,
            shortVersion: group.shortVersion,
            publisher: group.publisher,
            bundleSize: group.bundleSize,
            dynamicSize: group.dynamicSize,
            hasUpdateAvailable: group.hasUpdateAvailable,
            isManaged: group.isManaged,
            lastReportedAt: iso(group.lastReportedAt),
            deviceCount: group.devices.size,
          })),
        };
      }),
    getDeviceEffectivePolicy: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const row = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });

        if (!row)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));

        return yield* resolveEffectivePolicyForDevice(db, {
          id: row.id,
          organizationId: ctx.organization.id,
        });
      }),
    listGroups: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const rows = yield* db
          .select()
          .from(schema.enterpriseGroup)
          .where(eq(schema.enterpriseGroup.organizationId, ctx.organization.id));

        const ids = rows.map((row) => row.id);

        const [deviceCounts, policyCounts] = ids.length
          ? yield* Effect.all([
              db
                .select({ groupId: schema.groupDevice.groupId, value: count() })
                .from(schema.groupDevice)
                .where(inArray(schema.groupDevice.groupId, ids))
                .groupBy(schema.groupDevice.groupId),
              db
                .select({ groupId: schema.groupPolicy.groupId, value: count() })
                .from(schema.groupPolicy)
                .where(inArray(schema.groupPolicy.groupId, ids))
                .groupBy(schema.groupPolicy.groupId),
            ])
          : [[], []];

        const deviceMap = new Map(deviceCounts.map((row) => [row.groupId, row.value]));
        const policyMap = new Map(policyCounts.map((row) => [row.groupId, row.value]));

        return {
          rows: rows.map((row: EnterpriseGroup) =>
            rowGroup(
              row,
              (row.kind ?? "manual") === "dynamic" ? -1 : (deviceMap.get(row.id) ?? 0),
              policyMap.get(row.id) ?? 0,
            ),
          ),
        };
      }),
    getGroup: (request, tenantId, groupId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const row = yield* db.query.enterpriseGroup.findFirst({
          where: { id: groupId, organizationId: ctx.organization.id },
        });

        if (!row) return yield* Effect.fail(new EnterpriseNotFound({ message: "Group not found" }));

        const deviceLinks = yield* db
          .select({ deviceId: schema.groupDevice.deviceId })
          .from(schema.groupDevice)
          .where(eq(schema.groupDevice.groupId, groupId));

        const devices = deviceLinks.length
          ? yield* db
              .select({ id: schema.device.id, name: schema.device.name })
              .from(schema.device)
              .where(
                and(
                  eq(schema.device.organizationId, ctx.organization.id),
                  inArray(
                    schema.device.id,
                    deviceLinks.map((link) => link.deviceId),
                  ),
                ),
              )
          : [];

        const policyLinks = yield* db
          .select({ policyId: schema.groupPolicy.policyId, mode: schema.groupPolicy.mode })
          .from(schema.groupPolicy)
          .where(eq(schema.groupPolicy.groupId, groupId));

        const policies = policyLinks.length
          ? yield* db
              .select({
                id: schema.policy.id,
                name: schema.policy.name,
                priority: schema.policy.priority,
              })
              .from(schema.policy)
              .where(
                and(
                  eq(schema.policy.organizationId, ctx.organization.id),
                  inArray(
                    schema.policy.id,
                    policyLinks.map((link) => link.policyId),
                  ),
                ),
              )
          : [];

        const modes = new Map(
          policyLinks.map((link) => [link.policyId, link.mode ?? ("include" as const)]),
        );

        return {
          ...rowGroup(row, devices.length, policies.length),
          devices: [...devices].sort((left, right) => left.name.localeCompare(right.name)),
          policies: policies
            .map((policy) => ({
              ...policy,
              priority: policy.priority ?? 0,
              mode: modes.get(policy.id) ?? "include",
            }))
            .sort((left, right) => left.name.localeCompare(right.name)),
        };
      }),
    previewGroup: (request, tenantId, groupId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const preview = yield* previewDynamicGroup(db, ctx.organization.id, groupId, {
          now: now(),
        });

        if (!preview)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Group not found" }));

        return {
          groupId: preview.groupId,
          kind: preview.kind,
          count: preview.count,
          devices: [...preview.devices],
          evaluatedAt: iso(preview.evaluatedAt),
        };
      }),
    listPolicies: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const rows = yield* db
          .select()
          .from(schema.policy)
          .where(eq(schema.policy.organizationId, ctx.organization.id));

        return { rows: yield* Effect.all(rows.map((row: EnterprisePolicy) => rowPolicy(row))) };
      }),
    getPolicy: (request, tenantId, policyId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const row = yield* db.query.policy.findFirst({
          where: { id: policyId, organizationId: ctx.organization.id },
        });

        if (!row)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Policy not found" }));

        return yield* rowPolicy(row, true);
      }),
    billing: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        return yield* billingSummary(ctx.organization.id, ctx.user.id);
      }),
    billingPortal: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* requireStepUp(auth, request, "billing-portal");

        if (!stripe) return yield* Effect.fail(billingNotConfigured());
        const body: { returnUrl: string } = payload;
        const customer = yield* ensureStripeCustomer(ctx.organization);

        const result = yield* stripe.billingPortal.sessions
          .create({
            customer,
            return_url: body.returnUrl,
          })
          .pipe(Effect.mapError(() => billingUnavailable()));

        return { url: result.url ?? body.returnUrl };
      }),
    requestEmailVerification: (request) =>
      auth.requestEmailVerification(webRequestFromRequest(request, origin)),
    verifyEmail: (request, payload) =>
      auth.verifyEmail(webRequestFromRequest(request, origin), payload),
    requestEmailChange: (request, payload) =>
      auth.requestEmailChange(webRequestFromRequest(request, origin), payload),
    verifyEmailChange: (_request, payload) => auth.verifyEmailChange(payload),
    listApiTokens: (request) => auth.listApiTokens(webRequestFromRequest(request, origin)),
    listMcpConnections: (request) =>
      auth.listMcpConnections(webRequestFromRequest(request, origin)),
    revokeMcpConnection: (request, connectionId) =>
      auth.revokeMcpConnection(webRequestFromRequest(request, origin), connectionId),
    recordMcpActivity: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const body: {
          tool?: string;
          method?: string;
          path?: string;
          status?: number;
        } = payload;

        yield* audit(ctx, "mcp.tool_called", "mcp", null, {
          tool: body.tool ?? null,
          method: body.method ?? null,
          path: body.path ?? null,
          status: body.status ?? null,
        });

        return ok;
      }),
    createApiToken: (request, payload) =>
      auth.createApiToken(webRequestFromRequest(request, origin), payload),
    revokeApiToken: (request, tokenId) =>
      auth.revokeApiToken(webRequestFromRequest(request, origin), tokenId),
    /**
     * Remove one of the caller's passkeys. The library's own removal path
     * refuses when the account's current sign-in requirement is MFA and the
     * passkey is the only MFA factor, even though removing it flips the account
     * back to single-factor. This owner applies the same safe outcome directly:
     * deactivate the credential and its shared factor, bump the security
     * revision (invalidating sessions) and let the trigger recompute
     * `passkey_enabled`. A step-up grant is required first.
     */
    removeAccountPasskey: (request, credentialId) =>
      Effect.gen(function* () {
        const { user } = yield* requireStepUp(auth, request, "passkey-remove");

        const credential = yield* db
          .select({ credentialId: schema.authPasskeyCredentials.credentialId })
          .from(schema.authPasskeyCredentials)
          .where(
            and(
              eq(schema.authPasskeyCredentials.credentialId, credentialId),
              eq(schema.authPasskeyCredentials.subjectId, user.id),
              eq(schema.authPasskeyCredentials.active, true),
            ),
          )
          .limit(1);

        if (credential.length === 0)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Passkey not found" }));

        // Passkeys are the only sign-in method, so removing the last one would
        // make the account unreachable.
        const otherPasskey = yield* db
          .select({ credentialId: schema.authPasskeyCredentials.credentialId })
          .from(schema.authPasskeyCredentials)
          .where(
            and(
              eq(schema.authPasskeyCredentials.subjectId, user.id),
              eq(schema.authPasskeyCredentials.active, true),
              ne(schema.authPasskeyCredentials.credentialId, credentialId),
            ),
          )
          .limit(1);

        if (otherPasskey.length === 0)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Add another passkey before removing this one.",
            }),
          );

        const revision = id();
        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .update(schema.authPasskeyCredentials)
              .set({ active: false, credentialRevision: revision })
              .where(
                and(
                  eq(schema.authPasskeyCredentials.subjectId, user.id),
                  eq(schema.authPasskeyCredentials.credentialId, credentialId),
                  eq(schema.authPasskeyCredentials.active, true),
                ),
              );
            yield* tx
              .update(schema.authCredentials)
              .set({ active: false, revision })
              .where(
                and(
                  eq(schema.authCredentials.credentialId, credentialId),
                  eq(schema.authCredentials.subjectId, user.id),
                ),
              );
            // A revision change makes every outstanding session stale.
            yield* tx
              .update(schema.user)
              .set({
                authRevision: revision,
                passkeyEnabled: otherPasskey.length > 0,
                updatedAt: now(),
              })
              .where(eq(schema.user.id, user.id));
          }),
        );

        yield* recordAccountAudit(db, {
          subjectUserId: user.id,
          subjectEmail: user.email,
          action: ACCOUNT_AUDIT.passkeyRemoved,
          targetType: "passkey",
          targetId: credentialId,
        }).pipe(Effect.catchCause(() => Effect.void));

        return ok;
      }),
    stepUpMethods: (request) => auth.stepUpMethods(webRequestFromRequest(request, origin)),
    stepUpTotp: (request, payload) =>
      auth.stepUpTotp(webRequestFromRequest(request, origin), payload),
    beginStepUpPasskey: (request, payload) =>
      auth.beginStepUpPasskey(webRequestFromRequest(request, origin), payload),
    completeStepUpPasskey: (request, payload) =>
      auth.completeStepUpPasskey(webRequestFromRequest(request, origin), payload),
  } satisfies Record<string, (...args: Array<Dynamic>) => Effect.Effect<Dynamic, Dynamic, Dynamic>>;

  return wrapServiceErrors(service, true, analytics);
};

export const enterpriseHandlers = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof enterpriseApi>,
) =>
  handlers
    .handle("requestEmailVerification", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.requestEmailVerification(request)),
    )
    .handle("verifyEmail", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.verifyEmail(request, payload)),
    )
    .handle("requestEmailChange", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.requestEmailChange(request, payload)),
    )
    .handle("verifyEmailChange", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.verifyEmailChange(request, payload)),
    )
    .handle("listApiTokens", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.listApiTokens(request)),
    )
    .handle("listMcpConnections", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.listMcpConnections(request)),
    )
    .handle("revokeMcpConnection", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.revokeMcpConnection(request, params.connectionId),
      ),
    )
    .handle("recordMcpActivity", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.recordMcpActivity(request, params.tenantId, payload),
      ),
    )
    .handle("createApiToken", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.createApiToken(request, payload)),
    )
    .handle("revokeApiToken", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.revokeApiToken(request, params.tokenId),
      ),
    )
    .handle("removeAccountPasskey", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.removeAccountPasskey(request, params.credentialId),
      ),
    )
    .handle("stepUpMethods", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.stepUpMethods(request)),
    )
    .handle("stepUpTotp", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.stepUpTotp(request, payload)),
    )
    .handle("beginStepUpPasskey", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.beginStepUpPasskey(request, payload)),
    )
    .handle("completeStepUpPasskey", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.completeStepUpPasskey(request, payload),
      ),
    )
    .handle("listAccountSessions", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.listAccountSessions(request)),
    )
    .handle("revokeAccountSession", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.revokeAccountSession(request, params.sessionId),
      ),
    )
    .handle("revokeAllAccountSessions", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.revokeAllAccountSessions(request)),
    )
    .handle("searchAccountAuditLog", ({ request, query }) =>
      Effect.flatMap(EnterpriseService, (service) => service.searchAccountAuditLog(request, query)),
    )
    .handleRaw("exportAccountAuditLog", ({ request, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        Effect.map(
          service.exportAccountAuditLog(request, query),
          (result: {
            format: "csv" | "json";
            body: string;
            truncated: boolean;
            rowCount: number;
          }) =>
            HttpServerResponse.text(result.body, {
              contentType:
                result.format === "json"
                  ? "application/json; charset=utf-8"
                  : "text/csv; charset=utf-8",
              headers: exportHeaders(
                `account-activity-${new Date().toISOString().slice(0, 10)}.${result.format}`,
                result,
              ),
            }),
        ),
      ),
    )
    .handle("requestAccountRecovery", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.requestAccountRecovery(request, payload),
      ),
    )
    .handle("verifyAccountRecovery", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.verifyAccountRecovery(request, payload),
      ),
    )
    .handle("cancelEmailChange", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.cancelEmailChange(request, payload)),
    )
    .handle("me", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.me(request)),
    )
    .handle("bootstrap", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.bootstrap(request)),
    )
    .handle("updateMe", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.updateMe(request, payload)),
    )
    .handle("deleteMe", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.deleteMe(request)),
    )
    .handle("listTenants", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.listTenants(request)),
    )
    .handle("createTenant", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.createTenant(request, payload)),
    )
    .handle("importTenant", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.importTenant(request, payload)),
    )
    .handle("getTenant", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) => service.getTenant(request, params.tenantId)),
    )
    .handleRaw("exportTenant", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        Effect.map(
          service.exportTenant(request, params.tenantId, query),
          (result: { body: string; filename: string; version: number }) =>
            HttpServerResponse.text(result.body, {
              contentType: "application/json; charset=utf-8",
              headers: {
                "Content-Disposition": `attachment; filename="${result.filename}"`,
                "Cache-Control": "no-store",
                "X-Tenant-Export-Version": String(result.version),
              },
            }),
        ),
      ),
    )
    .handle("runTenantBackup", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.runTenantBackup(request, params.tenantId),
      ),
    )
    .handle("listTenantBackups", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listTenantBackups(request, params.tenantId),
      ),
    )
    .handleRaw("downloadTenantBackup", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        Effect.map(
          service.downloadTenantBackup(request, params.tenantId, params.id),
          (result: { content: string; filename: string }) =>
            HttpServerResponse.text(result.content, {
              contentType: "application/json; charset=utf-8",
              headers: {
                "Content-Disposition": `attachment; filename="${result.filename}"`,
                "Cache-Control": "no-store",
              },
            }),
        ),
      ),
    )
    .handle("pinTenantBackup", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.pinTenantBackup(request, params.tenantId, params.id),
      ),
    )
    .handle("unpinTenantBackup", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.unpinTenantBackup(request, params.tenantId, params.id),
      ),
    )
    .handle("deleteTenantBackup", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteTenantBackup(request, params.tenantId, params.id),
      ),
    )
    .handle("restoreTenantBackup", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.restoreTenantBackup(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("patchTenant", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchTenant(request, params.tenantId, payload),
      ),
    )
    .handle("deleteTenant", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteTenant(request, params.tenantId),
      ),
    )
    .handle("getEntraDirectorySync", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getEntraDirectorySync(request, params.tenantId),
      ),
    )
    .handle("patchEntraDirectorySync", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchEntraDirectorySync(request, params.tenantId, payload),
      ),
    )
    .handle("syncEntraDirectory", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.syncEntraDirectory(request, params.tenantId),
      ),
    )
    .handle("listEntraDomains", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listEntraDomains(request, params.tenantId),
      ),
    )
    .handle("refreshEntraDomains", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.refreshEntraDomains(request, params.tenantId),
      ),
    )
    .handle("getAutopilotSettings", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getAutopilotSettings(request, params.tenantId),
      ),
    )
    .handle("listAutopilotDevices", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listAutopilotDevices(request, params.tenantId),
      ),
    )
    .handle("importAutopilotDevices", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.importAutopilotDevices(request, params.tenantId, payload),
      ),
    )
    .handle("syncAutopilotDevices", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.syncAutopilotDevices(request, params.tenantId),
      ),
    )
    .handle("deleteAutopilotDevice", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteAutopilotDevice(request, params.tenantId, params.serial),
      ),
    )
    .handle("listAutopilotProfiles", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listAutopilotProfiles(request, params.tenantId),
      ),
    )
    .handle("createAutopilotProfile", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.createAutopilotProfile(request, params.tenantId, payload),
      ),
    )
    .handle("updateAutopilotProfile", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.updateAutopilotProfile(request, params.tenantId, params.profileId, payload),
      ),
    )
    .handle("assignAutopilotProfile", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.assignAutopilotProfile(request, params.tenantId, params.profileId, payload),
      ),
    )
    .handle("getTenantSecurity", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getTenantSecurity(request, params.tenantId),
      ),
    )
    .handle("patchTenantSecurity", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchTenantSecurity(request, params.tenantId, payload),
      ),
    )
    .handle("approveAccountRecovery", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.approveAccountRecovery(request, params.tenantId, payload),
      ),
    )
    .handle("getSsoConfig", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getSsoConfig(request, params.tenantId),
      ),
    )
    .handle("patchSsoConfig", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchSsoConfig(request, params.tenantId, payload),
      ),
    )
    .handle("listScimTokens", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listScimTokens(request, params.tenantId),
      ),
    )
    .handle("createScimToken", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.createScimToken(request, params.tenantId, payload),
      ),
    )
    .handle("revokeScimToken", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.revokeScimToken(request, params.tenantId, params.tokenId),
      ),
    )
    .handle("listWebhookEndpoints", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listWebhookEndpoints(request, params.tenantId),
      ),
    )
    .handle("createWebhookEndpoint", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.createWebhookEndpoint(request, params.tenantId, payload),
      ),
    )
    .handle("patchWebhookEndpoint", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchWebhookEndpoint(request, params.tenantId, params.webhookId, payload),
      ),
    )
    .handle("deleteWebhookEndpoint", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteWebhookEndpoint(request, params.tenantId, params.webhookId),
      ),
    )
    .handle("rotateWebhookSecret", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.rotateWebhookSecret(request, params.tenantId, params.webhookId),
      ),
    )
    .handle("testWebhookEndpoint", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.testWebhookEndpoint(request, params.tenantId, params.webhookId),
      ),
    )
    .handle("listAuditLog", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listAuditLog(request, params.tenantId),
      ),
    )
    .handle("searchAuditLog", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.searchAuditLog(request, params.tenantId, query),
      ),
    )
    .handleRaw("exportAuditLog", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        Effect.map(
          service.exportAuditLog(request, params.tenantId, query),
          (result: {
            format: "csv" | "json";
            body: string;
            truncated: boolean;
            rowCount: number;
          }) => {
            const extension = result.format;

            return HttpServerResponse.text(result.body, {
              contentType:
                result.format === "json"
                  ? "application/json; charset=utf-8"
                  : "text/csv; charset=utf-8",
              headers: exportHeaders(
                `audit-log-${new Date().toISOString().slice(0, 10)}.${extension}`,
                result,
              ),
            });
          },
        ),
      ),
    )
    .handle("listTenantRoles", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listTenantRoles(request, params.tenantId),
      ),
    )
    .handle("createTenantRole", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.createTenantRole(request, params.tenantId, payload),
      ),
    )
    .handle("patchTenantRole", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchTenantRole(request, params.tenantId, params.roleId, payload),
      ),
    )
    .handle("deleteTenantRole", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteTenantRole(request, params.tenantId, params.roleId),
      ),
    )
    .handle("listTenantUsers", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listTenantUsers(request, params.tenantId),
      ),
    )
    .handle("inviteTenantUser", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.inviteTenantUser(request, params.tenantId, payload),
      ),
    )
    .handle("acceptInvitation", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.acceptInvitation(request, payload)),
    )
    .handle("previewInvitation", ({ request, query }) =>
      Effect.flatMap(EnterpriseService, (service) => service.previewInvitation(request, query)),
    )
    .handle("listTenantInvitations", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listTenantInvitations(request, params.tenantId, query),
      ),
    )
    .handle("getTenantInvitationOptions", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getTenantInvitationOptions(request, params.tenantId),
      ),
    )
    .handle("resendTenantInvitation", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.resendTenantInvitation(request, params.tenantId, params.invitationId),
      ),
    )
    .handle("cancelTenantInvitation", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.cancelTenantInvitation(request, params.tenantId, params.invitationId),
      ),
    )
    .handle("patchTenantUser", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchTenantUser(request, params.tenantId, params.memberId, payload),
      ),
    )
    .handle("removeTenantUser", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.removeTenantUser(request, params.tenantId, params.memberId),
      ),
    )
    .handle("getEnrollment", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) => {
        const headers = Object.fromEntries(headersFromRequest(request));
        const forwarded = headers["x-forwarded-for"]?.split(",")[0]?.trim();

        return service.getEnrollment(params.id, query.code, {
          platform: query.platform,
          ip: headers["cf-connecting-ip"] ?? forwarded,
          userAgent: headers["user-agent"],
        });
      }),
    )
    .handleRaw("getAppleEnrollmentProfile", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) => {
        const headers = Object.fromEntries(headersFromRequest(request));
        const forwarded = headers["x-forwarded-for"]?.split(",")[0]?.trim();

        return Effect.map(
          service.getAppleEnrollmentProfile(params.id, query.code, {
            platform: query.platform ?? "apple",
            ip: headers["cf-connecting-ip"] ?? forwarded,
            userAgent: headers["user-agent"],
          }),
          (result: { profile: Uint8Array; filename: string }) =>
            appleEnrollmentProfileResponse(result),
        );
      }),
    )
    .handleRaw("getAdeEnrollmentProfile", ({ params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        Effect.map(service.getAdeEnrollmentProfile(params.token), (result) =>
          appleEnrollmentProfileResponse(result),
        ),
      ),
    )
    .handle("getTenantScepCa", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getTenantScepCa(request, params.tenantId),
      ),
    )
    .handle("rotateTenantScepCa", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.rotateTenantScepCa(request, params.tenantId),
      ),
    )
    .handle("importTenantScepCa", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.importTenantScepCa(request, params.tenantId, payload),
      ),
    )
    .handle("getTenantEnrollment", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getTenantEnrollment(request, params.tenantId),
      ),
    )
    .handle("listEnrollmentAttempts", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listEnrollmentAttempts(request, params.tenantId, query),
      ),
    )
    .handle("patchTenantEnrollment", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchTenantEnrollment(request, params.tenantId, payload),
      ),
    )
    .handle("resetTenantEnrollment", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.resetTenantEnrollment(request, params.tenantId),
      ),
    )
    .handle("getApns", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) => service.getApns(request, params.tenantId)),
    )
    .handle("getApnsCsr", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) => service.getApnsCsr(request, params.tenantId)),
    )
    .handle("uploadApns", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.uploadApns(request, params.tenantId, payload),
      ),
    )
    .handle("getTenantAndroid", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getTenantAndroid(request, params.tenantId),
      ),
    )
    .handle("patchTenantAndroid", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchTenantAndroid(request, params.tenantId, payload),
      ),
    )
    .handle("createAndroidSignup", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.createAndroidSignup(request, params.tenantId),
      ),
    )
    .handle("syncTenantAndroid", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.syncTenantAndroid(request, params.tenantId),
      ),
    )
    .handle("getAppleFdeEscrowKey", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getAppleFdeEscrowKey(request, params.tenantId),
      ),
    )
    .handle("generateAppleFdeEscrowKey", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.generateAppleFdeEscrowKey(request, params.tenantId),
      ),
    )
    .handle("uploadAppleFdeEscrowKey", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.uploadAppleFdeEscrowKey(request, params.tenantId, payload),
      ),
    )
    .handle("getAppleBusinessManager", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getAppleBusinessManager(request, params.tenantId),
      ),
    )
    .handle("uploadAppleBusinessManagerToken", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.uploadAppleBusinessManagerToken(request, params.tenantId, payload),
      ),
    )
    .handle("deleteAppleBusinessManagerToken", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteAppleBusinessManagerToken(request, params.tenantId),
      ),
    )
    .handle("syncAppleBusinessManager", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.syncAppleBusinessManager(request, params.tenantId),
      ),
    )
    .handle("listAbmDevices", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listAbmDevices(request, params.tenantId),
      ),
    )
    .handle("getAbmDevice", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getAbmDevice(request, params.tenantId, params.serial),
      ),
    )
    .handle("assignAppleBusinessManagerDevice", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.assignAppleBusinessManagerDevice(request, params.tenantId, params.serial),
      ),
    )
    .handle("getAbmDeviceProfileUrl", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getAbmDeviceProfileUrl(request, params.tenantId, params.serial),
      ),
    )
    .handle("getVpp", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) => service.getVpp(request, params.tenantId)),
    )
    .handle("uploadVppToken", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.uploadVppToken(request, params.tenantId, payload),
      ),
    )
    .handle("deleteVppToken", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteVppToken(request, params.tenantId),
      ),
    )
    .handle("syncVpp", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) => service.syncVpp(request, params.tenantId)),
    )
    .handle("listVppAssets", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listVppAssets(request, params.tenantId),
      ),
    )
    .handle("listVppAssignments", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listVppAssignments(request, params.tenantId),
      ),
    )
    .handle("installVppAsset", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.installVppAsset(request, params.tenantId, params.adamId, payload),
      ),
    )
    .handle("releaseVppAsset", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.releaseVppAsset(request, params.tenantId, params.adamId, payload),
      ),
    )
    .handle("search", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.search(request, params.tenantId, query),
      ),
    )
    .handle("listDevices", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) => service.listDevices(request, params.tenantId)),
    )
    .handle("searchDevices", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.searchDevices(request, params.tenantId, query),
      ),
    )
    .handle("listDashboards", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listDashboards(request, params.tenantId),
      ),
    )
    .handle("createDashboard", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.createDashboard(request, params.tenantId, payload),
      ),
    )
    .handle("getDashboard", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getDashboard(request, params.tenantId, params.dashboardId),
      ),
    )
    .handle("patchDashboard", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchDashboard(request, params.tenantId, params.dashboardId, payload),
      ),
    )
    .handle("deleteDashboard", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteDashboard(request, params.tenantId, params.dashboardId),
      ),
    )
    .handle("createDashboardWidget", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.createDashboardWidget(request, params.tenantId, params.dashboardId, payload),
      ),
    )
    .handle("patchDashboardWidget", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchDashboardWidget(
          request,
          params.tenantId,
          params.dashboardId,
          params.widgetId,
          payload,
        ),
      ),
    )
    .handle("deleteDashboardWidget", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteDashboardWidget(
          request,
          params.tenantId,
          params.dashboardId,
          params.widgetId,
        ),
      ),
    )
    .handle("patchDashboardLayout", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchDashboardLayout(request, params.tenantId, params.dashboardId, payload),
      ),
    )
    .handle("queryDashboard", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.queryDashboard(request, params.tenantId, payload),
      ),
    )
    .handleRaw("exportDevices", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        Effect.map(
          service.exportDevices(request, params.tenantId, query),
          (result: { csv: string; truncated: boolean; rowCount: number }) =>
            HttpServerResponse.text(result.csv, {
              contentType: "text/csv; charset=utf-8",
              headers: exportHeaders(
                `devices-${new Date().toISOString().slice(0, 10)}.csv`,
                result,
              ),
            }),
        ),
      ),
    )
    .handle("getDevice", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getDevice(request, params.tenantId, params.id),
      ),
    )
    .handle("listDeviceApplications", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listDeviceApplications(request, params.tenantId, params.id),
      ),
    )
    .handle("getDeviceRecoveryKey", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getDeviceRecoveryKey(request, params.tenantId, params.id),
      ),
    )
    .handle("getDeviceActivationLockBypassCode", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getDeviceActivationLockBypassCode(request, params.tenantId, params.id),
      ),
    )
    .handle("getDeviceEffectivePolicy", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getDeviceEffectivePolicy(request, params.tenantId, params.id),
      ),
    )
    .handle("getDeviceUsers", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getDeviceUsers(request, params.tenantId, params.id),
      ),
    )
    .handle("setDeviceUsers", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.setDeviceUsers(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("listDirectory", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listDirectory(request, params.tenantId),
      ),
    )
    .handle("deleteDevices", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteDevices(request, params.tenantId, payload),
      ),
    )
    .handle("listDevicePreRegistrations", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listDevicePreRegistrations(request, params.tenantId),
      ),
    )
    .handle("importDevicePreRegistrations", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.importDevicePreRegistrations(request, params.tenantId, payload),
      ),
    )
    .handle("deleteDevicePreRegistration", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteDevicePreRegistration(request, params.tenantId, params.id),
      ),
    )
    .handle("deleteDevicePreRegistrations", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteDevicePreRegistrations(request, params.tenantId, payload),
      ),
    )
    .handle("patchDevice", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchDevice(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("deviceAction", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deviceAction(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("listDeviceCommands", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listDeviceCommands(request, params.tenantId, params.id),
      ),
    )
    .handle("listDeviceDeclarations", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listDeviceDeclarations(request, params.tenantId, params.id),
      ),
    )
    .handle("deviceUnenroll", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deviceUnenroll(request, params.tenantId, params.id),
      ),
    )
    .handle("getDeviceHealth", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getDeviceHealth(request, params.tenantId, params.id),
      ),
    )
    .handle("getDeviceActivity", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getDeviceActivity(request, params.tenantId, params.id, query),
      ),
    )
    .handle("revokeDeviceIdentity", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.revokeDeviceIdentity(request, params.tenantId, params.id),
      ),
    )
    .handle("getDeviceHealthSummary", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getDeviceHealthSummary(request, params.tenantId),
      ),
    )
    .handle("getDevicePushHealth", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getDevicePushHealth(request, params.tenantId),
      ),
    )
    .handle("getCredentialHealth", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getCredentialHealth(request, params.tenantId),
      ),
    )
    .handle("listGroups", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) => service.listGroups(request, params.tenantId)),
    )
    .handle("getGroup", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getGroup(request, params.tenantId, params.id),
      ),
    )
    .handle("previewGroup", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.previewGroup(request, params.tenantId, params.id),
      ),
    )
    .handle("createGroup", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.createGroup(request, params.tenantId, payload),
      ),
    )
    .handle("deleteGroups", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteGroups(request, params.tenantId, payload),
      ),
    )
    .handle("patchGroup", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchGroup(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("patchGroupMembers", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchGroupMembers(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("syncGroups", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.syncGroups(request, params.tenantId, payload),
      ),
    )
    .handle("duplicateGroup", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.duplicateGroup(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("listApplications", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listApplications(request, params.tenantId),
      ),
    )
    .handle("getApplicationInventory", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getApplicationInventory(request, params.tenantId, query),
      ),
    )
    .handle("getApplication", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getApplication(request, params.tenantId, params.id),
      ),
    )
    .handle("createApplication", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.createApplication(request, params.tenantId, payload),
      ),
    )
    .handle("patchApplication", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchApplication(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("deleteApplications", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteApplications(request, params.tenantId, payload),
      ),
    )
    .handle("patchApplicationAssignments", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchApplicationAssignments(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("installApplication", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.installApplication(request, params.tenantId, params.id),
      ),
    )
    .handle("uploadApplication", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.uploadApplication(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("downloadApplication", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.downloadApplication(request, params.tenantId, params.id, params.sha256),
      ),
    )
    .handle("getPolicyAssignments", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getPolicyAssignments(request, params.tenantId, params.id),
      ),
    )
    .handle("patchPolicyAssignments", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchPolicyAssignments(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("listPolicies", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listPolicies(request, params.tenantId),
      ),
    )
    .handle("getPolicy", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getPolicy(request, params.tenantId, params.id),
      ),
    )
    .handle("createPolicy", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.createPolicy(request, params.tenantId, payload),
      ),
    )
    .handle("deletePolicies", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deletePolicies(request, params.tenantId, payload),
      ),
    )
    .handle("patchPolicy", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchPolicy(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("uploadPolicyApplication", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.uploadPolicyApplication(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("downloadPolicyApplication", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.downloadPolicyApplication(request, params.tenantId, params.id, params.sha256),
      ),
    )
    .handle("listPolicyDeployments", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listPolicyDeployments(request, params.tenantId, params.id),
      ),
    )
    .handle("rollbackPolicy", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.rollbackPolicy(request, params.tenantId, params.id, params.deploymentId),
      ),
    )
    .handle("syncPolicies", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.syncPolicies(request, params.tenantId, payload),
      ),
    )
    .handle("duplicatePolicy", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.duplicatePolicy(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("extractMobileconfig", ({ payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.extractMobileconfig(payload)),
    )
    .handle("previewMobileconfig", ({ payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.previewMobileconfig(payload)),
    )
    .handle("billing", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) => service.billing(request, params.tenantId)),
    )
    .handle("billingPortal", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.billingPortal(request, params.tenantId, payload),
      ),
    );

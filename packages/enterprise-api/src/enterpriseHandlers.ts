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
  EnterpriseLastTenantAccount,
  EnterpriseNotFound,
  EnterpriseNotConfigured,
  EnterpriseR2FileNotFound,
  EnterpriseR2InternalError,
  EnterpriseTenantHasMembers,
  EnterpriseTenantTeardownFailed,
  EnterpriseUpstreamError,
  credentialPermissions,
  hasAnyWritePermission,
  hasUnrestrictedCredential,
  PERMISSIONS,
  EnterpriseUnauthorized,
  EnterpriseService,
  enterpriseAccountApi,
  enterpriseApi,
  enterpriseAdeApi,
  enterpriseAttributeApi,
  enterpriseDashboardApi,
  enterpriseWindowsApi,
  scriptAgentApi,
  scriptApi,
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
  containsPolicyVariables,
  deviceCommandStatusLabel,
  deviceActionUnavailableReason,
  deviceAvailableActions,
  appleUserAvailableActions,
  diagnoseError,
  errorDiagnostic,
  evaluateDeviceQuery,
  normalizeDeviceCommandStatus,
  type DashboardQueryRequest,
  type DashboardQueryBatchRequest,
  type DeviceQuery,
  DeviceActionName,
  DashboardWidgetType,
  WEBHOOK_EVENT_TYPES,
  webhookUrlProblem,
  DynamicGroupRules,
  DeviceManagementApp,
  type StepUpAction,
  type TenantScepCaInfo,
  verifyScriptAgentToken,
  type BillingCheckoutRequest,
  type WebhookDeliveryQuery,
  type WebhookDeliveryReplayResponse,
  type WebhookDeliveriesResponse,
  type WebhookDeliveryDetail,
  type WebhookTestResponse,
  type SetDeviceAttributesRequest,
  type PolicyDeliveryInfo,
  POLICY_SNAPSHOT_ENABLED_KEY,
  POLICY_SNAPSHOT_SCOPES_KEY,
  POLICY_VARIABLE_NOTES,
  policyConfigurationVariableProblem,
  policyVariableInfo,
  validateAttributeValue,
  windowsActivationStatusFromLicenseStatus,
  windowsLicenseStatusValue,
} from "@mattrax/enterprise-domain";
import { makeEffectStripeClient } from "@mattrax/effect-stripe";
import { derivePolicyDelivery, resolvePolicyScopes } from "./policyList.js";
import type { StripeClientLike } from "@mattrax/effect-stripe";
import {
  authCredentials,
  authIdentifiers,
  authPending,
  authSessions,
  countWindowsFailures,
  deviceLimitForOrganization,
  hasMfaFactor,
  listWindowsFailuresForDevice,
  listWindowsFailuresForOrganization,
  R2_IMMUTABLE_CACHE_CONTROL,
  tenantLimitForAccount,
  WINDOWS_FAILURE_RETENTION_DAYS,
  type PlanLimitsConfig,
  type WindowsFailureRow,
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
  lte,
  max,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import type { AnyColumn, SQL } from "drizzle-orm";
import type { HttpServerRequest } from "effect/http/HttpServerRequest";
import {
  certificateDeviceIdsFor,
  buildAdeEnrollmentProfile,
  createWindowsTenantToken,
  dispatchWebhookEvent,
  enterpriseEnrollmentProfile,
  federatedAuthServiceUrl,
  federatedRealm,
  generateWebhookSecret,
  previewDynamicGroup,
  replayWebhookDelivery as redeliverWebhook,
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
  CATALOGUE_APPLICATION_ASSET_KIND,
  catalogueApplicationAssetIdentifier,
  commandDeadline,
  commandDedupeKey,
  commandIsExpired,
  commandStatusIsActive,
  deviceCommandExpiresAt,
  extendedCommandDeadline,
  planCommandQueueing,
  WebhookPayload,
  writeSystemAudit,
  type CommandPayload,
} from "@mattrax/mdm-apple";
import {
  LOGIN_ATTEMPT_LIST_LIMIT,
  listLoginAttempts,
  loginAttemptEntry,
} from "@mattrax/enterprise-backend";
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
} from "@mattrax/enterprise-backend";
import {
  ScepRepositoryLive,
  isApplicationKind,
  issueScepChallenge,
  parseAppleApplicationConfiguration,
  validateConfiguration,
} from "@mattrax/mdm-apple";
import { serializePlist } from "@mattrax/plist";
import { certificateDer } from "@mattrax/scep";
import { extractMobileconfigPlist, parseMobileconfigPreview } from "@mattrax/enterprise-backend";
import { parseStoredCredentialScopes } from "@mattrax/enterprise-backend";
import { sessionCookie } from "@mattrax/enterprise-backend";
import { cookieValue, signSsrRevision, signSsrToken } from "@mattrax/enterprise-backend";
import {
  ApnsService,
  NoopPushTransport,
  buildApnsCsr,
  generateApnsKeyPair,
  importApnsKeyJwk,
  makeApnsService,
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
} from "@mattrax/enterprise-backend";
import { applePushService } from "@mattrax/enterprise-backend";
import { summarizeApplePushHealth } from "@mattrax/enterprise-backend";
import {
  DEVICE_ACTIVITY_AUDIT_PREFIX,
  DEVICE_ACTIVITY_COMMAND_PREFIX,
  decodeDeviceActivityCursor,
  deviceActivityPage,
  deviceActivitySourceKeyset,
  normalizeDeviceActivityLimit,
  type DeviceActivitySourceKeyset,
} from "@mattrax/enterprise-backend";
import {
  clearTenantAccountDirectoryState,
  hasOwnerRole,
  isBuiltInOwnerMember,
  normalizePermissions,
  loadTenantAccess,
  permissionForMethod,
  RequiredPermission,
  resolveTenantRoleFrom,
} from "@mattrax/enterprise-identity";
import {
  createScript,
  deleteScript,
  getScriptAssignments,
  getScriptDetail,
  getScriptSettings as scriptSettingsFor,
  listScriptExecutions,
  listScripts as listTenantScripts,
  patchScriptAssignments,
  recordScriptAgentResult,
  runScript,
  scriptAgentSync,
  scriptAssignedDeviceIds,
  updateScript,
} from "@mattrax/enterprise-backend";
import { invitationEmail } from "@mattrax/enterprise-backend";
import { ownershipTransferEmail } from "@mattrax/enterprise-backend";
import { sendTransactionalEmail } from "@mattrax/enterprise-backend";
import { DEFAULT_EMAIL_FROM } from "@mattrax/email";
import { EMAIL_CODE_TTL_MS, emailCodeHash, generateEmailCode } from "@mattrax/enterprise-backend";
import {
  deviceBucket,
  normalizeWidgetConfig,
  normalizeWidgetLayout,
  softwareBucket,
  toBuckets,
} from "@mattrax/enterprise-backend";
import {
  syncEntraDirectory,
  runEntraDirectorySyncForTenant,
  acquireEntraSyncLock,
} from "@mattrax/entra-id";
import {
  DEVICE_EXPORT_MAX_ROWS,
  deviceSearchPlatforms,
  deviceSearchStatuses,
  deviceSearchTimestampFormats,
  normalizeDeviceSearchQuery,
  platformLabel,
  toCsv,
  type DeviceSearchFilters,
} from "@mattrax/enterprise-backend";
import {
  attributeCsvCells,
  attributeCsvHeaders,
  attributeDefinitionRow,
  attributeValuesProblem,
  claimEnrollmentAnswers,
  definitionInputProblem,
  listAttributeDefinitions,
  loadDeviceAttributes,
  loadEnrollmentQuestions,
  mergeAttributeValues,
  normalizeDefinitionOptions,
  parseAttributeCsv,
} from "@mattrax/enterprise-backend";
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
} from "@mattrax/enterprise-backend";
import {
  compareInstallerPreference,
  installerSkipReason,
  selectInstaller,
} from "@mattrax/enterprise-domain";
import { reconcileSubscriptionQuantity } from "@mattrax/enterprise-billing";
// oxlint-disable-next-line anti-slop-effect/no-service-constructor-imports -- this is the composition fallback for a deployment with a Stripe client but no remote billing layer.
import { makeStripeBillingService, type BillingOperations } from "@mattrax/enterprise-billing";
import {
  listWebhookDeliveries as listStoredWebhookDeliveries,
  loadWebhookDelivery as loadStoredWebhookDelivery,
  webhookDeliveryDetail,
  webhookDeliveryInfo,
} from "@mattrax/enterprise-backend";
import {
  ACCOUNT_AUDIT,
  accountAuditEntry,
  accountAuditOrder,
  accountAuditWhere,
  clientAddress,
  recordAccountAudit,
} from "@mattrax/enterprise-backend";
import {
  approveAccountRecovery as approveRecoveryRequest,
  createRecoveryLimiter,
  RECOVERY_REQUEST_LIMIT,
  RECOVERY_WINDOW_MILLIS,
  requestAccountRecovery as startRecoveryRequest,
  verifyAccountRecoveryProof as consumeRecoveryProof,
} from "@mattrax/enterprise-backend";
import { canEnrollDevice } from "@mattrax/enterprise-backend";
import {
  AndroidDeliveryError,
  androidEnterpriseInfo,
  createAndroidEnrollmentToken,
  createAndroidSignup,
  disconnectAndroidEnterprise,
  isAndroidConfigured,
  issueAndroidCommand,
  loadAndroidEnterprise,
  reconcileAndroidEnterprise,
  refreshAndroidDevice,
  setAndroidEnabled,
  setAndroidProvisioningMode,
  syncAndroidPoliciesForTenant,
  unenrollAndroidDevice,
  type AndroidDeliveryConfig,
} from "@mattrax/enterprise-backend";
import {
  detectEnrollmentPlatform,
  ENROLLMENT_ATTEMPT_DEDUPE_MS,
  ENROLLMENT_ATTEMPT_PER_CLIENT_LIMIT,
  evaluateEnrollmentAttempt,
  type EnrollmentAttemptOutcome,
  type EnrollmentAttemptPlatform,
} from "@mattrax/enterprise-backend";
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
} from "@mattrax/apple-business-manager";
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
} from "@mattrax/apple-business-manager";
import {
  countDeviceHealth,
  deriveDeviceHealth,
  groupDeviceHealthReasons,
  normalizeDeviceHealth,
} from "@mattrax/enterprise-backend";
import {
  APNS_RENEWAL_URL,
  apnsCredentialHealth,
  loadCredentialHealth,
} from "@mattrax/enterprise-backend";
import { loadScepCaState, type ScepCaState } from "@mattrax/enterprise-backend";
import {
  listTenantBackups as listTenantBackupRuns,
  runTenantBackup as runTenantBackupForTenant,
  setBackupRetention,
  deleteBackupRun,
  BackupActionError,
} from "@mattrax/enterprise-backend";
import {
  teardownTenant,
  TenantTeardownStepFailed,
  type DeviceUnenrollSummary,
  type UnreachableDevice,
} from "@mattrax/enterprise-backend";
import { restoreTenantFromBackup, TenantRestoreError } from "@mattrax/enterprise-backend";
import {
  isMsiInstaller,
  isMsiProductCode,
  normalizeMsiProductCode,
  windowsMsiInstallPayload,
} from "@mattrax/enterprise-backend";
import { AndroidManagement } from "@mattrax/dm-android";
import { buildTenantExport } from "@mattrax/enterprise-backend";
import type { AzureGraphService } from "@mattrax/azure-graph";
import {
  appleInstallAssetExpiresAt,
  appleOsFamily,
  buildAppleManifest,
  buildInstallEnterpriseApplicationPayload,
  createAppleProfileSigner,
  AppleAdeEnrollmentError,
  isApplePackageUpload,
  parseAppleAdeMachineInfo,
  signAppleAssetToken,
  signAppleProfilePlist,
  type AppleProfileSigningConfig,
} from "@mattrax/dm-apple";
import { ensureScepCa, importScepCa, replaceScepCa, rotateScepCa, ScepError } from "@mattrax/scep";
import {
  listUserSessions,
  revokeAllUserSessions,
  revokeUserSession,
} from "@mattrax/enterprise-backend";
import {
  R2Storage,
  R2StorageLive,
  base64ToBytes,
  bytesToBase64,
  storageSha256Hex as sha256Hex,
} from "@mattrax/enterprise-backend";
import type { R2Bucket } from "@mattrax/enterprise-backend";
import type {
  EnterpriseConfiguration,
  EnterpriseDb,
  EnterpriseDevice,
  EnterpriseEnrollment,
  EnterpriseGroup,
  EnterpriseGroupDevice,
  EnterpriseGroupPolicy,
  EnterpriseApplication,
  EnterpriseApplicationInstaller,
  EnterpriseOrganization,
  EnterprisePolicy,
  EnterpriseSchema,
} from "@mattrax/enterprise-backend";
import type { EmailTransport } from "@mattrax/email";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export type EnterpriseAnalyticsIdentity = {
  readonly userId: string;
  readonly email?: string;
  readonly name?: string;
  readonly emailVerified?: boolean;
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
  /**
   * Customer-facing billing implementation. Hosted deployments omit it and get
   * the Stripe service; a self-hosted deployment supplies the remote service.
   */
  readonly billing?: BillingOperations;
  /**
   * Stripe price for the per-device monthly plan. Checkout and seat
   * reconciliation need it alongside `stripeClient`; both request a
   * configuration error when it is absent.
   */
  readonly deviceMonthlyPriceId?: string;
  readonly storage: R2Bucket;
  /** Application secret used to seal/unseal APNs private keys. */
  readonly authSecret?: string;
  /** Microsoft Graph client used by directory sync and Autopilot (optional). */
  readonly azureGraph?: AzureGraphService;
  /** Public Entra app client id, exposed only to build the admin consent URL. */
  readonly azureClientId?: string;
  /**
   * Overall deadline for revoking Entra consent during an unlink. Defaults to
   * 20s so a throttled Graph cannot hold the committed unlink response open.
   */
  readonly entraConsentRevocationTimeoutMs?: number;
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
   * Windows failure-history retention window used by the delivery panel.
   * Defaults to `WINDOWS_FAILURE_RETENTION_DAYS`; `0` keeps history forever.
   * Maintenance must be configured with the same value.
   */
  readonly windowsFailureRetentionDays?: number;
  /**
   * Deployment identity used to CMS-sign Apple enrollment profile downloads.
   * This is an explicit self-hosted override. When it is omitted, each tenant's
   * own SCEP CA signs the download (bootstrapped on first use).
   */
  readonly appleProfileSigning?: AppleProfileSigningConfig;
  /** Optional static analytics sink; the API supplies a request-scoped one. */
  readonly analytics?: EnterpriseAnalytics;
  /** Transactional email transport. Invitations are returned without email when omitted. */
  readonly email?: EmailTransport;
  /**
   * Verified sender address for invitation email. Must remain an allowed
   * Cloudflare Email sender; defaults to `hello@mattrax.cloud`.
   */
  readonly invitationFromEmail?: string;
  /**
   * Lifetime of the bearer SCEP challenge embedded in an Apple enrollment
   * profile, in seconds. Defaults to one hour and is bounded to a day so a
   * shared profile link cannot stay live indefinitely.
   */
  readonly enrollmentProfileTtlSeconds?: number;
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
  "EnterpriseLastTenantAccount",
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
  inviteTenantAccount: "member_invited",
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
 * One hour is long enough to install a profile on a device an administrator is
 * holding, and short enough that a leaked profile link stops working the same
 * day. The challenge is one-time and bound to the tenant's enrollment id.
 */
export const ENROLLMENT_PROFILE_DEFAULT_TTL_SECONDS = 60 * 60;

export const ENROLLMENT_PROFILE_MAX_TTL_SECONDS = 24 * 60 * 60;

export const normalizeEnrollmentProfileTtlSeconds = (value: number | undefined) => {
  if (value === undefined) return ENROLLMENT_PROFILE_DEFAULT_TTL_SECONDS;

  if (!Number.isInteger(value) || value < 60 || value > ENROLLMENT_PROFILE_MAX_TTL_SECONDS)
    throw new Error(
      `enrollmentProfileTtlSeconds must be a whole number of seconds between 60 and ${ENROLLMENT_PROFILE_MAX_TTL_SECONDS}`,
    );

  return value;
};

/**
 * Restrict one activity source to rows older than the keyset cursor. The
 * timestamp column is the source's event time (`createdAt` for audits,
 * `updatedAt` for commands); the id tiebreaker matches the merged feed.
 */
const deviceActivityKeysetCondition = (
  keyset: DeviceActivitySourceKeyset,
  at: AnyColumn,
  id: AnyColumn,
): SQL => {
  const before = lt(at, keyset.at);

  if ("beforeId" in keyset) {
    const sameInstant = and(eq(at, keyset.at), lt(id, keyset.beforeId));

    return or(before, sameInstant) ?? before;
  }

  if (keyset.sameInstant === "all") return or(before, eq(at, keyset.at)) ?? before;

  return before;
};

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

/**
 * Guest sign-up codes. Kept tighter than recovery: one live challenge per
 * address, five wrong guesses, and a small hourly budget per mailbox.
 */
const registrationLimiter = createRecoveryLimiter({
  limit: 10,
  windowMillis: 60 * 60 * 1000,
});

const registrationGrant = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

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
  actorAccountId?: string | null;
  actorEmail?: string | null;
  metadata?: unknown;
  createdAt: Date;
}): AuditExportEntry => ({
  id: entry.id,
  action: entry.action,
  targetType: entry.targetType,
  targetId: entry.targetId,
  actorAccountId: entry.actorAccountId ?? null,
  actorEmail: entry.actorEmail ?? null,
  // Drizzle types a `json` column as unknown; only valid JSON reaches a response.
  metadata: Option.getOrNull(Schema.decodeUnknownOption(Schema.Json)(entry.metadata)),
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

/**
 * Rebuild a Web Request for the auth library from the Effect request.
 *
 * The path and method matter: the library's MCP guard decides whether an OAuth
 * token may touch account settings from them. Rebuilding at the origin root
 * would make every request look like `GET /`.
 */
const webRequestFromRequest = (request: HttpServerRequest, origin: string) =>
  new Request(new URL(request.url, origin), {
    method: request.method,
    headers: headersFromRequest(request),
  });

/** Require a recent step-up for a sensitive action. */
const requireStepUp = (
  auth: EnterpriseAuth["Service"],
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

/** Ownership transfer links live as long as an invitation. */
const OWNERSHIP_TRANSFER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The role a requester falls back to once ownership has moved. */
const OWNERSHIP_TRANSFER_DEMOTED_ROLE = "admin";

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

const newOneTimeToken = () =>
  bytesToBase64(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const oneTimeTokenHash = (token: string) =>
  sha256Hex(bytesToArrayBuffer(new TextEncoder().encode(token)));

const invitationUrl = (origin: string, token: string) =>
  `${origin.replace(/\/+$/, "")}/accept-invitation?token=${encodeURIComponent(token)}`;

const ownershipTransferUrl = (origin: string, token: string) =>
  `${origin.replace(/\/+$/, "")}/accept-ownership?token=${encodeURIComponent(token)}`;

/** Preview state for a token; terminal rows keep their digest for this read. */
const ownershipTransferPreviewState = (transfer: { status: string; expiresAt: Date }) => {
  if (transfer.status === "pending")
    return transfer.expiresAt <= now() ? ("expired" as const) : ("valid" as const);

  if (transfer.status === "accepted") return "accepted" as const;

  if (transfer.status === "cancelled") return "cancelled" as const;

  if (transfer.status === "expired") return "expired" as const;

  return "unknown" as const;
};

/**
 * Who is allowed to end a pending handover. Either party can stop their own
 * transfer, and any owner can intervene; everyone else is refused.
 */
const ownershipTransferCancelActor = (
  pending: { readonly requestedByAccountId: string; readonly targetAccountId: string },
  caller: {
    readonly id: string;
    readonly member: { readonly role: string; readonly customRoleId?: string | null };
  },
) => {
  if (pending.requestedByAccountId === caller.id) return "requester" as const;

  if (pending.targetAccountId === caller.id) return "target" as const;

  if (isBuiltInOwnerMember(caller.member)) return "owner" as const;

  return undefined;
};

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
  returnToService?: {
    wifiProfileIncluded: boolean;
    enrollmentProfileIncluded: boolean;
    bootstrapTokenIncluded: boolean;
    automatedDeviceEnrollment: boolean;
  };
};

type ReturnToServiceErase = {
  Enabled: boolean;
  WiFiProfileData: string;
  MDMProfileData?: string;
  BootstrapToken?: string;
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
  deviceMonthlyPriceId,
  billing: providedBilling,
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
  entraConsentRevocationTimeoutMs: configuredEntraConsentRevocationTimeoutMs,
  windowsFederated,
  webhookFetch,
  webhookTimeoutMs,
  planLimits,
  windowsFailureRetentionDays: configuredWindowsFailureRetentionDays,
  appleProfileSigning,
  analytics,
  enrollmentProfileTtlSeconds: configuredEnrollmentProfileTtlSeconds,
}: EnterpriseServiceConfig) => {
  if (!authService) throw new Error("EnterpriseAuth service is required");

  const windowsFailureRetentionDays =
    configuredWindowsFailureRetentionDays ?? WINDOWS_FAILURE_RETENTION_DAYS;

  const entraConsentRevocationTimeoutMs =
    configuredEntraConsentRevocationTimeoutMs ?? 20_000;

  const enrollmentProfileTtlSeconds = normalizeEnrollmentProfileTtlSeconds(
    configuredEnrollmentProfileTtlSeconds,
  );

  const auth = wrapServiceErrors(authService);

  /**
   * Run independent Drizzle reads in one wave.
   *
   * `Effect.all` needs Effects. Drizzle's Effect driver returns Effects in
   * production, while the in-memory database used by the unit tests exposes
   * the same builders as iterators; wrapping each entry in a generator
   * supports both and keeps the concurrency explicit at every call site.
   */
  /**
   * Accept a Drizzle query builder as an Effect.
   *
   * Drizzle's Effect driver returns Effects in production, while the in-memory
   * database used by the unit tests exposes the same builders as iterators.
   * `yield*` supports both, and wrapping each builder here lets `Effect.all`
   * keep per-position result types while running independent reads in one wave.
   */
  const queryEffect = <A, E, R>(builder: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.gen(function* () {
      return yield* builder;
    });

  /** An empty result with an explicit row type, without a type assertion. */
  const emptyRows = <A>(): Effect.Effect<Array<A>> => Effect.succeed([]);

  const identifyUser = (
    user: {
      readonly id: string;
      readonly email: string;
      readonly name?: string | null;
      readonly emailVerified?: boolean;
    },
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

        if (user.emailVerified !== undefined) identity.emailVerified = user.emailVerified;

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

  const billing =
    providedBilling ??
    makeStripeBillingService({
      db,
      origin,
      stripe,
      deviceMonthlyPriceId,
      planLimits,
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

  /**
   * A tenant-wide MFA requirement applies to every role, including token-bound
   * ceremonies such as accepting ownership, which grant owner authority.
   */
  const tenantMfaBlocked = (
    user: { readonly totpEnabled?: boolean | null; readonly passkeyEnabled?: boolean | null },
    organization: { readonly requireMfa: boolean },
  ) => !hasMfaFactor(user) && organization.requireMfa;

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
      }

      // The credential's own ceiling. A browser session has none; an API token
      // or MCP connection may be narrowed to specific permissions, and the
      // account's role is applied below as a second, independent limit.
      const credentialScopes = apiToken
        ? parseStoredCredentialScopes(apiToken.scopes)
        : oauth
          ? oauth.scopes
          : null;

      const credentialGrant = credentialScopes
        ? credentialPermissions(credentialScopes)
        : undefined;

      const credentialRestricted =
        credentialScopes !== null && !hasUnrestrictedCredential(credentialScopes);

      // Membership, organisation and effective role come from one join. They
      // are all required before authorisation can decide anything, so reading
      // them in sequence cost three round trips on every tenant request.
      const tenantAccess = yield* loadTenantAccess(db, user.id, tenantId);

      if (!tenantAccess)
        return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant not found" }));

      const { member, organization, role } = tenantAccess;
      const required = yield* Effect.serviceOption(RequiredPermission);
      const requiredPermission = Option.isSome(required) ? required.value.permission : undefined;

      // Activity attribution is written by the MCP gateway for the caller's own
      // tool call. It records that the read happened; it must not require the
      // read grant itself, or a narrowed connection would lose its audit trail.
      const isMcpActivity =
        Option.isSome(required) && required.value.method === "recordMcpActivity";

      if (credentialRestricted && credentialGrant && !isMcpActivity) {
        if (requiredPermission && !credentialGrant.has(requiredPermission))
          return yield* Effect.fail(
            diagnoseError(
              new EnterprisePermissionDenied({
                message: `This credential does not include the ${requiredPermission} permission.`,
                permission: requiredPermission,
                roleName: role.roleName,
                roleKind: role.roleKind,
              }),
              {
                code: "token_scope",
                reason: "missing_permission",
                details: { permission: requiredPermission },
              },
            ),
          );

        // Methods without a mapped permission (future or fallback routes) keep
        // the coarse read/write contract.
        if (!requiredPermission) {
          const hasRead = [...credentialGrant].some((permission) => permission.endsWith(".read"));

          if (access === "read" && !hasRead)
            return yield* Effect.fail(
              diagnoseError(
                new EnterpriseForbidden({
                  message: "This credential is not allowed to read this tenant.",
                }),
                { code: "token_scope", reason: "read_scope_missing" },
              ),
            );

          if (access !== "read" && !hasAnyWritePermission(credentialGrant))
            return yield* Effect.fail(
              diagnoseError(
                new EnterpriseForbidden({
                  message: "This credential cannot modify this tenant.",
                }),
                { code: "token_scope", reason: "write_scope_missing" },
              ),
            );
        }
      }

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

      if (
        !isMcpActivity &&
        requiredPermission &&
        !hasPermission(role.permissions, requiredPermission)
      )
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

      // A tenant-wide MFA requirement applies to every role, including viewers
      // and auditors: read access to tenant data is exactly what an attacker
      // with a borrowed session is after. Account endpoints are not
      // tenant-scoped, so a blocked member can always reach Account settings to
      // enrol a factor.
      if (tenantMfaBlocked(user, organization))
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
        account: user,
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
    ctx: {
      readonly account: { readonly id: string };
      readonly organization: { readonly id: string };
    },
    policyId: string,
  ) =>
    Effect.gen(function* () {
      const [policy] = yield* db
        .select({ enabled: schema.policy.enabled })
        .from(schema.policy)
        .where(eq(schema.policy.id, policyId))
        .limit(1);

      const configurations = yield* db
        .select()
        .from(schema.configuration)
        .where(eq(schema.configuration.policyId, policyId));

      const scopes = Object.fromEntries(
        configurations
          .filter((configuration) => configuration.scope === "user")
          .map((configuration) => [configuration.kind, "user"]),
      );

      const snapshot = {
        ...Object.fromEntries(
          configurations.map((configuration) => [configuration.kind, configuration.data]),
        ),
        ...(Object.keys(scopes).length > 0 ? { [POLICY_SNAPSHOT_SCOPES_KEY]: scopes } : {}),
        // Absence means enabled; only a disabled policy adds the reserved key.
        ...(policy?.enabled === false ? { [POLICY_SNAPSHOT_ENABLED_KEY]: false } : {}),
      };

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
            createdByAccountId: ctx.account.id,
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
      readonly account: {
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
        if (!hasMfaFactor(ctx.account))
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message:
                "Add a passkey or authenticator app to your own account before requiring MFA for this tenant.",
            }),
          );

        const members = yield* db
          .select({
            role: schema.member.role,
            totpEnabled: schema.account.totpEnabled,
            passkeyEnabled: schema.account.passkeyEnabled,
          })
          .from(schema.member)
          .innerJoin(schema.account, eq(schema.account.id, schema.member.accountId))
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
      readonly account: { readonly id: string; readonly email: string };
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
        actorAccountId: ctx.account.id,
        actorEmail: ctx.account.email,
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

  /**
   * Whether this tenant ever proved the linked Entra directory works, either
   * with a successful directory/domain sync or a completed SSO sign-in. An
   * unverified tenant id is only a string an owner typed, so it must not be
   * used as permission to delete anything in that remote directory.
   */
  const entraLinkWasVerified = (organizationId: string) =>
    Effect.gen(function* () {
      const sync = yield* db.query.entraDirectorySync.findFirst({ where: { organizationId } });

      if (sync?.lastSyncedAt != null || sync?.domainsSyncedAt != null) return true;

      const identity = yield* db.query.ssoIdentity.findFirst({ where: { organizationId } });

      if (identity) return true;

      const directoryUser = yield* db.query.user.findFirst({
        where: { organizationId, source: "entra" },
      });

      return directoryUser !== undefined;
    });

  /**
   * Best-effort removal of this app's delegated Entra consent. Unlinking must
   * never fail because Graph is unavailable, so every failure (including an
   * audit write) is recorded and swallowed. The returned outcome is surfaced
   * on the SSO response so the dashboard can tell the operator what happened.
   */
  const revokeEntraConsent = (
    ctx: Parameters<typeof audit>[0],
    azureTenantId: string,
    linkVerified: boolean,
  ) =>
    Effect.gen(function* () {
      const record = (action: string, metadata: Schema.Json) =>
        audit(ctx, action, "sso", ctx.organization.id, metadata).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`Entra consent audit write failed: ${String(cause)}`),
          ),
        );

      if (!azureGraph) {
        const reason = "Microsoft Graph credentials are not configured.";

        yield* record("sso.consent_revocation_skipped", {
          azureTenantId,
          result: "skipped",
          reason,
        });

        return { status: "skipped" as const, reason };
      }

      if (!linkVerified) {
        const reason = "The Entra link was never verified by a successful sync or sign-in.";

        yield* record("sso.consent_revocation_skipped", {
          azureTenantId,
          result: "skipped",
          reason,
        });

        return { status: "skipped" as const, reason };
      }

      // One overall deadline, because each Graph call has its own 15s timeout
      // and a throttled tenant could otherwise hold the committed unlink open
      // until the HTTP request is aborted. `catchCause` also absorbs defects,
      // which must never turn a successful unlink into an error.
      // `suspend` also captures a synchronous throw (for example from a mock or
      // a future client refactor) as a defect for `catchCause` below.
      const revoke = Effect.suspend(() => azureGraph.revokeDelegatedConsent(azureTenantId));

      const outcome = yield* revoke.pipe(
        Effect.map((revocation) => ({
          status: "revoked" as const,
          grantsRemoved: revocation.grantsRemoved,
          servicePrincipalId: revocation.servicePrincipalId,
        })),
        Effect.catchCause((cause) => {
          const error = Cause.squash(cause);

          // Graph error messages name the endpoint, never a token or secret.
          const reason = (error instanceof Error ? error.message : String(error)).slice(0, 200);

          const httpStatus = Schema.is(Schema.Struct({ status: Schema.Number }))(error)
            ? error.status
            : null;

          const grantsRemoved = Schema.is(Schema.Struct({ grantsRemoved: Schema.Number }))(error)
            ? error.grantsRemoved
            : 0;

          return Effect.succeed({
            status: "failed" as const,
            reason,
            grantsRemoved,
            httpStatus,
          });
        }),
        Effect.timeoutOrElse({
          duration: entraConsentRevocationTimeoutMs,
          orElse: () =>
            Effect.succeed({
              status: "failed" as const,
              reason: "Microsoft Graph did not respond in time.",
              grantsRemoved: 0,
              httpStatus: null,
            }),
        }),
      );

      if (outcome.status === "revoked") {
        yield* record("sso.consent_revoked", {
          azureTenantId,
          result: "revoked",
          grantsRemoved: outcome.grantsRemoved,
          servicePrincipalFound: outcome.servicePrincipalId !== null,
        });

        return { status: "revoked" as const, grantsRemoved: outcome.grantsRemoved };
      }

      yield* Effect.logWarning(
        `Entra consent revocation failed for ${azureTenantId}: ${outcome.reason}`,
      );

      yield* record("sso.consent_revocation_failed", {
        azureTenantId,
        result: "failed",
        message: outcome.reason,
        httpStatus: outcome.httpStatus,
        grantsRemoved: outcome.grantsRemoved,
      });

      return {
        status: "failed" as const,
        reason: outcome.reason,
        grantsRemoved: outcome.grantsRemoved,
      };
    });

  const WEBHOOK_EVENTS = new Set<string>(WEBHOOK_EVENT_TYPES);

  /**
   * Write a keyed attribute-value map for one device. Values are already
   * validated and canonicalised; `null` deletes the row. The caller owns the
   * audit entry so it can name the source (dashboard, CSV, enrollment).
   */
  const writeDeviceAttributeValues = (input: {
    readonly organizationId: string;
    readonly deviceId: string;
    readonly definitions: ReadonlyArray<{ readonly id: string; readonly key: string }>;
    readonly values: Readonly<Record<string, string | null>>;
    readonly updatedByAccountId: string | null;
  }) =>
    Effect.gen(function* () {
      const byKey = new Map(input.definitions.map((definition) => [definition.key, definition.id]));
      const timestamp = now();
      const cleared: Array<string> = [];
      const written: Array<string> = [];

      for (const [key, value] of Object.entries(input.values)) {
        const attributeId = byKey.get(key);

        if (!attributeId) continue;

        if (value === null || value === "") {
          cleared.push(key);

          continue;
        }

        written.push(key);
        yield* db
          .insert(schema.deviceAttribute)
          .values({
            deviceId: input.deviceId,
            attributeId,
            organizationId: input.organizationId,
            value,
            updatedByAccountId: input.updatedByAccountId,
            updatedAt: timestamp,
          })
          .onDuplicateKeyUpdate({
            set: { value, updatedByAccountId: input.updatedByAccountId, updatedAt: timestamp },
          });
      }

      if (cleared.length > 0) {
        const ids = cleared.flatMap((key) => {
          const value = byKey.get(key);

          return value === undefined ? [] : [value];
        });

        if (ids.length > 0)
          yield* db
            .delete(schema.deviceAttribute)
            .where(
              and(
                eq(schema.deviceAttribute.deviceId, input.deviceId),
                eq(schema.deviceAttribute.organizationId, input.organizationId),
                inArray(schema.deviceAttribute.attributeId, ids),
              ),
            );
      }

      return { written, cleared };
    });

  /**
   * Compose and queue the branded invitation. Returns whether the message was
   * accepted for delivery (queued in the outbox, or delivered to the local
   * mailbox); failures never expose the token or full address.
   *
   * The delivery itself belongs to the cron drain. An invitation link the admin
   * copies from the response is always valid even when every send fails.
   */
  const sendInvitationEmail = (
    organization: {
      readonly id: string;
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
      /**
       * One message per invitation generation: a retried request cannot queue
       * the same invitation twice, while a resend (which rotates the token)
       * gets a new key.
       */
      readonly idempotencyKey: string;
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

      const outcome = yield* sendTransactionalEmail({
        db,
        email,
        template: "invitation",
        recipient: input.email,
        organizationId: organization.id,
        dedupeKey: `invitation:${input.idempotencyKey}`,
        message: {
          to: input.email,
          from: {
            name: branding.displayName,
            email: invitationFromEmail ?? DEFAULT_INVITATION_FROM,
          },
          replyTo,
          subject: message.subject,
          text: message.text,
          html: message.html,
        },
      });

      // `queued`, `duplicate` and the local mailbox all mean the admin can
      // stop worrying: the message exists. `failed`/`skipped` keep the
      // existing "copy this link" UI.
      return outcome === "queued" || outcome === "duplicate" || outcome === "delivered";
    });

  /**
   * Compose and queue the ownership handover notice. Best effort: the request
   * is already durable when this runs, and the response carries the link so
   * the owner can forward it if the transport or outbox is unavailable.
   */
  const sendOwnershipTransferEmail = (
    organization: {
      readonly id: string;
      readonly name: string;
      readonly displayName?: string | null;
      readonly logo?: string | null;
      readonly supportEmail?: string | null;
      readonly brandColor?: string | null;
    },
    requesterName: string,
    input: {
      readonly email: string;
      readonly acceptUrl: string;
      readonly expiresAt: Date;
      /** One message per transfer generation; a retry cannot queue it twice. */
      readonly idempotencyKey: string;
    },
  ) =>
    Effect.gen(function* () {
      if (!email) {
        yield* Effect.logWarning(
          "Ownership transfer email skipped: the deployment has no email binding",
        );

        return false;
      }

      const branding = resolveTenantBranding(organization);

      const message = ownershipTransferEmail({
        tenantName: branding.displayName,
        logoUrl: branding.logo,
        brandColor: branding.brandColor,
        requesterName,
        targetEmail: input.email,
        acceptUrl: input.acceptUrl,
        expiresAt: input.expiresAt,
        supportEmail: branding.supportEmail,
      });

      const configuredSupport = organization.supportEmail?.trim();

      const replyTo =
        configuredSupport && INVITATION_EMAIL_PATTERN.test(configuredSupport)
          ? { name: branding.displayName, email: configuredSupport }
          : undefined;

      const outcome = yield* sendTransactionalEmail({
        db,
        email,
        template: "ownership_transfer",
        recipient: input.email,
        organizationId: organization.id,
        dedupeKey: `ownership_transfer:${input.idempotencyKey}`,
        message: {
          to: input.email,
          from: {
            name: branding.displayName,
            email: invitationFromEmail ?? DEFAULT_INVITATION_FROM,
          },
          replyTo,
          subject: message.subject,
          text: message.text,
          html: message.html,
        },
      });

      return outcome === "queued" || outcome === "duplicate" || outcome === "delivered";
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

  /**
   * Wake every user channel on these devices.
   *
   * User-scoped policy is owned by the user channel, so a policy change that
   * only pushed the device would leave an open login on stale settings. Push
   * failures are already recorded per channel by the push service and shown on
   * the device page, so a dead channel must not fail the whole policy write.
   */
  const pushPolicyUserChannels = (deviceIds: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const unique = [...new Set(deviceIds)];

      if (unique.length === 0) return;

      const channels = yield* db
        .select({
          deviceId: schema.deviceAppleUser.deviceId,
          userId: schema.deviceAppleUser.userId,
        })
        .from(schema.deviceAppleUser)
        .where(
          and(
            inArray(schema.deviceAppleUser.deviceId, unique),
            isNotNull(schema.deviceAppleUser.token),
          ),
        );

      yield* Effect.forEach(
        channels,
        (channel) =>
          applePush
            .pushAppleUserChannel(channel.deviceId, channel.userId)
            .pipe(Effect.catch(() => Effect.void)),
        { concurrency: 4 },
      );
    });

  const pushPolicyDevices = (
    organizationId: string,
    context: Record<string, Schema.Json>,
    deviceIds: ReadonlyArray<string>,
  ) =>
    Effect.gen(function* () {
      const result = yield* applePush.pushAppleDevices(deviceIds);
      yield* pushPolicyUserChannels(deviceIds);
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

  /**
   * Best-effort seat reconciliation for a device lifecycle change.
   *
   * The nightly sweep is the backstop, so a Stripe outage is logged rather
   * than failing the device operation that triggered it.
   */
  const reconcileSeats = (organizationId: string) =>
    stripe && deviceMonthlyPriceId
      ? reconcileSubscriptionQuantity({
          db,
          stripe,
          organizationId,
          deviceMonthlyPriceId,
          planLimits,
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(
              `Billing seat reconciliation failed for ${organizationId}: ${String(cause)}`,
            ),
          ),
        )
      : Effect.void;

  const listTenantInfo = (userId: string) =>
    Effect.gen(function* () {
      // The tenant switcher loads this on every shell boot. A custom role used
      // to cost one extra query per tenant; the left join resolves all of them
      // in the same read.
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
          organizationId: schema.member.organizationId,
          customRoleId: schema.member.customRoleId,
          customRoleName: schema.tenantRole.name,
          customRolePermissions: schema.tenantRole.permissions,
          requireMfa: schema.organization.requireMfa,
        })
        .from(schema.member)
        .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
        .leftJoin(
          schema.tenantRole,
          and(
            eq(schema.tenantRole.id, schema.member.customRoleId),
            eq(schema.tenantRole.organizationId, schema.member.organizationId),
          ),
        )
        .where(eq(schema.member.accountId, userId));

      const tenants = rows.map((row) => {
        const role = resolveTenantRoleFrom(
          { role: row.role, organizationId: row.organizationId, customRoleId: row.customRoleId },
          row.customRoleId && row.customRoleName
            ? {
                id: row.customRoleId,
                name: row.customRoleName,
                permissions: row.customRolePermissions,
              }
            : undefined,
        );

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
      });

      // The requirement is a tenant property and binds every role, so it is
      // reported for any membership rather than only owner/admin ones. Reading
      // it here avoids the separate membership + organisation reads the shell
      // used to perform on every boot.
      return { tenants, mfaRequired: rows.some((row) => row.requireMfa) };
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
        .select({ id: schema.user.id })
        .from(schema.user)
        .where(and(eq(schema.user.organizationId, tenantId), inArray(schema.user.id, [...ids])));

      if (rows.length !== new Set(ids).size)
        return yield* Effect.fail(
          new EnterpriseBadRequest({
            message: "One or more users are not in this tenant's directory.",
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

  /**
   * Active commands for one device, newest first; the input to queue planning.
   * `userId` narrows the result to one Apple user channel.
   */
  const activeDeviceCommands = (deviceId: string, userId?: string) =>
    db
      .select()
      .from(schema.deviceCommand)
      .where(
        and(
          eq(schema.deviceCommand.deviceId, deviceId),
          userId ? eq(schema.deviceCommand.userId, userId) : isNull(schema.deviceCommand.userId),
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
   *
   * `userId` targets one Apple user channel. Its commands never mix with the
   * device channel's queue: the de-duplication key is namespaced and the
   * channel is persisted on the row.
   */
  const queueDeviceCommand = (input: {
    readonly organizationId: string;
    readonly deviceId: string;
    readonly requestType: string;
    readonly payload: CommandPayload;
    readonly at: Date;
    /** Apple per-user channel (`UserID`/`EnrollmentUserID`); omit for the device. */
    readonly userId?: string;
    /** Commands from the same operation that must survive supersede planning. */
    readonly protectIds?: ReadonlyArray<string>;
  }): Effect.Effect<
    { readonly id: string; readonly payload: CommandPayload; readonly deduplicated: boolean },
    unknown,
    never
  > =>
    Effect.gen(function* () {
      const active = yield* activeDeviceCommands(input.deviceId, input.userId);

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
        new Set(input.protectIds ?? []),
      );

      if (plan.duplicate) {
        // Re-issuing the same action is a fresh intent: extend the delivery
        // window instead of reporting success for a command that expires
        // moments later. A type without a budget has no deadline to move.
        const extended = extendedCommandDeadline(plan.duplicate, input.requestType, input.at);

        if (extended !== null)
          yield* db
            .update(schema.deviceCommand)
            .set({ expiresAt: extended })
            .where(
              and(
                eq(schema.deviceCommand.deviceId, input.deviceId),
                eq(schema.deviceCommand.id, plan.duplicate.id),
              ),
            );

        return {
          id: plan.duplicate.id,
          payload: plan.duplicate.payload ?? null,
          deduplicated: true,
        };
      }

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

      // Namespace the de-duplication key by channel so the device and a user
      // channel can each hold the same request type without colliding on the
      // `(deviceId, dedupeKey)` unique index.
      const dedupeKey = yield* Effect.promise(() =>
        commandDedupeKey(
          input.userId ? `user:${input.userId}:${input.requestType}` : input.requestType,
          input.payload,
        ),
      );

      const insertValues = {
        id,
        organizationId: input.organizationId,
        deviceId: input.deviceId,
        requestType: input.requestType,
        payload: input.payload,
        userId: input.userId ?? null,
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
  const PLAN_DEVICE_LIMIT_MESSAGE =
    "The device limit for this plan has been reached. Contact your administrator to upgrade.";

  /** Reject tenant creation when the account's plan does not allow another. */
  const assertTenantCreationAllowed = (userId: string) =>
    Effect.gen(function* () {
      const status = yield* tenantLimitForAccount({
        db,
        accountId: userId,
        config: planLimits,
      }).pipe(
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
      | "windowsActivationStatus"
      | "windowsActivationLicenseStatus"
      | "windowsActivationEdition"
      | "windowsActivationChannel"
      | "windowsActivationLicenseName"
      | "windowsActivationUpdatedAt"
    >,
  ) => ({
    bitLockerEnabled: row.bitLockerEnabled,
    bitLockerStatus: row.bitLockerStatus,
    tpmVersion: row.tpmVersion,
    secureBootState: row.secureBootState,
    domainName: row.domainName,
    entraDeviceId: row.entraDeviceId,
    // Activation comes from the agent's WMI sample, not the OMA-DM inventory,
    // so it has its own timestamp. A device without a report has no activation
    // block at all rather than an invented "unknown".
    activation: row.windowsActivationUpdatedAt
      ? {
          status: row.windowsActivationStatus ?? ("unknown" as const),
          licenseStatus: row.windowsActivationLicenseStatus,
          licenseName: row.windowsActivationLicenseName,
          productKeyChannel: row.windowsActivationChannel,
          edition: row.windowsActivationEdition,
          updatedAt: iso(row.windowsActivationUpdatedAt),
        }
      : undefined,
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

  /**
   * One recorded Windows fault, in the shape the device page and delivery
   * diagnostics render. `at` is the only date field; everything else is already
   * bounded and redacted by the recorder.
   */
  const windowsFailureInfo = (row: WindowsFailureRow) => ({
    id: row.id,
    deviceId: row.deviceId,
    deviceIdentifier: row.deviceIdentifier,
    serial: row.serial,
    hostname: row.hostname,
    phase: row.phase,
    code: row.code,
    message: row.message,
    detail: row.detail,
    at: iso(row.createdAt),
  });

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

  /** The escrowed bootstrap token in plaintext, or null when none was sent. */
  const resolveBootstrapToken = (device: { readonly id: string }) =>
    Effect.gen(function* () {
      if (!authSecret) return null;

      const [secret] = yield* db
        .select({ sealedValue: schema.deviceSecret.sealedValue })
        .from(schema.deviceSecret)
        .where(
          and(
            eq(schema.deviceSecret.deviceId, device.id),
            eq(schema.deviceSecret.kind, "bootstrap_token"),
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

  const rowDevice = (
    row: EnterpriseDevice,
    setup?: {
      readonly awaitingConfiguration?: boolean;
      readonly configured?: boolean;
      readonly setupReleasedAt?: Date | null;
      readonly returnToServiceRequestedAt?: Date | null;
      readonly returnToServiceCompletedAt?: Date | null;
    },
    android?: {
      readonly managementMode?: string | null;
      readonly ownership?: string | null;
    },
  ) => ({
    id: row.id,
    proto: row.proto,
    name: row.name,
    model: row.model,
    modelIdentifier: row.modelIdentifier,
    serial: row.serial,
    status: row.status,
    enrolledAt: iso(row.enrolledAt),
    lastSeenAt: iso(row.lastSeenAt),
    awaitingConfiguration: setup?.awaitingConfiguration ?? null,
    configured: setup?.configured ?? null,
    setupReleasedAt: setup?.setupReleasedAt ? iso(setup.setupReleasedAt) : null,
    returnToServiceRequestedAt: setup?.returnToServiceRequestedAt
      ? iso(setup.returnToServiceRequestedAt)
      : null,
    returnToServiceCompletedAt: setup?.returnToServiceCompletedAt
      ? iso(setup.returnToServiceCompletedAt)
      : null,
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
    windowsActivationStatus: row.proto === "win" ? (row.windowsActivationStatus ?? null) : null,
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
      managementMode: android?.managementMode ?? null,
      ownership: android?.ownership ?? null,
    }),
  });

  /** ADE setup state for a page of devices, keyed by device id. */
  const deviceSetupStateFor = (deviceIds: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      if (deviceIds.length === 0)
        return new Map<
          string,
          {
            deviceId: string;
            awaitingConfiguration: boolean;
            configured: boolean;
            setupReleasedAt: Date | null;
            returnToServiceRequestedAt: Date | null;
            returnToServiceCompletedAt: Date | null;
          }
        >();

      const rows = yield* db
        .select({
          deviceId: schema.deviceApple.deviceId,
          awaitingConfiguration: schema.deviceApple.awaitingConfiguration,
          configured: schema.deviceApple.configured,
          setupReleasedAt: schema.deviceApple.setupReleasedAt,
          returnToServiceRequestedAt: schema.deviceApple.returnToServiceRequestedAt,
          returnToServiceCompletedAt: schema.deviceApple.returnToServiceCompletedAt,
        })
        .from(schema.deviceApple)
        .where(inArray(schema.deviceApple.deviceId, [...deviceIds]));

      return new Map(rows.map((row) => [row.deviceId, row]));
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

  /** Android ownership/management mode for a page of devices, keyed by id. */
  const androidDeviceAccessFor = (organizationId: string, deviceIds: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      if (deviceIds.length === 0)
        return new Map<
          string,
          { readonly managementMode: string | null; readonly ownership: string | null }
        >();

      const rows = yield* db
        .select({
          deviceId: schema.androidDevice.deviceId,
          managementMode: schema.androidDevice.managementMode,
          ownership: schema.androidDevice.ownership,
        })
        .from(schema.androidDevice)
        .where(
          and(
            eq(schema.androidDevice.organizationId, organizationId),
            inArray(schema.androidDevice.deviceId, [...deviceIds]),
          ),
        );

      return new Map(
        rows.map((row) => [
          row.deviceId,
          { managementMode: row.managementMode, ownership: row.ownership },
        ]),
      );
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
  const rowPushInfo = (apple: typeof schema.deviceApple.$inferSelect | null | undefined) => ({
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
    awaitingConfiguration?: boolean | null,
  ) =>
    deriveDeviceHealth({
      status: device.status,
      awaitingConfiguration: awaitingConfiguration ?? null,
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

  /**
   * Health for a set of devices, derived from rows the caller already loaded.
   *
   * Health is never stored, so every list that shows or orders by it needs the
   * declarations (and ADE setup state) for the same ids. Device pages fetch
   * setup state anyway, so passing it here avoids a second `device_apple` read.
   */
  const deviceHealthFrom = (
    devices: ReadonlyArray<EnterpriseDevice>,
    declarations: ReadonlyArray<typeof schema.deviceDeclaration.$inferSelect>,
    awaitingByDevice: ReadonlyMap<string, boolean | null>,
  ) => {
    const byDevice = new Map<string, Array<(typeof declarations)[number]>>();

    for (const declaration of declarations) {
      const list = byDevice.get(declaration.deviceId) ?? [];
      list.push(declaration);
      byDevice.set(declaration.deviceId, list);
    }

    return new Map(
      devices.map((device) => [
        device.id,
        rowDeviceHealth(
          device,
          byDevice.get(device.id) ?? [],
          awaitingByDevice.get(device.id) ?? null,
        ),
      ]),
    );
  };

  const rowCertificate = (row: typeof schema.scepIssuedCertificate.$inferSelect) => ({
    serial: row.serial,
    notAfter: iso(row.notAfter),
    revokedAt: row.revokedAt ? iso(row.revokedAt) : null,
    createdAt: iso(row.createdAt),
  });

  const rowDeclaration = (declaration: typeof schema.deviceDeclaration.$inferSelect) => ({
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
        enabled: row.enabled ?? true,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      };

      if (withConfigurations) {
        const configurations = yield* db
          .select()
          .from(schema.configuration)
          .where(eq(schema.configuration.policyId, row.id));

        const scopes = Object.fromEntries(
          configurations.filter((item) => item.scope === "user").map((item) => [item.kind, "user"]),
        );

        Object.assign(base, {
          configurations: Object.fromEntries(configurations.map((item) => [item.kind, item.data])),
          ...(Object.keys(scopes).length > 0 ? { configurationScopes: scopes } : {}),
        });
      }

      return base;
    });

  type InstallerInput = {
    id?: string;
    platform: "apple" | "win" | "android";
    source?: "manifest" | "store" | "upload";
    bundleId?: string | null;
    version?: string | null;
    manifestUrl?: string | null;
    storeId?: string | null;
    minOsVersion?: string | null;
    requiredCapability?: string | null;
    priority?: number;
  };

  const installerSource = (input: InstallerInput): "manifest" | "store" | "upload" =>
    input.source ??
    (input.storeId?.trim() ? "store" : input.platform === "android" ? "store" : "manifest");

  const normaliseInstaller = (input: InstallerInput) =>
    Effect.gen(function* () {
      const source = installerSource(input);
      const manifestUrl = input.manifestUrl?.trim() || null;
      const storeId = input.storeId?.trim() || null;
      const bundleId = input.bundleId?.trim() || null;
      const minOsVersion = input.minOsVersion?.trim() || null;

      if (minOsVersion && !/^\d+(\.\d+)*$/.test(minOsVersion))
        return yield* Effect.fail(
          new EnterpriseBadRequest({ message: "Minimum OS version must look like 14 or 14.2.1" }),
        );

      if (input.platform === "apple") {
        if (source === "manifest" && !manifestUrl)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Apple manifest applications require a manifest URL",
            }),
          );

        if (source === "store" && (!storeId || !Number.isSafeInteger(Number(storeId))))
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Apple store applications require a whole-number store ID",
            }),
          );
      }

      if (
        input.platform === "win" &&
        (source === "manifest" || source === "upload") &&
        !manifestUrl
      )
        return yield* Effect.fail(
          new EnterpriseBadRequest({ message: "Windows installers require an installer URL" }),
        );

      if (input.platform === "android" && source !== "store" && !bundleId)
        return yield* Effect.fail(
          new EnterpriseBadRequest({
            message: "Android applications require a Managed Google Play package name",
          }),
        );

      return {
        platform: input.platform,
        source,
        bundleId,
        version: input.version?.trim() || null,
        manifestUrl,
        storeId,
        minOsVersion,
        requiredCapability: input.requiredCapability?.trim() || null,
        priority: Number.isFinite(input.priority) ? Math.trunc(input.priority!) : 0,
      };
    });

  const rowInstaller = (row: typeof schema.applicationInstaller.$inferSelect) => ({
    id: row.id,
    platform: row.platform,
    source: row.source,
    bundleId: row.bundleId,
    version: row.version,
    manifestUrl: row.manifestUrl,
    storeId: row.storeId,
    fileName: row.fileName,
    contentType: row.contentType,
    size: row.size ?? undefined,
    sha256: row.sha256,
    minOsVersion: row.minOsVersion,
    requiredCapability: row.requiredCapability,
    priority: row.priority,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  });

  const applicationInstallers = (organizationId: string, applicationId: string) =>
    db
      .select()
      .from(schema.applicationInstaller)
      .where(
        and(
          eq(schema.applicationInstaller.organizationId, organizationId),
          eq(schema.applicationInstaller.applicationId, applicationId),
        ),
      )
      .pipe(Effect.map((rows) => [...rows].sort(compareInstallerPreference)));

  /** Keep the legacy flat columns on `application` aligned with its best installer. */
  const syncLegacyApplicationInstaller = (organizationId: string, applicationId: string) =>
    Effect.gen(function* () {
      const installers = yield* applicationInstallers(organizationId, applicationId);
      const primary = installers[0];

      if (!primary) return;

      yield* db
        .update(schema.application)
        .set({
          platform: primary.platform,
          source: primary.source,
          bundleId: primary.bundleId,
          version: primary.version,
          manifestUrl: primary.manifestUrl,
          storeId: primary.storeId,
          fileName: primary.fileName,
          contentType: primary.contentType,
          size: primary.size,
          sha256: primary.sha256,
          r2Key: primary.r2Key,
          updatedAt: now(),
        })
        .where(
          and(
            eq(schema.application.id, applicationId),
            eq(schema.application.organizationId, organizationId),
          ),
        );
    });

  const replaceApplicationInstallers = (input: {
    organizationId: string;
    applicationId: string;
    installers: ReadonlyArray<InstallerInput>;
  }) =>
    Effect.gen(function* () {
      const existing = yield* applicationInstallers(input.organizationId, input.applicationId);
      const byId = new Map(existing.map((row) => [row.id, row]));
      const keep = new Set<string>();
      const at = now();

      for (const installer of input.installers) {
        const values = yield* normaliseInstaller(installer);
        const current = installer.id ? byId.get(installer.id) : undefined;

        if (current) {
          keep.add(current.id);
          yield* db
            .update(schema.applicationInstaller)
            .set({ ...values, updatedAt: at })
            .where(
              and(
                eq(schema.applicationInstaller.id, current.id),
                eq(schema.applicationInstaller.organizationId, input.organizationId),
              ),
            );
        } else {
          const installerId = id();

          keep.add(installerId);
          yield* db.insert(schema.applicationInstaller).values({
            id: installerId,
            organizationId: input.organizationId,
            applicationId: input.applicationId,
            ...values,
            createdAt: at,
            updatedAt: at,
          });
        }
      }

      const removed = existing.filter((row) => !keep.has(row.id));

      for (const row of removed)
        yield* db
          .delete(schema.applicationInstaller)
          .where(eq(schema.applicationInstaller.id, row.id));

      // Remove the objects only after their rows are gone, so a failed delete
      // leaves an orphan rather than a row pointing at a missing file.
      for (const row of removed)
        if (row.r2Key)
          yield* Effect.tryPromise(() => storage.delete(row.r2Key!)).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning(
                `Failed to delete application installer object ${row.r2Key}: ${String(cause)}`,
              ),
            ),
          );

      yield* syncLegacyApplicationInstaller(input.organizationId, input.applicationId);
    });

  const rowApplication = (
    row: EnterpriseApplication,
    groupsCount = 0,
    devicesCount = 0,
    installers: ReadonlyArray<ReturnType<typeof rowInstaller>> = [],
  ) => ({
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
    installers,
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
   * Drop challenges that were minted but never redeemed. Changing the
   * enrollment settings or rotating its id must invalidate profile links that
   * were already handed out; consumed rows are kept as the replay record.
   */
  const invalidateUnusedScepChallenges = (organizationId: string) =>
    db
      .delete(schema.scepChallenge)
      .where(
        and(
          eq(schema.scepChallenge.organizationId, organizationId),
          isNull(schema.scepChallenge.consumedAt),
        ),
      );

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

  const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

  /**
   * Upper bound on inventory rows read for one search.
   *
   * Search runs per keystroke, so a tenant-wide scan of every device/application
   * pair is not acceptable. The query orders rows deterministically before
   * applying this cap; when the cap is reached, device counts only cover the
   * rows that were read. That trade-off is deliberate: the alternative is an
   * unbounded per-keystroke read.
   */
  const SOFTWARE_SEARCH_MAX_ROWS = 10_000;

  /**
   * Collapse per-device inventory rows into one command-palette result per
   * app/version/publisher.
   *
   * The count needs every matching device in the capped set, but only the
   * sorted, sliced output is returned, so the caller still sees at most
   * `limit` rows. Choosing the smallest name/short version and sorting
   * explicitly keeps the result independent of the order MySQL returned the
   * inventory in.
   */
  const aggregateSoftwareSearchRows = (
    rows: ReadonlyArray<{
      readonly deviceId: string;
      readonly bundleId: string;
      readonly name: string | null;
      readonly version: string | null;
      readonly shortVersion: string | null;
      readonly publisher: string | null;
    }>,
    limit: number,
  ) => {
    type Group = {
      bundleId: string;
      name: string | null;
      version: string | null;
      shortVersion: string | null;
      publisher: string | null;
      devices: Set<string>;
    };

    const groups = new Map<string, Group>();

    for (const row of rows) {
      const key = [row.bundleId, row.version ?? "", row.publisher ?? ""].join("\u0000");

      const group = groups.get(key) ?? {
        bundleId: row.bundleId,
        name: null,
        version: row.version,
        shortVersion: null,
        publisher: row.publisher,
        devices: new Set<string>(),
      };

      if (row.name && (!group.name || row.name < group.name)) group.name = row.name;

      if (row.shortVersion && (!group.shortVersion || row.shortVersion < group.shortVersion))
        group.shortVersion = row.shortVersion;

      group.devices.add(row.deviceId);
      groups.set(key, group);
    }

    return [...groups.values()]
      .map((group) => ({
        name: group.name ?? group.bundleId,
        bundleId: group.bundleId,
        version: group.version,
        shortVersion: group.shortVersion,
        publisher: group.publisher,
        deviceCount: group.devices.size,
      }))
      .sort(
        (left, right) =>
          compareText(left.name, right.name) ||
          compareText(left.bundleId, right.bundleId) ||
          compareText(left.version ?? "", right.version ?? "") ||
          compareText(left.publisher ?? "", right.publisher ?? ""),
      )
      .slice(0, limit);
  };

  /**
   * Build the tenant-scoped `WHERE` clause shared by the device search and CSV
   * export endpoints. Group filtering resolves the membership list up front
   * (one extra query) instead of joining per row.
   */
  const deviceSearchWhere = (organizationId: string, filters: DeviceSearchFilters) =>
    Effect.gen(function* () {
      const conditions: SQL[] = [eq(schema.device.organizationId, organizationId)];

      if (filters.q) {
        const query = filters.q;
        const pattern = `%${escapeLike(query)}%`;

        // Every branch is a plain predicate or a set-based subquery, so the
        // caller keeps one `WHERE` (search and CSV export share it).
        const search: SQL[] = [
          like(schema.device.name, pattern),
          like(schema.device.physicalName, pattern),
          like(schema.device.serial, pattern),
          like(schema.device.model, pattern),
          like(schema.device.modelIdentifier, pattern),
          like(schema.device.dmIdentifier, pattern),
          like(schema.device.assetTag, pattern),
          like(schema.device.notes, pattern),
          like(schema.device.osVersion, pattern),
          like(schema.device.osEdition, pattern),
          like(schema.device.osBuild, pattern),
        ];

        // The platform column stores `apple`/`win`/`android` while the table
        // renders `Apple`/`Windows`/`Android`, so "windows" can only match by
        // label. Status values are stored verbatim, where the table shows them.
        const platforms = deviceSearchPlatforms(query);
        const statuses = deviceSearchStatuses(query);

        if (platforms.length > 0) search.push(inArray(schema.device.proto, platforms));

        if (statuses.length > 0) search.push(inArray(schema.device.status, statuses));

        // Group names are a column the table shows. The subquery keeps the
        // membership lookup in SQL and tenant-scoped by the group row it joins.
        search.push(
          inArray(
            schema.device.id,
            db
              .select({ deviceId: schema.groupDevice.deviceId })
              .from(schema.groupDevice)
              .innerJoin(
                schema.enterpriseGroup,
                eq(schema.groupDevice.groupId, schema.enterpriseGroup.id),
              )
              .where(
                and(
                  eq(schema.enterpriseGroup.organizationId, organizationId),
                  like(schema.enterpriseGroup.name, pattern),
                ),
              ),
          ),
        );

        // Attribute values are visible as extra table columns.
        search.push(
          inArray(
            schema.device.id,
            db
              .select({ deviceId: schema.deviceAttribute.deviceId })
              .from(schema.deviceAttribute)
              .where(
                and(
                  eq(schema.deviceAttribute.organizationId, organizationId),
                  like(schema.deviceAttribute.value, pattern),
                ),
              ),
          ),
        );

        // Timestamps are stored in UTC. Matching them through `date_format`
        // keeps the search set-based; the helper only returns formats for
        // date-shaped queries, so name/serial searches never touch the column.
        const timestampFormats = deviceSearchTimestampFormats(query);

        if (timestampFormats.length > 0) {
          const timestamps = or(
            ...timestampFormats.flatMap((format) => {
              const patternFor = (column: AnyColumn) =>
                like(sql`date_format(${column}, ${sql.raw(`'${format}'`)})`, pattern);

              return [patternFor(schema.device.lastSeenAt), patternFor(schema.device.enrolledAt)];
            }),
          );

          if (timestamps) search.push(timestamps);
        }

        const condition = or(...search);

        if (condition) conditions.push(condition);
      }

      for (const [key, value] of Object.entries(filters.attributes ?? {}))
        conditions.push(
          inArray(
            schema.device.id,
            db
              .select({ deviceId: schema.deviceAttribute.deviceId })
              .from(schema.deviceAttribute)
              .innerJoin(
                schema.attributeDefinition,
                eq(schema.attributeDefinition.id, schema.deviceAttribute.attributeId),
              )
              .where(
                and(
                  eq(schema.deviceAttribute.organizationId, organizationId),
                  eq(schema.attributeDefinition.organizationId, organizationId),
                  eq(schema.attributeDefinition.key, key),
                  eq(schema.deviceAttribute.value, value),
                ),
              ),
          ),
        );

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

        const awaiting = deviceIds.length
          ? yield* db
              .select({
                deviceId: schema.deviceApple.deviceId,
                awaitingConfiguration: schema.deviceApple.awaitingConfiguration,
              })
              .from(schema.deviceApple)
              .where(inArray(schema.deviceApple.deviceId, deviceIds))
          : [];

        const awaitingByDevice = new Map(
          awaiting.map((row) => [row.deviceId, row.awaitingConfiguration]),
        );

        const byDevice = new Map<string, Array<(typeof declarations)[number]>>();

        for (const declaration of declarations) {
          const list = byDevice.get(declaration.deviceId) ?? [];
          list.push(declaration);
          byDevice.set(declaration.deviceId, list);
        }

        const matching = devices
          .filter((device: EnterpriseDevice) => {
            const health = rowDeviceHealth(
              device,
              byDevice.get(device.id) ?? [],
              awaitingByDevice.get(device.id) ?? null,
            );

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

      if (filters.setup) {
        // ADE setup state is stored on `device_apple`; the subquery keeps the
        // filter set-based and tenant scoping remains on the outer device query.
        const appleDevices = db
          .select({ deviceId: schema.deviceApple.deviceId })
          .from(schema.deviceApple);

        conditions.push(
          filters.setup === "awaiting"
            ? inArray(
                schema.device.id,
                db
                  .select({ deviceId: schema.deviceApple.deviceId })
                  .from(schema.deviceApple)
                  .where(eq(schema.deviceApple.awaitingConfiguration, true)),
              )
            : // "Complete" includes devices with no ADE row (Windows, Android,
              // and Apple devices that never awaited configuration).
              (or(
                inArray(
                  schema.device.id,
                  db
                    .select({ deviceId: schema.deviceApple.deviceId })
                    .from(schema.deviceApple)
                    .where(eq(schema.deviceApple.awaitingConfiguration, false)),
                ),
                notInArray(schema.device.id, appleDevices),
              ) ?? sql`false`),
        );
      }

      if (filters.activation) {
        // Only Windows can report activation. `unknown` also covers Windows
        // devices that have not run the agent yet; every other platform never
        // matches, so a Mac can never appear in an "unactivated" filter.
        conditions.push(eq(schema.device.proto, "win"));

        const activation = schema.device.windowsActivationStatus;

        if (filters.activation === "unknown")
          conditions.push(or(eq(activation, "unknown"), isNull(activation)) ?? sql`false`);
        else conditions.push(eq(activation, filters.activation));
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

  /**
   * Administrative order for activation sorting: unreported, activated, not,
   * unknown. Unreported sorts first, matching the SQL ordering where the
   * nullable column sorts before the stored enum values.
   */
  const activationSortRank = (status: string | null | undefined): number => {
    switch (status) {
      case "activated":
        return 0;
      case "not-activated":
        return 1;
      case "unknown":
        return 2;
      default:
        return -1;
    }
  };

  /** Human label for exports; the raw enum stays on the API payload. */
  const windowsActivationLabel = (status: string | null | undefined): string => {
    switch (status) {
      case "activated":
        return "Activated";
      case "not-activated":
        return "Not activated";
      case "unknown":
        return "Unknown";
      default:
        return "Not reported";
    }
  };

  const deviceOrderColumn = (sort: DeviceSearchFilters["sort"]): AnyColumn | SQL => {
    switch (sort) {
      case "lastSeenAt":
        return schema.device.lastSeenAt;
      case "enrolledAt":
        return schema.device.enrolledAt;
      case "status":
        return schema.device.status;
      case "activation":
        // The stored enum sorts alphabetically into administrative order
        // (activated, not-activated, unknown). Unreported Windows devices are
        // null and sort first ascending.
        return schema.device.windowsActivationStatus;
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
    subjectAccountId: string,
    filters: AuditSearchFilters,
    take: number,
  ) =>
    Effect.gen(function* () {
      const rows = yield* db
        .select()
        .from(schema.accountAuditLog)
        .where(accountAuditWhere(schema, subjectAccountId, filters))
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
   * A freshly signed MDM enrollment profile for one tenant.
   *
   * Return to Service embeds this for devices that are not managed through
   * ADE (Apple requires `MDMProfileData` there). ADE devices re-fetch their
   * profile from the ADE enrollment URL, so the caller omits it for them.
   */
  const tenantSignedEnrollmentProfile = (organizationId: string) =>
    Effect.gen(function* () {
      const [apns, organization] = yield* Effect.all([
        db.query.applePushCertificate.findFirst({ where: { organizationId } }),
        db.query.organization.findFirst({ where: { id: organizationId } }),
      ]);

      if (!apns?.topic)
        return yield* Effect.fail(
          new EnterpriseNotConfigured({
            message: "Apple push notifications are not configured for this tenant.",
          }),
        );

      if (!organization)
        return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant not found." }));

      const branding = resolveTenantBranding(organization);
      const enrollment = yield* getOrCreateEnrollment(organizationId);

      const { challenge } = yield* issueScepChallenge(db, {
        enrollmentId: enrollment.id,
        organizationId,
        authSecret: authSecret ?? "",
        ttlSeconds: enrollmentProfileTtlSeconds,
      }).pipe(
        Effect.mapError(
          () =>
            new EnterpriseBadRequest({
              message: "Could not create the SCEP challenge for the enrollment profile.",
            }),
        ),
      );

      const plist = yield* serializePlist(
        enterpriseEnrollmentProfile({
          origin,
          topic: apns.topic,
          organizationId,
          organizationName: branding.displayName,
          supportEmail: branding.supportEmail,
          challenge,
        }),
      );

      return yield* signAppleEnrollmentProfile(plist, organizationId);
    });

  /** The signed profile an ADE device installs during Setup Assistant. */
  const adeEnrollmentProfileFor = (input: {
    readonly organizationId: string;
    readonly profileUuid: string;
    readonly displayName: string;
  }) =>
    Effect.gen(function* () {
      const [apns, organization] = yield* Effect.all([
        db.query.applePushCertificate.findFirst({
          where: { organizationId: input.organizationId },
        }),
        db.query.organization.findFirst({ where: { id: input.organizationId } }),
      ]);

      if (!apns?.topic)
        return yield* Effect.fail(
          new EnterpriseNotConfigured({
            message: "Apple push notifications are not configured for this tenant.",
          }),
        );

      if (!organization)
        return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant not found." }));

      const branding = resolveTenantBranding(organization);

      // The same builder backs the inline Authenticate response in the MDM
      // backend, so the two delivery paths cannot drift.
      return yield* buildAdeEnrollmentProfile({
        db,
        origin,
        authSecret,
        organizationId: input.organizationId,
        topic: apns.topic,
        organizationName: branding.displayName,
        supportEmail: branding.supportEmail,
        profileUuid: input.profileUuid,
        displayName: input.displayName,
        ttlSeconds: enrollmentProfileTtlSeconds,
        sign: (plist) => signAppleEnrollmentProfile(plist, input.organizationId),
      }).pipe(
        Effect.mapError((error) =>
          error instanceof ScepError
            ? new EnterpriseBadRequest({
                message: "Could not create the SCEP challenge for the ADE profile.",
              })
            : error,
        ),
      );
    });

  /**
   * Public SCEP endpoint for a tenant. The tenant id is part of the path because
   * SCEP clients append their own `?operation=...` query to the configured URL.
   */
  const scepUrlFor = (organizationId: string) =>
    `${origin}/mdm/apple/scep/${encodeURIComponent(organizationId)}`;

  const tenantScepCaInfo = (organizationId: string, state: ScepCaState): TenantScepCaInfo => ({
    configured: state.configured,
    scepUrl: scepUrlFor(organizationId),
    source: state.source,
    commonName: state.commonName,
    fingerprintSha256: state.fingerprintSha256,
    serialNumber: state.serialNumber,
    notBefore: state.notBefore,
    notAfter: state.notAfter,
    daysLeft: state.health?.daysLeft ?? null,
    level: state.configured ? (state.health?.level ?? "unknown") : "missing",
    rotationDue: state.health?.rotationDue ?? false,
    rotationDueAt: state.health?.rotationDueAt.toISOString() ?? null,
    retiring: state.retiring,
    unattributedIdentities: state.unattributedIdentities,
    untrustedIdentities: state.untrustedIdentities,
    createdAt: state.createdAt,
    rotatedAt: state.rotatedAt,
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
    options: { readonly includeApplications?: boolean } = {},
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

      if (ids.length === 0) return [];

      // Declarations, installed applications and ADE state are independent
      // reads over the same id set; one wave instead of three sequential ones.
      const [declarations, applications, awaiting] = yield* Effect.all(
        [
          queryEffect(
            db
              .select()
              .from(schema.deviceDeclaration)
              .where(inArray(schema.deviceDeclaration.deviceId, ids)),
          ),
          queryEffect(
            // Count-only device stats do not render rows, so the application
            // inventory scan is skipped unless the query actually references apps.
            options.includeApplications === false
              ? emptyRows<{ deviceId: string; bundleId: string; name: string | null }>()
              : db
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
                  ),
          ),
          queryEffect(
            db
              .select({
                deviceId: schema.deviceApple.deviceId,
                awaitingConfiguration: schema.deviceApple.awaitingConfiguration,
              })
              .from(schema.deviceApple)
              .where(inArray(schema.deviceApple.deviceId, ids)),
          ),
        ],
        { concurrency: "unbounded" },
      );

      const awaitingByDevice = new Map(
        awaiting.map((row) => [row.deviceId, row.awaitingConfiguration]),
      );

      const declarationsByDevice = new Map<string, Array<(typeof declarations)[number]>>();

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
        health: rowDeviceHealth(
          row,
          declarationsByDevice.get(row.id) ?? [],
          awaitingByDevice.get(row.id) ?? null,
        ),
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
        return ["Healthy", "Attention", "Missing", "Critical", "Unknown"];
      case "platform":
        return ["Apple", "Windows", "Android", "Unknown"];
      default:
        return undefined;
    }
  };

  /** Whether any clause of a dashboard query needs installed-application data. */
  const deviceQueryNeedsApplications = (query: DeviceQuery): boolean =>
    (query.all ?? [])
      .concat(query.any ?? [], query.none ?? [])
      .some((condition) => condition.field === "application");

  const isUnfilteredDeviceQuery = (query: DeviceQuery): boolean =>
    (query.all?.length ?? 0) === 0 &&
    (query.any?.length ?? 0) === 0 &&
    (query.none?.length ?? 0) === 0;

  type DeviceDashboardSnapshot = {
    row: typeof schema.device.$inferSelect;
    health: ReturnType<typeof rowDeviceHealth>;
    applications: ReadonlyArray<{ bundleId: string; name: string | null }>;
  };

  /** A stat card renders only `total`. */
  const dashboardCountOnly = (payload: DashboardQueryRequest): boolean =>
    payload.countOnly === true && payload.dataset === "devices" && !payload.groupBy;

  /**
   * Device health is derived rather than stored, so everything that needs it
   * loads one snapshot of the matching devices. The whole-fleet read is skipped
   * for an unfiltered count, which MySQL can answer directly.
   */
  const dashboardNeedsSnapshot = (payload: DashboardQueryRequest): boolean =>
    !(
      payload.dataset === "devices" &&
      dashboardCountOnly(payload) &&
      isUnfilteredDeviceQuery(payload.query)
    );

  const dashboardSnapshot = (
    organizationId: string,
    payloads: ReadonlyArray<DashboardQueryRequest>,
  ) =>
    loadDeviceSnapshots(organizationId, undefined, {
      includeApplications: payloads.some(
        (payload) => payload.dataset === "devices" && deviceQueryNeedsApplications(payload.query),
      ),
    });

  const matchingSnapshots = (
    snapshots: ReadonlyArray<DeviceDashboardSnapshot>,
    payload: DashboardQueryRequest,
    timestamp: Date,
  ) =>
    snapshots.filter((snapshot) =>
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

  const projectDeviceDashboardQuery = (
    payload: DashboardQueryRequest,
    matches: ReadonlyArray<DeviceDashboardSnapshot>,
    timestamp: Date,
  ) => {
    const limit = Math.min(Math.max(Math.trunc(Number(payload.limit ?? 100)) || 100, 1), 500);

    if (dashboardCountOnly(payload)) return { total: matches.length, buckets: [], rows: [] };

    const buckets = payload.groupBy
      ? toBuckets(
          matches.map((snapshot) =>
            deviceBucket(snapshot.row, payload.groupBy!, snapshot.health, timestamp),
          ),
          groupBucketOrder(payload.groupBy),
        )
      : [];

    return {
      total: matches.length,
      buckets,
      rows: matches.slice(0, limit).map((snapshot) => ({
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
  };

  type DeviceApplicationRow = typeof schema.deviceApplication.$inferSelect;

  /**
   * One installed-application read for every software widget in a batch.
   *
   * Software widgets bucket the same rows by bundle id, so loading them once
   * avoids one whole-fleet inventory scan per widget.
   */
  const loadApplicationsByDevice = (organizationId: string, deviceIds: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const byDevice = new Map<string, DeviceApplicationRow[]>();

      if (deviceIds.length === 0) return byDevice;

      const rows = yield* db
        .select()
        .from(schema.deviceApplication)
        .where(
          and(
            eq(schema.deviceApplication.organizationId, organizationId),
            inArray(schema.deviceApplication.deviceId, [...deviceIds]),
          ),
        );

      for (const row of rows) {
        const list = byDevice.get(row.deviceId);

        if (list) list.push(row);
        else byDevice.set(row.deviceId, [row]);
      }

      return byDevice;
    });

  const projectSoftwareDashboardQuery = (
    organizationId: string,
    payload: DashboardQueryRequest,
    matches: ReadonlyArray<DeviceDashboardSnapshot>,
    sharedApplications?: ReadonlyMap<string, ReadonlyArray<DeviceApplicationRow>>,
  ) =>
    Effect.gen(function* () {
      const limit = Math.min(Math.max(Math.trunc(Number(payload.limit ?? 100)) || 100, 1), 500);
      const matchingIds = matches.map((snapshot) => snapshot.row.id);

      const applications = sharedApplications
        ? matchingIds.flatMap((id) => sharedApplications.get(id) ?? [])
        : matchingIds.length
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

  const evaluateDashboardQuery = (
    organizationId: string,
    payload: DashboardQueryRequest,
    snapshots: ReadonlyArray<DeviceDashboardSnapshot> | null,
    timestamp: Date,
    sharedApplications?: ReadonlyMap<string, ReadonlyArray<DeviceApplicationRow>>,
  ) =>
    Effect.gen(function* () {
      if (
        payload.dataset === "devices" &&
        snapshots === null &&
        dashboardCountOnly(payload) &&
        isUnfilteredDeviceQuery(payload.query)
      ) {
        const [row] = yield* db
          .select({ value: count() })
          .from(schema.device)
          .where(eq(schema.device.organizationId, organizationId));

        return { total: Number(row?.value ?? 0), buckets: [], rows: [] };
      }

      const matches = matchingSnapshots(snapshots ?? [], payload, timestamp);

      return payload.dataset === "devices"
        ? projectDeviceDashboardQuery(payload, matches, timestamp)
        : yield* projectSoftwareDashboardQuery(
            organizationId,
            payload,
            matches,
            sharedApplications,
          );
    });

  const runDashboardQuery = (organizationId: string, payload: DashboardQueryRequest) =>
    Effect.gen(function* () {
      const timestamp = now();

      const snapshots = dashboardNeedsSnapshot(payload)
        ? yield* dashboardSnapshot(organizationId, [payload])
        : null;

      return yield* evaluateDashboardQuery(organizationId, payload, snapshots, timestamp);
    });

  /**
   * Evaluate every widget of a dashboard against one tenant snapshot.
   *
   * Each widget used to be its own request and its own whole-fleet read, so a
   * default overview paid for the device table (and health/declaration reads)
   * five times. Queries share the snapshot here and are evaluated in memory;
   * only unfiltered stat cards still need their own `COUNT(*)`.
   */
  const runDashboardQueryBatch = (
    organizationId: string,
    payloads: ReadonlyArray<DashboardQueryRequest>,
  ) =>
    Effect.gen(function* () {
      if (payloads.length === 0) return { results: [] };

      const timestamp = now();

      const snapshots = payloads.some(dashboardNeedsSnapshot)
        ? yield* dashboardSnapshot(organizationId, payloads)
        : null;

      // Several software widgets bucket the same inventory, so read it once.
      const sharedApplications =
        snapshots && payloads.filter((payload) => payload.dataset === "software").length > 1
          ? yield* loadApplicationsByDevice(
              organizationId,
              snapshots.map((snapshot) => snapshot.row.id),
            )
          : undefined;

      const results = yield* Effect.all(
        payloads.map((payload) =>
          evaluateDashboardQuery(organizationId, payload, snapshots, timestamp, sharedApplications),
        ),
        { concurrency: "unbounded" },
      );

      return { results };
    });

  const mePayload = (user: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
    readonly emailVerified: boolean;
    readonly image?: string | null;
    readonly totpEnabled?: boolean | null;
    readonly passkeyEnabled?: boolean | null;
    readonly defaultTenantId?: string | null;
  }) =>
    Effect.gen(function* () {
      // Do not disclose tenant membership to an unverified account. The
      // verification screen only needs the user record.
      const info = user.emailVerified
        ? yield* listTenantInfo(user.id)
        : { tenants: [], mfaRequired: false };

      const { tenants } = info;

      // A stale choice (the account left the tenant) is reported as null so
      // every client applies the same precedence without extra membership
      // checks.
      const defaultTenantId =
        user.defaultTenantId && tenants.some((tenant) => tenant.id === user.defaultTenantId)
          ? user.defaultTenantId
          : null;

      const mfaRequired = info.mfaRequired;

      return {
        account: {
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          image: user.image,
          mfaEnabled: hasMfaFactor(user),
          totpEnabled: user.totpEnabled === true,
          passkeyEnabled: user.passkeyEnabled === true,
          mfaRequired,
          defaultTenantId,
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

      // The enterprise itself outlives its devices: deleting it removes the
      // enterprise-wide baseline policy and anything Google still holds, so a
      // deleted tenant cannot leave a managed Android estate behind.
      if (androidDevices.length > 0) {
        const android = yield* Effect.serviceOption(AndroidManagement);

        const enterprise = yield* loadAndroidEnterprise(db, organizationId).pipe(
          Effect.catch(() => Effect.succeed(undefined)),
        );

        if (enterprise?.enterpriseName && isAndroidConfigured(androidConfig)) {
          const removed = Option.isSome(android)
            ? yield* disconnectAndroidEnterprise({
                db,
                config: androidConfig,
                organizationId,
              }).pipe(
                Effect.provideService(AndroidManagement, android.value),
                Effect.match({ onFailure: () => false, onSuccess: () => true }),
              )
            : false;

          if (!removed)
            unreachable.push({
              id: enterprise.enterpriseName,
              name: "Android enterprise",
              platform: "android",
              reason:
                "The Google enterprise could not be deleted, so its policies and device records remain in Google.",
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
    mcpContext: (request) =>
      Effect.gen(function* () {
        const { user, apiToken, oauth } = yield* auth.requireUser({ headers: request.headers });
        yield* identifyUser(user);
        const me = yield* mePayload(user);

        // A tenant-bound token only advertises that tenant; other ids would
        // fail `requireTenant` and confuse the agent.
        const tenants = apiToken?.tenantId
          ? me.tenants.filter((tenant) => tenant.id === apiToken.tenantId)
          : me.tenants;

        // The role union is what a browser session can do; a bearer credential
        // is then narrowed to its own grant. The MCP gateway uses the result to
        // hide tools the caller could never invoke.
        const roleUnion = new Set(tenants.flatMap((tenant) => tenant.permissions));

        const scopes = apiToken
          ? parseStoredCredentialScopes(apiToken.scopes)
          : oauth
            ? oauth.scopes
            : null;

        const granted = scopes ? credentialPermissions(scopes) : undefined;

        const effective = granted
          ? new Set([...granted].filter((permission) => roleUnion.has(permission)))
          : roleUnion;

        const methods = [
          ...Object.keys(enterpriseApi.endpoints),
          ...Object.keys(enterpriseAttributeApi.endpoints),
        ].filter((method) => {
          const permission = permissionForMethod(method);

          return permission !== undefined && effective.has(permission);
        });

        return {
          me: { ...me, tenants },
          permissions: PERMISSIONS.filter((permission) => effective.has(permission)),
          methods,
        };
      }),
    bootstrap: (request) =>
      Effect.gen(function* () {
        const { user, session } = yield* auth.requireUser({ headers: request.headers });
        yield* identifyUser(user);

        const me = yield* mePayload(user);

        // /api/* is a public Workers route, so a browser can call bootstrap
        // directly. Only the website Worker consumes the SSR snapshot, and it
        // reaches the API over the service binding, which does not cross the
        // Cloudflare edge (no `cf-ray`). Redact the token pair for anything
        // that arrived through the edge: `session` and `me` are the caller's
        // own data, but the edge token is internal.
        const internalRequest = !request.headers["cf-ray"];

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
          authSecret && boundCookie && internalRequest
            ? yield* signSsrToken(authSecret, {
                subjectId: user.id,
                sessionId: session.sessionId,
                sessionCookie: boundCookie,
                name: user.name,
                email: user.email,
                emailVerified: user.emailVerified,
                authRevision: user.authRevision,
                account: me.account,
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

        const body: { name?: string; image?: string | null; defaultTenantId?: string | null } =
          payload;

        // The select submits an empty string when nothing is chosen; both that
        // and `null` mean "clear the account default".
        const defaultTenantId = body.defaultTenantId === "" ? null : body.defaultTenantId;

        // A default tenant is a promise the account can land there, so a
        // non-member choice is rejected rather than stored and quietly
        // ignored later. Clearing it is always allowed.
        if (defaultTenantId) {
          const membership = yield* db.query.member.findFirst({
            where: { accountId: user.id, organizationId: defaultTenantId },
          });

          if (!membership)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: "You are not a member of that tenant." }),
            );
        }

        yield* db
          .update(schema.account)
          .set({
            name: body.name ?? user.name,
            image: body.image === undefined ? user.image : body.image,
            defaultTenantId:
              body.defaultTenantId === undefined ? user.defaultTenantId : defaultTenantId,
            updatedAt: now(),
          })
          .where(eq(schema.account.id, user.id));

        return ok;
      }),
    deleteMe: (request) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });
        yield* identifyUser(user);

        // Remove solo tenants with the account; keep shared tenants for the
        // remaining administrators.
        const memberships = yield* db.query.member.findMany({
          where: { accountId: user.id },
        });

        for (const membership of memberships) {
          const [members] = yield* db
            .select({ value: count() })
            .from(schema.member)
            .where(eq(schema.member.organizationId, membership.organizationId));

          if ((members?.value ?? 0) <= 1) {
            // A solo tenant is deleted with the account, so its subscription,
            // devices and objects must be reclaimed exactly as the explicit
            // tenant delete does. A failed teardown keeps both rows so the
            // operator can retry instead of silently leaving Stripe billing.
            const [organization] = yield* db
              .select()
              .from(schema.organization)
              .where(eq(schema.organization.id, membership.organizationId))
              .limit(1);

            if (!organization)
              return yield* Effect.fail(
                new EnterpriseDbError({ message: "The tenant could not be loaded for deletion" }),
              );

            yield* teardownTenant(db, storage, {
              organizationId: organization.id,
              actor: { id: user.id, email: user.email },
              deps: {
                preflight: () => preflightTeardown(organization),
                unenrollDevices: teardownDevices,
                cancelSubscription: teardownSubscription,
              },
            }).pipe(
              Effect.mapError(
                (cause) =>
                  new EnterpriseDbError({
                    message: `${cause.message} The account was kept so the deletion can be retried.`,
                  }),
              ),
            );
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

        yield* db
          .delete(schema.accountApiToken)
          .where(eq(schema.accountApiToken.accountId, user.id));
        yield* db.delete(schema.invitation).where(eq(schema.invitation.inviterId, user.id));
        yield* db.delete(schema.member).where(eq(schema.member.accountId, user.id));

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
          subjectAccountId: user.id,
          subjectEmail: user.email,
          action: ACCOUNT_AUDIT.deleted,
          targetType: "account",
        }).pipe(Effect.catchCause(() => Effect.void));

        yield* db.delete(schema.account).where(eq(schema.account.id, user.id));

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
    listLoginAttempts: (request) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });
        yield* identifyUser(user);

        const rows = yield* listLoginAttempts(db, user.id, LOGIN_ATTEMPT_LIST_LIMIT);

        return { attempts: rows.map(loginAttemptEntry) };
      }),
    revokeAccountSession: (request, sessionId) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });
        yield* identifyUser(user);
        const revoked = yield* revokeUserSession(db, user.id, sessionId);

        if (!revoked)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Session not found" }));

        yield* recordAccountAudit(db, {
          subjectAccountId: user.id,
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
          .update(schema.account)
          .set({ authRevision: id(), updatedAt: now() })
          .where(eq(schema.account.id, user.id));

        yield* recordAccountAudit(db, {
          subjectAccountId: user.id,
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

        return { entries: page.map((entry) => accountAuditEntry(entry)), nextCursor };
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

        const entries = (truncated ? rows.slice(0, AUDIT_EXPORT_MAX_ROWS) : rows).map((entry) =>
          accountAuditEntry(entry),
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
        const { tenants } = yield* listTenantInfo(user.id);

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
          accountId: user.id,
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
          { account: user, organization: { id: tenantId } },
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
          actor: { accountId: ctx.account.id, email: ctx.account.email },
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
          accountId: ctx.account.id,
          email: ctx.account.email,
        }).pipe(Effect.mapError(backupActionFailure));

        return backupRunInfo(run);
      }),
    unpinTenantBackup: (request, tenantId, backupId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* requireStepUp(auth, request, "backup-pin");

        const run = yield* setBackupRetention(db, ctx.organization.id, backupId, "default", {
          accountId: ctx.account.id,
          email: ctx.account.email,
        }).pipe(Effect.mapError(backupActionFailure));

        return backupRunInfo(run);
      }),
    deleteTenantBackup: (request, tenantId, backupId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* requireStepUp(auth, request, "backup-delete");

        yield* deleteBackupRun(db, storage, ctx.organization.id, backupId, {
          accountId: ctx.account.id,
          email: ctx.account.email,
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
          actor: { accountId: ctx.account.id, email: ctx.account.email },
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

        if (!user.emailVerified)
          return yield* Effect.fail(
            new EnterpriseForbidden({
              message: "Verify your email address before importing a tenant.",
            }),
          );

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
        const policyConfigurationScopes = new Map<string, Record<string, "device" | "user">>();

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
          const scopes: Record<string, "device" | "user"> = {};

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
            const scope = policy.configurationScopes?.[kind] ?? "device";

            if (scope === "user") scopes[kind] = "user";

            yield* validateConfiguration(kind, configuration, {
              escrowCertificateFingerprintSha256: null,
              scope,
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
          if (Object.keys(scopes).length > 0) policyConfigurationScopes.set(key, scopes);
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
              accountId: user.id,
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
                enabled: policy.enabled ?? true,
                createdAt: timestamp,
                updatedAt: timestamp,
              });
              const configurations = policyConfigurations.get(policy.key) ?? [];
              const scopes = policyConfigurationScopes.get(policy.key) ?? {};

              if (configurations.length > 0) {
                const values = yield* Effect.all(
                  configurations.map(([kind, data]) =>
                    Effect.map(hashJson(data), (hash) => ({
                      policyId,
                      kind,
                      scope: scopes[kind] ?? "device",
                      data,
                      hash,
                    })),
                  ),
                );

                yield* tx.insert(schema.configuration).values(values);
              }

              yield* tx.insert(schema.policyDeployment).values({
                id: id(),
                organizationId: tenantId,
                policyId,
                version: 1,
                snapshot: {
                  ...Object.fromEntries(configurations),
                  ...(Object.keys(scopes).length > 0
                    ? { [POLICY_SNAPSHOT_SCOPES_KEY]: scopes }
                    : {}),
                  ...(policy.enabled === false
                    ? { [POLICY_SNAPSHOT_ENABLED_KEY]: false }
                    : {}),
                },
                createdByAccountId: user.id,
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

            for (const row of preRegistrations) {
              // Devices are not imported, so a consumed serial can never be
              // re-linked. Skipping it prevents a second enrollment.
              if (row.consumedDeviceKey) continue;

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
            }

            yield* tx.insert(schema.auditLog).values({
              id: id(),
              organizationId: tenantId,
              actorAccountId: user.id,
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

        // Keep the Stripe customer label in step with the tenant. Billing is
        // never allowed to fail a rename: the nightly sweep compares names and
        // retries an update that Stripe rejected.
        if (name && stripe && ctx.organization.stripeCustomerId)
          yield* stripe.customers
            .update(ctx.organization.stripeCustomerId, { name })
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning(
                  `Stripe customer rename failed for ${tenantId}: ${String(cause)}`,
                ),
              ),
            );

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
          actor: { id: ctx.account.id, email: ctx.account.email },
          deps: {
            preflight: () => preflightTeardown(ctx.organization),
            unenrollDevices: teardownDevices,
            cancelSubscription: teardownSubscription,
          },
        }).pipe(
          Effect.catchTag("TenantTeardownInProgress", (error) =>
            Effect.fail(
              diagnoseError(new EnterpriseConflict({ message: error.message }), {
                code: "conflict",
                reason: "teardown_in_progress",
                details: { retryAfterSeconds: error.retryAfterSeconds },
              }),
            ),
          ),
          Effect.mapError((cause: TenantTeardownStepFailed | EnterpriseConflict) =>
            cause instanceof EnterpriseConflict
              ? cause
              : diagnoseError(
                  new EnterpriseTenantTeardownFailed({
                    message: `${cause.message} The tenant was kept so the deletion can be retried.`,
                    step: cause.step,
                  }),
                  { code: "teardown_failed", details: { step: cause.step } },
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
          // Lock heartbeat, refreshed as each page completes. The dashboard
          // uses it (not the initial attempt time) to decide a run is stuck.
          lastHeartbeatAt: state?.updatedAt ? iso(state.updatedAt) : null,
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
            approverAccountId: ctx.account.id,
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

        // GUIDs are case-insensitive, so store and compare one canonical form.
        // Re-saving the same id with different casing is not a link change.
        const normalizeAzureTenantId = (value: string | null | undefined) =>
          value?.trim().toLowerCase() || null;

        const previousAzureTenantId = normalizeAzureTenantId(existing?.azureTenantId);

        const nextAzureTenantId =
          body.azureTenantId === undefined
            ? previousAzureTenantId
            : normalizeAzureTenantId(body.azureTenantId);

        const tenantChanged = previousAzureTenantId !== nextAzureTenantId;

        if (nextAzureTenantId) {
          if (
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              nextAzureTenantId,
            )
          )
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: "Enter a valid Entra tenant ID (a GUID from the Entra admin centre)",
              }),
            );
        } else if (body.enabled === true)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Enter the Entra tenant ID before enabling single sign-on",
            }),
          );

        // Linking a different Entra tenant changes which identities can claim
        // member accounts, so only a built-in owner may change it.
        if (tenantChanged && !isBuiltInOwnerMember(ctx.member))
          return yield* Effect.fail(
            new EnterpriseForbidden({
              message: "Only an owner can change the linked Entra tenant",
            }),
          );

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

        // Evidence is evaluated before the rows below are cleared so a real
        // successful sync still authorises revocation of the old link.
        const previousLinkVerified =
          previousAzureTenantId && tenantChanged
            ? yield* entraLinkWasVerified(ctx.organization.id).pipe(
                Effect.catchCause(() => Effect.succeed(false)),
              )
            : false;

        if (tenantChanged) {
          // Delta cursors and imported domains belong to the previous Entra
          // tenant and cannot be reused after a change. The sync timestamps
          // are evidence for that previous link, so clear them too.
          yield* db
            .update(schema.entraDirectorySync)
            .set({
              usersDeltaLink: null,
              groupsDeltaLink: null,
              lastSyncedAt: null,
              domainsSyncedAt: null,
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
              azureTenantId: body.azureTenantId !== undefined ? nextAzureTenantId : undefined,
              autoProvision: body.autoProvision !== undefined ? body.autoProvision : undefined,
              updatedAt: timestamp,
            })
            .where(eq(schema.ssoConfig.organizationId, ctx.organization.id));
        } else {
          yield* db.insert(schema.ssoConfig).values({
            organizationId: ctx.organization.id,
            enabled: body.enabled ?? false,
            azureTenantId: nextAzureTenantId,
            autoProvision: body.autoProvision ?? true,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }

        yield* audit(ctx, "sso.updated", "sso", ctx.organization.id, {
          fields: Object.keys(body),
        });

        // The local unlink is already committed. Anything below is best-effort
        // so a Graph outage cannot trap the tenant in a link it wants removed.
        const consentRevocation =
          previousAzureTenantId && tenantChanged
            ? yield* revokeEntraConsent(ctx, previousAzureTenantId, previousLinkVerified)
            : undefined;

        const config = yield* db.query.ssoConfig.findFirst({
          where: { organizationId: ctx.organization.id },
        });

        return {
          enabled: config?.enabled ?? false,
          azureTenantId: config?.azureTenantId ?? null,
          autoProvision: config?.autoProvision ?? true,
          requireMfa,
          consentRevocation,
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
          tokens: rows.map((row) => {
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
        yield* requireStepUp(auth, request, "scim-token-create");

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
    listWebhookDeliveries: (
      request,
      tenantId,
      webhookId,
      query: WebhookDeliveryQuery | undefined,
    ) =>
      Effect.gen(function* () {
        // `webhooks.read` is enforced by the method→permission mapping; the
        // endpoint lookup keeps one tenant from reading another's history.
        const ctx = yield* requireTenant(request, tenantId);

        yield* loadWebhookEndpoint(ctx.organization.id, webhookId);

        const response: WebhookDeliveriesResponse = yield* listStoredWebhookDeliveries({
          db,
          organizationId: ctx.organization.id,
          endpointId: webhookId,
          query,
        });

        return response;
      }),
    getWebhookDelivery: (request, tenantId, webhookId, deliveryId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        yield* loadWebhookEndpoint(ctx.organization.id, webhookId);

        const row = yield* loadStoredWebhookDelivery({
          db,
          organizationId: ctx.organization.id,
          endpointId: webhookId,
          deliveryId,
        });

        const response: WebhookDeliveryDetail = webhookDeliveryDetail(row);

        return response;
      }),
    replayWebhookDelivery: (request, tenantId, webhookId, deliveryId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const endpoint = yield* loadWebhookEndpoint(ctx.organization.id, webhookId);

        const row = yield* loadStoredWebhookDelivery({
          db,
          organizationId: ctx.organization.id,
          endpointId: endpoint.id,
          deliveryId,
        });

        const payload = Option.getOrNull(Schema.decodeUnknownOption(WebhookPayload)(row.payload));

        if (!payload)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "This delivery has no stored payload to replay.",
            }),
          );

        // The stored payload keeps its event id, so the receiver sees the same
        // `X-Mattrax-Delivery` header as the original delivery.
        const replay = yield* redeliverWebhook(db, { endpoint, payload }, webhookOptions);

        if (!replay.deliveryId)
          return yield* Effect.fail(
            new EnterpriseDbError({ message: "Could not record the replayed delivery" }),
          );

        const recorded = yield* loadStoredWebhookDelivery({
          db,
          organizationId: ctx.organization.id,
          endpointId: endpoint.id,
          deliveryId: replay.deliveryId,
        });

        yield* audit(ctx, "webhook.replayed", "webhook_delivery", row.id, {
          endpointId: endpoint.id,
          replayedAs: recorded.id,
          status: replay.outcome.status,
          responseStatus: replay.outcome.responseStatus,
        });

        const response: WebhookDeliveryReplayResponse = {
          delivery: webhookDeliveryInfo(recorded),
          replayedFrom: row.id,
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

        return { entries: entries.map((entry) => auditEntry(entry)) };
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

        return { entries: page.map((entry) => auditEntry(entry)), nextCursor };
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

        const entries = (truncated ? rows.slice(0, AUDIT_EXPORT_MAX_ROWS) : rows).map((entry) =>
          auditEntry(entry),
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
          createdByAccountId: ctx.account.id,
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
    listTenantAccounts: (request, tenantId) =>
      Effect.gen(function* () {
        yield* requireTenant(request, tenantId);

        const [accounts, customRoles] = yield* Effect.all(
          [
            queryEffect(
              db
                .select({
                  memberId: schema.member.id,
                  accountId: schema.account.id,
                  name: schema.account.name,
                  email: schema.account.email,
                  role: schema.member.role,
                  customRoleId: schema.member.customRoleId,
                  createdAt: schema.member.createdAt,
                })
                .from(schema.member)
                .innerJoin(schema.account, eq(schema.account.id, schema.member.accountId))
                .where(eq(schema.member.organizationId, tenantId)),
            ),
            queryEffect(
              db
                .select({ id: schema.tenantRole.id, name: schema.tenantRole.name })
                .from(schema.tenantRole)
                .where(eq(schema.tenantRole.organizationId, tenantId)),
            ),
          ],
          { concurrency: "unbounded" },
        );

        const custom = new Map(customRoles.map((role) => [role.id, role.name]));

        return {
          accounts: accounts.map((account) => {
            const builtInName = account.role
              .split(",")
              .map((raw) => {
                const part = raw.trim();

                return isBuiltInTenantRole(part) ? BUILT_IN_ROLE_LABELS[part] : part;
              })
              .join(", ");

            return {
              memberId: account.memberId,
              accountId: account.accountId,
              name: account.name,
              email: account.email,
              role: account.role,
              roleId: account.customRoleId ?? null,
              roleName: account.customRoleId
                ? (custom.get(account.customRoleId) ?? builtInName)
                : builtInName,
              roleKind: account.customRoleId ? ("custom" as const) : ("built-in" as const),
              createdAt: iso(account.createdAt),
            };
          }),
        };
      }),
    inviteTenantAccount: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const { account: user } = ctx;

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
          .select({ email: schema.account.email })
          .from(schema.member)
          .innerJoin(schema.account, eq(schema.account.id, schema.member.accountId))
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
        const rawToken = newOneTimeToken();
        const tokenHash = yield* oneTimeTokenHash(rawToken);
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
          idempotencyKey: `${invitationId}:1`,
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

        const tokenHash = yield* oneTimeTokenHash(body.token);

        const invitation = yield* db.query.invitation.findFirst({
          where: { tokenHash },
        });

        if (!invitation)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "Invitation not found or already used" }),
          );

        if (invitation.status === "accepted") {
          const member = yield* db.query.member.findFirst({
            where: { accountId: user.id, organizationId: invitation.organizationId },
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
          where: { accountId: user.id, organizationId: invitation.organizationId },
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
                accountId: user.id,
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
          { account: user, organization: { id: invitation.organizationId } },
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
          where: { tokenHash: yield* oneTimeTokenHash(query.token) },
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

        const inviterIds = [...new Set(invitations.map((item) => item.inviterId))];

        const inviters = inviterIds.length
          ? yield* db
              .select({
                id: schema.account.id,
                name: schema.account.name,
                email: schema.account.email,
              })
              .from(schema.account)
              .where(inArray(schema.account.id, inviterIds))
          : [];

        const inviterById = new Map(inviters.map((inviter) => [inviter.id, inviter]));

        return {
          invitations: invitations.map((item) => {
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

        const custom = customRoles.map((role) => {
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
    getTenantOwnershipTransfer: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "read");

        // Newest first so any duplicate pending rows (a legacy race) are all
        // closed, and the newest remaining request is the one on display.
        const pendingRows = yield* db
          .select({
            id: schema.tenantOwnershipTransfer.id,
            requestedByAccountId: schema.tenantOwnershipTransfer.requestedByAccountId,
            targetAccountId: schema.tenantOwnershipTransfer.targetAccountId,
            createdAt: schema.tenantOwnershipTransfer.createdAt,
            expiresAt: schema.tenantOwnershipTransfer.expiresAt,
            acceptedAt: schema.tenantOwnershipTransfer.acceptedAt,
            cancelledAt: schema.tenantOwnershipTransfer.cancelledAt,
          })
          .from(schema.tenantOwnershipTransfer)
          .where(
            and(
              eq(schema.tenantOwnershipTransfer.organizationId, tenantId),
              eq(schema.tenantOwnershipTransfer.status, "pending"),
            ),
          )
          .orderBy(desc(schema.tenantOwnershipTransfer.createdAt));

        if (pendingRows.length === 0) return { transfer: null };

        const timestamp = now();

        // An expired request is no longer pending and must not block a new
        // one. Its digest stays so the emailed link still previews as expired.
        for (const expired of pendingRows.filter((row) => row.expiresAt <= timestamp)) {
          yield* db
            .update(schema.tenantOwnershipTransfer)
            .set({ status: "expired", updatedAt: timestamp })
            .where(
              and(
                eq(schema.tenantOwnershipTransfer.id, expired.id),
                eq(schema.tenantOwnershipTransfer.status, "pending"),
              ),
            );

          yield* audit(ctx, "member.ownership_transfer_expired", "ownership_transfer", expired.id, {
            targetAccountId: expired.targetAccountId,
          });
        }

        const pending = pendingRows.find((row) => row.expiresAt > timestamp);

        if (!pending) return { transfer: null };

        const requester = yield* db.query.account.findFirst({
          where: { id: pending.requestedByAccountId },
        });

        const target = yield* db.query.account.findFirst({
          where: { id: pending.targetAccountId },
        });

        if (!requester || !target) return { transfer: null };

        return {
          transfer: {
            id: pending.id,
            status: "pending" as const,
            isExpired: false,
            requestedBy: { id: requester.id, name: requester.name, email: requester.email },
            target: { id: target.id, name: target.name, email: target.email },
            createdAt: iso(pending.createdAt),
            expiresAt: iso(pending.expiresAt),
            acceptedAt: pending.acceptedAt ? iso(pending.acceptedAt) : null,
            cancelledAt: pending.cancelledAt ? iso(pending.cancelledAt) : null,
          },
        };
      }),
    requestTenantOwnershipTransfer: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        // Ownership is built-in authority, never a custom-role delegation.
        if (!isBuiltInOwnerMember(ctx.member))
          return yield* Effect.fail(
            new EnterpriseForbidden({ message: "Only a tenant owner can transfer ownership" }),
          );

        const targetAccountId = payload.targetAccountId.trim();

        if (!targetAccountId)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Choose a member to take over ownership" }),
          );

        if (targetAccountId === ctx.account.id)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "You already own this tenant" }),
          );

        const targetMember = yield* db.query.member.findFirst({
          where: { organizationId: tenantId, accountId: targetAccountId },
        });

        if (!targetMember)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "Tenant account not found" }),
          );

        if (isBuiltInOwnerMember(targetMember))
          return yield* Effect.fail(
            new EnterpriseConflict({ message: "That member is already a tenant owner" }),
          );

        const targetUser = yield* db.query.account.findFirst({ where: { id: targetAccountId } });

        if (!targetUser)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "Tenant account not found" }),
          );

        const rawToken = newOneTimeToken();
        const tokenHash = yield* oneTimeTokenHash(rawToken);
        const acceptUrl = ownershipTransferUrl(origin, rawToken);
        const timestamp = now();
        const expiresAt = new Date(timestamp.getTime() + OWNERSHIP_TRANSFER_TTL_MS);
        const transferId = id();
        let expiredTransferIds: string[] = [];

        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            // Serialise requests for this tenant. Without the row lock two
            // concurrent owners can both observe no pending row and insert.
            const [organization] = yield* tx
              .select({ id: schema.organization.id })
              .from(schema.organization)
              .where(eq(schema.organization.id, tenantId))
              .for("update");

            if (!organization)
              return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant not found" }));

            const pendingRows = yield* tx
              .select({
                id: schema.tenantOwnershipTransfer.id,
                expiresAt: schema.tenantOwnershipTransfer.expiresAt,
              })
              .from(schema.tenantOwnershipTransfer)
              .where(
                and(
                  eq(schema.tenantOwnershipTransfer.organizationId, tenantId),
                  eq(schema.tenantOwnershipTransfer.status, "pending"),
                ),
              )
              .for("update");

            if (pendingRows.some((pending) => pending.expiresAt > timestamp))
              return yield* Effect.fail(
                new EnterpriseConflict({
                  message:
                    "An ownership transfer is already pending. Cancel it or wait for it to expire.",
                }),
              );

            if (pendingRows.length > 0) {
              const expired = yield* tx
                .update(schema.tenantOwnershipTransfer)
                .set({ status: "expired", updatedAt: timestamp })
                .where(
                  and(
                    eq(schema.tenantOwnershipTransfer.organizationId, tenantId),
                    eq(schema.tenantOwnershipTransfer.status, "pending"),
                  ),
                );

              if (expired.affectedRows !== pendingRows.length)
                return yield* Effect.fail(
                  new EnterpriseConflict({
                    message: "The pending ownership transfer changed. Try again.",
                  }),
                );

              expiredTransferIds = pendingRows.map((pending) => pending.id);
            }

            yield* tx.insert(schema.tenantOwnershipTransfer).values({
              id: transferId,
              organizationId: tenantId,
              requestedByAccountId: ctx.account.id,
              targetAccountId,
              status: "pending",
              tokenHash,
              expiresAt,
              acceptedAt: null,
              cancelledAt: null,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
          }),
        );

        const emailSent = yield* sendOwnershipTransferEmail(ctx.organization, ctx.account.name, {
          email: targetUser.email,
          acceptUrl,
          expiresAt,
          idempotencyKey: transferId,
        });

        for (const expiredTransferId of expiredTransferIds)
          yield* audit(
            ctx,
            "member.ownership_transfer_expired",
            "ownership_transfer",
            expiredTransferId,
            { supersededBy: transferId },
          );

        yield* audit(ctx, "member.ownership_transfer_requested", "ownership_transfer", transferId, {
          targetAccountId,
          targetEmail: targetUser.email,
          expiresAt: iso(expiresAt),
          emailSent,
        });

        return {
          id: transferId,
          targetAccountId,
          acceptUrl,
          expiresAt: iso(expiresAt),
          emailSent,
        };
      }),
    cancelTenantOwnershipTransfer: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "read");

        const timestamp = now();

        const cancelledRows = yield* db.transaction((tx) =>
          Effect.gen(function* () {
            // Lock the tenant so a request and a cancellation for the same
            // tenant cannot interleave, then lock every pending row.
            const [organization] = yield* tx
              .select({ id: schema.organization.id })
              .from(schema.organization)
              .where(eq(schema.organization.id, tenantId))
              .for("update");

            if (!organization)
              return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant not found" }));

            const pendingRows = yield* tx
              .select({
                id: schema.tenantOwnershipTransfer.id,
                requestedByAccountId: schema.tenantOwnershipTransfer.requestedByAccountId,
                targetAccountId: schema.tenantOwnershipTransfer.targetAccountId,
              })
              .from(schema.tenantOwnershipTransfer)
              .where(
                and(
                  eq(schema.tenantOwnershipTransfer.organizationId, tenantId),
                  eq(schema.tenantOwnershipTransfer.status, "pending"),
                ),
              )
              .for("update");

            if (pendingRows.length === 0)
              return yield* Effect.fail(
                new EnterpriseNotFound({ message: "No ownership transfer is pending" }),
              );

            // Either party can stop their own handover, and any owner can
            // intervene. A legacy duplicate row only blocks rows the actor may
            // actually end.
            const cancellable = pendingRows.flatMap((pending) => {
              const actor = ownershipTransferCancelActor(pending, {
                id: ctx.account.id,
                member: ctx.member,
              });

              return actor ? [{ pending, actor }] : [];
            });

            if (cancellable.length === 0)
              return yield* Effect.fail(
                new EnterpriseForbidden({
                  message:
                    "Only the requester, the target or a tenant owner can cancel this transfer",
                }),
              );

            for (const { pending } of cancellable) {
              const cancelled = yield* tx
                .update(schema.tenantOwnershipTransfer)
                .set({ status: "cancelled", cancelledAt: timestamp, updatedAt: timestamp })
                .where(
                  and(
                    eq(schema.tenantOwnershipTransfer.id, pending.id),
                    eq(schema.tenantOwnershipTransfer.status, "pending"),
                  ),
                );

              if (cancelled.affectedRows !== 1)
                return yield* Effect.fail(
                  new EnterpriseConflict({
                    message: "This ownership transfer is no longer pending",
                  }),
                );
            }

            return cancellable;
          }),
        );

        for (const { pending, actor } of cancelledRows)
          yield* audit(
            ctx,
            "member.ownership_transfer_cancelled",
            "ownership_transfer",
            pending.id,
            {
              targetAccountId: pending.targetAccountId,
              requestedByAccountId: pending.requestedByAccountId,
              actor,
            },
          );

        return ok;
      }),
    acceptTenantOwnershipTransfer: (request, payload) =>
      Effect.gen(function* () {
        const { user } = yield* auth.requireUser({ headers: request.headers });

        if (!user.emailVerified)
          return yield* Effect.fail(
            new EnterpriseForbidden({
              message: "Verify your email address before accepting this transfer.",
            }),
          );

        const tokenHash = yield* oneTimeTokenHash(payload.token);

        const transfer = yield* db.query.tenantOwnershipTransfer.findFirst({
          where: { tokenHash },
        });

        if (!transfer)
          return yield* Effect.fail(
            new EnterpriseNotFound({
              message: "This ownership transfer link is invalid or has already been used",
            }),
          );

        if (transfer.status === "accepted")
          return yield* Effect.fail(
            new EnterpriseConflict({
              message: "This ownership transfer has already been accepted",
            }),
          );

        if (transfer.status === "cancelled")
          return yield* Effect.fail(
            new EnterpriseConflict({ message: "This ownership transfer was cancelled" }),
          );

        if (transfer.status === "expired")
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "This ownership transfer has expired" }),
          );

        if (transfer.status !== "pending")
          return yield* Effect.fail(
            new EnterpriseConflict({
              message: "This ownership transfer can no longer be accepted",
            }),
          );

        const timestamp = now();

        if (transfer.expiresAt <= timestamp) {
          yield* db
            .update(schema.tenantOwnershipTransfer)
            .set({ status: "expired", updatedAt: timestamp })
            .where(
              and(
                eq(schema.tenantOwnershipTransfer.id, transfer.id),
                eq(schema.tenantOwnershipTransfer.status, "pending"),
              ),
            );

          yield* audit(
            { account: user, organization: { id: transfer.organizationId } },
            "member.ownership_transfer_expired",
            "ownership_transfer",
            transfer.id,
            { targetAccountId: transfer.targetAccountId },
          );

          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "This ownership transfer has expired" }),
          );
        }

        if (transfer.targetAccountId !== user.id)
          return yield* Effect.fail(
            new EnterpriseForbidden({
              message: "Sign in with the account this transfer was sent to",
            }),
          );

        // Defensive: the request path refuses self-transfers, but a direct row
        // must never let one owner "accept" their own handover.
        if (transfer.requestedByAccountId === user.id)
          return yield* Effect.fail(
            new EnterpriseConflict({ message: "You cannot accept your own ownership transfer" }),
          );

        const organization = yield* db.query.organization.findFirst({
          where: { id: transfer.organizationId },
        });

        if (!organization)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant not found" }));

        // Accepting grants owner authority, so the same tenant-wide MFA policy
        // that gates tenant access applies to this token-bound ceremony.
        if (tenantMfaBlocked(user, organization))
          return yield* Effect.fail(
            new EnterpriseForbidden({
              message:
                "This tenant requires multi-factor authentication. Add a passkey or authenticator app to your account first.",
            }),
          );

        const targetMember = yield* db.query.member.findFirst({
          where: { organizationId: transfer.organizationId, accountId: user.id },
        });

        const requesterMember = yield* db.query.member.findFirst({
          where: {
            organizationId: transfer.organizationId,
            accountId: transfer.requestedByAccountId,
          },
        });

        // A stale request is closed rather than applied: the target must still
        // be a member and the requester must still be an owner. Applying it
        // otherwise would change roles nobody currently agreed to.
        const staleReason = !targetMember
          ? "You are no longer a member of this tenant"
          : !requesterMember || !isBuiltInOwnerMember(requesterMember)
            ? "The owner who requested this transfer is no longer an owner"
            : undefined;

        if (staleReason) {
          yield* db
            .update(schema.tenantOwnershipTransfer)
            .set({ status: "cancelled", cancelledAt: timestamp, updatedAt: timestamp })
            .where(
              and(
                eq(schema.tenantOwnershipTransfer.id, transfer.id),
                eq(schema.tenantOwnershipTransfer.status, "pending"),
              ),
            );

          yield* audit(
            { account: user, organization: { id: transfer.organizationId } },
            "member.ownership_transfer_cancelled",
            "ownership_transfer",
            transfer.id,
            {
              targetAccountId: transfer.targetAccountId,
              requestedByAccountId: transfer.requestedByAccountId,
              actor: "system",
              reason: staleReason,
            },
          );

          return yield* Effect.fail(new EnterpriseConflict({ message: staleReason }));
        }

        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            // One lock per tenant serialises request, accept and cancel, and
            // keeps the owner-count post-condition stable.
            const [lockedOrganization] = yield* tx
              .select({ id: schema.organization.id })
              .from(schema.organization)
              .where(eq(schema.organization.id, transfer.organizationId))
              .for("update");

            if (!lockedOrganization)
              return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant not found" }));

            const [current] = yield* tx
              .select({
                status: schema.tenantOwnershipTransfer.status,
                expiresAt: schema.tenantOwnershipTransfer.expiresAt,
              })
              .from(schema.tenantOwnershipTransfer)
              .where(eq(schema.tenantOwnershipTransfer.id, transfer.id))
              .for("update");

            if (!current || current.status !== "pending")
              return yield* Effect.fail(
                new EnterpriseConflict({
                  message: "This ownership transfer has already been used",
                }),
              );

            if (current.expiresAt <= timestamp)
              return yield* Effect.fail(
                new EnterpriseBadRequest({ message: "This ownership transfer has expired" }),
              );

            // Lock both memberships and re-validate them inside the
            // transaction: rows read before it may already be gone or demoted.
            const [targetMember] = yield* tx
              .select({
                id: schema.member.id,
                role: schema.member.role,
                customRoleId: schema.member.customRoleId,
              })
              .from(schema.member)
              .where(
                and(
                  eq(schema.member.organizationId, transfer.organizationId),
                  eq(schema.member.accountId, transfer.targetAccountId),
                ),
              )
              .for("update");

            if (!targetMember)
              return yield* Effect.fail(
                new EnterpriseConflict({ message: "You are no longer a member of this tenant" }),
              );

            const [requesterMember] = yield* tx
              .select({
                id: schema.member.id,
                role: schema.member.role,
                customRoleId: schema.member.customRoleId,
              })
              .from(schema.member)
              .where(
                and(
                  eq(schema.member.organizationId, transfer.organizationId),
                  eq(schema.member.accountId, transfer.requestedByAccountId),
                ),
              )
              .for("update");

            if (!requesterMember || !isBuiltInOwnerMember(requesterMember))
              return yield* Effect.fail(
                new EnterpriseConflict({
                  message: "The owner who requested this transfer is no longer an owner",
                }),
              );

            const claimed = yield* tx
              .update(schema.tenantOwnershipTransfer)
              .set({ status: "accepted", acceptedAt: timestamp, updatedAt: timestamp })
              .where(
                and(
                  eq(schema.tenantOwnershipTransfer.id, transfer.id),
                  eq(schema.tenantOwnershipTransfer.status, "pending"),
                ),
              );

            if (claimed.affectedRows !== 1)
              return yield* Effect.fail(
                new EnterpriseConflict({
                  message: "This ownership transfer has already been used",
                }),
              );

            // The target is promoted before the requester is demoted, and both
            // writes must still affect their membership row. A concurrent
            // removal aborts the whole transaction.
            const promoted = yield* tx
              .update(schema.member)
              .set({ role: "owner", customRoleId: null, updatedAt: timestamp })
              .where(
                and(
                  eq(schema.member.id, targetMember.id),
                  eq(schema.member.organizationId, transfer.organizationId),
                ),
              );

            if (promoted.affectedRows !== 1)
              return yield* Effect.fail(
                new EnterpriseConflict({ message: "You are no longer a member of this tenant" }),
              );

            const demoted = yield* tx
              .update(schema.member)
              .set({
                role: OWNERSHIP_TRANSFER_DEMOTED_ROLE,
                customRoleId: null,
                updatedAt: timestamp,
              })
              .where(
                and(
                  eq(schema.member.id, requesterMember.id),
                  eq(schema.member.organizationId, transfer.organizationId),
                ),
              );

            if (demoted.affectedRows !== 1)
              return yield* Effect.fail(
                new EnterpriseConflict({
                  message: "The owner who requested this transfer is no longer a member",
                }),
              );

            // Post-condition: never commit a tenant with zero built-in owners.
            const remainingMembers = yield* tx
              .select({ role: schema.member.role, customRoleId: schema.member.customRoleId })
              .from(schema.member)
              .where(eq(schema.member.organizationId, transfer.organizationId));

            if (!remainingMembers.some((member) => isBuiltInOwnerMember(member)))
              return yield* Effect.fail(
                new EnterpriseConflict({
                  message: "The transfer would leave the tenant without an owner",
                }),
              );
          }),
        );

        yield* audit(
          { account: user, organization: { id: transfer.organizationId } },
          "member.ownership_transfer_accepted",
          "tenant",
          transfer.organizationId,
          {
            transferId: transfer.id,
            fromUserId: transfer.requestedByAccountId,
            toUserId: transfer.targetAccountId,
            previousTargetRole: targetMember!.role,
            previousTargetRoleId: targetMember!.customRoleId ?? null,
            requesterRole: OWNERSHIP_TRANSFER_DEMOTED_ROLE,
          },
        );

        return { tenantId: transfer.organizationId };
      }),
    previewTenantOwnershipTransfer: (_request, query) =>
      Effect.gen(function* () {
        const transfer = yield* db.query.tenantOwnershipTransfer.findFirst({
          where: { tokenHash: yield* oneTimeTokenHash(query.token) },
        });

        if (!transfer) return { state: "unknown" as const };

        let state: ReturnType<typeof ownershipTransferPreviewState> | "stale" =
          ownershipTransferPreviewState(transfer);

        // A cancelled token reveals nothing beyond its state.
        if (state === "cancelled" || state === "unknown") return { state };

        const organization = yield* db.query.organization.findFirst({
          where: { id: transfer.organizationId },
        });

        if (!organization) return { state: "unknown" as const };

        // A pending token is only actionable while both parties still hold
        // their expected membership. Otherwise the accept page must not claim
        // the link is valid.
        if (state === "valid") {
          const targetMember = yield* db.query.member.findFirst({
            where: {
              organizationId: transfer.organizationId,
              accountId: transfer.targetAccountId,
            },
          });

          const requesterMember = yield* db.query.member.findFirst({
            where: {
              organizationId: transfer.organizationId,
              accountId: transfer.requestedByAccountId,
            },
          });

          if (!targetMember || !requesterMember || !isBuiltInOwnerMember(requesterMember))
            state = "stale";
        }

        const requester = yield* db.query.account.findFirst({
          where: { id: transfer.requestedByAccountId },
        });

        const target = yield* db.query.account.findFirst({
          where: { id: transfer.targetAccountId },
        });

        return {
          state,
          tenant: {
            name: organization.name,
            displayName: organization.displayName ?? null,
            logo: organization.logo ?? null,
            brandColor: organization.brandColor ?? null,
          },
          requestedByName: requester?.name,
          targetEmailMasked: target ? maskInvitationEmail(target.email) : undefined,
          expiresAt: iso(transfer.expiresAt),
        };
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

        const rawToken = newOneTimeToken();
        const tokenHash = yield* oneTimeTokenHash(rawToken);
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

        const emailSent = yield* sendInvitationEmail(ctx.organization, ctx.account.name, {
          email: invitation.email,
          roleName: roleLabel,
          inviteUrl,
          expiresAt,
          idempotencyKey: `${invitation.id}:${sendCount}`,
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
    patchTenantAccount: (request, tenantId, accountId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const member = yield* db.query.member.findFirst({
          where: { organizationId: tenantId, accountId },
        });

        if (!member)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "Tenant account not found" }),
          );
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
          .where(eq(schema.member.id, member.id));
        const roleAudit = { memberId: member.id, role };

        if (customRole)
          Object.assign(roleAudit, {
            roleId: customRole.id,
            roleName: customRole.name,
            permissionCeiling: "actor",
          });

        yield* audit(ctx, "member.role_changed", "user", member.accountId, roleAudit);

        return ok;
      }),
    removeTenantAccount: (request, tenantId, accountId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const count = yield* memberCount(tenantId);

        if (count <= 1)
          return yield* Effect.fail(
            diagnoseError(
              new EnterpriseLastTenantAccount({
                message: "Cannot remove the last tenant user; delete the tenant instead",
              }),
              { code: "last_tenant_account" },
            ),
          );

        const member = yield* db.query.member.findFirst({
          where: { organizationId: tenantId, accountId },
        });

        if (!member)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "Tenant account not found" }),
          );

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

        const targetAccount = yield* db.query.account.findFirst({
          where: { id: member.accountId },
        });

        const targetEmail = targetAccount?.email.trim().toLowerCase();

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

        // The membership and its SSO link go together. Directory users are a
        // separate identity: their device links and user policies belong to the
        // person, not to dashboard access, so removing an administrator leaves
        // them untouched.
        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.delete(schema.member).where(eq(schema.member.id, member.id));
            yield* clearTenantAccountDirectoryState(tx, tenantId, member.accountId);
          }),
        );

        yield* audit(ctx, "member.removed", "account", member.accountId, {
          memberId: member.id,
        });

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
            // The profile link is a bearer credential until the challenge is
            // consumed, so it is deliberately short-lived.
            ttlSeconds: enrollmentProfileTtlSeconds,
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
              provisioningMode: token.provisioningMode,
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
          questions: enabled ? yield* loadEnrollmentQuestions(db, organization.id) : [],
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
    enrollAdeDevice: (body: Uint8Array) =>
      Effect.gen(function* () {
        // The Setup Assistant request is a CMS-signed MachineInfo plist. A
        // random caller must not be able to mint a SCEP challenge for a serial,
        // so an unverified request is refused.
        const machine = yield* Effect.tryPromise({
          try: () => parseAppleAdeMachineInfo(body),
          catch: (cause) =>
            cause instanceof AppleAdeEnrollmentError && cause.code === "untrusted_signer"
              ? new EnterpriseForbidden({
                  message: `The ADE enrollment request was not signed by Apple: ${cause.message}`,
                })
              : new EnterpriseBadRequest({
                  message:
                    cause instanceof Error
                      ? `The ADE enrollment request could not be verified: ${cause.message}`
                      : "The ADE enrollment request could not be verified.",
                }),
        });

        const device = yield* db.query.abmDevice.findFirst({
          where: { serial: machine.serial },
        });

        if (!device || device.enrollmentState === "REMOVED" || device.profileStatus === "removed")
          return yield* Effect.fail(
            new EnterpriseNotFound({
              message: "This serial is not an assigned device in Apple Business Manager.",
            }),
          );

        if (device.enrollmentState !== "ASSIGNED")
          return yield* Effect.fail(
            new EnterpriseForbidden({
              message:
                "Assign this device to the Mattrax device management service in Apple Business Manager before it can enrol.",
            }),
          );

        const abm = yield* loadAppleBusinessManager(db, device.organizationId);

        if (!abm)
          return yield* Effect.fail(
            new EnterpriseNotConfigured({
              message: "Apple Business Manager is not configured for this tenant.",
            }),
          );

        const organization = yield* db.query.organization.findFirst({
          where: { id: device.organizationId },
        });

        if (!organization)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Tenant not found." }));
        const branding = resolveTenantBranding(organization);
        const profileUuid = device.assignedProfileUuid ?? abm.profileUuid;

        if (!profileUuid)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "No ADE profile UUID is recorded for this tenant. Re-sync ABM.",
            }),
          );

        return {
          profile: yield* adeEnrollmentProfileFor({
            organizationId: device.organizationId,
            profileUuid,
            displayName: `${branding.displayName} Automated Device Enrollment`,
          }),
          filename: `${safeFilename(machine.serial)}.mobileconfig`,
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

        if (!device || device.enrollmentState === "REMOVED" || device.profileStatus === "removed")
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

        return {
          profile: yield* adeEnrollmentProfileFor({
            organizationId: organization.id,
            profileUuid: signed.profileUuid,
            displayName: `${branding.displayName} Automated Device Enrollment`,
          }),
          filename: `${safeFilename(signed.serial)}.mobileconfig`,
        };
      }),
    getTenantScepCa: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const organizationId = ctx.organization.id;

        const state = yield* loadScepCaState(db, organizationId).pipe(
          Effect.mapError(
            () => new EnterpriseDbError({ message: "Could not read the tenant SCEP CA." }),
          ),
        );

        return tenantScepCaInfo(organizationId, state);
      }),
    rotateTenantScepCa: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        // Starting a rotation changes the root that new identities chain to.
        // It is staged and non-destructive, but it is still a security-relevant
        // change that needs fresh proof of presence.
        yield* requireStepUp(auth, request, "scep-ca-rotate");
        const organizationId = ctx.organization.id;
        const rotatedAt = now();

        const before = yield* loadScepCaState(db, organizationId, rotatedAt).pipe(
          Effect.mapError(
            () => new EnterpriseInternal({ message: "Could not read the tenant SCEP CA." }),
          ),
        );

        // The previous CA is retained as a verification anchor until it
        // expires. Existing identities keep authenticating and renewing, and
        // the renewed identity is issued by the successor CA, so no device has
        // to enrol again.
        yield* rotateScepCa(
          ScepRepositoryLive.make(db, { authSecret }),
          { organizationId },
          { now: rotatedAt },
        ).pipe(
          Effect.mapError(
            () => new EnterpriseInternal({ message: "Could not rotate the tenant SCEP CA." }),
          ),
        );

        const state = yield* loadScepCaState(db, organizationId, rotatedAt).pipe(
          Effect.mapError(
            () => new EnterpriseInternal({ message: "Could not read the rotated SCEP CA." }),
          ),
        );

        yield* audit(ctx, "scep_ca.rotated", "scep_ca", null, {
          mode: "overlap",
          source: "generated",
          commonName: state.commonName,
          fingerprintSha256: state.fingerprintSha256,
          previousFingerprintSha256: before.fingerprintSha256,
          previousNotAfter: before.notAfter,
          // Identities issued by the previous CA stay valid for the whole
          // overlap window, so nothing is revoked and no device re-enrols.
          overlapUntil: before.notAfter,
          revokedCertificates: 0,
        });

        return tenantScepCaInfo(organizationId, state);
      }),
    importTenantScepCa: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        // Importing a CA replaces the root every device identity chains to.
        yield* requireStepUp(auth, request, "scep-ca-import");
        const organizationId = ctx.organization.id;

        const material = yield* importScepCa({
          certificatePem: payload.certificatePem,
          privateKeyPem: payload.privateKeyPem,
        }).pipe(Effect.mapError((cause) => new EnterpriseBadRequest({ message: cause.message })));

        // Importing a different CA invalidates every identity issued by the old
        // one for renewal purposes. Revoke them in the same transaction as the
        // replacement so the CA and the revocation list cannot disagree.
        const revokedCertificates = yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              const repository = ScepRepositoryLive.make(tx, { authSecret });
              yield* replaceScepCa(repository, { organizationId }, material);

              const revoked = yield* tx
                .update(schema.scepIssuedCertificate)
                .set({ revokedAt: now() })
                .where(
                  and(
                    eq(schema.scepIssuedCertificate.organizationId, organizationId),
                    isNull(schema.scepIssuedCertificate.revokedAt),
                  ),
                );

              return revoked.affectedRows;
            }),
          )
          .pipe(
            Effect.mapError(
              () => new EnterpriseInternal({ message: "Could not store the supplied SCEP CA." }),
            ),
          );

        const state = yield* loadScepCaState(db, organizationId).pipe(
          Effect.mapError(
            () => new EnterpriseInternal({ message: "Could not read the supplied SCEP CA." }),
          ),
        );

        yield* audit(ctx, "scep_ca.imported", "scep_ca", null, {
          source: "imported",
          commonName: state.commonName,
          fingerprintSha256: state.fingerprintSha256,
          revokedCertificates,
        });

        return tenantScepCaInfo(organizationId, state);
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
          attempts: attempts.map((attempt) => ({
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

        if (body.code != null && body.code.trim().length > 0 && body.code.trim().length < 8)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "The enrollment password must be at least 8 characters, or left blank",
            }),
          );

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
        yield* invalidateUnusedScepChallenges(ctx.organization.id);
        yield* audit(ctx, "enrollment.updated", "enrollment", null, {
          fields: Object.keys(body),
        });

        return ok;
      }),
    resetTenantEnrollment: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const existing = yield* getOrCreateEnrollment(ctx.organization.id);
        const newId = id();
        const timestamp = now();

        // Rotate by replacing the row, not by updating its primary key:
        // `enrollment_answer` references it with a cascade delete and no
        // ON UPDATE rule, so a key update fails once a question has been
        // answered. Deleting the old row clears those answers with it.
        yield* db.insert(schema.enterpriseEnrollment).values({
          id: newId,
          organizationId: ctx.organization.id,
          code: existing.code,
          enabledApple: existing.enabledApple,
          enabledWindows: existing.enabledWindows,
          enabledAndroid: existing.enabledAndroid,
          enabledAssetTag: existing.enabledAssetTag,
          maxDevices: existing.maxDevices,
          createdAt: existing.createdAt,
          updatedAt: timestamp,
        });
        yield* db
          .delete(schema.enterpriseEnrollment)
          .where(eq(schema.enterpriseEnrollment.id, existing.id));
        yield* invalidateUnusedScepChallenges(ctx.organization.id);
        yield* audit(ctx, "enrollment.reset", "enrollment", newId);

        return { id: newId };
      }),
    listAttributes: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const definitions = yield* listAttributeDefinitions(db, ctx.organization.id);

        const counts = yield* db
          .select({ attributeId: schema.deviceAttribute.attributeId, value: count() })
          .from(schema.deviceAttribute)
          .where(eq(schema.deviceAttribute.organizationId, ctx.organization.id))
          .groupBy(schema.deviceAttribute.attributeId);

        const byId = new Map(counts.map((row) => [row.attributeId, Number(row.value)]));

        return {
          rows: definitions.map((definition) =>
            attributeDefinitionRow(definition, byId.get(definition.id) ?? 0),
          ),
        };
      }),
    createAttribute: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const key = payload.key.trim();
        const label = payload.label.trim();
        const type = payload.type;

        const problem = definitionInputProblem({
          key,
          label,
          type,
          options: payload.options,
        });

        if (problem) return yield* Effect.fail(new EnterpriseBadRequest({ message: problem }));

        const [existing] = yield* db
          .select()
          .from(schema.attributeDefinition)
          .where(
            and(
              eq(schema.attributeDefinition.organizationId, ctx.organization.id),
              eq(schema.attributeDefinition.key, key),
            ),
          )
          .limit(1);

        if (existing)
          return yield* Effect.fail(
            new EnterpriseConflict({
              message: `An attribute with the key "${key}" already exists in this tenant.`,
            }),
          );

        const attributeId = id();

        yield* db.insert(schema.attributeDefinition).values({
          id: attributeId,
          organizationId: ctx.organization.id,
          key,
          label,
          type,
          options: normalizeDefinitionOptions(type, payload.options),
          required: payload.required ?? false,
          visibility: payload.visibility ?? "visible",
          sortOrder: payload.sortOrder ?? 0,
          createdAt: now(),
          updatedAt: now(),
        });

        yield* audit(ctx, "attribute.created", "attribute", attributeId, {
          key,
          label,
          type,
          required: payload.required ?? false,
          visibility: payload.visibility ?? "visible",
        });

        const [row] = yield* db
          .select()
          .from(schema.attributeDefinition)
          .where(eq(schema.attributeDefinition.id, attributeId))
          .limit(1);

        return attributeDefinitionRow(row!);
      }),
    patchAttribute: (request, tenantId, attributeId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const [existing] = yield* db
          .select()
          .from(schema.attributeDefinition)
          .where(
            and(
              eq(schema.attributeDefinition.id, attributeId),
              eq(schema.attributeDefinition.organizationId, ctx.organization.id),
            ),
          )
          .limit(1);

        if (!existing)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Attribute not found" }));

        const label = payload.label?.trim() ?? existing.label;

        const type = payload.type ?? existing.type;

        const options =
          payload.options !== undefined ? payload.options : (existing.options ?? undefined);

        const problem = definitionInputProblem({ key: existing.key, label, type, options });

        if (problem) return yield* Effect.fail(new EnterpriseBadRequest({ message: problem }));

        yield* db
          .update(schema.attributeDefinition)
          .set({
            label,
            type,
            options: normalizeDefinitionOptions(type, options),
            required: payload.required ?? existing.required,
            visibility: payload.visibility ?? existing.visibility,
            sortOrder: payload.sortOrder ?? existing.sortOrder,
            updatedAt: now(),
          })
          .where(
            and(
              eq(schema.attributeDefinition.id, attributeId),
              eq(schema.attributeDefinition.organizationId, ctx.organization.id),
            ),
          );

        yield* audit(ctx, "attribute.updated", "attribute", attributeId, {
          key: existing.key,
          fields: Object.keys(payload),
        });

        const [row] = yield* db
          .select()
          .from(schema.attributeDefinition)
          .where(eq(schema.attributeDefinition.id, attributeId))
          .limit(1);

        return attributeDefinitionRow(row!);
      }),
    deleteAttribute: (request, tenantId, attributeId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const [existing] = yield* db
          .select()
          .from(schema.attributeDefinition)
          .where(
            and(
              eq(schema.attributeDefinition.id, attributeId),
              eq(schema.attributeDefinition.organizationId, ctx.organization.id),
            ),
          )
          .limit(1);

        if (!existing)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Attribute not found" }));

        yield* db
          .delete(schema.attributeDefinition)
          .where(
            and(
              eq(schema.attributeDefinition.id, attributeId),
              eq(schema.attributeDefinition.organizationId, ctx.organization.id),
            ),
          );

        yield* audit(ctx, "attribute.deleted", "attribute", attributeId, {
          key: existing.key,
          label: existing.label,
        });

        return ok;
      }),
    listEnrollmentQuestions: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const definitions = yield* listAttributeDefinitions(db, ctx.organization.id);

        const rows = yield* db
          .select()
          .from(schema.enrollmentQuestion)
          .where(eq(schema.enrollmentQuestion.organizationId, ctx.organization.id))
          .orderBy(schema.enrollmentQuestion.sortOrder);

        return {
          rows: rows.flatMap((row) => {
            const definition = definitions.find((candidate) => candidate.id === row.attributeId);

            if (!definition) return [];

            return [
              {
                id: row.id,
                attributeId: row.attributeId,
                key: definition.key,
                label: row.prompt?.trim() || definition.label,
                type: definition.type,
                options: definition.options ?? null,
                required: row.required ?? definition.required,
                sortOrder: row.sortOrder,
              },
            ];
          }),
        };
      }),
    patchEnrollmentQuestions: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const definitions = yield* listAttributeDefinitions(db, ctx.organization.id);
        const byKey = new Map(definitions.map((definition) => [definition.key, definition]));

        if (payload.questions.length > 50)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "A tenant can have at most 50 questions." }),
          );

        const seen = new Set<string>();

        const rows: Array<{
          id: string;
          attributeId: string;
          prompt: string | null;
          required: boolean | null;
          sortOrder: number;
        }> = [];

        for (const [index, question] of payload.questions.entries()) {
          const key = question.key.trim();
          const definition = byKey.get(key);

          if (!definition)
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `"${key}" is not a registered attribute in this tenant.`,
              }),
            );

          if (seen.has(key))
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `"${key}" is asked more than once.`,
              }),
            );

          seen.add(key);
          const prompt = question.prompt?.trim() || null;

          if (prompt && prompt.length > 255)
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: "A question prompt must be 255 characters or fewer.",
              }),
            );

          rows.push({
            id: id(),
            attributeId: definition.id,
            prompt,
            required: question.required ?? null,
            sortOrder: question.sortOrder ?? index,
          });
        }

        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .delete(schema.enrollmentQuestion)
              .where(eq(schema.enrollmentQuestion.organizationId, ctx.organization.id));

            if (rows.length > 0)
              yield* tx.insert(schema.enrollmentQuestion).values(
                rows.map((row) => ({
                  ...row,
                  organizationId: ctx.organization.id,
                  createdAt: now(),
                  updatedAt: now(),
                })),
              );
          }),
        );

        yield* audit(ctx, "enrollment.questions_updated", "enrollment", null, {
          keys: [...seen],
        });

        const refreshed = yield* db
          .select()
          .from(schema.enrollmentQuestion)
          .where(eq(schema.enrollmentQuestion.organizationId, ctx.organization.id))
          .orderBy(schema.enrollmentQuestion.sortOrder);

        return {
          rows: refreshed.flatMap((row) => {
            const definition = definitions.find((candidate) => candidate.id === row.attributeId);

            if (!definition) return [];

            return [
              {
                id: row.id,
                attributeId: row.attributeId,
                key: definition.key,
                label: row.prompt?.trim() || definition.label,
                type: definition.type,
                options: definition.options ?? null,
                required: row.required ?? definition.required,
                sortOrder: row.sortOrder,
              },
            ];
          }),
        };
      }),
    getPolicyVariables: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const definitions = yield* listAttributeDefinitions(db, ctx.organization.id);

        return {
          variables: policyVariableInfo(
            definitions.map((definition) => definition.key),
            definitions.map((definition) => ({ key: definition.key, label: definition.label })),
          ),
          notes: [...POLICY_VARIABLE_NOTES],
        };
      }),
    setDeviceAttributes: (request, tenantId, deviceId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const body: SetDeviceAttributesRequest = payload;

        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });

        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));

        const definitions = yield* listAttributeDefinitions(db, ctx.organization.id);
        const values = body.values ?? {};

        const problem = attributeValuesProblem(definitions, values);

        if (problem)
          return yield* Effect.fail(new EnterpriseBadRequest({ message: problem.message }));

        const current = yield* loadDeviceAttributes(db, ctx.organization.id, [device.id]);
        const existing = current.get(device.id) ?? {};

        const finalValues = mergeAttributeValues({
          existing,
          values,
          definitions,
          replace: body.replace === true,
        });

        for (const definition of definitions) {
          if (!definition.required) continue;

          if (!finalValues[definition.key])
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `${definition.label} is required for this device.`,
              }),
            );
        }

        const result = yield* writeDeviceAttributeValues({
          organizationId: ctx.organization.id,
          deviceId: device.id,
          definitions,
          values: finalValues,
          updatedByAccountId: ctx.account.id,
        });

        yield* audit(ctx, "device.attributes_updated", "device", device.id, {
          written: result.written.sort(),
          cleared: result.cleared.sort(),
          replace: body.replace === true,
        });

        return ok;
      }),
    importDeviceAttributes: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        const definitions = yield* listAttributeDefinitions(db, ctx.organization.id);
        const parsed = parseAttributeCsv(definitions, payload.csv);
        const headerProblem = parsed.issues.find((issue) => issue.row === 0);

        if (headerProblem)
          return yield* Effect.fail(new EnterpriseBadRequest({ message: headerProblem.message }));

        const serials = [...new Set(parsed.rows.map((row) => row.serial))];

        const devices = serials.length
          ? yield* db
              .select({ id: schema.device.id, serial: schema.device.serial })
              .from(schema.device)
              .where(
                and(
                  eq(schema.device.organizationId, ctx.organization.id),
                  inArray(schema.device.serial, serials),
                ),
              )
          : [];

        const bySerial = new Map(
          devices.flatMap((device) => (device.serial ? [[device.serial, device.id] as const] : [])),
        );

        const results: Array<{
          row: number;
          serial: string | null;
          status: "updated" | "unchanged" | "skipped" | "error";
          deviceId: string | null;
          error: string | null;
        }> = parsed.issues.map((issue) => ({
          row: issue.row,
          serial: null,
          status: "error" as const,
          deviceId: null,
          error: issue.message,
        }));

        let updated = 0;
        const issueRows = new Set(parsed.issues.map((issue) => issue.row));

        for (const row of parsed.rows) {
          if (issueRows.has(row.row)) continue;

          const deviceId = bySerial.get(row.serial);

          if (!deviceId) {
            results.push({
              row: row.row,
              serial: row.serial,
              status: "error",
              deviceId: null,
              error: `No device with serial ${row.serial} exists in this tenant.`,
            });

            continue;
          }

          yield* writeDeviceAttributeValues({
            organizationId: ctx.organization.id,
            deviceId,
            definitions,
            values: row.values,
            updatedByAccountId: ctx.account.id,
          });

          const writtenKeys = Object.entries(row.values)
            .filter(([, value]) => value !== null)
            .map(([key]) => key);

          const clearedKeys = Object.entries(row.values)
            .filter(([, value]) => value === null)
            .map(([key]) => key);

          if (writtenKeys.length > 0 || clearedKeys.length > 0)
            yield* audit(ctx, "device.attributes_updated", "device", deviceId, {
              source: "csv",
              written: writtenKeys.sort(),
              cleared: clearedKeys.sort(),
            });

          updated++;
          results.push({
            row: row.row,
            serial: row.serial,
            status: "updated",
            deviceId,
            error: null,
          });
        }

        return {
          results,
          updated,
          skipped: results.filter((result) => result.status === "skipped").length,
          failed: results.filter((result) => result.status === "error").length,
        };
      }),
    submitEnrollmentAnswers: (enrollmentId, payload) =>
      Effect.gen(function* () {
        const enrollment = yield* db.query.enterpriseEnrollment.findFirst({
          where: { id: enrollmentId },
        });

        if (!enrollment)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Enrollment not found" }));

        if (enrollment.code && enrollment.code !== (payload.code ?? ""))
          return yield* Effect.fail(
            new EnterpriseForbidden({ message: "The enrollment password is invalid." }),
          );

        const serial = payload.serial.trim();

        if (!serial || serial.length > 128)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Enter the device serial number." }),
          );

        const questions = yield* loadEnrollmentQuestions(db, enrollment.organizationId);
        const definitions = yield* listAttributeDefinitions(db, enrollment.organizationId);

        const definitionByKey = new Map(
          definitions.map((definition) => [definition.key, definition]),
        );

        const questionByKey = new Map(questions.map((question) => [question.key, question]));

        if (Object.keys(payload.answers).length > 0 && questions.length === 0)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "This tenant has no enrollment questions." }),
          );

        if (Object.keys(payload.answers).length > questions.length)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "The answer list does not match this tenant." }),
          );

        for (const key of Object.keys(payload.answers))
          if (!questionByKey.has(key))
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `"${key}" is not a question on this tenant's enrollment page.`,
              }),
            );

        const canonical: Array<{ attributeId: string; value: string }> = [];

        for (const question of questions) {
          const definition = definitionByKey.get(question.key);

          if (!definition)
            return yield* Effect.fail(
              new EnterpriseInternal({
                message: "Enrollment question references a missing attribute",
              }),
            );

          const raw = payload.answers[question.key];

          const result = validateAttributeValue(
            { ...definition, required: question.required },
            raw ?? null,
          );

          if (!result.ok)
            return yield* Effect.fail(new EnterpriseBadRequest({ message: result.error }));

          if (result.value === "") continue;
          canonical.push({ attributeId: definition.id, value: result.value });
        }

        const timestamp = now();

        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            for (const answer of canonical)
              yield* tx
                .insert(schema.enrollmentAnswer)
                .values({
                  id: id(),
                  organizationId: enrollment.organizationId,
                  enrollmentId: enrollment.id,
                  serial,
                  attributeId: answer.attributeId,
                  value: answer.value,
                  createdAt: timestamp,
                })
                .onDuplicateKeyUpdate({ set: { value: answer.value, createdAt: timestamp } });

            if (payload.name !== undefined || payload.assetTag !== undefined)
              yield* tx
                .update(schema.devicePreRegistration)
                .set({
                  name:
                    payload.name === undefined
                      ? undefined
                      : payload.name === null
                        ? null
                        : payload.name.trim() || null,
                  assetTag:
                    payload.assetTag === undefined
                      ? undefined
                      : payload.assetTag === null
                        ? null
                        : payload.assetTag.trim() || null,
                  updatedAt: timestamp,
                })
                .where(
                  and(
                    eq(schema.devicePreRegistration.organizationId, enrollment.organizationId),
                    eq(schema.devicePreRegistration.serial, serial),
                  ),
                );
          }),
        );

        yield* writeSystemAudit(db, {
          organizationId: enrollment.organizationId,
          action: "enrollment.answers_submitted",
          targetType: "enrollment",
          targetId: enrollment.id,
          metadata: { serial, keys: canonical.length },
        });

        return { status: "ok" as const, stored: canonical.length };
      }),
    getAppleBusinessManager: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        return yield* mapAppleFailure(appleBusinessManagerInfo(db, ctx.organization.id, origin));
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
            // The link is a bearer credential for one serial. It is only
            // needed long enough to open it, and the ADE enrollment endpoint
            // is the automatic path, so keep the window short.
            ttlSeconds: 60 * 60,
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
        const body: {
          enabled?: boolean;
          provisioningMode?: "work-profile" | "fully-managed" | "dedicated";
          disconnect?: boolean;
        } = payload;

        if (body.disconnect) {
          // Deleting the Google enterprise removes every policy and device
          // record Google holds, so it needs tenant-delete permission and the
          // same recent proof of possession as a wipe.
          const ctx = yield* requireTenant(request, tenantId, "delete");
          yield* requireStepUp(auth, request, "android-disconnect");

          const result = yield* mapAndroidFailure(
            disconnectAndroidEnterprise({
              db,
              config: androidConfig,
              organizationId: ctx.organization.id,
            }),
          );

          yield* audit(
            ctx,
            "android.enterprise_disconnected",
            "android_enterprise",
            ctx.organization.id,
            { enterpriseName: result?.enterpriseName ?? null },
          );

          return ok;
        }

        const ctx = yield* requireTenant(request, tenantId, "write");

        if (body.provisioningMode !== undefined) {
          yield* mapAndroidFailure(
            setAndroidProvisioningMode({
              db,
              config: androidConfig,
              organizationId: ctx.organization.id,
              mode: body.provisioningMode,
            }),
          );
          yield* audit(
            ctx,
            "android.provisioning_mode_changed",
            "android_enterprise",
            ctx.organization.id,
            { mode: body.provisioningMode },
          );
        }

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
          reconcileAndroidEnterprise({
            db,
            config: androidConfig,
            authSecret,
            organizationId: ctx.organization.id,
            planLimits,
          }),
        );

        yield* audit(ctx, "android.policy_sync", "android_enterprise", ctx.organization.id, {
          devices: result.devices,
          updated: result.updated,
          skipped: result.skipped,
          failed: result.failed,
          reconciled: result.reconciled,
          removed: result.removed,
          commands: result.commands,
          policiesPruned: result.policiesPruned,
        });

        return result;
      }),
    getApns: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const apns = yield* db.query.applePushCertificate.findFirst({
          where: { organizationId: ctx.organization.id },
        });

        // Health includes the key/certificate pairing: an APNs certificate
        // whose stored key no longer matches cannot sign a push even though its
        // expiry date is fine.
        const health = yield* Effect.tryPromise({
          try: () =>
            apnsCredentialHealth({
              certificatePem: apns?.certPem ?? null,
              topic: apns?.topic ?? null,
              encryptedKey: apns?.encryptedKey ?? null,
              authSecret,
              now: now(),
            }),
          catch: () => new EnterpriseInternal({ message: "Could not read APNs health." }),
        });

        return {
          configured: health.configured,
          email: apns?.email ?? null,
          topic: health.topic,
          commonName: health.commonName,
          expiresAt: health.expiresAt,
          daysLeft: health.daysLeft,
          level: health.level,
          keyConfigured: health.keyConfigured,
          keyMatchesCertificate: health.keyMatchesCertificate,
          topicMatchesCertificate: health.topicMatchesCertificate,
          renewalUrl: APNS_RENEWAL_URL,
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

        // An Android row is a pointer at a Google-side device. Deleting the row
        // without deleting that device leaves Google applying the last policy
        // forever, to a machine the dashboard no longer knows about. Retire
        // them first and refuse the request if Google will not let go, so the
        // operator can retry or unenroll the device individually.
        const androidDevices = devices.filter((device) => device.proto === "android");

        if (androidDevices.length > 0 && androidConfigured()) {
          const failures: string[] = [];

          for (const device of androidDevices) {
            const outcome = yield* Effect.result(
              unenrollAndroidDevice({
                db,
                config: androidConfig,
                organizationId: ctx.organization.id,
                device: { id: device.id, dmIdentifier: device.dmIdentifier },
              }),
            );

            if (Predicate.isTagged(outcome, "Failure"))
              failures.push(`${device.name}: ${outcome.failure.message}`);
          }

          if (failures.length > 0)
            return yield* Effect.fail(
              new EnterpriseConflict({
                message: `These Android devices could not be removed from Google, so nothing was deleted. ${failures.slice(0, 3).join(" ")}`,
              }),
            );
        }

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
        // Deleting devices frees seats on the per-device plan.
        yield* reconcileSeats(ctx.organization.id);

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

        const existing = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });

        if (!existing)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));

        if (body.name !== undefined && !body.name.trim())
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Device name cannot be empty" }),
          );

        yield* db
          .update(schema.device)
          .set({
            name: body.name === undefined ? existing.name : body.name.trim(),
            notes: body.notes === undefined ? existing.notes : body.notes,
            assetTag: body.assetTag === undefined ? existing.assetTag : body.assetTag,
          })
          .where(
            and(
              eq(schema.device.id, deviceId),
              eq(schema.device.organizationId, ctx.organization.id),
            ),
          );

        // A rename or asset-tag edit can change dynamic-group membership, and
        // therefore the device's policies. Push that change instead of only
        // updating the server-side rows.
        const groupChanges = yield* syncDynamicGroupsForDevice(db, ctx.organization.id, deviceId, {
          now: now(),
        }).pipe(Effect.catch(() => Effect.succeed([])));

        if (groupChanges.some((group) => group.added > 0 || group.removed > 0))
          yield* refreshDevicePolicies(ctx.organization.id, [deviceId]);

        yield* audit(ctx, "device.updated", "device", deviceId, { fields: Object.keys(body) });

        return ok;
      }),
    getScriptSettings: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        return scriptSettingsFor(ctx.organization);
      }),
    patchScriptSettings: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* requireStepUp(auth, request, "script-change");

        if (ctx.organization.scriptsEnabled !== payload.enabled) {
          yield* db
            .update(schema.organization)
            .set({ scriptsEnabled: payload.enabled, updatedAt: now() })
            .where(eq(schema.organization.id, ctx.organization.id));

          yield* audit(ctx, "script.settings_updated", "tenant", ctx.organization.id, {
            enabled: payload.enabled,
          });
        }

        // Apple devices lose their assigned script profiles on the next
        // check-in; push now so disabling takes effect without a manual sync.
        if (!payload.enabled) {
          const rows = yield* db
            .select({ deviceId: schema.scriptAssignment.targetId })
            .from(schema.scriptAssignment)
            .where(
              and(
                eq(schema.scriptAssignment.organizationId, ctx.organization.id),
                eq(schema.scriptAssignment.targetType, "device"),
              ),
            );

          yield* applePush.pushAppleDevices(rows.map((row) => row.deviceId));
        }

        return { enabled: payload.enabled };
      }),
    listScripts: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        return yield* listTenantScripts(db, ctx.organization, ctx.role.permissions);
      }),
    getScript: (request, tenantId, scriptId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const detail = yield* getScriptDetail(db, ctx.organization.id, scriptId);

        if (!detail)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Script not found" }));

        return detail;
      }),
    createScript: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* requireStepUp(auth, request, "script-change");

        if (!ctx.organization.scriptsEnabled)
          return yield* Effect.fail(
            new EnterpriseForbidden({
              message: "Scripts are disabled for this tenant. Enable them in Scripts settings.",
            }),
          );

        const result = yield* createScript(db, ctx.organization.id, ctx.account.id, payload, now());

        if (!("id" in result))
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: result.problem ?? "The script is invalid." }),
          );

        yield* audit(ctx, "script.created", "script", result.id, {
          name: payload.name.trim(),
          trigger: payload.trigger.type,
          language: payload.language,
        });

        return { id: result.id };
      }),
    patchScript: (request, tenantId, scriptId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* requireStepUp(auth, request, "script-change");

        const result = yield* updateScript(db, ctx.organization.id, scriptId, payload, now());

        if ("notFound" in result)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Script not found" }));

        if ("problem" in result && result.problem)
          return yield* Effect.fail(new EnterpriseBadRequest({ message: result.problem }));

        yield* audit(ctx, "script.updated", "script", scriptId, {
          fields: Object.keys(payload),
        });

        // A script edit changes the profile an Apple device holds; wake the
        // assigned devices so the new body is delivered.
        const devices = yield* scriptAssignedDeviceIds(db, ctx.organization.id, scriptId);

        yield* applePush.pushAppleDevices(devices.map((device) => device.id));

        return ok;
      }),
    deleteScript: (request, tenantId, scriptId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* requireStepUp(auth, request, "script-change");

        const result = yield* deleteScript(db, ctx.organization.id, scriptId);

        if (!result.deleted)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Script not found" }));

        yield* audit(ctx, "script.deleted", "script", scriptId);

        return ok;
      }),
    getScriptAssignments: (request, tenantId, scriptId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);
        const assignments = yield* getScriptAssignments(db, ctx.organization.id, scriptId);

        if (!assignments)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Script not found" }));

        return assignments;
      }),
    patchScriptAssignments: (request, tenantId, scriptId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* requireStepUp(auth, request, "script-change");

        const result = yield* patchScriptAssignments(
          db,
          ctx.organization.id,
          scriptId,
          payload,
          now(),
        );

        if ("notFound" in result)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Script not found" }));

        if ("problem" in result && result.problem)
          return yield* Effect.fail(new EnterpriseBadRequest({ message: result.problem }));

        const devices = yield* scriptAssignedDeviceIds(db, ctx.organization.id, scriptId);

        yield* applePush.pushAppleDevices(devices.map((device) => device.id));

        yield* audit(ctx, "script.assignments_changed", "script", scriptId, {
          assignGroups: payload.assign?.groups?.length ?? 0,
          assignDevices: payload.assign?.devices?.length ?? 0,
          unassignGroups: payload.unassign?.groups?.length ?? 0,
          unassignDevices: payload.unassign?.devices?.length ?? 0,
        });

        return ok;
      }),
    runScript: (request, tenantId, scriptId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* requireStepUp(auth, request, "script-run");

        if (!ctx.organization.scriptsEnabled)
          return yield* Effect.fail(
            new EnterpriseForbidden({
              message: "Scripts are disabled for this tenant. Enable them in Scripts settings.",
            }),
          );

        const script = yield* db.query.script.findFirst({
          where: { id: scriptId, organizationId: ctx.organization.id },
        });

        if (!script)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Script not found" }));

        const result = yield* runScript(
          db,
          ctx.organization.id,
          script,
          payload ?? {},
          ctx.account.id,
          now(),
        );

        const queuedDeviceIds = result.targets
          .filter((target) => !target.skippedReason && target.executionId)
          .map((target) => target.deviceId);

        yield* applePush.pushAppleDevices(queuedDeviceIds);

        yield* audit(ctx, "script.run_requested", "script", scriptId, {
          queued: result.queued,
          skipped: result.skipped,
        });

        return result;
      }),
    listScriptExecutions: (request, tenantId, scriptId, query) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const script = yield* db.query.script.findFirst({
          where: { id: scriptId, organizationId: ctx.organization.id },
        });

        if (!script)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Script not found" }));

        return yield* listScriptExecutions(db, ctx.organization.id, scriptId, query ?? {});
      }),
    syncScriptAgent: (request) =>
      Effect.gen(function* () {
        if (!authSecret)
          return yield* Effect.fail(
            new EnterpriseInternal({
              message: "Script agent results require a configured AUTH_SECRET.",
            }),
          );

        const header = request.headers.authorization;

        const token = header?.toLowerCase().startsWith("bearer ")
          ? header.slice(7).trim()
          : undefined;

        if (!token)
          return yield* Effect.fail(new EnterpriseUnauthorized({ message: "Unauthorized" }));

        const deviceId = yield* Effect.promise(() => verifyScriptAgentToken(token, authSecret));

        if (!deviceId)
          return yield* Effect.fail(new EnterpriseUnauthorized({ message: "Unauthorized" }));

        const device = yield* db.query.device.findFirst({ where: { id: deviceId } });

        if (!device || device.status !== "enrolled")
          return yield* Effect.fail(new EnterpriseUnauthorized({ message: "Unauthorized" }));

        return yield* scriptAgentSync(db, device.organizationId, device.id, now());
      }),
    reportScriptAgentResult: (request, payload) =>
      Effect.gen(function* () {
        if (!authSecret)
          return yield* Effect.fail(
            new EnterpriseInternal({
              message: "Script agent results require a configured AUTH_SECRET.",
            }),
          );

        const header = request.headers.authorization;

        const token = header?.toLowerCase().startsWith("bearer ")
          ? header.slice(7).trim()
          : undefined;

        if (!token)
          return yield* Effect.fail(new EnterpriseUnauthorized({ message: "Unauthorized" }));

        const deviceId = yield* Effect.promise(() => verifyScriptAgentToken(token, authSecret));

        if (!deviceId)
          return yield* Effect.fail(new EnterpriseUnauthorized({ message: "Unauthorized" }));

        const device = yield* db.query.device.findFirst({ where: { id: deviceId } });

        if (!device || device.status !== "enrolled")
          return yield* Effect.fail(new EnterpriseUnauthorized({ message: "Unauthorized" }));

        const result = yield* recordScriptAgentResult(db, device, payload, now());

        if ("problem" in result && result.problem)
          return yield* Effect.fail(new EnterpriseBadRequest({ message: result.problem }));

        return {
          status: "ok" as const,
          executionId: result.executionId,
          duplicate: result.duplicate,
        };
      }),
    reportWindowsActivation: (request, payload) =>
      Effect.gen(function* () {
        if (!authSecret)
          return yield* Effect.fail(
            new EnterpriseInternal({
              message: "Windows activation reports require a configured AUTH_SECRET.",
            }),
          );

        const header = request.headers.authorization;

        const token = header?.toLowerCase().startsWith("bearer ")
          ? header.slice(7).trim()
          : undefined;

        if (!token)
          return yield* Effect.fail(new EnterpriseUnauthorized({ message: "Unauthorized" }));

        const deviceId = yield* Effect.promise(() => verifyScriptAgentToken(token, authSecret));

        if (!deviceId)
          return yield* Effect.fail(new EnterpriseUnauthorized({ message: "Unauthorized" }));

        const device = yield* db.query.device.findFirst({ where: { id: deviceId } });

        if (!device || device.status !== "enrolled")
          return yield* Effect.fail(new EnterpriseUnauthorized({ message: "Unauthorized" }));

        // Activation is a Windows concept: accepting a report for another
        // platform would invent a state the device cannot have.
        if (device.proto !== "win")
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Only Windows devices report activation state.",
            }),
          );

        const text = (value: string | null | undefined) => {
          const trimmed = value?.trim();

          return trimmed ? trimmed.slice(0, 255) : null;
        };

        const receivedAt = now();
        const sampledAt = payload.sampledAt ? new Date(payload.sampledAt) : null;

        // Clamp a future clock to the ingest time, and ignore timestamps MySQL
        // cannot store (`datetime` starts at year 1000). A bad sample must not
        // 500 or pin the row in the future.
        let appliedAt = receivedAt;

        if (
          sampledAt &&
          Number.isFinite(sampledAt.getTime()) &&
          sampledAt.getUTCFullYear() >= 1000 &&
          sampledAt < receivedAt
        )
          appliedAt = sampledAt;

        const rawLicenseStatus = windowsLicenseStatusValue(payload.licenseStatus);

        const activationStatus = windowsActivationStatusFromLicenseStatus(rawLicenseStatus);

        // Only a sample at or after the stored instant may replace it, so an
        // out-of-order replay cannot move the row backwards. The comparison
        // lives in the UPDATE so two concurrent reports cannot race.
        const updated = yield* db
          .update(schema.device)
          .set({
            windowsActivationStatus: activationStatus,
            windowsActivationLicenseStatus: rawLicenseStatus,
            windowsActivationEdition: text(payload.edition),
            windowsActivationChannel: text(payload.productKeyChannel),
            windowsActivationLicenseName: text(payload.licenseName),
            windowsActivationUpdatedAt: appliedAt,
          })
          .where(
            and(
              eq(schema.device.id, device.id),
              or(
                isNull(schema.device.windowsActivationUpdatedAt),
                lte(schema.device.windowsActivationUpdatedAt, appliedAt),
              ),
            ),
          );

        if (updated.affectedRows === 0) {
          const [current] = yield* db
            .select({ status: schema.device.windowsActivationStatus })
            .from(schema.device)
            .where(eq(schema.device.id, device.id))
            .limit(1);

          return {
            status: "ok" as const,
            applied: false,
            activation: current?.status ?? ("unknown" as const),
          };
        }

        return { status: "ok" as const, applied: true, activation: activationStatus };
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

        // Android Management API limits some commands to particular management
        // modes, so the Android row joins the capability decision.
        const [android] =
          device.proto === "android"
            ? yield* db
                .select({
                  managementMode: schema.androidDevice.managementMode,
                  ownership: schema.androidDevice.ownership,
                })
                .from(schema.androidDevice)
                .where(
                  and(
                    eq(schema.androidDevice.deviceId, device.id),
                    eq(schema.androidDevice.organizationId, ctx.organization.id),
                  ),
                )
                .limit(1)
            : [];

        // Capability gating: the platform, enrollment state and the device's
        // own reported capabilities decide which actions are legal. RBAC is
        // still enforced by `requireTenant` above.
        const deviceActionInput = {
          proto: device.proto,
          status: device.status,
          osEdition: device.osEdition,
          osVersion: device.osVersion,
          model: device.model,
          managementMode: android?.managementMode ?? null,
          ownership: android?.ownership ?? null,
          capabilities: Option.getOrUndefined(
            Schema.decodeUnknownOption(Schema.Json)(device.capabilities),
          ),
        };

        const requestedAction = Option.getOrUndefined(
          Schema.decodeUnknownOption(DeviceActionName)(action),
        );

        if (
          !requestedAction ||
          !deviceAvailableActions(deviceActionInput).includes(requestedAction)
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

        let returnToService:
          | {
              wifiProfileIncluded: boolean;
              enrollmentProfileIncluded: boolean;
              bootstrapTokenIncluded: boolean;
              automatedDeviceEnrollment: boolean;
            }
          | undefined;

        let returnToServicePayload: CommandPayload | undefined;

        if (device.proto === "android" && device.status === "enrolled" && action === "sync") {
          // Read this one device from Google before pushing policy: a status
          // report can be missed, and the operator pressing Sync expects the
          // page to reflect Google rather than the last push it received.
          // A device Google no longer has is retired by the same call.
          yield* mapAndroidFailure(
            refreshAndroidDevice({
              db,
              config: androidConfig,
              authSecret,
              organizationId: ctx.organization.id,
              device: { id: device.id, dmIdentifier: device.dmIdentifier },
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
                message: "This remote action is not available for Android devices.",
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

            if (action === "return-to-service" && device.proto === "apple") {
              // Apple only supports Return to Service on iOS/iPadOS 17+,
              // tvOS 18+ and visionOS 26+; `EraseDevice.ReturnToService` is
              // not defined for macOS at all.
              if (/mac/i.test(`${device.osEdition ?? ""} ${device.model ?? ""}`))
                return yield* Effect.fail(
                  new EnterpriseBadRequest({
                    message:
                      "Return to Service is not supported on macOS. Apple defines the EraseDevice ReturnToService key only for iOS/iPadOS 17+, tvOS 18+ and visionOS 26+. Use a regular wipe and re-enrol the Mac through ADE.",
                  }),
                );

              const edition = (device.osEdition ?? "").toLowerCase();

              const majorVersion = Number.parseInt(device.osVersion ?? "", 10);

              const minimumVersion = /tvos/.test(edition) ? 18 : /visionos/.test(edition) ? 26 : 17;

              if (Number.isFinite(majorVersion) && majorVersion < minimumVersion)
                return yield* Effect.fail(
                  new EnterpriseBadRequest({
                    message: `Return to Service requires ${/tvos/.test(edition) ? "tvOS" : /visionos/.test(edition) ? "visionOS" : "iOS/iPadOS"} ${minimumVersion} or later. This device reports ${device.osVersion}.`,
                  }),
                );

              const effective = yield* resolveEffectivePolicyForDevice(db, device);

              const wifiProfile = effective.configurations
                .filter((configuration) => configuration.kind === "mttx.apple.custom.wifi")
                .map((configuration) => {
                  const data = Option.getOrUndefined(
                    Schema.decodeUnknownOption(Schema.Json)(configuration.data),
                  );

                  if (!Schema.is(Schema.JsonObject)(data)) return undefined;
                  const content = data["content"];

                  return Schema.is(Schema.String)(content) && content.length > 0
                    ? content
                    : undefined;
                })
                .find((content): content is string => content !== undefined);

              if (!wifiProfile)
                return yield* Effect.fail(
                  new EnterpriseBadRequest({
                    message:
                      "Return to Service needs a Wi-Fi profile so the device can reconnect after erasing. Add a Wi-Fi configuration to a policy assigned to this device, then try again.",
                  }),
                );

              const bootstrapToken = yield* resolveBootstrapToken(device);

              // App preservation on iOS 26+/visionOS 26+ requires the
              // escrowed bootstrap token. Older releases can still return to
              // service, just without preserving managed apps.
              const requiresBootstrapToken =
                (/ios|ipados|visionos/.test(edition) || edition === "") &&
                Number.isFinite(majorVersion) &&
                majorVersion >= 26;

              if (!bootstrapToken && requiresBootstrapToken)
                return yield* Effect.fail(
                  new EnterpriseBadRequest({
                    message:
                      "Return to Service with app preservation requires an escrowed bootstrap token, and this device has not sent one. Complete one ADE enrolment on iOS 26 or later so the device escrows its token, then try again.",
                  }),
                );

              const abmDevice = device.serial
                ? yield* db.query.abmDevice.findFirst({
                    where: {
                      organizationId: ctx.organization.id,
                      serial: device.serial,
                      enrollmentState: "ASSIGNED",
                    },
                  })
                : undefined;

              const automatedDeviceEnrollment = Boolean(abmDevice);

              // ADE devices re-fetch their enrollment profile from Apple (and
              // therefore get a fresh SCEP challenge). Other supervised devices
              // need the signed profile embedded in the erase.
              const enrollmentProfile = automatedDeviceEnrollment
                ? undefined
                : yield* tenantSignedEnrollmentProfile(ctx.organization.id);

              const returnToServiceConfiguration: ReturnToServiceErase = {
                Enabled: true,
                WiFiProfileData: wifiProfile,
              };

              if (enrollmentProfile)
                returnToServiceConfiguration.MDMProfileData = bytesToBase64(enrollmentProfile);

              if (bootstrapToken) returnToServiceConfiguration.BootstrapToken = bootstrapToken;

              returnToServicePayload = {
                ReturnToService: returnToServiceConfiguration,
                // iOS-only key; false keeps the eSIM for a shared device.
                PreserveDataPlan: false,
              } satisfies CommandPayload;
              returnToService = {
                wifiProfileIncluded: true,
                enrollmentProfileIncluded: Boolean(enrollmentProfile),
                bootstrapTokenIncluded: Boolean(bootstrapToken),
                automatedDeviceEnrollment,
              };

              yield* db
                .update(schema.deviceApple)
                .set({
                  returnToServiceRequestedAt: timestamp,
                  returnToServiceCompletedAt: null,
                })
                .where(eq(schema.deviceApple.deviceId, device.id));
              yield* audit(ctx, "device.return_to_service_requested", "device", device.id, {
                automatedDeviceEnrollment,
                enrollmentProfileIncluded: Boolean(enrollmentProfile),
                bootstrapTokenIncluded: Boolean(bootstrapToken),
              });
            }

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
                  // Erase flags are explicit rather than defaulted and are
                  // platform-specific: `PIN` and `ObliterationBehavior` are
                  // macOS keys; iOS/tvOS/visionOS take the Setup Assistant and
                  // data-plan keys instead.
                  if (isMacOsDevice(device))
                    return {
                      requestType: "EraseDevice",
                      payload: { PIN: randomPin, ObliterationBehavior: "Default" },
                    };

                  return {
                    requestType: "EraseDevice",
                    payload: { DisallowProximitySetup: true, PreserveDataPlan: false },
                  };
                }

                case "return-to-service":
                  return returnToServicePayload
                    ? { requestType: "EraseDevice", payload: returnToServicePayload }
                    : null;

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

            let recoveryLockClearId: string | undefined;

            if ((action === "wipe" || action === "return-to-service") && device.proto === "apple") {
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
                // Protect this command from the erase's supersede pass: it is
                // queued by the same request and must reach the device first.
                const clear = yield* queueDeviceCommand({
                  organizationId: ctx.organization.id,
                  deviceId: device.id,
                  requestType: "SetRecoveryLock",
                  payload: { CurrentPassword: recoveryLock, NewPassword: "" },
                  at: new Date(timestamp.getTime() - 1),
                });

                recoveryLockClearId = clear.id;
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
              protectIds: recoveryLockClearId ? [recoveryLockClearId] : undefined,
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

        if (returnToService) response.returnToService = returnToService;

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
          commands: commands.map((command) => {
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
    listDeviceAppleUsers: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });

        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));

        const [apple] = yield* db
          .select({ enrollmentMode: schema.deviceApple.enrollmentMode })
          .from(schema.deviceApple)
          .where(eq(schema.deviceApple.deviceId, device.id))
          .limit(1);

        const users = yield* db
          .select()
          .from(schema.deviceAppleUser)
          .where(eq(schema.deviceAppleUser.deviceId, device.id))
          .orderBy(desc(schema.deviceAppleUser.lastSeenAt));

        const boundUserIds = users.flatMap((user) =>
          user.directoryUserId ? [user.directoryUserId] : [],
        );

        const boundUsers = boundUserIds.length
          ? yield* db
              .select({
                id: schema.user.id,
                name: schema.user.name,
                email: schema.user.email,
              })
              .from(schema.user)
              .where(
                and(
                  eq(schema.user.organizationId, ctx.organization.id),
                  inArray(schema.user.id, [...new Set(boundUserIds)]),
                ),
              )
          : [];

        const boundById = new Map(boundUsers.map((user) => [user.id, user]));

        return {
          enrollmentMode: apple?.enrollmentMode ?? null,
          users: users.map((user) => {
            const configured = Boolean(user.token && user.pushMagic);
            const identityTarget = user.directoryUserId
              ? boundById.get(user.directoryUserId)
              : undefined;

            const binding =
              user.authenticatedAt !== null
                ? ("authenticated" as const)
                : apple?.enrollmentMode === "user"
                  ? ("enrollment" as const)
                  : ("unbound" as const);

            return {
              platformUserId: user.userId,
              shortName: user.userShortName,
              longName: user.userLongName,
              binding,
              configured,
              authenticatedAt: user.authenticatedAt ? iso(user.authenticatedAt) : null,
              lastSeenAt: user.lastSeenAt ? iso(user.lastSeenAt) : null,
              push: {
                configured,
                lastAttemptAt: user.lastPushAt ? iso(user.lastPushAt) : null,
                lastSuccessAt: user.lastPushOkAt ? iso(user.lastPushOkAt) : null,
                lastError: user.lastPushError,
                lastErrorCode: null,
                consecutiveFailures: user.consecutivePushFailures ?? 0,
                invalidToken: false,
              },
              profiles: user.profiles ?? [],
              identity:
                identityTarget && user.identitySource
                  ? {
                      userId: identityTarget.id,
                      name: identityTarget.name,
                      email: identityTarget.email,
                      source: user.identitySource,
                      upn: user.identityUpn,
                      verifiedAt: user.identityVerifiedAt ? iso(user.identityVerifiedAt) : null,
                    }
                  : null,
              actions: appleUserAvailableActions({ configured }),
            };
          }),
        };
      }),
    deviceAppleUserAction: (request, tenantId, deviceId, platformUserId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });

        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));

        if (device.proto !== "apple")
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Per-user channels are only available for Apple devices.",
            }),
          );

        if (device.status !== "enrolled")
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Per-user actions are only available while the device is enrolled.",
            }),
          );

        const [user] = yield* db
          .select()
          .from(schema.deviceAppleUser)
          .where(
            and(
              eq(schema.deviceAppleUser.deviceId, device.id),
              eq(schema.deviceAppleUser.userId, platformUserId),
            ),
          )
          .limit(1);

        if (!user)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "This user channel is not present on the device." }),
          );

        const action = payload.action;

        const available = appleUserAvailableActions({
          configured: Boolean(user.token && user.pushMagic),
        });

        if (!available.includes(action))
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message:
                action === "sync"
                  ? "This user channel has not reported a push token, so it cannot be woken. It will check in on its own."
                  : "Unknown per-user action.",
            }),
          );

        const auditUserAction = (name: string) =>
          audit(ctx, "device.action", "device", deviceId, {
            action: name,
            channel: "user",
            platformUserId,
          });

        if (action === "sync") {
          yield* applePush.pushAppleUserChannel(device.id, platformUserId);
          yield* auditUserAction("user-sync");

          return { status: "ok" as const };
        }

        const queued = yield* queueDeviceCommand({
          organizationId: ctx.organization.id,
          deviceId: device.id,
          requestType: "ProfileList",
          payload: { ManagedOnly: false },
          at: now(),
          userId: platformUserId,
        });

        yield* applePush.pushAppleUserChannel(device.id, platformUserId);
        yield* auditUserAction("user-refresh-profiles");

        return {
          status: "ok" as const,
          commandId: queued.id,
          deduplicated: queued.deduplicated,
        };
      }),
    bindAppleUserIdentity: (request, tenantId, deviceId, platformUserId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });

        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));

        if (device.proto !== "apple")
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Per-user channels are only available for Apple devices.",
            }),
          );

        if (device.status !== "enrolled")
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Link an identity while the device is enrolled.",
            }),
          );

        const [channel] = yield* db
          .select({ userId: schema.deviceAppleUser.userId })
          .from(schema.deviceAppleUser)
          .where(
            and(
              eq(schema.deviceAppleUser.deviceId, device.id),
              eq(schema.deviceAppleUser.userId, platformUserId),
            ),
          )
          .limit(1);

        if (!channel)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "This user channel is not present on the device." }),
          );

        yield* assertTenantUsers(ctx.organization.id, [payload.userId]);

        const [directoryUser] = yield* db
          .select({
            id: schema.user.id,
            name: schema.user.name,
            email: schema.user.email,
            disabled: schema.user.disabled,
          })
          .from(schema.user)
          .where(
            and(
              eq(schema.user.id, payload.userId),
              eq(schema.user.organizationId, ctx.organization.id),
            ),
          )
          .limit(1);

        if (!directoryUser)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "Directory user not found." }),
          );

        if (directoryUser.disabled)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "A disabled directory user cannot be bound to a user channel.",
            }),
          );

        // A new binding invalidates the old declaration set: the next sync must
        // recompute the user's policy from scratch.
        yield* db
          .update(schema.deviceAppleUser)
          .set({
            directoryUserId: directoryUser.id,
            identitySource: "manual",
            identityUpn: directoryUser.email,
            identityVerifiedAt: now(),
            ddmDeclarationsToken: null,
            updatedAt: now(),
          })
          .where(
            and(
              eq(schema.deviceAppleUser.deviceId, device.id),
              eq(schema.deviceAppleUser.userId, platformUserId),
            ),
          );

        yield* db
          .delete(schema.deviceUserDeclaration)
          .where(
            and(
              eq(schema.deviceUserDeclaration.deviceId, device.id),
              eq(schema.deviceUserDeclaration.userId, platformUserId),
            ),
          );

        yield* applePush
          .pushAppleUserChannel(device.id, platformUserId)
          .pipe(Effect.catch(() => Effect.void));

        yield* audit(ctx, "device.apple_user_bound", "device", device.id, {
          platformUserId,
          directoryUserId: directoryUser.id,
          source: "manual",
        });

        return { status: "ok" as const };
      }),
    unbindAppleUserIdentity: (request, tenantId, deviceId, platformUserId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const device = yield* db.query.device.findFirst({
          where: { id: deviceId, organizationId: ctx.organization.id },
        });

        if (!device)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));

        if (device.proto !== "apple")
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Per-user channels are only available for Apple devices.",
            }),
          );

        const [channel] = yield* db
          .select({ userId: schema.deviceAppleUser.userId })
          .from(schema.deviceAppleUser)
          .where(
            and(
              eq(schema.deviceAppleUser.deviceId, device.id),
              eq(schema.deviceAppleUser.userId, platformUserId),
            ),
          )
          .limit(1);

        if (!channel)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "This user channel is not present on the device." }),
          );

        yield* db
          .update(schema.deviceAppleUser)
          .set({
            directoryUserId: null,
            identitySource: null,
            identityUpn: null,
            identityVerifiedAt: null,
            ddmDeclarationsToken: null,
            updatedAt: now(),
          })
          .where(
            and(
              eq(schema.deviceAppleUser.deviceId, device.id),
              eq(schema.deviceAppleUser.userId, platformUserId),
            ),
          );

        yield* db
          .delete(schema.deviceUserDeclaration)
          .where(
            and(
              eq(schema.deviceUserDeclaration.deviceId, device.id),
              eq(schema.deviceUserDeclaration.userId, platformUserId),
            ),
          );

        yield* applePush
          .pushAppleUserChannel(device.id, platformUserId)
          .pipe(Effect.catch(() => Effect.void));

        yield* audit(ctx, "device.apple_user_unbound", "device", device.id, { platformUserId });

        return { status: "ok" as const };
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

        if (device.proto === "android" && device.status === "enrolled")
          return yield* Effect.gen(function* () {
            // Deleting the Google Enterprise record is destructive, so it
            // demands the same recent step-up proof as the /action commands.
            yield* requireStepUp(auth, request, "device-command");

            // Deleting the Google Enterprise device resource removes Android
            // Device Policy and its work data, then moves the row to
            // `unenrolled` in one step (Google has no asynchronous retirement
            // acknowledgement to wait for here).
            yield* mapAndroidFailure(
              unenrollAndroidDevice({
                db,
                config: androidConfig,
                organizationId: ctx.organization.id,
                device: { id: device.id, dmIdentifier: device.dmIdentifier },
              }),
            );

            const revoked = yield* revokeDeviceCertificates(ctx.organization.id, [device]);
            yield* audit(ctx, "device.unenrolled", "device", deviceId, {
              revokedCertificates: revoked,
              platform: "android",
            });
            yield* reconcileSeats(ctx.organization.id);

            return ok;
          });

        if (device.proto === "android")
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "This Android device is not enrolled, so it cannot be unenrolled.",
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
        // A device on its way out no longer costs a seat; the nightly sweep
        // catches devices that stop reporting without an explicit unenrol.
        yield* reconcileSeats(ctx.organization.id);

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

        const [declarations, certificates, apple] = yield* Effect.all(
          [
            queryEffect(deviceDeclarationsFor(device.id)),
            queryEffect(deviceCertificatesFor(ctx.organization.id, device)),
            queryEffect(
              device.proto === "apple"
                ? db.query.deviceApple.findFirst({ where: { deviceId: device.id } })
                : Effect.succeed(undefined),
            ),
          ],
          { concurrency: "unbounded" },
        );

        return {
          health: normalizeDeviceHealth(
            rowDeviceHealth(device, declarations, apple?.awaitingConfiguration ?? null),
          ),
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
        const cursor = query?.cursor ? decodeDeviceActivityCursor(query.cursor) : undefined;

        // Offset paging re-read every row above the page from both sources on
        // each request, so it is retired. The first page is still `offset=0` or
        // omitted; deeper pages use the cursor returned by the previous page.
        if (!cursor && query?.offset !== undefined && query.offset > 0)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "offset paging is not supported; pass the cursor from the previous page",
            }),
          );

        // Fetch one bounded window per source. Each page reads at most
        // `limit + 1` rows per source regardless of how deep it is.
        const window = limit + 1;

        const auditFilter = cursor
          ? deviceActivityKeysetCondition(
              deviceActivitySourceKeyset(cursor, DEVICE_ACTIVITY_AUDIT_PREFIX),
              schema.auditLog.createdAt,
              schema.auditLog.id,
            )
          : undefined;

        const auditQuery = db
          .select()
          .from(schema.auditLog)
          .where(
            and(
              eq(schema.auditLog.organizationId, ctx.organization.id),
              eq(schema.auditLog.targetType, "device"),
              eq(schema.auditLog.targetId, device.id),
              auditFilter,
            ),
          )
          .orderBy(desc(schema.auditLog.createdAt), desc(schema.auditLog.id))
          .limit(window);

        const commandFilter = cursor
          ? deviceActivityKeysetCondition(
              deviceActivitySourceKeyset(cursor, DEVICE_ACTIVITY_COMMAND_PREFIX),
              schema.deviceCommand.updatedAt,
              schema.deviceCommand.id,
            )
          : undefined;

        const commandQuery = db
          .select()
          .from(schema.deviceCommand)
          .where(
            commandFilter
              ? and(eq(schema.deviceCommand.deviceId, device.id), commandFilter)
              : eq(schema.deviceCommand.deviceId, device.id),
          )
          .orderBy(desc(schema.deviceCommand.updatedAt), desc(schema.deviceCommand.id))
          .limit(window);

        // Audit, commands, declarations and certificates are four independent
        // sources of one activity page.
        const [auditRows, commandRows, declarations, certificates] = yield* Effect.all(
          [
            queryEffect(auditQuery),
            queryEffect(commandQuery),
            queryEffect(deviceDeclarationsFor(device.id)),
            queryEffect(deviceCertificatesFor(ctx.organization.id, device)),
          ],
          { concurrency: "unbounded" },
        );

        const audits = auditRows.map((row) => ({
          ...row,
          metadata: Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(row.metadata)),
        }));

        const at = now();

        // A command past its deadline can no longer run, even before a check-in
        // persists the transition.
        const commands = commandRows.map((row) => ({
          ...row,
          status: commandIsExpired(row, at) ? "expired" : row.status,
        }));

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
          { limit, cursor },
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

        const [declarations, setupRows] = yield* Effect.all(
          [
            queryEffect(
              deviceIds.length
                ? db
                    .select()
                    .from(schema.deviceDeclaration)
                    .where(inArray(schema.deviceDeclaration.deviceId, deviceIds))
                : emptyRows<typeof schema.deviceDeclaration.$inferSelect>(),
            ),
            queryEffect(
              deviceIds.length
                ? db
                    .select({
                      deviceId: schema.deviceApple.deviceId,
                      awaitingConfiguration: schema.deviceApple.awaitingConfiguration,
                    })
                    .from(schema.deviceApple)
                    .where(inArray(schema.deviceApple.deviceId, deviceIds))
                : emptyRows<{ deviceId: string; awaitingConfiguration: boolean }>(),
            ),
          ],
          { concurrency: "unbounded" },
        );

        const byDevice = new Map<string, Array<(typeof declarations)[number]>>();

        for (const declaration of declarations) {
          const list = byDevice.get(declaration.deviceId) ?? [];
          list.push(declaration);
          byDevice.set(declaration.deviceId, list);
        }

        const setup = new Map(setupRows.map((row) => [row.deviceId, row.awaitingConfiguration]));

        const summaries = devices.map((device: EnterpriseDevice) =>
          rowDeviceHealth(device, byDevice.get(device.id) ?? [], setup.get(device.id) ?? null),
        );

        const levelRank = {
          critical: 0,
          missing: 1,
          attention: 2,
          unknown: 3,
          healthy: 4,
        } as const;

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
          .filter((row) => (row.consecutivePushFailures ?? 0) > 0 && row.lastPushAt)
          .map((row) => ({
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
    listWindowsFailures: (request, tenantId, query = {}) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        // A device filter is tenant-scoped before it is used, so guessing a
        // device id cannot read another tenant's history.
        if (query.deviceId) {
          const device = yield* db.query.device.findFirst({
            where: { id: query.deviceId, organizationId: ctx.organization.id },
          });

          if (!device)
            return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));
        }

        const [count, failures] = yield* Effect.all(
          [
            countWindowsFailures(db, {
              organizationId: ctx.organization.id,
              deviceId: query.deviceId,
              retentionDays: windowsFailureRetentionDays,
            }),
            query.deviceId
              ? listWindowsFailuresForDevice(db, {
                  organizationId: ctx.organization.id,
                  deviceId: query.deviceId,
                  limit: query.limit,
                })
              : listWindowsFailuresForOrganization(db, ctx.organization.id, query.limit),
          ],
          { concurrency: "unbounded" },
        );

        return {
          retentionDays: windowsFailureRetentionDays,
          count,
          failures: failures.map(windowsFailureInfo),
        };
      }),
    getCredentialHealth: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        return yield* loadCredentialHealth(db, ctx.organization.id, now(), { authSecret });
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
        const body: {
          name: string;
          notes?: string | null;
          priority?: number;
          enabled?: boolean;
        } = payload;

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
          enabled: body.enabled ?? true,
          createdAt: now(),
          updatedAt: now(),
        });
        yield* audit(ctx, "policy.created", "policy", policyId, {
          name: body.name,
          ...(body.enabled === false ? { enabled: false } : {}),
        });
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
          enabled?: boolean;
          configurations?: Record<string, Schema.Json>;
          configurationScopes?: Record<string, "device" | "user">;
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

        // An omitted scope map means "leave scopes alone": the designer and
        // older clients patch configurations without knowing about scope. A
        // supplied map is authoritative for every kind it carries, and a kind
        // missing from it is device scope.
        const existingScopes = new Map(
          (yield* db
            .select({ kind: schema.configuration.kind, scope: schema.configuration.scope })
            .from(schema.configuration)
            .where(eq(schema.configuration.policyId, policyId))).map((row) => [
            row.kind,
            row.scope,
          ]),
        );

        const scopeFor = (kind: string): "device" | "user" =>
          body.configurationScopes === undefined
            ? (existingScopes.get(kind) ?? "device")
            : (body.configurationScopes[kind] ?? "device");

        const attributeKeys = (yield* listAttributeDefinitions(db, ctx.organization.id)).map(
          (definition) => definition.key,
        );

        // Validate the whole patch before mutating anything so a bad
        // configuration cannot leave the policy half-updated.
        for (const [kind, data] of configurations) {
          if (data === null) continue;

          const configuration = Option.getOrUndefined(
            Schema.decodeUnknownOption(Schema.Json)(data),
          );

          if (configuration === undefined) continue;
          const scope = scopeFor(kind);

          yield* validateConfiguration(kind, configuration, {
            escrowCertificateFingerprintSha256: escrowFingerprint,
            scope,
          }).pipe(Effect.mapError((message) => new EnterpriseBadRequest({ message })));

          const variableProblem = policyConfigurationVariableProblem(configuration, attributeKeys);

          if (variableProblem)
            return yield* Effect.fail(
              new EnterpriseBadRequest({ message: `${kind}: ${variableProblem}` }),
            );

          if (!isApplicationKind(kind)) continue;
          const application = parseAppleApplicationConfiguration(configuration);

          if (!application)
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `"${kind}" is not a valid Apple application configuration`,
              }),
            );

          if (application.type === "catalogue") {
            const catalogue = yield* db.query.application.findFirst({
              where: {
                id: application.applicationId,
                organizationId: ctx.organization.id,
              },
            });

            if (!catalogue)
              return yield* Effect.fail(
                new EnterpriseBadRequest({
                  message: `"${kind}" references an application that does not exist in this tenant`,
                }),
              );

            if (catalogue.platform !== "apple")
              return yield* Effect.fail(
                new EnterpriseBadRequest({
                  message: `"${kind}" references a ${catalogue.platform} application; only Apple applications can be added to an Apple policy`,
                }),
              );

            continue;
          }

          if (application.source !== "upload") continue;

          const r2 = yield* R2Storage;

          const uploaded = yield* r2
            .head(policyApplicationKey(ctx.organization.id, policyId, application.sha256!))
            .pipe(Effect.option);

          if (Option.isNone(uploaded))
            return yield* Effect.fail(
              new EnterpriseBadRequest({
                message: `"${kind}" references an uploaded package that is not in this policy's storage. Upload the .pkg first, then save.`,
              }),
            );
        }

        yield* db
          .update(schema.policy)
          .set({
            name: body.name,
            notes: body.notes,
            priority: body.priority,
            enabled: body.enabled,
            updatedAt: now(),
          })
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
            const scope = scopeFor(kind);

            yield* db
              .insert(schema.configuration)
              .values({ policyId, kind, scope, data, hash })
              .onDuplicateKeyUpdate({ set: { data, hash, scope } });
          }
        }

        const affectedDevices = yield* applePush.deviceIdsInPolicies([policyId]);
        yield* pushPolicyDevices(ctx.organization.id, { policyId }, affectedDevices);
        yield* syncAndroidDevices(ctx.organization.id, affectedDevices);
        yield* audit(ctx, "policy.updated", "policy", policyId, {
          fields: Object.keys(body),
          ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
          configurations: Object.keys(body.configurations ?? {}),
          userScopedConfigurations: Object.entries(body.configurationScopes ?? {})
            .filter(([, scope]) => scope === "user")
            .map(([kind]) => kind),
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
          deployments: deployments.map((deployment) => ({
            id: deployment.id,
            version: deployment.version,
            createdAt: iso(deployment.createdAt),
            createdByAccountId: deployment.createdByAccountId,
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

        const snapshot = Option.getOrElse(
          Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Json))(
            deployment.snapshot,
          ),
          () => ({}) as Record<string, Schema.Json>,
        );

        const snapshotScopes = Option.getOrElse(
          Schema.decodeUnknownOption(
            Schema.Record(Schema.String, Schema.Literals(["device", "user"])),
          )(snapshot[POLICY_SNAPSHOT_SCOPES_KEY]),
          () => ({}) as Record<string, "device" | "user">,
        );

        const entries = Object.entries(snapshot).filter(
          ([kind]) =>
            kind !== POLICY_SNAPSHOT_SCOPES_KEY && kind !== POLICY_SNAPSHOT_ENABLED_KEY,
        );

        if (entries.length > 0)
          yield* db.insert(schema.configuration).values(
            yield* Effect.all(
              entries.map(([kind, data]) =>
                Effect.map(hashJson(data), (hash) => ({
                  policyId,
                  kind,
                  scope: snapshotScopes[kind] ?? "device",
                  data,
                  hash,
                })),
              ),
            ),
          );

        // Older snapshots have no state key and are therefore enabled.
        const restoredEnabled = snapshot[POLICY_SNAPSHOT_ENABLED_KEY] !== false;

        yield* db
          .update(schema.policy)
          .set({ enabled: restoredEnabled, updatedAt: now() })
          .where(eq(schema.policy.id, policyId));
        yield* snapshotPolicy(ctx, policyId);
        yield* audit(ctx, "policy.rolled_back", "policy", policyId, {
          deploymentId,
          enabled: restoredEnabled,
        });
        // Rollback replaces configurations, so both Apple and Android devices
        // must be woken; previously only Android was resynced.
        yield* refreshDevicePolicies(
          ctx.organization.id,
          yield* applePush.deviceIdsInPolicies([policyId]),
          policyId,
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
          httpMetadata: {
            contentType: body.contentType ?? "application/octet-stream",
            cacheControl: R2_IMMUTABLE_CACHE_CONTROL,
          },
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

        const [policy, groupLinks, deviceLinks, userLinks, userGroupLinks] = yield* Effect.all(
          [
            queryEffect(
              db.query.policy.findFirst({
                where: { id: policyId, organizationId: ctx.organization.id },
              }),
            ),
            queryEffect(
              db
                .select({ groupId: schema.groupPolicy.groupId, mode: schema.groupPolicy.mode })
                .from(schema.groupPolicy)
                .where(eq(schema.groupPolicy.policyId, policyId)),
            ),
            queryEffect(
              db
                .select({ deviceId: schema.devicePolicy.deviceId, mode: schema.devicePolicy.mode })
                .from(schema.devicePolicy)
                .where(eq(schema.devicePolicy.policyId, policyId)),
            ),
            queryEffect(
              db
                .select({ userId: schema.userPolicy.userId, mode: schema.userPolicy.mode })
                .from(schema.userPolicy)
                .where(
                  and(
                    eq(schema.userPolicy.organizationId, ctx.organization.id),
                    eq(schema.userPolicy.policyId, policyId),
                  ),
                ),
            ),
            queryEffect(
              db
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
                ),
            ),
          ],
          { concurrency: "unbounded" },
        );

        if (!policy)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Policy not found" }));
        const priority = policy.priority ?? 0;

        const [groups, devices, users, userGroups] = yield* Effect.all(
          [
            queryEffect(
              groupLinks.length
                ? db
                    .select({ id: schema.enterpriseGroup.id, name: schema.enterpriseGroup.name })
                    .from(schema.enterpriseGroup)
                    .where(
                      inArray(
                        schema.enterpriseGroup.id,
                        groupLinks.map((link) => link.groupId),
                      ),
                    )
                : emptyRows<{ id: string; name: string }>(),
            ),
            queryEffect(
              deviceLinks.length
                ? db
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
                : emptyRows<{ id: string; name: string }>(),
            ),
            queryEffect(
              userLinks.length
                ? db
                    .select({
                      id: schema.user.id,
                      name: schema.user.name,
                      email: schema.user.email,
                    })
                    .from(schema.user)
                    .where(
                      and(
                        eq(schema.user.organizationId, ctx.organization.id),
                        inArray(
                          schema.user.id,
                          userLinks.map((link) => link.userId),
                        ),
                      ),
                    )
                : emptyRows<{ id: string; name: string; email: string }>(),
            ),
            queryEffect(
              userGroupLinks.length
                ? db
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
                : emptyRows<{ id: string; name: string }>(),
            ),
          ],
          { concurrency: "unbounded" },
        );

        const groupModes = new Map(
          groupLinks.map((link) => [link.groupId, link.mode ?? ("include" as const)]),
        );

        const deviceModes = new Map(
          deviceLinks.map((link) => [link.deviceId, link.mode ?? ("include" as const)]),
        );

        const userModes = new Map(
          userLinks.map((link) => [link.userId, link.mode ?? ("include" as const)]),
        );

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

        const [userRows, groups] = yield* Effect.all(
          [
            queryEffect(
              db
                .select({
                  id: schema.user.id,
                  name: schema.user.name,
                  email: schema.user.email,
                  externalId: schema.user.externalId,
                  disabled: schema.user.disabled,
                  source: schema.user.source,
                })
                .from(schema.user)
                .where(eq(schema.user.organizationId, ctx.organization.id)),
            ),
            queryEffect(
              db
                .select({
                  id: schema.userGroup.id,
                  name: schema.userGroup.name,
                  source: schema.userGroup.source,
                })
                .from(schema.userGroup)
                .where(eq(schema.userGroup.organizationId, ctx.organization.id)),
            ),
          ],
          { concurrency: "unbounded" },
        );

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
          users: userRows.sort((left, right) => left.name.localeCompare(right.name)),
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
          .where(
            and(
              eq(schema.deviceUser.organizationId, ctx.organization.id),
              eq(schema.deviceUser.deviceId, deviceId),
              eq(schema.user.organizationId, ctx.organization.id),
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
          .where(
            and(
              eq(schema.deviceUser.organizationId, ctx.organization.id),
              eq(schema.deviceUser.deviceId, deviceId),
              eq(schema.user.organizationId, ctx.organization.id),
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

        const [groupLinks, deviceLinks, installerRows] = yield* Effect.all(
          [
            queryEffect(
              db
                .select()
                .from(schema.applicationGroup)
                .where(inArray(schema.applicationGroup.applicationId, ids)),
            ),
            queryEffect(
              db
                .select()
                .from(schema.applicationDevice)
                .where(inArray(schema.applicationDevice.applicationId, ids)),
            ),
            queryEffect(
              db
                .select()
                .from(schema.applicationInstaller)
                .where(inArray(schema.applicationInstaller.applicationId, ids)),
            ),
          ],
          { concurrency: "unbounded" },
        );

        const sortedInstallers = [...installerRows].sort(compareInstallerPreference);

        return {
          applications: apps.map((app) =>
            rowApplication(
              app,
              groupLinks.filter((link: { applicationId: string }) => link.applicationId === app.id)
                .length,
              deviceLinks.filter((link: { applicationId: string }) => link.applicationId === app.id)
                .length,
              sortedInstallers
                .filter((installer) => installer.applicationId === app.id)
                .map(rowInstaller),
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

        const [groupLinks, deviceLinks, installers] = yield* Effect.all(
          [
            queryEffect(
              db
                .select()
                .from(schema.applicationGroup)
                .where(eq(schema.applicationGroup.applicationId, applicationId)),
            ),
            queryEffect(
              db
                .select()
                .from(schema.applicationDevice)
                .where(eq(schema.applicationDevice.applicationId, applicationId)),
            ),
            queryEffect(applicationInstallers(ctx.organization.id, applicationId)),
          ],
          { concurrency: "unbounded" },
        );

        const groupIds = groupLinks.map((link: { groupId: string }) => link.groupId);
        const deviceIds = deviceLinks.map((link: { deviceId: string }) => link.deviceId);

        const [groups, devices] = yield* Effect.all(
          [
            queryEffect(
              groupIds.length
                ? db
                    .select({ id: schema.enterpriseGroup.id, name: schema.enterpriseGroup.name })
                    .from(schema.enterpriseGroup)
                    .where(inArray(schema.enterpriseGroup.id, groupIds))
                : emptyRows<{ id: string; name: string }>(),
            ),
            queryEffect(
              deviceIds.length
                ? db
                    .select({ id: schema.device.id, name: schema.device.name })
                    .from(schema.device)
                    .where(inArray(schema.device.id, deviceIds))
                : emptyRows<{ id: string; name: string }>(),
            ),
          ],
          { concurrency: "unbounded" },
        );

        return {
          ...rowApplication(app, groups.length, devices.length, installers.map(rowInstaller)),
          groups,
          devices,
        };
      }),
    createApplication: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");

        const body: {
          name: string;
          platform?: "apple" | "win" | "android";
          bundleId?: string | null;
          version?: string | null;
          source?: "manifest" | "store" | "upload";
          manifestUrl?: string | null;
          storeId?: string | null;
          notes?: string | null;
          installers?: ReadonlyArray<InstallerInput>;
        } = payload;

        if (!body.name.trim())
          return yield* Effect.fail(new EnterpriseBadRequest({ message: "Name is required" }));

        const inputs: ReadonlyArray<InstallerInput> = body.installers?.length
          ? body.installers
          : body.platform
            ? [
                {
                  platform: body.platform,
                  source: body.source,
                  bundleId: body.bundleId,
                  version: body.version,
                  manifestUrl: body.manifestUrl,
                  storeId: body.storeId,
                },
              ]
            : [];

        if (inputs.length === 0)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Add at least one installer" }),
          );

        const primary = yield* normaliseInstaller(inputs[0]!);
        const applicationId = id();
        const at = now();

        yield* db.insert(schema.application).values({
          id: applicationId,
          organizationId: ctx.organization.id,
          name: body.name.trim(),
          platform: primary.platform,
          bundleId: primary.bundleId,
          version: primary.version,
          source: primary.source,
          manifestUrl: primary.manifestUrl,
          storeId: primary.storeId,
          notes: body.notes ?? null,
          createdAt: at,
          updatedAt: at,
        });

        yield* replaceApplicationInstallers({
          organizationId: ctx.organization.id,
          applicationId,
          installers: inputs,
        });

        yield* audit(ctx, "application.created", "application", applicationId, {
          name: body.name.trim(),
          platform: primary.platform,
          installers: inputs.length,
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
          installers?: ReadonlyArray<InstallerInput>;
        } = payload;

        if (body.name !== undefined && !body.name.trim())
          return yield* Effect.fail(new EnterpriseBadRequest({ message: "Name is required" }));

        if (body.installers !== undefined && body.installers.length === 0)
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "An application needs at least one installer" }),
          );

        yield* db
          .update(schema.application)
          .set({
            name: body.name?.trim() ?? existing.name,
            notes: body.notes === undefined ? existing.notes : body.notes,
            updatedAt: now(),
          })
          .where(
            and(
              eq(schema.application.id, applicationId),
              eq(schema.application.organizationId, ctx.organization.id),
            ),
          );

        if (body.installers !== undefined) {
          yield* replaceApplicationInstallers({
            organizationId: ctx.organization.id,
            applicationId,
            installers: body.installers,
          });
        } else {
          const installers = yield* applicationInstallers(ctx.organization.id, applicationId);
          const primary = installers[0];

          if (primary) {
            const merged: InstallerInput = {
              id: primary.id,
              platform: primary.platform,
              source: body.source ?? primary.source,
              bundleId: body.bundleId === undefined ? primary.bundleId : body.bundleId,
              version: body.version === undefined ? primary.version : body.version,
              manifestUrl: body.manifestUrl === undefined ? primary.manifestUrl : body.manifestUrl,
              storeId: body.storeId === undefined ? primary.storeId : body.storeId,
              minOsVersion: primary.minOsVersion,
              requiredCapability: primary.requiredCapability,
              priority: primary.priority,
            };

            yield* replaceApplicationInstallers({
              organizationId: ctx.organization.id,
              applicationId,
              installers: [
                merged,
                ...installers.slice(1).map((installer) => ({
                  id: installer.id,
                  platform: installer.platform,
                  source: installer.source,
                  bundleId: installer.bundleId,
                  version: installer.version,
                  manifestUrl: installer.manifestUrl,
                  storeId: installer.storeId,
                  minOsVersion: installer.minOsVersion,
                  requiredCapability: installer.requiredCapability,
                  priority: installer.priority,
                })),
              ],
            });
          }
        }

        yield* audit(ctx, "application.updated", "application", applicationId, {
          fields: Object.keys(body),
        });

        if (existing.platform === "android") yield* syncAndroidDevices(ctx.organization.id);

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

              const installerRows = yield* db
                .select({ r2Key: schema.applicationInstaller.r2Key })
                .from(schema.applicationInstaller)
                .where(eq(schema.applicationInstaller.applicationId, applicationId));

              yield* db
                .delete(schema.application)
                .where(
                  and(
                    eq(schema.application.id, applicationId),
                    eq(schema.application.organizationId, ctx.organization.id),
                  ),
                );

              // Delete objects only after the rows are gone. A failure here
              // leaves an orphaned object, never a row pointing at a deleted
              // file, and must not abort the rest of the batch.
              for (const key of [
                ...installerRows.flatMap((row) => (row.r2Key ? [row.r2Key] : [])),
                ...(existing.r2Key ? [existing.r2Key] : []),
              ])
                yield* r2
                  .delete(key)
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

        // Removing a catalogue entry removes it from every compiled Android
        // policy, which is how Google is told to uninstall it.
        if (deleted.length > 0) yield* syncAndroidDevices(ctx.organization.id);

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
        yield* syncAndroidDevices(
          ctx.organization.id,
          affected.filter((device) => device.proto === "android").map((device) => device.id),
        );
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

        const installerRows = yield* applicationInstallers(ctx.organization.id, applicationId);

        // Rows created before multi-installer support (or by older importers)
        // still carry a complete installer in the application columns.
        const installers: ReadonlyArray<EnterpriseApplicationInstaller> =
          installerRows.length > 0
            ? installerRows
            : [
                {
                  id: app.id,
                  organizationId: app.organizationId,
                  applicationId: app.id,
                  platform: app.platform,
                  source: app.source,
                  bundleId: app.bundleId,
                  version: app.version,
                  manifestUrl: app.manifestUrl,
                  storeId: app.storeId,
                  fileName: app.fileName,
                  contentType: app.contentType,
                  size: app.size,
                  sha256: app.sha256,
                  r2Key: app.r2Key,
                  minOsVersion: null,
                  requiredCapability: null,
                  priority: 0,
                  createdAt: app.createdAt,
                  updatedAt: app.updatedAt,
                },
              ];

        const devices = yield* applicationAssignedDeviceIds(ctx.organization.id, applicationId);

        const selected = new Map<
          string,
          { installer: EnterpriseApplicationInstaller; devices: EnterpriseDevice[] }
        >();

        const reasons: string[] = [];
        let skipped = 0;

        for (const device of devices) {
          if (device.status !== "enrolled") {
            skipped++;
            continue;
          }

          // Uploaded Apple packages are macOS-only. Filter them out before
          // selection so an iPhone falls through to its manifest/store option.
          const candidates = installers.filter(
            (item) =>
              !(
                item.platform === "apple" &&
                item.source === "upload" &&
                appleOsFamily(device.osEdition) !== "macOS"
              ),
          );

          const installer = selectInstaller(candidates, {
            proto: device.proto,
            osVersion: device.osVersion,
            capabilities: Array.isArray(device.capabilities)
              ? device.capabilities.filter((value): value is string => typeof value === "string")
              : undefined,
          });

          if (!installer) {
            skipped++;

            const reason =
              candidates.length === 0 &&
              installers.some((item) => item.platform === "apple" && item.source === "upload")
                ? "Uploaded .pkg installers target macOS only, and no assigned Mac is enrolled."
                : installerSkipReason(candidates, {
                    proto: device.proto,
                    osVersion: device.osVersion,
                    capabilities: Array.isArray(device.capabilities)
                      ? device.capabilities.filter(
                          (value): value is string => typeof value === "string",
                        )
                      : undefined,
                  });

            if (reason) reasons.push(reason);

            continue;
          }

          const group = selected.get(installer.id) ?? { installer, devices: [] };

          group.devices.push(device);
          selected.set(installer.id, group);
        }

        let queued = 0;
        const at = now();

        for (const { installer, devices: groupDevices } of selected.values()) {
          if (installer.platform === "android") {
            const packageName = installer.bundleId?.trim();

            if (!packageName) {
              skipped += groupDevices.length;
              reasons.push("an Android installer is missing its package name");
              continue;
            }

            if (!isAndroidConfigured(androidConfig)) {
              skipped += groupDevices.length;
              reasons.push("Android Management is not configured for this deployment");
              continue;
            }

            const sync = yield* syncAndroidPoliciesForTenant({
              db,
              config: androidConfig,
              organizationId: ctx.organization.id,
              deviceIds: groupDevices.map((device) => device.id),
            }).pipe(Effect.result);

            if (Predicate.isTagged(sync, "Failure")) {
              skipped += groupDevices.length;
              reasons.push(`the Android policy could not be pushed: ${sync.failure.message}`);
              continue;
            }

            queued += sync.success.updated;
            skipped += sync.success.failed;
            continue;
          }

          if (installer.platform === "win") {
            if (installer.source === "store") {
              skipped += groupDevices.length;
              reasons.push(
                "Windows Store applications cannot be installed through OMA-DM; deploy an MSI installer",
              );
              continue;
            }

            const productId = installer.bundleId?.trim();

            if (!productId || !isMsiProductCode(productId)) {
              skipped += groupDevices.length;
              reasons.push("a Windows installer needs the MSI ProductCode (a GUID)");
              continue;
            }

            const installerUrl = installer.manifestUrl?.trim();

            if (!installerUrl) {
              skipped += groupDevices.length;
              reasons.push("a Windows installer needs an installer URL");
              continue;
            }

            let url: URL;

            try {
              url = new URL(installerUrl);
            } catch {
              skipped += groupDevices.length;
              reasons.push("a Windows installer URL is not absolute");
              continue;
            }

            if (url.protocol !== "https:") {
              skipped += groupDevices.length;
              reasons.push("a Windows installer URL must use HTTPS");
              continue;
            }

            if (
              !isMsiInstaller({
                fileName: installer.fileName,
                contentType: installer.contentType,
                installerUrl,
              })
            ) {
              skipped += groupDevices.length;
              reasons.push(
                "Only .msi packages can be installed by the Windows MDM channel. Package this app as an MSI (an .exe or .intunewin needs the Intune Management Extension).",
              );
              continue;
            }

            const payload = windowsMsiInstallPayload({
              appId: app.id,
              productId: normalizeMsiProductCode(productId),
              version: installer.version ?? "1.0.0",
              url: url.toString(),
              sha256: installer.sha256,
            });

            for (const device of groupDevices)
              yield* queueDeviceCommand({
                organizationId: ctx.organization.id,
                deviceId: device.id,
                requestType: "InstallApplication",
                payload,
                at,
              });

            queued += groupDevices.length;
            continue;
          }

          // Apple: one installer may be a .pkg upload, an OTA manifest or a
          // store listing. The selected installer already matched the device's
          // platform, OS version and reported capabilities.
          if (installer.source === "upload") {
            if (!installer.r2Key || !installer.sha256 || !installer.fileName) {
              skipped += groupDevices.length;
              reasons.push("Upload the installer before installing this application.");
              continue;
            }

            if (!installer.bundleId?.trim()) {
              skipped += groupDevices.length;
              reasons.push("an uploaded Apple installer needs a bundle identifier");
              continue;
            }

            if (
              !isApplePackageUpload({
                fileName: installer.fileName,
                contentType: installer.contentType,
              })
            ) {
              skipped += groupDevices.length;
              reasons.push(
                "Only signed .pkg installers can be installed from an upload. An .ipa needs an OTA manifest URL.",
              );
              continue;
            }

            const macDevices = groupDevices.filter(
              (device) => appleOsFamily(device.osEdition) === "macOS",
            );

            skipped += groupDevices.length - macDevices.length;

            if (macDevices.length === 0) {
              reasons.push("uploaded .pkg installers target macOS only");
              continue;
            }

            for (const device of macDevices) {
              const token = yield* Effect.tryPromise(() =>
                signAppleAssetToken(authSecret ?? "", {
                  policyId: installer.id,
                  kind: CATALOGUE_APPLICATION_ASSET_KIND,
                  deviceId: device.id,
                  expiresAt: appleInstallAssetExpiresAt(at.getTime()),
                }),
              );

              const url = `${origin.replace(/\/+$/, "")}/mdm/apple/assets/${encodeURIComponent(
                catalogueApplicationAssetIdentifier(installer.id),
              )}?token=${encodeURIComponent(token)}`;

              yield* queueDeviceCommand({
                organizationId: ctx.organization.id,
                deviceId: device.id,
                requestType: "InstallEnterpriseApplication",
                payload: buildInstallEnterpriseApplicationPayload({
                  manifest: buildAppleManifest({
                    url,
                    sha256: installer.sha256,
                    bundleId: installer.bundleId.trim(),
                    version: installer.version?.trim() || "0",
                    title: app.name,
                  }),
                  managementFlags: 1,
                }),
                at,
              });
            }

            yield* applePush.pushAppleDevices(macDevices.map((device) => device.id));
            queued += macDevices.length;
            continue;
          }

          if (installer.source === "store") {
            const storeId = installer.storeId?.trim();

            if (!storeId) {
              skipped += groupDevices.length;
              reasons.push("the store installer is missing its store ID");
              continue;
            }

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

              if (!asset) {
                skipped += groupDevices.length;
                reasons.push("no VPP licence pool exists for this app yet");
                continue;
              }

              const queuedDevices: Array<(typeof groupDevices)[number]> = [];

              for (const device of groupDevices) {
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
                  skipped++;
                  continue;
                }

                queuedDevices.push(device);
              }

              if (queuedDevices.length > 0) {
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

              queued += queuedDevices.length;
              continue;
            }

            const payload: CommandPayload = {
              iTunesStoreID: Number(storeId),
              ManagementFlags: 1,
              InstallAsManaged: true,
              Options: { PurchaseMethod: 1 },
            };

            for (const device of groupDevices)
              yield* queueDeviceCommand({
                organizationId: ctx.organization.id,
                deviceId: device.id,
                requestType: "InstallApplication",
                payload,
                at,
              });

            queued += groupDevices.length;
            continue;
          }

          const manifestUrl = installer.manifestUrl?.trim();

          if (!manifestUrl) {
            skipped += groupDevices.length;
            reasons.push("the manifest installer is missing its manifest URL");
            continue;
          }

          const payload: CommandPayload = {
            ManifestURL: manifestUrl,
            ManagementFlags: 1,
            InstallAsManaged: true,
            Options: { PurchaseMethod: 1 },
          };

          for (const device of groupDevices)
            yield* queueDeviceCommand({
              organizationId: ctx.organization.id,
              deviceId: device.id,
              requestType: "InstallApplication",
              payload,
              at,
            });

          queued += groupDevices.length;
        }

        yield* audit(ctx, "application.install_queued", "application", applicationId, {
          queued,
          skipped,
          installers: [...selected.values()].map(({ installer, devices: group }) => ({
            id: installer.id,
            platform: installer.platform,
            source: installer.source,
            version: installer.version,
            devices: group.length,
          })),
        });

        return {
          status: "ok" as const,
          queued,
          skipped,
          message: queued === 0 ? reasons[0] : reasons.length > 0 ? reasons[0] : undefined,
        };
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
          httpMetadata: {
            contentType: body.contentType ?? "application/octet-stream",
            cacheControl: R2_IMMUTABLE_CACHE_CONTROL,
          },
          customMetadata: { fileName: body.fileName },
        });
        const installers = yield* applicationInstallers(ctx.organization.id, applicationId);
        const primary = installers[0];

        if (primary) {
          yield* db
            .update(schema.applicationInstaller)
            .set({
              fileName: body.fileName,
              contentType: body.contentType ?? null,
              size: bytes.byteLength,
              sha256,
              r2Key: key,
              updatedAt: now(),
            })
            .where(eq(schema.applicationInstaller.id, primary.id));

          if (primary.r2Key && primary.r2Key !== key) yield* r2.delete(primary.r2Key);
        } else {
          const at = now();

          yield* db.insert(schema.applicationInstaller).values({
            id: id(),
            organizationId: ctx.organization.id,
            applicationId,
            platform: existing?.platform ?? "apple",
            source: "upload",
            bundleId: existing?.bundleId ?? null,
            version: existing?.version ?? null,
            manifestUrl: existing?.manifestUrl ?? null,
            storeId: existing?.storeId ?? null,
            fileName: body.fileName,
            contentType: body.contentType ?? null,
            size: bytes.byteLength,
            sha256,
            r2Key: key,
            priority: 0,
            createdAt: at,
            updatedAt: at,
          });
        }

        yield* syncLegacyApplicationInstaller(ctx.organization.id, applicationId);

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
    uploadApplicationInstaller: (request, tenantId, applicationId, installerId, payload) =>
      Effect.gen(function* () {
        const r2 = yield* R2Storage;
        const ctx = yield* requireTenant(request, tenantId, "write");

        const [installer] = yield* db
          .select()
          .from(schema.applicationInstaller)
          .where(
            and(
              eq(schema.applicationInstaller.id, installerId),
              eq(schema.applicationInstaller.applicationId, applicationId),
              eq(schema.applicationInstaller.organizationId, ctx.organization.id),
            ),
          )
          .limit(1);

        if (!installer)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Installer not found" }));

        const body: { fileName: string; contentType?: string; content: string } = payload;
        const bytes = base64ToBytes(body.content);
        const sha256 = yield* sha256Hex(bytesToArrayBuffer(bytes));
        const key = applicationKey(ctx.organization.id, installer.id, sha256);

        yield* r2.put(key, bytes, {
          httpMetadata: {
            contentType: body.contentType ?? "application/octet-stream",
            cacheControl: R2_IMMUTABLE_CACHE_CONTROL,
          },
          customMetadata: { fileName: body.fileName },
        });

        yield* db
          .update(schema.applicationInstaller)
          .set({
            fileName: body.fileName,
            contentType: body.contentType ?? null,
            size: bytes.byteLength,
            sha256,
            r2Key: key,
            updatedAt: now(),
          })
          .where(eq(schema.applicationInstaller.id, installer.id));

        if (installer.r2Key && installer.r2Key !== key) yield* r2.delete(installer.r2Key);

        yield* syncLegacyApplicationInstaller(ctx.organization.id, applicationId);
        yield* audit(ctx, "application.uploaded", "application", applicationId, {
          installerId: installer.id,
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
    downloadApplicationInstaller: (request, tenantId, applicationId, installerId, sha256) =>
      Effect.gen(function* () {
        const r2 = yield* R2Storage;
        const ctx = yield* requireTenant(request, tenantId);

        const [installer] = yield* db
          .select()
          .from(schema.applicationInstaller)
          .where(
            and(
              eq(schema.applicationInstaller.id, installerId),
              eq(schema.applicationInstaller.applicationId, applicationId),
              eq(schema.applicationInstaller.organizationId, ctx.organization.id),
            ),
          )
          .limit(1);

        if (!installer || installer.sha256 !== sha256 || !installer.r2Key)
          return yield* Effect.fail(
            new EnterpriseNotFound({ message: "Application file not found" }),
          );

        const object = yield* r2
          .get(installer.r2Key)
          .pipe(
            Effect.catchTag("R2FileNotFound", () =>
              Effect.fail(new EnterpriseNotFound({ message: "Application file not found" })),
            ),
          );

        const bytes = yield* r2.arrayBuffer(object);

        return {
          sha256,
          fileName: object.customMetadata?.fileName ?? installer.fileName ?? sha256,
          contentType: object.httpMetadata?.contentType ?? installer.contentType ?? null,
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

        const deviceIds = affected.flat();
        const pushed = yield* applePush.pushAppleDevices(deviceIds);
        yield* reportPolicyDeliveryFailure(tenantId, { policyIds: [...ids] }, pushed);
        // Android has no push channel: the sync endpoint must recompute its
        // policies explicitly, as every other policy mutation does.
        yield* syncAndroidDevices(tenantId, deviceIds);

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
          enabled: source.enabled ?? true,
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
              scope: c.scope,
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
        const pattern = `%${escapeLike(term)}%`;

        // Tenant-level read is not enough to enumerate an entity class:
        // serials, group names and policy names need their section permission,
        // the same as the corresponding list endpoints.
        const canReadDevices = hasPermission(ctx.role.permissions, "devices.read");
        const canReadGroups = hasPermission(ctx.role.permissions, "groups.read");
        const canReadPolicies = hasPermission(ctx.role.permissions, "policies.read");

        const devices = canReadDevices
          ? yield* db
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
              .orderBy(asc(schema.device.name), asc(schema.device.id))
              .limit(limit)
          : [];

        const groups = canReadGroups
          ? yield* db
              .select()
              .from(schema.enterpriseGroup)
              .where(
                and(
                  eq(schema.enterpriseGroup.organizationId, ctx.organization.id),
                  like(schema.enterpriseGroup.name, pattern),
                ),
              )
              .orderBy(asc(schema.enterpriseGroup.name), asc(schema.enterpriseGroup.id))
              .limit(limit)
          : [];

        const policies = canReadPolicies
          ? yield* db
              .select()
              .from(schema.policy)
              .where(
                and(
                  eq(schema.policy.organizationId, ctx.organization.id),
                  like(schema.policy.name, pattern),
                ),
              )
              .orderBy(asc(schema.policy.name), asc(schema.policy.id))
              .limit(limit)
          : [];

        // Both administrator accounts and directory people are gated by
        // `members.read`; tenant-level read must not bypass it.
        const canReadPeople = hasPermission(ctx.role.permissions, "members.read");

        const accounts = canReadPeople
          ? yield* db
              .select({
                id: schema.account.id,
                name: schema.account.name,
                email: schema.account.email,
                role: schema.member.role,
              })
              .from(schema.member)
              .innerJoin(schema.account, eq(schema.account.id, schema.member.accountId))
              .where(
                and(
                  eq(schema.member.organizationId, ctx.organization.id),
                  or(like(schema.account.name, pattern), like(schema.account.email, pattern)),
                ),
              )
              .orderBy(asc(schema.account.name), asc(schema.account.id))
              .limit(limit)
          : [];

        const directoryUsers = canReadPeople
          ? yield* db
              .select({
                id: schema.user.id,
                name: schema.user.name,
                email: schema.user.email,
              })
              .from(schema.user)
              .where(
                and(
                  eq(schema.user.organizationId, ctx.organization.id),
                  or(like(schema.user.name, pattern), like(schema.user.email, pattern)),
                ),
              )
              .orderBy(asc(schema.user.name), asc(schema.user.id))
              .limit(limit)
          : [];

        // Catalogue entries are not device data: the palette links to the
        // application page, which itself requires `applications.read`.
        const applications = hasPermission(ctx.role.permissions, "applications.read")
          ? yield* db
              .select({
                id: schema.application.id,
                name: schema.application.name,
                platform: schema.application.platform,
                bundleId: schema.application.bundleId,
                storeId: schema.application.storeId,
              })
              .from(schema.application)
              .where(
                and(
                  eq(schema.application.organizationId, ctx.organization.id),
                  or(
                    like(schema.application.name, pattern),
                    like(schema.application.bundleId, pattern),
                    like(schema.application.storeId, pattern),
                  ),
                ),
              )
              .orderBy(asc(schema.application.name), asc(schema.application.id))
              .limit(limit)
          : [];

        // The same permission guards the tenant software inventory that the
        // palette links to. Inventory rows are per device, so aggregation runs
        // before the limit is applied.
        const software = hasPermission(ctx.role.permissions, "applications.read")
          ? yield* (
              db
                .select({
                  deviceId: schema.deviceApplication.deviceId,
                  bundleId: schema.deviceApplication.bundleId,
                  name: schema.deviceApplication.name,
                  version: schema.deviceApplication.version,
                  shortVersion: schema.deviceApplication.shortVersion,
                  publisher: schema.deviceApplication.publisher,
                })
                .from(schema.deviceApplication)
                .where(
                  and(
                    eq(schema.deviceApplication.organizationId, ctx.organization.id),
                    or(
                      like(schema.deviceApplication.name, pattern),
                      like(schema.deviceApplication.bundleId, pattern),
                      like(schema.deviceApplication.version, pattern),
                      like(schema.deviceApplication.shortVersion, pattern),
                      like(schema.deviceApplication.publisher, pattern),
                    ),
                  ),
                )
                // Deterministic order before the raw-row cap so truncation (if it
                // happens) keeps the same subset on every query.
                .orderBy(
                  asc(schema.deviceApplication.bundleId),
                  asc(schema.deviceApplication.version),
                  asc(schema.deviceApplication.publisher),
                  asc(schema.deviceApplication.name),
                  asc(schema.deviceApplication.deviceId),
                )
                .limit(SOFTWARE_SEARCH_MAX_ROWS)
            )
          : [];

        const androidByDevice = yield* androidDeviceAccessFor(
          ctx.organization.id,
          devices.map((row) => row.id),
        );

        return {
          rows: [
            ...devices.map((row) => rowDevice(row, undefined, androidByDevice.get(row.id))),
            ...groups.map((row: EnterpriseGroup) => rowGroup(row)),
            ...(yield* Effect.all(policies.map((row) => rowPolicy(row)))),
            ...accounts,
            ...directoryUsers,
            ...applications.map((row) => ({
              id: row.id,
              name: row.name,
              platform: row.platform,
              identifier: row.bundleId ?? row.storeId ?? null,
              storeId: row.storeId,
            })),
            ...aggregateSoftwareSearchRows(software, limit),
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

        const ids = rows.map((row) => row.id);

        // Claiming enrollment answers writes `device_attribute` rows, so it must
        // finish before the attribute read. Setup and Android state are
        // independent of both and of each other, so they share its wave.
        const [, appleByDevice, androidByDevice] = yield* Effect.all(
          [
            queryEffect(claimEnrollmentAnswers(db, ctx.organization.id, rows)),
            queryEffect(deviceSetupStateFor(ids)),
            queryEffect(androidDeviceAccessFor(ctx.organization.id, ids)),
          ],
          { concurrency: "unbounded" },
        );

        const attributes = yield* loadDeviceAttributes(db, ctx.organization.id, ids);

        return {
          rows: rows.map((row) => {
            const values = attributes.get(row.id);
            const device = rowDevice(row, appleByDevice.get(row.id), androidByDevice.get(row.id));

            return values ? { ...device, attributes: values } : device;
          }),
        };
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
              case "health":
                return { critical: 0, missing: 1, attention: 2, unknown: 3, healthy: 4 }[
                  snapshot.health.level
                ];
              case "activation":
                return activationSortRank(snapshot.row.windowsActivationStatus);
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
          const pageIds = page.map((snapshot) => snapshot.row.id);

          const [groups, , setup, androidByDevice] = yield* Effect.all(
            [
              queryEffect(deviceGroupsFor(ctx.organization.id, pageIds)),
              queryEffect(
                claimEnrollmentAnswers(
                  db,
                  ctx.organization.id,
                  page.map((snapshot) => snapshot.row),
                ),
              ),
              queryEffect(deviceSetupStateFor(pageIds)),
              queryEffect(androidDeviceAccessFor(ctx.organization.id, pageIds)),
            ],
            { concurrency: "unbounded" },
          );

          const attributes = yield* loadDeviceAttributes(db, ctx.organization.id, pageIds);

          return {
            devices: page.map((snapshot) => ({
              ...rowDevice(
                snapshot.row,
                setup.get(snapshot.row.id),
                androidByDevice.get(snapshot.row.id),
              ),
              attributes: attributes.get(snapshot.row.id),
              health: normalizeDeviceHealth(snapshot.health),
              groups: groups.get(snapshot.row.id) ?? [],
            })),
            total: matches.length,
          };
        }

        const totalQuery = () => db.select({ value: count() }).from(schema.device).where(where);

        // Health is derived, so ordering by it needs the same bounded
        // in-memory pass as the health filter: load the matching set once,
        // sort by severity and slice the page. Ascending means worst first, so
        // the table agrees with the "needs attention" filter and the summary.
        if (filters.sort === "health") {
          const [[total], matches] = yield* Effect.all(
            [queryEffect(totalQuery()), queryEffect(db.select().from(schema.device).where(where))],
            { concurrency: "unbounded" },
          );

          const matchIds = matches.map((row) => row.id);

          const [declarations, setup] = yield* Effect.all(
            [
              queryEffect(
                db
                  .select()
                  .from(schema.deviceDeclaration)
                  .where(inArray(schema.deviceDeclaration.deviceId, matchIds)),
              ),
              queryEffect(deviceSetupStateFor(matchIds)),
            ],
            { concurrency: "unbounded" },
          );

          const health = deviceHealthFrom(
            matches,
            declarations,
            new Map([...setup].map(([id, row]) => [id, row.awaitingConfiguration])),
          );

          const rank = { critical: 0, missing: 1, attention: 2, unknown: 3, healthy: 4 } as const;
          const direction = filters.direction === "desc" ? -1 : 1;

          matches.sort((left, right) => {
            const a = rank[health.get(left.id)?.level ?? "unknown"];
            const b = rank[health.get(right.id)?.level ?? "unknown"];

            return (
              (a - b) * direction ||
              left.name.localeCompare(right.name, undefined, { numeric: true }) ||
              left.id.localeCompare(right.id)
            );
          });

          const page = matches.slice(filters.offset, filters.offset + filters.limit);
          const pageIds = page.map((row) => row.id);

          const [groups, , androidByDevice] = yield* Effect.all(
            [
              queryEffect(deviceGroupsFor(ctx.organization.id, pageIds)),
              queryEffect(claimEnrollmentAnswers(db, ctx.organization.id, page)),
              queryEffect(androidDeviceAccessFor(ctx.organization.id, pageIds)),
            ],
            { concurrency: "unbounded" },
          );

          const attributes = yield* loadDeviceAttributes(db, ctx.organization.id, pageIds);

          return {
            devices: page.map((row) => {
              const summary = health.get(row.id);
              const values = attributes.get(row.id);

              return {
                ...rowDevice(row, setup.get(row.id), androidByDevice.get(row.id)),
                attributes: values,
                health: normalizeDeviceHealth(
                  summary ?? rowDeviceHealth(row, [], setup.get(row.id)?.awaitingConfiguration),
                ),
                groups: groups.get(row.id) ?? [],
              };
            }),
            total: Number(total?.value ?? 0),
          };
        }

        const [[total], rows] = yield* Effect.all(
          [
            queryEffect(totalQuery()),
            queryEffect(
              db
                .select()
                .from(schema.device)
                .where(where)
                .orderBy(...deviceOrder(filters))
                .limit(filters.limit)
                .offset(filters.offset),
            ),
          ],
          { concurrency: "unbounded" },
        );

        const ids = rows.map((row) => row.id);

        // Groups, health and setup state are independent reads; claiming
        // enrollment answers is a write that the attribute read depends on.
        const [groups, declarations, , setup, androidByDevice] = yield* Effect.all(
          [
            queryEffect(deviceGroupsFor(ctx.organization.id, ids)),
            queryEffect(
              db
                .select()
                .from(schema.deviceDeclaration)
                .where(inArray(schema.deviceDeclaration.deviceId, ids)),
            ),
            queryEffect(claimEnrollmentAnswers(db, ctx.organization.id, rows)),
            queryEffect(deviceSetupStateFor(ids)),
            queryEffect(androidDeviceAccessFor(ctx.organization.id, ids)),
          ],
          { concurrency: "unbounded" },
        );

        const health = deviceHealthFrom(
          rows,
          declarations,
          new Map([...setup].map(([id, row]) => [id, row.awaitingConfiguration])),
        );

        const attributes = yield* loadDeviceAttributes(db, ctx.organization.id, ids);

        return {
          devices: rows.map((row) => {
            const summary = health.get(row.id);
            const values = attributes.get(row.id);

            return {
              ...rowDevice(row, setup.get(row.id), androidByDevice.get(row.id)),
              attributes: values,
              health: normalizeDeviceHealth(
                summary ?? rowDeviceHealth(row, [], setup.get(row.id)?.awaitingConfiguration),
              ),
              groups: groups.get(row.id) ?? [],
            };
          }),
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
          createdByAccountId: ctx.account.id,
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
    queryDashboardBatch: (request, tenantId, payload: DashboardQueryBatchRequest) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        return yield* runDashboardQueryBatch(ctx.organization.id, payload.queries);
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
              case "health":
                return { critical: 0, missing: 1, attention: 2, unknown: 3, healthy: 4 }[
                  snapshot.health.level
                ];
              case "activation":
                return activationSortRank(snapshot.row.windowsActivationStatus);
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

        yield* claimEnrollmentAnswers(db, ctx.organization.id, exportedRows);

        const definitions = yield* listAttributeDefinitions(db, ctx.organization.id);

        const attributes = yield* loadDeviceAttributes(
          db,
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
            "Activation",
            "Battery health",
            "Capabilities",
            "Inventory updated",
            "Notes",
            "Groups",
            ...attributeCsvHeaders(definitions),
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
            row.proto === "win" ? windowsActivationLabel(row.windowsActivationStatus) : "",
            row.batteryHealth,
            capabilityText(
              Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(row.capabilities)),
            ),
            row.inventoryUpdatedAt ? iso(row.inventoryUpdatedAt) : "",
            row.notes,
            (groups.get(row.id) ?? []).map((group) => group.name).join("; "),
            ...attributeCsvCells(definitions, attributes.get(row.id)),
          ]),
        );

        return { csv, truncated, rowCount: exportedRows.length };
      }),
    getDevice: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        // Device, Apple and Android rows are one-to-one on the device id, so a
        // single join replaces three round trips. Autopilot stays separate: it
        // matches on serial *or* device id and may have a second candidate row.
        const [joined] = yield* db
          .select({
            device: schema.device,
            apple: schema.deviceApple,
            android: schema.androidDevice,
          })
          .from(schema.device)
          .leftJoin(schema.deviceApple, eq(schema.deviceApple.deviceId, schema.device.id))
          .leftJoin(
            schema.androidDevice,
            and(
              eq(schema.androidDevice.deviceId, schema.device.id),
              eq(schema.androidDevice.organizationId, ctx.organization.id),
            ),
          )
          .where(
            and(
              eq(schema.device.id, deviceId),
              eq(schema.device.organizationId, ctx.organization.id),
            ),
          )
          .limit(1);

        if (!joined)
          return yield* Effect.fail(new EnterpriseNotFound({ message: "Device not found" }));

        const row = joined.device;
        const apple = joined.apple ?? undefined;
        const android = joined.android ?? undefined;

        const [secrets, autopilotRows, groups] = yield* Effect.all(
          [
            queryEffect(
              db
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
                ),
            ),
            queryEffect(
              db
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
                .limit(1),
            ),
            queryEffect(deviceGroupsFor(ctx.organization.id, [row.id])),
          ],
          { concurrency: "unbounded" },
        );

        const autopilot = autopilotRows[0];

        const recoveryKey = secrets.find((secret) => secret.kind === "filevault_recovery_key");
        const bootstrapToken = secrets.find((secret) => secret.kind === "bootstrap_token");
        const localAdmin = secrets.find((secret) => secret.kind === "local_admin_password");

        const bypassCode = secrets.find((secret) => secret.kind === "activation_lock_bypass_code");

        yield* claimEnrollmentAnswers(db, ctx.organization.id, [row]);
        const attributes = yield* loadDeviceAttributes(db, ctx.organization.id, [row.id]);

        // Presence metadata only — the sealed value never leaves the backend.
        return {
          ...rowDevice(row, apple, android),
          attributes: attributes.get(row.id),
          groups: groups.get(row.id) ?? [],
          recoveryKeyEscrowed: Boolean(recoveryKey),
          bootstrapTokenEscrowed: apple?.bootstrapTokenEscrowed ?? Boolean(bootstrapToken),
          recoveryKeyUpdatedAt: recoveryKey ? iso(recoveryKey.updatedAt) : null,
          recoveryKeyRotatedAt: recoveryKey?.rotatedAt ? iso(recoveryKey.rotatedAt) : null,
          recoveryKeyFormat: recoveryKey?.format ?? null,
          bootstrapTokenUpdatedAt: bootstrapToken ? iso(bootstrapToken.updatedAt) : null,
          localAdminUsername: localAdmin ? "mattrax-admin" : null,
          localAdminPasswordEscrowed: Boolean(localAdmin),
          localAdminUpdatedAt: localAdmin ? iso(localAdmin.updatedAt) : null,
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
    getDeviceLocalAdmin: (request, tenantId, deviceId) =>
      Effect.gen(function* () {
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
              message: "Local administrator escrow is not configured on this deployment",
            }),
          );

        const [secret] = yield* db
          .select()
          .from(schema.deviceSecret)
          .where(
            and(
              eq(schema.deviceSecret.deviceId, device.id),
              eq(schema.deviceSecret.organizationId, ctx.organization.id),
              eq(schema.deviceSecret.kind, "local_admin_password"),
            ),
          )
          .limit(1);

        if (!secret)
          return yield* Effect.fail(
            new EnterpriseNotFound({
              message:
                "No managed local administrator has been created for this device. It is created during ADE setup on macOS.",
            }),
          );

        const password = yield* Effect.tryPromise(() =>
          openSecret(authSecret!, secret.sealedValue),
        ).pipe(
          Effect.mapError(
            () =>
              new EnterpriseBadRequest({
                message: "The managed local administrator password could not be decrypted",
              }),
          ),
        );

        yield* audit(ctx, "device.local_admin_viewed", "device", device.id, {
          kind: "local_admin_password",
        });

        return {
          username: "mattrax-admin",
          password,
          updatedAt: iso(secret.updatedAt),
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

        yield* claimEnrollmentAnswers(db, ctx.organization.id, [row]);

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

        const [deviceLinks, policyLinks] = yield* Effect.all(
          [
            queryEffect(
              db
                .select({ deviceId: schema.groupDevice.deviceId })
                .from(schema.groupDevice)
                .where(eq(schema.groupDevice.groupId, groupId)),
            ),
            queryEffect(
              db
                .select({ policyId: schema.groupPolicy.policyId, mode: schema.groupPolicy.mode })
                .from(schema.groupPolicy)
                .where(eq(schema.groupPolicy.groupId, groupId)),
            ),
          ],
          { concurrency: "unbounded" },
        );

        const [devices, policies] = yield* Effect.all(
          [
            queryEffect(
              deviceLinks.length
                ? db
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
                : emptyRows<{ id: string; name: string }>(),
            ),
            queryEffect(
              policyLinks.length
                ? db
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
                : emptyRows<{ id: string; name: string; priority: number }>(),
            ),
          ],
          { concurrency: "unbounded" },
        );

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

        if (rows.length === 0) return { rows: [] };

        const policyIds = rows.map((row: EnterprisePolicy) => row.id);

        // The list needs counts for every row, so load the tenant's assignment
        // edges once instead of running the per-device resolver per policy (or
        // per row). Scope arithmetic and delivery derivation are pure and live
        // in `policyList.ts`; the query count stays fixed as the fleet grows.
        // All six reads depend only on `policyIds`, so they share one wave
        // rather than six sequential round trips.
        const [
          configurationCounts,
          userConfigurationCounts,
          deployments,
          groupAssignments,
          deviceAssignments,
          userAssignments,
          userGroupAssignments,
        ] = yield* Effect.all(
          [
            queryEffect(
              db
                .select({ policyId: schema.configuration.policyId, value: count() })
                .from(schema.configuration)
                .where(inArray(schema.configuration.policyId, policyIds))
                .groupBy(schema.configuration.policyId),
            ),
            queryEffect(
              db
                .select({ policyId: schema.configuration.policyId, value: count() })
                .from(schema.configuration)
                .where(
                  and(
                    inArray(schema.configuration.policyId, policyIds),
                    eq(schema.configuration.scope, "user"),
                  ),
                )
                .groupBy(schema.configuration.policyId),
            ),
            queryEffect(
              db
                .select({
                  policyId: schema.policyDeployment.policyId,
                  value: max(schema.policyDeployment.version),
                })
                .from(schema.policyDeployment)
                .where(inArray(schema.policyDeployment.policyId, policyIds))
                .groupBy(schema.policyDeployment.policyId),
            ),
            queryEffect(
              db
                .select({
                  policyId: schema.groupPolicy.policyId,
                  groupId: schema.groupPolicy.groupId,
                  mode: schema.groupPolicy.mode,
                })
                .from(schema.groupPolicy)
                .innerJoin(
                  schema.enterpriseGroup,
                  eq(schema.enterpriseGroup.id, schema.groupPolicy.groupId),
                )
                .where(
                  and(
                    eq(schema.enterpriseGroup.organizationId, ctx.organization.id),
                    inArray(schema.groupPolicy.policyId, policyIds),
                  ),
                ),
            ),
            queryEffect(
              db
                .select({
                  policyId: schema.devicePolicy.policyId,
                  deviceId: schema.devicePolicy.deviceId,
                  mode: schema.devicePolicy.mode,
                })
                .from(schema.devicePolicy)
                .where(inArray(schema.devicePolicy.policyId, policyIds)),
            ),
            queryEffect(
              db
                .select({
                  policyId: schema.userPolicy.policyId,
                  userId: schema.userPolicy.userId,
                  mode: schema.userPolicy.mode,
                })
                .from(schema.userPolicy)
                .where(
                  and(
                    eq(schema.userPolicy.organizationId, ctx.organization.id),
                    inArray(schema.userPolicy.policyId, policyIds),
                  ),
                ),
            ),
            queryEffect(
              db
                .select({
                  policyId: schema.userGroupPolicy.policyId,
                  groupId: schema.userGroupPolicy.groupId,
                  mode: schema.userGroupPolicy.mode,
                })
                .from(schema.userGroupPolicy)
                .innerJoin(
                  schema.userGroup,
                  eq(schema.userGroup.id, schema.userGroupPolicy.groupId),
                )
                .where(
                  and(
                    eq(schema.userGroup.organizationId, ctx.organization.id),
                    eq(schema.userGroupPolicy.organizationId, ctx.organization.id),
                    inArray(schema.userGroupPolicy.policyId, policyIds),
                  ),
                ),
            ),
          ],
          { concurrency: "unbounded" },
        );

        const groupIds = [...new Set(groupAssignments.map((row) => row.groupId))];
        const userGroupIds = [...new Set(userGroupAssignments.map((row) => row.groupId))];

        const [groupMembers, userGroupMembers] = yield* Effect.all(
          [
            queryEffect(
              groupIds.length
                ? db
                    .select({
                      groupId: schema.groupDevice.groupId,
                      deviceId: schema.groupDevice.deviceId,
                    })
                    .from(schema.groupDevice)
                    .where(inArray(schema.groupDevice.groupId, groupIds))
                : emptyRows<{ groupId: string; deviceId: string }>(),
            ),
            queryEffect(
              userGroupIds.length
                ? db
                    .select({
                      groupId: schema.userGroupMember.groupId,
                      userId: schema.userGroupMember.userId,
                    })
                    .from(schema.userGroupMember)
                    .where(inArray(schema.userGroupMember.groupId, userGroupIds))
                : emptyRows<{ groupId: string; userId: string }>(),
            ),
          ],
          { concurrency: "unbounded" },
        );

        const assignedUserIds = [
          ...new Set([
            ...userAssignments.map((row) => row.userId),
            ...userGroupMembers.map((row) => row.userId),
          ]),
        ];

        // Disabled directory users no longer grant policies, and a user must be
        // a member of this tenant to contribute. This mirrors the resolver.
        const [activeUsers, deviceUsers] = yield* Effect.all(
          [
            queryEffect(
              assignedUserIds.length
                ? db
                    .select({ id: schema.user.id })
                    .from(schema.user)
                    .where(
                      and(
                        eq(schema.user.organizationId, ctx.organization.id),
                        eq(schema.user.disabled, false),
                        inArray(schema.user.id, assignedUserIds),
                      ),
                    )
                : emptyRows<{ id: string }>(),
            ),
            queryEffect(
              assignedUserIds.length
                ? db
                    .select({
                      deviceId: schema.deviceUser.deviceId,
                      userId: schema.deviceUser.userId,
                    })
                    .from(schema.deviceUser)
                    .where(
                      and(
                        eq(schema.deviceUser.organizationId, ctx.organization.id),
                        inArray(schema.deviceUser.userId, assignedUserIds),
                      ),
                    )
                : emptyRows<{ deviceId: string; userId: string }>(),
            ),
          ],
          { concurrency: "unbounded" },
        );

        const activeUserIds = new Set(activeUsers.map((row) => row.id));

        const candidateDeviceIds = [
          ...new Set([
            ...deviceAssignments.map((row) => row.deviceId),
            ...groupMembers.map((row) => row.deviceId),
            ...deviceUsers.map((row) => row.deviceId),
          ]),
        ];

        const devices = candidateDeviceIds.length
          ? yield* db
              .select({
                id: schema.device.id,
                proto: schema.device.proto,
                declarationMode: schema.deviceApple.declarationMode,
              })
              .from(schema.device)
              .leftJoin(schema.deviceApple, eq(schema.deviceApple.deviceId, schema.device.id))
              .where(
                and(
                  eq(schema.device.organizationId, ctx.organization.id),
                  inArray(schema.device.id, candidateDeviceIds),
                ),
              )
          : [];

        const scopes = resolvePolicyScopes({
          policyIds,
          devices,
          groupAssignments,
          groupMembers,
          deviceAssignments,
          userAssignments,
          userGroupAssignments,
          userGroupMembers,
          deviceUsers,
          activeUserIds,
        });

        const deviceById = new Map(devices.map((device) => [device.id, device]));

        const appleScopedDeviceIds = new Map<string, Array<string>>();

        for (const policyId of policyIds) {
          const scopedDeviceIds = scopes.get(policyId)?.deviceIds;

          if (!scopedDeviceIds) continue;

          const ids = [...scopedDeviceIds].filter((deviceId) => {
            const device = deviceById.get(deviceId);

            // Legacy Apple devices never report DDM declarations, so there is
            // no evidence to load or reason about for them.
            return device?.proto === "apple" && device.declarationMode !== "legacy";
          });

          if (ids.length > 0) appleScopedDeviceIds.set(policyId, ids);
        }

        const declaredDeviceIds = [...new Set([...appleScopedDeviceIds.values()].flat())];

        const trackedPolicyIds = [...appleScopedDeviceIds.keys()];

        const [declarations, configurations] = yield* Effect.all(
          [
            queryEffect(
              declaredDeviceIds.length
                ? db
                    .select({
                      deviceId: schema.deviceDeclaration.deviceId,
                      identifier: schema.deviceDeclaration.identifier,
                      valid: schema.deviceDeclaration.valid,
                      active: schema.deviceDeclaration.active,
                      serverToken: schema.deviceDeclaration.serverToken,
                    })
                    .from(schema.deviceDeclaration)
                    .where(inArray(schema.deviceDeclaration.deviceId, declaredDeviceIds))
                : emptyRows<{
                    deviceId: string;
                    identifier: string;
                    valid: string;
                    active: boolean;
                    serverToken: string | null;
                  }>(),
            ),
            queryEffect(
              trackedPolicyIds.length
                ? db
                    .select({
                      policyId: schema.configuration.policyId,
                      kind: schema.configuration.kind,
                      scope: schema.configuration.scope,
                      hash: schema.configuration.hash,
                      data: schema.configuration.data,
                    })
                    .from(schema.configuration)
                    .where(inArray(schema.configuration.policyId, trackedPolicyIds))
                : emptyRows<{
                    policyId: string;
                    kind: string;
                    scope: "device" | "user";
                    hash: string;
                    data: unknown;
                  }>(),
            ),
          ],
          { concurrency: "unbounded" },
        );

        const declarationsByDevice = new Map<string, Array<(typeof declarations)[number]>>();

        for (const declaration of declarations) {
          const list = declarationsByDevice.get(declaration.deviceId) ?? [];

          list.push(declaration);
          declarationsByDevice.set(declaration.deviceId, list);
        }

        const configurationsByPolicy = new Map<
          string,
          Array<{ kind: string; hash: string; hasVariables: boolean }>
        >();

        for (const configuration of configurations) {
          const list = configurationsByPolicy.get(configuration.policyId) ?? [];

          const data = Option.getOrUndefined(
            Schema.decodeUnknownOption(Schema.Json)(configuration.data),
          );

          // Device-channel rollup only: a user-scoped kind is delivered by a
          // user channel and never appears in the device's declaration set.
          if (configuration.scope !== "user")
            list.push({
              kind: configuration.kind,
              hash: configuration.hash,
              hasVariables: data !== undefined && containsPolicyVariables(data),
            });
          configurationsByPolicy.set(configuration.policyId, list);
        }

        const configurationCountsByPolicy = new Map(
          configurationCounts.map((row) => [row.policyId, Number(row.value)]),
        );

        const userConfigurationCountsByPolicy = new Map(
          userConfigurationCounts.map((row) => [row.policyId, Number(row.value)]),
        );

        const versionsByPolicy = new Map(
          deployments.map((row) => [row.policyId, Number(row.value)]),
        );

        const deliveryByPolicy = new Map<string, PolicyDeliveryInfo>();

        for (const policyId of policyIds) {
          const scope = scopes.get(policyId) ?? {
            deviceIds: new Set<string>(),
            userIds: new Set<string>(),
          };

          deliveryByPolicy.set(
            policyId,
            derivePolicyDelivery({
              policyId,
              version: versionsByPolicy.get(policyId) ?? null,
              // Delivery is derived from DDM declaration reports, which only
              // exist for the device channel. User-scoped kinds are delivered
              // per user channel and would otherwise look pending forever.
              configurations: configurationsByPolicy.get(policyId) ?? [],
              hasUserScopedConfigurations: (userConfigurationCountsByPolicy.get(policyId) ?? 0) > 0,
              devices: [...scope.deviceIds].flatMap((deviceId) => {
                const device = deviceById.get(deviceId);

                return device ? [device] : [];
              }),
              declarations: (appleScopedDeviceIds.get(policyId) ?? []).flatMap(
                (deviceId) => declarationsByDevice.get(deviceId) ?? [],
              ),
            }),
          );
        }

        const baseRows = yield* Effect.all(rows.map((row: EnterprisePolicy) => rowPolicy(row)));
        const baseById = new Map(baseRows.map((row) => [row.id, row]));

        return {
          rows: policyIds.map((policyId) => ({
            ...baseById.get(policyId)!,
            configurationCount: configurationCountsByPolicy.get(policyId) ?? 0,
            userConfigurationCount: userConfigurationCountsByPolicy.get(policyId) ?? 0,
            scopedDeviceCount: scopes.get(policyId)?.deviceIds.size ?? 0,
            scopedUserCount: scopes.get(policyId)?.userIds.size ?? 0,
            delivery: deliveryByPolicy.get(policyId),
          })),
        };
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

        return yield* billing.summary({
          organizationId: ctx.organization.id,
          accountId: ctx.account.id,
        });
      }),
    billingPortal: (request, tenantId, payload) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        yield* requireStepUp(auth, request, "billing-portal");

        const body: { returnUrl: string } = payload;

        const result = yield* billing.portal({
          tenantId,
          organization: ctx.organization,
          returnUrl: body.returnUrl,
        });

        yield* audit(ctx, "billing.portal_opened", "organization", ctx.organization.id);

        return result;
      }),
    billingCheckout: (request, tenantId, payload: BillingCheckoutRequest) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId, "write");
        // Checkout changes the plan, so it needs the same step-up as opening
        // the portal.
        yield* requireStepUp(auth, request, "billing-portal");

        const result = yield* billing.checkout({
          tenantId,
          organization: ctx.organization,
          request: payload,
        });

        yield* audit(ctx, "billing.checkout_started", "organization", ctx.organization.id, {
          quantity: result.quantity,
          trialDays: payload.trialDays ?? null,
        });

        return { url: result.url };
      }),
    billingInvoices: (request, tenantId) =>
      Effect.gen(function* () {
        const ctx = yield* requireTenant(request, tenantId);

        return yield* billing.invoices({ organization: ctx.organization });
      }),
    requestEmailVerification: (request) =>
      auth.requestEmailVerification(webRequestFromRequest(request, origin)),
    requestRegistrationCode: (_request, payload) =>
      Effect.gen(function* () {
        const address = payload.email.trim().toLowerCase();
        const name = payload.name.trim();

        if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
          return yield* Effect.fail(
            new EnterpriseBadRequest({ message: "Enter your name and a valid email address." }),
          );

        if (!registrationLimiter.allow(`send:${address}`))
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "Too many codes requested for that address. Try again in an hour.",
            }),
          );

        const existing = yield* db.query.account.findFirst({ where: { email: address } });

        if (existing)
          return yield* Effect.fail(
            diagnoseError(
              new EnterpriseBadRequest({
                message: "An account with that email already exists. Sign in instead.",
              }),
              { code: "conflict", field: "email" },
            ),
          );

        if (!authSecret)
          return yield* Effect.fail(
            new EnterpriseNotConfigured({
              message: "Sign-up is not configured for this deployment.",
            }),
          );

        if (!email)
          return yield* Effect.fail(
            new EnterpriseNotConfigured({
              message:
                "This deployment cannot send email. Ask an administrator to configure a mailer, then try again.",
            }),
          );

        const code = generateEmailCode();
        const codeHash = yield* emailCodeHash(authSecret, `register:${address}`, code);
        const grant = registrationGrant();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + EMAIL_CODE_TTL_MS);

        yield* db
          .insert(schema.registrationVerification)
          .values({
            email: address,
            name,
            codeHash,
            grant,
            attempts: 0,
            expiresAt,
            verifiedAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .onDuplicateKeyUpdate({
            set: {
              name,
              codeHash,
              grant,
              attempts: 0,
              expiresAt,
              verifiedAt: null,
              updatedAt: now,
            },
          });

        const outcome = yield* sendTransactionalEmail({
          db,
          email,
          template: "registration_verification",
          recipient: address,
          dedupeKey: `registration-verification:${address}:${codeHash}`,
          message: {
            to: address,
            from: DEFAULT_EMAIL_FROM,
            subject: "Your Mattrax verification code",
            text: `Your Mattrax verification code is ${code}.\n\nIt expires in 15 minutes. Enter it on the sign-up page to finish creating your account.`,
            html: `<p>Your Mattrax verification code is:</p><p style="font-size:24px;letter-spacing:6px;font-weight:600">${code}</p><p>It expires in 15 minutes. Enter it on the sign-up page to finish creating your account.</p>`,
          },
        });

        return {
          status: "ok" as const,
          emailSent: outcome === "queued" || outcome === "duplicate" || outcome === "delivered",
        };
      }),
    verifyRegistrationCode: (_request, payload) =>
      Effect.gen(function* () {
        const address = payload.email.trim().toLowerCase();
        const code = payload.code.trim();

        if (!/^\d{6}$/.test(code) || !registrationLimiter.allow(`verify:${address}`))
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "That code is invalid or has expired. Request a new one.",
            }),
          );

        if (!authSecret)
          return yield* Effect.fail(
            new EnterpriseNotConfigured({
              message: "Sign-up is not configured for this deployment.",
            }),
          );

        const row = yield* db.query.registrationVerification.findFirst({
          where: { email: address },
        });

        const now = new Date();

        if (!row || row.expiresAt.getTime() <= now.getTime() || row.attempts >= 5)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "That code is invalid or has expired. Request a new one.",
            }),
          );

        const hash = yield* emailCodeHash(authSecret, `register:${address}`, code);

        if (hash !== row.codeHash) {
          yield* db
            .update(schema.registrationVerification)
            .set({ attempts: row.attempts + 1, updatedAt: now })
            .where(eq(schema.registrationVerification.email, address));

          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "That code is invalid or has expired. Request a new one.",
            }),
          );
        }

        if (!row.verifiedAt)
          yield* db
            .update(schema.registrationVerification)
            .set({ verifiedAt: now, attempts: 0, updatedAt: now })
            .where(eq(schema.registrationVerification.email, address));

        return { grant: row.grant };
      }),
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

        // Only an issued MCP credential (OAuth connection or account API key)
        // may attribute activity to a tool call. A browser session or a
        // read-only token must not be able to forge audit entries; the write
        // scope is enforced in `requireUser`.
        if (ctx.credential?.type !== "oauth" && ctx.credential?.type !== "api_token")
          return yield* Effect.fail(
            new EnterpriseForbidden({ message: "MCP activity requires an MCP credential." }),
          );

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
              .update(schema.account)
              .set({
                authRevision: revision,
                passkeyEnabled: otherPasskey.length > 0,
                updatedAt: now(),
              })
              .where(eq(schema.account.id, user.id));
          }),
        );

        yield* recordAccountAudit(db, {
          subjectAccountId: user.id,
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

export const enterpriseDashboardHandlers = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof enterpriseDashboardApi>,
) =>
  handlers.handle("queryDashboardBatch", ({ request, params, payload }) =>
    Effect.flatMap(EnterpriseService, (service) =>
      service.queryDashboardBatch(request, params.tenantId, payload),
    ),
  );

export const enterpriseWindowsHandlers = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof enterpriseWindowsApi>,
) =>
  handlers.handle("listWindowsFailures", ({ request, params, query }) =>
    Effect.flatMap(EnterpriseService, (service) =>
      service.listWindowsFailures(request, params.tenantId, query),
    ),
  );

export const enterpriseAttributeHandlers = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof enterpriseAttributeApi>,
) =>
  handlers
    .handle("listAttributes", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listAttributes(request, params.tenantId),
      ),
    )
    .handle("createAttribute", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.createAttribute(request, params.tenantId, payload),
      ),
    )
    .handle("patchAttribute", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchAttribute(request, params.tenantId, params.attributeId, payload),
      ),
    )
    .handle("deleteAttribute", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteAttribute(request, params.tenantId, params.attributeId),
      ),
    )
    .handle("listEnrollmentQuestions", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listEnrollmentQuestions(request, params.tenantId),
      ),
    )
    .handle("patchEnrollmentQuestions", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchEnrollmentQuestions(request, params.tenantId, payload),
      ),
    )
    .handle("getPolicyVariables", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getPolicyVariables(request, params.tenantId),
      ),
    )
    .handle("submitEnrollmentAnswers", ({ params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.submitEnrollmentAnswers(params.id, payload),
      ),
    )
    .handle("extractMobileconfig", ({ payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.extractMobileconfig(payload)),
    )
    .handle("previewMobileconfig", ({ payload }) =>
      Effect.flatMap(EnterpriseService, (service) => service.previewMobileconfig(payload)),
    )
    .handle("importDeviceAttributes", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.importDeviceAttributes(request, params.tenantId, payload),
      ),
    )
    .handle("setDeviceAttributes", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.setDeviceAttributes(request, params.tenantId, params.id, payload),
      ),
    );

export const enterpriseAccountHandlers = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof enterpriseAccountApi>,
) =>
  handlers
    .handle("requestEmailVerification", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.requestEmailVerification(request)),
    )
    .handle("requestRegistrationCode", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.requestRegistrationCode(request, payload),
      ),
    )
    .handle("verifyRegistrationCode", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.verifyRegistrationCode(request, payload),
      ),
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
    .handle("getMcpContext", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.mcpContext(request)),
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
    .handle("listLoginAttempts", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.listLoginAttempts(request)),
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
    );

export const enterpriseAdeHandlers = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof enterpriseAdeApi>,
) =>
  handlers.handleRaw("enrollAdeDevice", ({ request }) =>
    Effect.flatMap(EnterpriseService, (service) =>
      Effect.gen(function* () {
        const body = new Uint8Array(yield* request.arrayBuffer);

        if (body.byteLength === 0)
          return yield* Effect.fail(
            new EnterpriseBadRequest({
              message: "The ADE enrollment request body is empty.",
            }),
          );

        const result: { profile: Uint8Array; filename: string } =
          yield* service.enrollAdeDevice(body);

        return appleEnrollmentProfileResponse(result);
      }),
    ),
  );

export const enterpriseHandlers = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof enterpriseApi>,
) =>
  handlers
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
    .handle("listWebhookDeliveries", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listWebhookDeliveries(request, params.tenantId, params.webhookId, query),
      ),
    )
    .handle("getWebhookDelivery", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getWebhookDelivery(request, params.tenantId, params.webhookId, params.deliveryId),
      ),
    )
    .handle("replayWebhookDelivery", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.replayWebhookDelivery(
          request,
          params.tenantId,
          params.webhookId,
          params.deliveryId,
        ),
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
    .handle("listTenantAccounts", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listTenantAccounts(request, params.tenantId),
      ),
    )
    .handle("inviteTenantAccount", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.inviteTenantAccount(request, params.tenantId, payload),
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
    .handle("getTenantOwnershipTransfer", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getTenantOwnershipTransfer(request, params.tenantId),
      ),
    )
    .handle("requestTenantOwnershipTransfer", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.requestTenantOwnershipTransfer(request, params.tenantId, payload),
      ),
    )
    .handle("cancelTenantOwnershipTransfer", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.cancelTenantOwnershipTransfer(request, params.tenantId),
      ),
    )
    .handle("acceptTenantOwnershipTransfer", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.acceptTenantOwnershipTransfer(request, payload),
      ),
    )
    .handle("previewTenantOwnershipTransfer", ({ request, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.previewTenantOwnershipTransfer(request, query),
      ),
    )
    .handle("patchTenantAccount", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchTenantAccount(request, params.tenantId, params.accountId, payload),
      ),
    )
    .handle("removeTenantAccount", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.removeTenantAccount(request, params.tenantId, params.accountId),
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
    .handle("getTenantAndroid", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getTenantAndroid(request, params.tenantId),
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
    .handle("getDeviceLocalAdmin", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getDeviceLocalAdmin(request, params.tenantId, params.id),
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
    .handle("listDeviceAppleUsers", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listDeviceAppleUsers(request, params.tenantId, params.id),
      ),
    )
    .handle("deviceAppleUserAction", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deviceAppleUserAction(request, params.tenantId, params.id, params.userId, payload),
      ),
    )
    .handle("bindAppleUserIdentity", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.bindAppleUserIdentity(request, params.tenantId, params.id, params.userId, payload),
      ),
    )
    .handle("unbindAppleUserIdentity", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.unbindAppleUserIdentity(request, params.tenantId, params.id, params.userId),
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
    .handle("uploadApplicationInstaller", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.uploadApplicationInstaller(
          request,
          params.tenantId,
          params.id,
          params.installerId,
          payload,
        ),
      ),
    )
    .handle("downloadApplicationInstaller", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.downloadApplicationInstaller(
          request,
          params.tenantId,
          params.id,
          params.installerId,
          params.sha256,
        ),
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
    .handle("billing", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) => service.billing(request, params.tenantId)),
    )
    .handle("billingPortal", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.billingPortal(request, params.tenantId, payload),
      ),
    )
    .handle("billingCheckout", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.billingCheckout(request, params.tenantId, payload),
      ),
    )
    .handle("billingInvoices", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.billingInvoices(request, params.tenantId),
      ),
    );

/**
 * Script management handlers. Registered against `scriptApi`, a group separate
 * from `EnterpriseApi` so the generated client types stay manageable.
 */
export const scriptHandlers = (handlers: HttpApiBuilder.Handlers.FromGroup<typeof scriptApi>) =>
  handlers
    .handle("getScriptSettings", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getScriptSettings(request, params.tenantId),
      ),
    )
    .handle("patchScriptSettings", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchScriptSettings(request, params.tenantId, payload),
      ),
    )
    .handle("listScripts", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) => service.listScripts(request, params.tenantId)),
    )
    .handle("getScript", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getScript(request, params.tenantId, params.id),
      ),
    )
    .handle("createScript", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.createScript(request, params.tenantId, payload),
      ),
    )
    .handle("patchScript", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchScript(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("deleteScript", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.deleteScript(request, params.tenantId, params.id),
      ),
    )
    .handle("getScriptAssignments", ({ request, params }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.getScriptAssignments(request, params.tenantId, params.id),
      ),
    )
    .handle("patchScriptAssignments", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.patchScriptAssignments(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("runScript", ({ request, params, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.runScript(request, params.tenantId, params.id, payload),
      ),
    )
    .handle("listScriptExecutions", ({ request, params, query }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.listScriptExecutions(request, params.tenantId, params.id, query),
      ),
    );

/**
 * Device-facing script channel. It shares the `EnterpriseService` handlers but
 * has no session middleware: the device token is the credential.
 */
export const scriptAgentHandlers = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof scriptAgentApi>,
) =>
  handlers
    .handle("syncScriptAgent", ({ request }) =>
      Effect.flatMap(EnterpriseService, (service) => service.syncScriptAgent(request)),
    )
    .handle("reportScriptAgentResult", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.reportScriptAgentResult(request, payload),
      ),
    )
    .handle("reportWindowsActivation", ({ request, payload }) =>
      Effect.flatMap(EnterpriseService, (service) =>
        service.reportWindowsActivation(request, payload),
      ),
    );

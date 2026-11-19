export {
  BillingWebhookError,
  billingWebhookRoutes,
  processStripeWebhook,
} from "@mattrax/enterprise-billing";

export type { BillingWebhookConfig, ProcessStripeWebhookInput } from "@mattrax/enterprise-billing";

export {
  BillingService,
  BillingServiceLive,
  makeStripeBillingService,
} from "@mattrax/enterprise-billing";

export { licenseBillingRoutes } from "@mattrax/enterprise-billing";

export type { LicenseBillingConfig } from "@mattrax/enterprise-billing";

export { makeRemoteBillingService } from "@mattrax/enterprise-billing";

export type { RemoteBillingOptions } from "@mattrax/enterprise-billing";

export type {
  BillingCheckoutInput,
  BillingError,
  BillingInvoicesInput,
  BillingPortalInput,
  BillingOperations,
  BillingSummaryInput,
  BillingUsageInput,
  StripeBillingOptions,
} from "@mattrax/enterprise-billing";

export {
  billableDeviceCount,
  deploymentUsage,
  reconcileSubscriptionQuantity,
  reconcileSubscriptionSweep,
  syncStripeCustomerName,
} from "@mattrax/enterprise-billing";

export type {
  ReconcileSeatsInput,
  SeatReconcileResult,
  SeatReconcileSkipReason,
  SubscriptionSweepInput,
  SubscriptionSweepResult,
  SyncCustomerNameInput,
} from "@mattrax/enterprise-billing";

export {
  WEBHOOK_DELIVERY_PAGE_DEFAULT,
  WEBHOOK_DELIVERY_PAGE_MAX,
  listWebhookDeliveries,
  loadWebhookDelivery,
  normalizeWebhookDeliveryQuery,
  webhookDeliveryDetail,
  webhookDeliveryInfo,
} from "./Webhook/webhookDeliveries.ts";

export type {
  ListWebhookDeliveriesInput,
  LoadWebhookDeliveryInput,
  NormalizedWebhookDeliveryQuery,
} from "./Webhook/webhookDeliveries.ts";

export {
  AUDIT_EXPORT_MAX_ROWS,
  AUDIT_SEARCH_DEFAULT_LIMIT,
  AUDIT_SEARCH_MAX_LIMIT,
  SYSTEM_AUDIT_ACTOR,
  auditCsv,
  auditJson,
  auditOrder,
  auditWhere,
  decodeAuditCursor,
  encodeAuditCursor,
  encodeAuditOffsetCursor,
  escapeLike,
  normalizeAuditSearchQuery,
} from "./Account/auditLog.ts";

export type {
  AuditCursor,
  AuditExportEntry,
  AuditSearchFilters,
  DecodedAuditCursor,
} from "./Account/auditLog.ts";

export {
  ACCOUNT_AUDIT,
  accountAuditEntry,
  accountAuditOrder,
  accountAuditWhere,
  clientAddress,
  clientDescriptor,
  hashClientAddress,
  parseUserAgent,
  recordAccountAudit,
} from "./Account/accountAudit.ts";

export type {
  AccountAuditAction,
  AccountAuditInput,
  ClientDescriptor,
} from "./Account/accountAudit.ts";

export {
  LOGIN_ATTEMPT_FAILURES,
  LOGIN_ATTEMPT_FACTORS,
  LOGIN_ATTEMPT_LIST_LIMIT,
  LOGIN_ATTEMPT_METHODS,
  LOGIN_ATTEMPT_PRUNE_BATCH,
  LOGIN_ATTEMPT_USER_AGENT_LIMIT,
  PENDING_PROOF_COOKIE,
  approximateNetwork,
  decodeLoginAttemptOutcome,
  isObservedSignInPath,
  listLoginAttempts,
  loginAttemptClient,
  loginAttemptEntry,
  loginAttemptFailureFromTag,
  loginAttemptMethodFromAssurance,
  pendingAttemptSubject,
  pendingCredentialDigest,
  pruneLoginAttempts,
  recordLoginAttempt,
  recordObservedLoginAttempt,
  signInFactorForPath,
} from "./Account/loginAttempts.ts";

export type {
  LoginAttemptFactor,
  LoginAttemptFailure,
  LoginAttemptInput,
  LoginAttemptMethod,
  LoginAttemptOutcome,
} from "./Account/loginAttempts.ts";

export {
  RECOVERY_COMPLETION_TTL_MILLIS,
  RECOVERY_PROOF_TTL_MILLIS,
  RECOVERY_REQUEST_LIMIT,
  RECOVERY_WINDOW_MILLIS,
  approveAccountRecovery,
  cancelAccountRecovery,
  createRecoveryLimiter,
  makeRecoveryStrategy,
  recoveryApprovalTenant,
  redeemRecoveryToken,
  requestAccountRecovery,
  verifyAccountRecoveryProof,
} from "./Account/recovery.ts";

export type { RecoveryLimiter } from "./Account/recovery.ts";

export {
  listUserSessions,
  captureSessionContext,
  revokeAllUserSessions,
  revokeUserSession,
  SESSION_CONTEXT_REFRESH_MILLIS,
} from "./Account/sessions.ts";

export type { AccountSession } from "./Account/sessions.ts";

export { makeApplePush } from "./Device/push.ts";

export type { ApplePush, ApplePushOptions } from "./Device/push.ts";

export {
  ABM_BUSINESS_BASE_URL,
  ABM_DEFAULT_ASSERTION_AUDIENCE,
  ABM_DEFAULT_TOKEN_URL,
  ABM_SCHOOL_BASE_URL,
  ADE_PROFILE_PURPOSE,
  AppleBusinessManagerError,
  appleBusinessManagerInfo,
  assignAppleBusinessManagerDevice,
  buildClientAssertion,
  clearAppleBusinessManagerToken,
  createAdeProfileToken,
  describeAppleError,
  loadAppleBusinessManager,
  makeAbmClient,
  openAbmCredential,
  parseAbmTokenUpload,
  parseAppleDate,
  readAdeProfileToken,
  saveAppleBusinessManagerToken,
  sealAbmCredential,
  syncAppleBusinessManagerDevices,
  validateAbmPrivateKey,
} from "@mattrax/apple-business-manager";

export type {
  AbmAccessToken,
  AbmApiCredential,
  AbmApp,
  AbmClient,
  AbmCredential,
  AbmDeviceRow,
  AbmMdmServer,
  AbmOrgDevice,
  AbmTokenUpload,
  AdeProfileToken,
  AppleApiConfig,
  AppleBusinessManagerErrorKind,
  AppleBusinessManagerInfo,
  AppleBusinessManagerRow,
  LegacyDepCredential,
} from "@mattrax/apple-business-manager";

export {
  VPP_BASE_URL,
  VppError,
  assignVppLicence,
  clearVppToken,
  findVppAsset,
  findVppAssetByStoreId,
  loadVppToken,
  makeVppClient,
  openVppToken,
  parseVppTokenUpload,
  releaseVppLicence,
  saveVppToken,
  sealVppToken,
  syncScheduledVppAssets,
  syncVppAssets,
  vppInfo,
} from "@mattrax/apple-business-manager";

export type {
  DeviceVppAssignmentRow,
  ScheduledVppSyncResult,
  VppApiConfig,
  VppAsset,
  VppAssetRow,
  VppAssignment,
  VppClient,
  VppContentToken,
  VppErrorKind,
  VppInfo,
  VppTokenRow,
} from "@mattrax/apple-business-manager";

export {
  SCRIPT_EXECUTION_SWEEP_LIMIT,
  createScript,
  deleteScript,
  expireScriptExecutions,
  getScriptAssignments,
  getScriptDetail,
  getScriptSettings,
  listScriptExecutions,
  listScripts,
  patchScriptAssignments,
  recordScriptAgentResult,
  queueScriptRun,
  runScript,
  scriptAgentSync,
  scriptAssignedDeviceIds,
  scriptDigest,
  scriptExecutionRetentionCutoff,
  scriptExecutionIsDeliverable,
  sha256Hex,
  sweepScriptExecutions,
  updateScript,
} from "./Policy/scripts.ts";

export type {
  AssignmentPatchResult,
  ScriptResultIngestion,
  ScriptSweepResult,
} from "./Policy/scripts.ts";

export {
  ANDROID_NOTIFICATION_TYPES,
  ANDROID_PROVISIONING_MODES,
  ANDROID_PUBSUB_RETENTION_DAYS,
  AndroidDeliveryError,
  DEFAULT_ANDROID_POLICY_ID,
  DEFAULT_ANDROID_PROVISIONING_MODE,
  allowPersonalUsageFor,
  androidCommandForAction,
  androidEnterpriseInfo,
  completeAndroidSignup,
  createAndroidEnrollmentToken,
  createAndroidSignup,
  describeAndroidError,
  disconnectAndroidEnterprise,
  handleAndroidPubSub,
  isAndroidConfigured,
  issueAndroidCommand,
  loadAndroidEnterprise,
  pruneAndroidPubSubMessages,
  reconcileAndroidEnterprise,
  refreshAndroidDevice,
  setAndroidEnabled,
  setAndroidProvisioningMode,
  syncAndroidPoliciesForTenant,
  unenrollAndroidDevice,
} from "./Device/android.ts";

export type {
  AndroidDeliveryConfig,
  AndroidDeliveryErrorKind,
  AndroidDisconnectResult,
  AndroidProvisioningMode,
  AndroidReconcileResult,
  AndroidRefreshResult,
  AndroidEnrollmentTokenResult,
  AndroidEnterpriseInfoResult,
  AndroidEnterpriseRow,
  AndroidPubSubResult,
  AndroidServiceAccount,
  AndroidSignupOrganization,
  AndroidSyncResult,
  AndroidUnenrollResult,
} from "./Device/android.ts";

export { makeSsoStrategy } from "./Identity/sso.ts";

export { linkDirectoryUserSso } from "./Identity/linkSsoIdentity.ts";

export type {
  LinkDirectoryUserSsoInput,
  LinkDirectoryUserSsoResult,
} from "./Identity/linkSsoIdentity.ts";

export { signToken, verifyToken } from "@mattrax/enterprise-tokens";

export {
  signSsrRevision,
  signSsrToken,
  verifySsrRevision,
  verifySsrToken,
  SSR_TOKEN_COOKIE,
  SSR_TOKEN_TTL_MILLIS,
  type SignedSsrToken,
  type SignSsrTokenInput,
} from "./Account/ssrToken.ts";

export { invitationEmail } from "./Mail/invitationEmail.ts";

export type { InvitationEmail, InvitationEmailInput } from "./Mail/invitationEmail.ts";

export { ownershipTransferEmail } from "./Mail/ownershipTransferEmail.ts";

export type {
  OwnershipTransferEmail,
  OwnershipTransferEmailInput,
} from "./Mail/ownershipTransferEmail.ts";

export { onboardingFollowUpEmail, welcomeEmail } from "./Tenant/onboardingEmail.ts";

export type {
  OnboardingEmail,
  OnboardingFollowUpEmailInput,
  WelcomeEmailInput,
} from "./Tenant/onboardingEmail.ts";

export {
  DEFAULT_ONBOARDING_REPLY_TO,
  ONBOARDING_EMAIL_FROM,
  ONBOARDING_FOLLOW_UP_AUDIT_ACTION,
  ONBOARDING_SUPPORT_EMAIL,
  runOnboardingEmails,
  runWelcomeEmailSweep,
  sendWelcomeEmailOnce,
} from "./Tenant/onboardingEmails.ts";

export type {
  OnboardingEmailRunResult,
  OnboardingEmailTransport,
  RunOnboardingEmailsOptions,
  SendWelcomeEmailOptions,
  WelcomeEmailOutcome,
  WelcomeEmailSweepOptions,
  WelcomeEmailSweepResult,
} from "./Tenant/onboardingEmails.ts";

export type { EmailReplyTo, EmailTransport, OutboundEmailMessage } from "@mattrax/email";

export {
  DEFAULT_EMAIL_FROM,
  EmailFailure,
  describeEmailFailure,
  formatEmailAddress,
  makeEmailTransport,
  parseEmailSender,
  replyToAddress,
  smtpEmailTransport,
} from "@mattrax/email";

export type { EmailAddress } from "@mattrax/email";

export type { SmtpTransportOptions } from "@mattrax/email";

export {
  ACCOUNT_EMAIL_DELIVERY_FAILED_ACTION,
  EMAIL_DELIVERY_FAILED_ACTION,
  EMAIL_OUTBOX_BACKOFF_BASE_MS,
  EMAIL_OUTBOX_CLAIM_STALE_MS,
  EMAIL_OUTBOX_FAILED_RETENTION_MS,
  EMAIL_OUTBOX_MAX_ATTEMPTS,
  EMAIL_OUTBOX_MAX_BACKOFF_MS,
  EMAIL_OUTBOX_SENT_RETENTION_MS,
  EMAIL_OUTBOX_TEMPLATES,
  drainEmailOutbox,
  emailOutboxBackoffMs,
  enqueueEmail,
  purgeEmailOutbox,
  sendTransactionalEmail,
} from "./Mail/emailOutbox.ts";

export type {
  DrainEmailOutboxOptions,
  DrainEmailOutboxResult,
  EmailOutboxTemplate,
  EnqueueEmailInput,
  EnqueueEmailOutcome,
  SendTransactionalEmailInput,
  TransactionalEmailOutcome,
} from "./Mail/emailOutbox.ts";

export { settlePendingInvitations } from "@mattrax/enterprise-identity";

export { makeAuthLive, sessionCookie } from "./Account/auth.ts";

export { makeAppAuth } from "@mattrax/enterprise-domain";

export type { AppAuthService, AuthLiveOptions } from "./Account/auth.ts";

export { makeEnterpriseAuthLive } from "./Identity/enterpriseAuth.ts";

export type { EnterpriseAuthOptions } from "./Identity/enterpriseAuth.ts";

export {
  detectEnrollmentPlatform,
  evaluateEnrollmentAttempt,
  ENROLLMENT_ATTEMPT_OUTCOMES,
  ENROLLMENT_ATTEMPT_PLATFORMS,
} from "./Device/enrollmentAttempts.ts";

export type {
  EnrollmentAttemptEvaluation,
  EnrollmentAttemptOutcome,
  EnrollmentAttemptPlatform,
} from "./Device/enrollmentAttempts.ts";

export {
  runMaintenance,
  loadCredentialAlertRecipients,
  loadTenantAdminRecipients,
} from "./Tenant/maintenance.ts";

export type {
  CredentialAlertRecipient,
  CredentialExpiryNotification,
  CredentialExpiryNotifier,
  MaintenanceOptions,
  MaintenanceResult,
} from "./Tenant/maintenance.ts";

export {
  BACKUP_CONCURRENCY,
  BACKUP_ERROR_MAX_LENGTH,
  BACKUP_RUN_RETENTION_DAYS,
  backupObjectKey,
  describeBackupError,
  listTenantBackups,
  pruneBackups,
  runScheduledBackups,
  runTenantBackup,
} from "./Tenant/backup.ts";

export type {
  BackupActor,
  BackupRetention,
  BackupStatus,
  BackupTrigger,
  PruneBackupsResult,
  RunTenantBackupOptions,
  ScheduledBackupsResult,
  TenantBackupResult,
} from "./Tenant/backup.ts";

export { buildTenantExport } from "./Tenant/tenantExport.ts";

export type { TenantExportBundle } from "./Tenant/tenantExport.ts";

export {
  ENTRA_GRAPH_NOT_CONFIGURED,
  ENTRA_SYNC_CONCURRENCY,
  ENTRA_SYNC_STALE_MS,
  acquireEntraSyncLock,
  isEntraSyncDue,
  linkedDeviceIdsForUsers,
  runEntraDirectorySyncForTenant,
  runScheduledEntraSync,
  syncEntraDirectory,
} from "@mattrax/entra-id";

export type {
  EntraDirectorySyncOutcome,
  EntraSyncLockState,
  EntraSyncProgress,
  EntraSyncScheduleState,
  EntraSyncTrigger,
  ScheduledEntraSyncResult,
} from "@mattrax/entra-id";

export {
  syncDirectoryGroup,
  syncDirectoryGroupsForTenant,
} from "@mattrax/mdm-apple";

export type {
  DirectoryGroupSyncOptions,
  DirectoryGroupSyncResult,
} from "@mattrax/mdm-apple";

export {
  WEBHOOK_DELIVERY_RETENTION_DAYS,
  WEBHOOK_DELIVERY_TIMEOUT_MS,
  WEBHOOK_MAX_RETRY_ATTEMPTS,
  generateWebhookSecret,
  pruneWebhookDeliveries,
  retryFailedWebhookDeliveries,
  sendTestWebhook,
  signWebhookDelivery,
  verifyWebhookSignature,
} from "@mattrax/mdm-apple";

export type {
  WebhookDeliveryOutcome,
  WebhookRetryOptions,
  WebhookRetryResult,
} from "@mattrax/mdm-apple";

export {
  APNS_RENEWAL_URL,
  CREDENTIAL_CRITICAL_DAYS,
  CREDENTIAL_WARNING_DAYS,
  apnsCredentialHealth,
  credentialLevel,
  daysUntilExpiry,
  loadCredentialHealth,
  parseCertificateNotAfter,
  serverCertificateInfo,
  summarizeDeviceCertificates,
} from "./Device/credentialHealth.ts";

export type { CredentialHealth, DeviceCertificateRecord } from "./Device/credentialHealth.ts";

export type {
  DomainCertificateRequest,
  DomainCertificateRequester,
} from "./Device/credentialIssuance.ts";

export {
  loadScepCaState,
  loadTrustedScepCaCertificates,
  purgeExpiredScepCaTrust,
  rotateDueScepCas,
  scepCaStateFromRows,
} from "./Scep/scepLifecycle.ts";

export type {
  ScepCaRotationSweepResult,
  ScepCaState,
  ScepIssuedIdentity,
  ScepRetiredCaState,
} from "./Scep/scepLifecycle.ts";

export {
  SERVER_CERTIFICATE_CHECK_INTERVAL_MINUTES,
  SERVER_CERTIFICATE_CRITICAL_DAYS,
  SERVER_CERTIFICATE_PROBE_TIMEOUT_MS,
  SERVER_CERTIFICATE_WARNING_DAYS,
  loadServerCertificateInfo,
  probeServerCertificate,
  runServerCertificateCheck,
  serverCertificatePeerFromDer,
} from "./Scep/serverCertificate.ts";

export type {
  ServerCertificateCheckResult,
  ServerCertificatePeer,
  ServerCertificateProbe,
  ServerCertificateProbeOptions,
} from "./Scep/serverCertificate.ts";

// Composition helpers used by @mattrax/enterprise-api. They remain internal to
// the backend; the API package is the only consumer outside this package.
export {
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
} from "./Policy/attributes.ts";

export {
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
} from "./Autopilot/autopilot.ts";

export { setBackupRetention, deleteBackupRun, BackupActionError } from "./Tenant/backup.ts";

export {
  deviceBucket,
  normalizeWidgetConfig,
  normalizeWidgetLayout,
  softwareBucket,
  toBuckets,
} from "./Policy/dashboardQuery.ts";

export {
  DEVICE_ACTIVITY_AUDIT_PREFIX,
  DEVICE_ACTIVITY_COMMAND_PREFIX,
  decodeDeviceActivityCursor,
  deviceActivityPage,
  deviceActivitySourceKeyset,
  normalizeDeviceActivityLimit,
  type DeviceActivitySourceKeyset,
} from "./Device/deviceActivity.ts";

export {
  countDeviceHealth,
  deriveDeviceHealth,
  groupDeviceHealthReasons,
  normalizeDeviceHealth,
} from "./Device/deviceHealth.ts";

export {
  DEVICE_EXPORT_MAX_ROWS,
  deviceSearchPlatforms,
  deviceSearchStatuses,
  deviceSearchTimestampFormats,
  isDeviceTimestampSearch,
  normalizeDeviceSearchQuery,
  platformLabel,
  toCsv,
  type DeviceSearchFilters,
} from "./Device/deviceSearch.ts";

export {
  ENROLLMENT_ATTEMPT_DEDUPE_MS,
  ENROLLMENT_ATTEMPT_PER_CLIENT_LIMIT,
} from "./Device/enrollmentAttempts.ts";

export { canEnrollDevice } from "./Device/enrollmentLimit.ts";

export {
  EMAIL_CODE_TTL_MS,
  emailCodeHash,
  generateEmailCode,
  parseStoredCredentialScopes,
} from "./Identity/enterpriseAuth.ts";

export {
  EscrowKeyError,
  escrowKeyInfo,
  generateTenantEscrowKey,
  loadTenantEscrowKey,
  revealRecoveryKey,
  uploadTenantEscrowKey,
} from "./Device/fdeEscrow.ts";

export { extractMobileconfigPlist, parseMobileconfigPreview } from "./Policy/mobileconfig.ts";

export {
  R2Storage,
  R2StorageLive,
  base64ToBytes,
  bytesToBase64,
  sha256Hex as storageSha256Hex,
  type R2Bucket,
} from "./Policy/policyApplicationStorage.ts";

export { applePushService, summarizeApplePushHealth } from "./Device/push.ts";

export { cookieValue } from "./Account/ssrToken.ts";

export { restoreTenantFromBackup, TenantRestoreError } from "./Tenant/tenantRestore.ts";

export {
  teardownTenant,
  TenantTeardownStepFailed,
  type DeviceUnenrollSummary,
  type UnreachableDevice,
} from "./Tenant/tenantTeardown.ts";

export {
  isMsiInstaller,
  isMsiProductCode,
  normalizeMsiProductCode,
  windowsMsiInstallPayload,
} from "./Device/windowsApplications.ts";

export type { DeviceActivityPage } from "./Device/deviceActivity.ts";

export type { RecoveryRequestResult, RecoveryVerifyResult } from "./Account/recovery.ts";

export type { TenantRestoreResult } from "./Tenant/tenantRestore.ts";

export type { SubscriptionReclamation } from "./Tenant/tenantTeardown.ts";

export type {
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
} from "./schema.ts";

export { createEnterpriseSchema } from "./schema.ts";

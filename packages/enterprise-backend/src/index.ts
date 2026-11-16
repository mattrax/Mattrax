export {
  createEnterpriseService,
  enterpriseAccountHandlers,
  enterpriseAdeHandlers,
  enterpriseAttributeHandlers,
  enterpriseHandlers,
  scriptAgentHandlers,
  scriptHandlers,
} from "./enterpriseHandlers.js";

export { EnterpriseAnalyticsService } from "./enterpriseHandlers.js";

export type {
  EnterpriseAnalytics,
  EnterpriseAnalyticsIdentity,
  EnterpriseHandlersConfig,
} from "./enterpriseHandlers.js";

export {
  BillingWebhookError,
  billingWebhookRoutes,
  processStripeWebhook,
} from "./billingWebhook.js";

export type { BillingWebhookConfig, ProcessStripeWebhookInput } from "./billingWebhook.js";

export {
  billableDeviceCount,
  reconcileSubscriptionQuantity,
  reconcileSubscriptionSweep,
  syncStripeCustomerName,
} from "./billing.js";

export type {
  ReconcileSeatsInput,
  SeatReconcileResult,
  SeatReconcileSkipReason,
  SubscriptionSweepInput,
  SubscriptionSweepResult,
  SyncCustomerNameInput,
} from "./billing.js";

export {
  WEBHOOK_DELIVERY_PAGE_DEFAULT,
  WEBHOOK_DELIVERY_PAGE_MAX,
  listWebhookDeliveries,
  loadWebhookDelivery,
  normalizeWebhookDeliveryQuery,
  webhookDeliveryDetail,
  webhookDeliveryInfo,
} from "./webhookDeliveries.js";

export type {
  ListWebhookDeliveriesInput,
  LoadWebhookDeliveryInput,
  NormalizedWebhookDeliveryQuery,
} from "./webhookDeliveries.js";

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
} from "./auditLog.js";

export type {
  AuditCursor,
  AuditExportEntry,
  AuditSearchFilters,
  DecodedAuditCursor,
} from "./auditLog.js";

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
} from "./accountAudit.js";

export type { AccountAuditAction, AccountAuditInput, ClientDescriptor } from "./accountAudit.js";

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
} from "./recovery.js";

export type { RecoveryLimiter } from "./recovery.js";

export {
  listUserSessions,
  captureSessionContext,
  revokeAllUserSessions,
  revokeUserSession,
  SESSION_CONTEXT_REFRESH_MILLIS,
} from "./sessions.js";

export type { AccountSession } from "./sessions.js";

export { makeApplePush } from "./push.js";

export type { ApplePush, ApplePushOptions } from "./push.js";

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
} from "./appleBusinessManager.js";

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
} from "./appleBusinessManager.js";

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
} from "./volumePurchase.js";

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
} from "./volumePurchase.js";

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
  runScript,
  scriptAgentSync,
  scriptAssignedDeviceIds,
  scriptDigest,
  scriptExecutionRetentionCutoff,
  scriptExecutionIsDeliverable,
  sha256Hex,
  sweepScriptExecutions,
  updateScript,
} from "./scripts.js";

export type { AssignmentPatchResult, ScriptResultIngestion, ScriptSweepResult } from "./scripts.js";

export { EnterpriseService } from "./service.js";

export {
  ANDROID_NOTIFICATION_TYPES,
  ANDROID_PUBSUB_RETENTION_DAYS,
  AndroidDeliveryError,
  DEFAULT_ANDROID_POLICY_ID,
  androidCommandForAction,
  androidEnterpriseInfo,
  completeAndroidSignup,
  createAndroidEnrollmentToken,
  createAndroidSignup,
  describeAndroidError,
  handleAndroidPubSub,
  isAndroidConfigured,
  issueAndroidCommand,
  loadAndroidEnterprise,
  pruneAndroidPubSubMessages,
  setAndroidEnabled,
  syncAndroidPoliciesForTenant,
} from "./android.js";

export type {
  AndroidDeliveryConfig,
  AndroidDeliveryErrorKind,
  AndroidEnrollmentTokenResult,
  AndroidEnterpriseInfoResult,
  AndroidEnterpriseRow,
  AndroidPubSubResult,
  AndroidServiceAccount,
  AndroidSignupOrganization,
  AndroidSyncResult,
} from "./android.js";

export { androidRoutes } from "./androidRoutes.js";

export type { AndroidRoutesOptions } from "./androidRoutes.js";

export { scimRoutes } from "./scim.js";

export { mcpOAuthRoutes } from "./mcpOAuth.js";

export { makeSsoStrategy } from "./sso.js";

export { signToken, verifyToken } from "./tokens.js";

export {
  signSsrToken,
  verifySsrToken,
  SSR_TOKEN_COOKIE,
  SSR_TOKEN_TTL_MILLIS,
  type SignedSsrToken,
  type SignSsrTokenInput,
} from "./ssrToken.js";

export { invitationEmail } from "./invitationEmail.js";

export type { InvitationEmail, InvitationEmailInput } from "./invitationEmail.js";

export { onboardingFollowUpEmail, welcomeEmail } from "./onboardingEmail.js";

export type {
  OnboardingEmail,
  OnboardingFollowUpEmailInput,
  WelcomeEmailInput,
} from "./onboardingEmail.js";

export {
  DEFAULT_ONBOARDING_REPLY_TO,
  ONBOARDING_EMAIL_FROM,
  ONBOARDING_FOLLOW_UP_AUDIT_ACTION,
  ONBOARDING_SUPPORT_EMAIL,
  runOnboardingEmails,
  runWelcomeEmailSweep,
  sendWelcomeEmailOnce,
} from "./onboardingEmails.js";

export type {
  OnboardingEmailRunResult,
  OnboardingEmailTransport,
  RunOnboardingEmailsOptions,
  SendWelcomeEmailOptions,
  WelcomeEmailOutcome,
  WelcomeEmailSweepOptions,
  WelcomeEmailSweepResult,
} from "./onboardingEmails.js";

export type { EmailReplyTo, EmailTransport, OutboundEmailMessage } from "./email.js";

export {
  DEFAULT_EMAIL_FROM,
  EmailFailure,
  describeEmailFailure,
  formatEmailAddress,
  makeEmailTransport,
  parseEmailSender,
  replyToAddress,
  smtpEmailTransport,
} from "./email.js";

export type { EmailAddress } from "./email.js";

export type { SmtpTransportOptions } from "./smtp.js";

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
} from "./emailOutbox.js";

export type {
  DrainEmailOutboxOptions,
  DrainEmailOutboxResult,
  EmailOutboxTemplate,
  EnqueueEmailInput,
  EnqueueEmailOutcome,
  SendTransactionalEmailInput,
  TransactionalEmailOutcome,
} from "./emailOutbox.js";

export { settlePendingInvitations } from "./invitations.js";

export { makeAuthLive, sessionCookie } from "./auth.js";

export { makeAppAuth } from "@mattrax/enterprise-domain";

export type { AppAuthService, AuthLiveOptions } from "./auth.js";

export { makeEnterpriseAuthLive } from "./enterpriseAuth.js";

export type { EnterpriseAuthOptions } from "./enterpriseAuth.js";

export {
  detectEnrollmentPlatform,
  evaluateEnrollmentAttempt,
  ENROLLMENT_ATTEMPT_OUTCOMES,
  ENROLLMENT_ATTEMPT_PLATFORMS,
} from "./enrollmentAttempts.js";

export type {
  EnrollmentAttemptEvaluation,
  EnrollmentAttemptOutcome,
  EnrollmentAttemptPlatform,
} from "./enrollmentAttempts.js";

export {
  runMaintenance,
  loadCredentialAlertRecipients,
  loadTenantAdminRecipients,
} from "./maintenance.js";

export type {
  CredentialAlertRecipient,
  CredentialExpiryNotification,
  CredentialExpiryNotifier,
  MaintenanceOptions,
  MaintenanceResult,
} from "./maintenance.js";

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
} from "./backup.js";

export type {
  BackupActor,
  BackupRetention,
  BackupStatus,
  BackupTrigger,
  PruneBackupsResult,
  RunTenantBackupOptions,
  ScheduledBackupsResult,
  TenantBackupResult,
} from "./backup.js";

export { buildTenantExport } from "./tenantExport.js";

export type { TenantExportBundle } from "./tenantExport.js";

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
} from "./entraSync.js";

export type {
  EntraDirectorySyncOutcome,
  EntraSyncLockState,
  EntraSyncProgress,
  EntraSyncScheduleState,
  EntraSyncTrigger,
  ScheduledEntraSyncResult,
} from "./entraSync.js";

export { ScimMembershipNotifier } from "./scim.ts";

export type { ScimMembershipNotifierHandler } from "./scim.ts";

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
} from "@mattrax/management-backend-enterprise";

export type {
  WebhookDeliveryOutcome,
  WebhookRetryOptions,
  WebhookRetryResult,
} from "@mattrax/management-backend-enterprise";

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
} from "./credentialHealth.js";

export type { CredentialHealth, DeviceCertificateRecord } from "./credentialHealth.js";

export {
  loadScepCaState,
  loadTrustedScepCaCertificates,
  purgeExpiredScepCaTrust,
  rotateDueScepCas,
  scepCaStateFromRows,
} from "./scepLifecycle.js";

export type {
  ScepCaRotationSweepResult,
  ScepCaState,
  ScepIssuedIdentity,
  ScepRetiredCaState,
} from "./scepLifecycle.js";

export {
  SERVER_CERTIFICATE_CHECK_INTERVAL_MINUTES,
  SERVER_CERTIFICATE_CRITICAL_DAYS,
  SERVER_CERTIFICATE_PROBE_TIMEOUT_MS,
  SERVER_CERTIFICATE_WARNING_DAYS,
  loadServerCertificateInfo,
  probeServerCertificate,
  runServerCertificateCheck,
  serverCertificatePeerFromDer,
} from "./serverCertificate.js";

export type {
  ServerCertificateCheckResult,
  ServerCertificatePeer,
  ServerCertificateProbe,
  ServerCertificateProbeOptions,
} from "./serverCertificate.js";

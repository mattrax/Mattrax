import { AppleUserActionName } from "./deviceActions.js";
import { DeviceActionName } from "./deviceActions.js";
import { DeviceAttributeValues } from "./attributes.js";
import { Schema } from "effect";
import { AutopilotDeviceInfo } from "./Autopilot.js";
import { GroupMembershipKind } from "./Group.js";
import { NullableString } from "./Errors.js";
import { WindowsActivationStatus } from "./deviceInventory.js";

export const DeviceProtocol = Schema.Literals(["apple", "win", "android"]);

export const DeviceStatus = Schema.Literals(["enrolling", "enrolled", "unenrolling", "unenrolled"]);

export const DeviceFileVaultStatus = Schema.Literals(["enabled", "disabled", "unknown"]);

export type DeviceFileVaultStatus = typeof DeviceFileVaultStatus.Type;

/**
 * Android Management API state that does not apply to Apple or Windows.
 * Enum values are the raw AMAPI identifiers so a new Google value is surfaced
 * rather than dropped; the dashboard humanises them for display.
 */
export const AndroidDeviceInfo = Schema.Struct({
  /** `DEVICE_OWNER`, `PROFILE_OWNER` or `MANAGEMENT_MODE_UNSPECIFIED`. */
  managementMode: Schema.optional(NullableString),
  /** `COMPANY_OWNED`, `PERSONALLY_OWNED` or `OWNERSHIP_UNSPECIFIED`. */
  ownership: Schema.optional(NullableString),
  /** Raw AMAPI device state (`ACTIVE`, `DISABLED`, `PROVISIONING`, ...). */
  state: Schema.optional(NullableString),
  /** `softwareInfo.androidVersion`'s API level, for example `34`. */
  apiLevel: Schema.optional(Schema.NullOr(Schema.Number)),
  /** `softwareInfo.securityPatchLevel`, for example `2026-10-05`. */
  securityPatchLevel: Schema.optional(NullableString),
  appliedPolicyName: Schema.optional(NullableString),
  appliedPolicyVersion: Schema.optional(NullableString),
  enrollmentTokenName: Schema.optional(NullableString),
  /** Free-text reason Google shows on the device while it is disabled. */
  disabledReason: Schema.optional(NullableString),
  /** Registered network operator from `networkInfo`. */
  networkOperator: Schema.optional(NullableString),
  /** `memoryInfo.totalRam`, in bytes. */
  totalRam: Schema.optional(Schema.NullOr(Schema.Number)),
});

export type AndroidDeviceInfo = typeof AndroidDeviceInfo.Type;

/**
 * Windows activation and licence state reported by mattraxd.
 *
 * Windows does not expose activation through OMA-DM, so an agent samples
 * `SoftwareLicensingProduct` over WMI and posts the raw values. Windows
 * devices that have not run an agent, and every non-Windows device, have no
 * activation state at all (never a false "not activated").
 */
export const WindowsActivationInfo = Schema.Struct({
  /** Stable normalised state derived from `licenseStatus`. */
  status: WindowsActivationStatus,
  /** Raw `SoftwareLicensingProduct.LicenseStatus` (0-6). */
  licenseStatus: Schema.optional(Schema.NullOr(Schema.Number)),
  /** Raw licence product name, for example `Windows(R), Professional edition`. */
  licenseName: Schema.optional(NullableString),
  /** Raw `ProductKeyChannel`, for example `Retail` or `Volume:MAK`. */
  productKeyChannel: Schema.optional(NullableString),
  /** Edition reported by WMI, for example `Microsoft Windows 11 Pro`. */
  edition: Schema.optional(NullableString),
  /** When the agent last reported activation state. */
  updatedAt: Schema.optional(NullableString),
});

export type WindowsActivationInfo = typeof WindowsActivationInfo.Type;

/**
 * Windows security and join state collected by the inventory `Get` set.
 *
 * `null` means the device has not reported the node (or rejected it), which is
 * different from a reported `false`. Health rules only fire once the device
 * has reported a security snapshot (`updatedAt` is set).
 */
export const WindowsSecurityInfo = Schema.Struct({
  /** `DeviceStatus/Compliance/EncryptionCompliance`: 1 encrypted, 0 not. */
  bitLockerEnabled: Schema.optional(Schema.NullOr(Schema.Boolean)),
  /** Raw `BitLocker/Status/DeviceEncryptionStatus` bitmask (0 = compliant). */
  bitLockerStatus: Schema.optional(Schema.NullOr(Schema.Number)),
  /** Reported when a TPM is present; absent means no TPM answered the node. */
  tpmVersion: Schema.optional(NullableString),
  /** `DeviceStatus/SecureBootState`: 0 unsupported, 1 enabled, 2 disabled. */
  secureBootState: Schema.optional(Schema.NullOr(Schema.Number)),
  /** `DeviceStatus/DomainName`; empty when the device is not domain joined. */
  domainName: Schema.optional(NullableString),
  /** `DMClient/Provider/{ProviderID}/AADDeviceID`, when Entra joined. */
  entraDeviceId: Schema.optional(NullableString),
  /** Activation and licence state from the agent's WMI sample, if any. */
  activation: Schema.optional(WindowsActivationInfo),
  /** When the security snapshot was last written. */
  updatedAt: Schema.optional(NullableString),
});

export type WindowsSecurityInfo = typeof WindowsSecurityInfo.Type;

/** The last time an OMA-URI was rejected by the device. */
export const WindowsPolicyFailure = Schema.Struct({
  uri: Schema.String,
  /** SyncML status the device returned (for example `400` or `500`). */
  resultStatus: Schema.String,
  detail: Schema.String,
  at: Schema.String,
});

export type WindowsPolicyFailure = typeof WindowsPolicyFailure.Type;

/**
 * Per-device Windows policy delivery state.
 *
 * `appliedUris` are the nodes whose `Replace` the device acknowledged.
 * `pendingUris` are desired nodes delivered but not acknowledged yet.
 * `pendingRevertUris` are nodes removed from every policy whose `Delete` has
 * been delivered but not acknowledged. `revertedAt` records the last completed
 * revert, so a deployment view can distinguish "reverted" from "pending".
 */
export const WindowsPolicyInfo = Schema.Struct({
  appliedUris: Schema.Array(Schema.String),
  pendingUris: Schema.Array(Schema.String),
  pendingRevertUris: Schema.Array(Schema.String),
  failed: Schema.Array(WindowsPolicyFailure),
  updatedAt: Schema.optional(NullableString),
  revertedAt: Schema.optional(NullableString),
});

export type WindowsPolicyInfo = typeof WindowsPolicyInfo.Type;

/** Where in the Windows protocol a recorded failure happened. */
export const WindowsFailurePhase = Schema.Literals([
  "discovery",
  "wstep",
  "enrollment",
  "policy",
  "command",
]);

export type WindowsFailurePhase = typeof WindowsFailurePhase.Type;

/**
 * One failed Windows enrollment or management request.
 *
 * `deviceId` is absent when the failure happened before a device row existed
 * (a first enrollment that never completed); `deviceIdentifier` then carries
 * the Windows `DeviceID` the client asserted, if it got that far.
 */
export const WindowsMdmFailure = Schema.Struct({
  id: Schema.String,
  deviceId: Schema.optional(NullableString),
  deviceIdentifier: Schema.optional(NullableString),
  serial: Schema.optional(NullableString),
  hostname: Schema.optional(NullableString),
  phase: WindowsFailurePhase,
  /** Stable machine-readable cause, e.g. `certificate_signing_failed`. */
  code: Schema.String,
  message: Schema.String,
  /** Optional diagnostic text (internal error, OMA-URI). */
  detail: Schema.optional(NullableString),
  at: Schema.String,
});

export type WindowsMdmFailure = typeof WindowsMdmFailure.Type;

/** Tenant-level Windows failure rollup shown in Settings → Delivery. */
export const WindowsFailureQuery = Schema.Struct({
  /** Restrict to one device row; omitted means the whole tenant. */
  deviceId: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
});

export type WindowsFailureQuery = typeof WindowsFailureQuery.Type;

export const WindowsFailureListResponse = Schema.Struct({
  /** Retained window in days; `0` means history is kept forever. */
  retentionDays: Schema.Number,
  /** Failures inside the retention window, using the same scope as `failures`. */
  count: Schema.Number,
  /** Newest first. */
  failures: Schema.Array(WindowsMdmFailure),
});

export type WindowsFailureListResponse = typeof WindowsFailureListResponse.Type;

export const WindowsDeviceInfo = Schema.Struct({
  security: WindowsSecurityInfo,
  policy: WindowsPolicyInfo,
});

export type WindowsDeviceInfo = typeof WindowsDeviceInfo.Type;

/** One `mdm.app` entry: an MDM-installed app and its install state. */
export const DeviceManagementApp = Schema.Struct({
  identifier: Schema.String,
  state: Schema.optional(NullableString),
  version: Schema.optional(NullableString),
  shortVersion: Schema.optional(NullableString),
});

export type DeviceManagementApp = typeof DeviceManagementApp.Type;

export const DeviceRow = Schema.Struct({
  id: Schema.String,
  proto: DeviceProtocol,
  name: Schema.String,
  model: Schema.optional(NullableString),
  modelIdentifier: Schema.optional(NullableString),
  serial: Schema.optional(NullableString),
  status: DeviceStatus,
  enrolledAt: Schema.String,
  lastSeenAt: Schema.String,
  /**
   * Check-in recency presence. Optional so stored snapshots and older clients
   * decode; the device endpoints always set it from `deriveDevicePresence`.
   */
  online: Schema.optional(Schema.Boolean),
  assetTag: Schema.optional(NullableString),
  notes: Schema.optional(NullableString),
  physicalName: Schema.optional(NullableString),
  vendor: Schema.optional(NullableString),
  osEdition: Schema.optional(NullableString),
  osVersion: Schema.optional(NullableString),
  osBuild: Schema.optional(NullableString),
  diskTotal: Schema.optional(NullableString),
  diskUsed: Schema.optional(NullableString),
  /** FileVault state reported by the DDM inventory status items. */
  fileVaultEnabled: Schema.optional(Schema.NullOr(Schema.Boolean)),
  /** Normalised battery condition (for example `Good`, `Service Recommended`). */
  batteryHealth: Schema.optional(NullableString),
  /** Raw client capability list reported by `management.client-capabilities`. */
  capabilities: Schema.optional(Schema.NullOr(Schema.Unknown)),
  modelNumber: Schema.optional(NullableString),
  inventoryUpdatedAt: Schema.optional(NullableString),
  /** Normalised FileVault state shared by DDM inventory and SecurityInfo. */
  fileVaultStatus: Schema.optional(Schema.NullOr(DeviceFileVaultStatus)),
  /**
   * Normalised Windows activation state reported by mattraxd.
   * `null` for non-Windows devices and Windows devices that have not run it.
   */
  windowsActivationStatus: Schema.optional(Schema.NullOr(WindowsActivationStatus)),
  /** `passcode.is-present`; absent on macOS, which has no device passcode. */
  passcodePresent: Schema.optional(Schema.NullOr(Schema.Boolean)),
  /** `passcode.is-compliant`. */
  passcodeCompliant: Schema.optional(Schema.NullOr(Schema.Boolean)),
  /** `softwareupdate.install-state`. */
  osUpdateInstallState: Schema.optional(NullableString),
  osUpdatePendingVersion: Schema.optional(NullableString),
  osUpdatePendingBuild: Schema.optional(NullableString),
  osUpdateFailureReason: Schema.optional(NullableString),
  osUpdateFailureCount: Schema.optional(Schema.NullOr(Schema.Number)),
  osUpdateFailedAt: Schema.optional(NullableString),
  /** `security.lockdown-mode`. */
  securityLockdownMode: Schema.optional(Schema.NullOr(Schema.Boolean)),
  managedCertificateCount: Schema.optional(Schema.NullOr(Schema.Number)),
  /** Apps from the last `mdm.app` report (MDM-installed apps only). */
  managementApps: Schema.optional(Schema.NullOr(Schema.Array(DeviceManagementApp))),
  /**
   * Policy delivery path. `legacy` means the device cannot apply declarations
   * and receives `.mobileconfig` profiles instead.
   */
  declarationMode: Schema.optional(Schema.NullOr(Schema.Literals(["ddm", "legacy"]))),
  /** Why that path was chosen, for support. */
  declarationModeReason: Schema.optional(NullableString),
  declarationModeUpdatedAt: Schema.optional(NullableString),
  /** `SecurityInfo.ManagementStatus.IsActivationLockManageable`. */
  isActivationLockManageable: Schema.optional(Schema.NullOr(Schema.Boolean)),
  /**
   * ADE setup state. `awaitingConfiguration` is true while the device is held
   * in Setup Assistant; `configured` flips when the server's
   * `DeviceConfigured` command is acknowledged.
   */
  awaitingConfiguration: Schema.optional(Schema.NullOr(Schema.Boolean)),
  configured: Schema.optional(Schema.NullOr(Schema.Boolean)),
  setupReleasedAt: Schema.optional(NullableString),
  /** When an administrator requested Return to Service. */
  returnToServiceRequestedAt: Schema.optional(NullableString),
  /** When the device re-enrolled after Return to Service. */
  returnToServiceCompletedAt: Schema.optional(NullableString),
  /** Whether a device-generated Activation Lock bypass code is escrowed. */
  activationLockBypassCodeEscrowed: Schema.optional(Schema.Boolean),
  /** When the last `SecurityInfo` answer was persisted. */
  securityInfoUpdatedAt: Schema.optional(NullableString),
  /** True when that answer is older than the refresh window. */
  securityInfoStale: Schema.optional(Schema.Boolean),
  /**
   * Device detail escrow metadata. The recovery key and bootstrap token are
   * never included in device payloads; use the recovery-key endpoint to read
   * the decrypted FileVault key.
   */
  recoveryKeyEscrowed: Schema.optional(Schema.Boolean),
  bootstrapTokenEscrowed: Schema.optional(Schema.Boolean),
  recoveryKeyUpdatedAt: Schema.optional(NullableString),
  recoveryKeyRotatedAt: Schema.optional(NullableString),
  /** `plaintext` or `cms` (CMS is unwrapped on reveal, never returned raw). */
  recoveryKeyFormat: Schema.optional(Schema.NullOr(Schema.Literals(["plaintext", "cms"]))),
  bootstrapTokenUpdatedAt: Schema.optional(NullableString),
  /**
   * The managed local administrator generated for macOS ADE setup. The
   * password is never included here; use the local-admin endpoint to reveal it.
   */
  localAdminUsername: Schema.optional(NullableString),
  localAdminPasswordEscrowed: Schema.optional(Schema.Boolean),
  localAdminUpdatedAt: Schema.optional(NullableString),
  applicationsUpdatedAt: Schema.optional(NullableString),
  /**
   * True when the installed-application inventory is older than the refresh
   * cadence (or has never been reported). The device page uses it to warn that
   * the software list may be out of date instead of presenting stale rows as
   * current.
   */
  applicationsStale: Schema.optional(Schema.Boolean),
  /** Android Management API state; absent for Apple and Windows devices. */
  android: Schema.optional(Schema.NullOr(AndroidDeviceInfo)),
  /** Windows security inventory and policy delivery state. */
  windows: Schema.optional(Schema.NullOr(WindowsDeviceInfo)),
  /**
   * Remote actions this device currently supports, derived from its platform,
   * enrollment status and reported capabilities. The dashboard renders its
   * action menu from this instead of guessing per platform.
   */
  actions: Schema.optional(Schema.Array(DeviceActionName)),
  /** Windows Autopilot state when the device is also known to Autopilot. */
  autopilot: Schema.optional(Schema.NullOr(AutopilotDeviceInfo)),
  /**
   * Tenant-defined attribute values keyed by definition key. Present on device
   * detail and search rows; never includes attributes that have no value.
   */
  attributes: Schema.optional(DeviceAttributeValues),
  /** Group memberships, populated on device detail (not the list payload). */
  groups: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        /** `nested` means the device is inherited from a child group. */
        source: Schema.optional(GroupMembershipKind),
        /** Child groups that bring an inherited device in, when known. */
        inheritedFrom: Schema.optional(
          Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
        ),
      }),
    ),
  ),
  /**
   * Derived health rollup. Present on search pages (one computation per page);
   * the `listDevices` payload omits it to avoid reading every declaration on a
   * whole-fleet listing.
   */
  health: Schema.optional(Schema.suspend(() => DeviceHealth)),
  /**
   * Derived macOS update status from the SOFA feed. Present on the device list,
   * search and detail payloads; other platforms report `unknown` with the
   * `platform_unsupported` code rather than a misleading "up to date".
   */
  osUpdate: Schema.optional(Schema.Json),
});

export type DeviceRow = typeof DeviceRow.Type;

/** One installed application reported by a managed device. */
export const DeviceApplication = Schema.Struct({
  /** Apple bundle id, Android package name or Windows product/registry key. */
  bundleId: Schema.String,
  name: Schema.optional(NullableString),
  version: Schema.optional(NullableString),
  shortVersion: Schema.optional(NullableString),
  /** Vendor as reported by Windows inventory (`Publisher`). */
  publisher: Schema.optional(NullableString),
  bundleSize: Schema.optional(Schema.NullOr(Schema.Number)),
  dynamicSize: Schema.optional(Schema.NullOr(Schema.Number)),
  hasUpdateAvailable: Schema.Boolean,
  isManaged: Schema.Boolean,
  lastReportedAt: Schema.String,
});

export type DeviceApplication = typeof DeviceApplication.Type;

export const DeviceApplicationsResponse = Schema.Struct({
  applications: Schema.Array(DeviceApplication),
});

export type DeviceApplicationsResponse = typeof DeviceApplicationsResponse.Type;

/** A tenant-wide software inventory row with its installed-device count. */
export const ApplicationInventoryRow = Schema.Struct({
  ...DeviceApplication.fields,
  /** Stable row key for tables: the bundle identifier. */
  id: Schema.String,
  deviceCount: Schema.Number,
});

export type ApplicationInventoryRow = typeof ApplicationInventoryRow.Type;

export const ApplicationInventoryQuery = Schema.Struct({
  /** Matches bundle identifier and display name. */
  q: Schema.optional(Schema.String),
  managed: Schema.optional(Schema.Literals(["managed", "unmanaged"])),
  updates: Schema.optional(Schema.Literals(["available"])),
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
});

export type ApplicationInventoryQuery = typeof ApplicationInventoryQuery.Type;

export const ApplicationInventoryResponse = Schema.Struct({
  applications: Schema.Array(ApplicationInventoryRow),
  /** Total matching bundle identifiers before pagination. */
  total: Schema.Number,
});

export type ApplicationInventoryResponse = typeof ApplicationInventoryResponse.Type;

/**
 * One installed software result for the command palette.
 *
 * The inventory has a row per device, so search aggregates by bundle id,
 * version and publisher: the palette shows one result per app/version with the
 * number of devices that reported it.
 */
export const SoftwareSearchRow = Schema.Struct({
  /** Display name reported by the device, falling back to the bundle id. */
  name: Schema.String,
  /** Apple bundle id, Android package name or Windows product key. */
  bundleId: Schema.String,
  version: Schema.optional(NullableString),
  /** Apple `shortVersion`; matched by search but not shown in the hint. */
  shortVersion: Schema.optional(NullableString),
  /** Vendor (`Publisher` on Windows, otherwise an app-store vendor). */
  publisher: Schema.optional(NullableString),
  /** Distinct devices reporting this app/version/publisher. */
  deviceCount: Schema.Number,
});

export type SoftwareSearchRow = typeof SoftwareSearchRow.Type;

/** Decrypted FileVault recovery key. Never returned by list/detail endpoints. */
export const DeviceRecoveryKeyResponse = Schema.Struct({
  recoveryKey: Schema.String,
  /** When the escrowed value was last received from the device. */
  updatedAt: Schema.String,
  /** When the value last changed. */
  rotatedAt: Schema.optional(NullableString),
});

export type DeviceRecoveryKeyResponse = typeof DeviceRecoveryKeyResponse.Type;

/** The managed local administrator account created during macOS ADE setup. */
export const DeviceLocalAdminResponse = Schema.Struct({
  username: Schema.String,
  password: Schema.String,
  /** When the account password was last generated. */
  updatedAt: Schema.String,
});

export type DeviceLocalAdminResponse = typeof DeviceLocalAdminResponse.Type;

/**
 * Device-generated Activation Lock bypass code. Apple only returns a code
 * before Activation Lock is enabled, so an empty escrow is not proof that the
 * device is clear.
 */
export const DeviceActivationLockBypassCodeResponse = Schema.Struct({
  bypassCode: Schema.String,
  /** When the escrowed code was last received from the device. */
  updatedAt: Schema.String,
  /** When the code last changed. */
  rotatedAt: Schema.optional(NullableString),
  /** `ManagementStatus.IsActivationLockManageable` from the last report. */
  isActivationLockManageable: Schema.optional(Schema.NullOr(Schema.Boolean)),
});

export type DeviceActivationLockBypassCodeResponse =
  typeof DeviceActivationLockBypassCodeResponse.Type;

/** Tenant FileVault personal recovery key escrow identity (public half only). */
export const AppleFdeEscrowKeyInfo = Schema.Struct({
  configured: Schema.Boolean,
  /** PEM certificate; the private key never leaves the backend. */
  certificatePem: Schema.optional(NullableString),
  fingerprintSha256: Schema.optional(NullableString),
  subject: Schema.optional(NullableString),
  notAfter: Schema.optional(NullableString),
  source: Schema.optional(Schema.NullOr(Schema.Literals(["generated", "uploaded"]))),
  createdAt: Schema.optional(NullableString),
  updatedAt: Schema.optional(NullableString),
});

export type AppleFdeEscrowKeyInfo = typeof AppleFdeEscrowKeyInfo.Type;

/** Upload a matching certificate/private-key pair for FileVault escrow. */
export const UploadAppleFdeEscrowKeyRequest = Schema.Struct({
  certificatePem: Schema.String,
  /** Unencrypted PKCS#8 PEM private key. */
  privateKeyPem: Schema.String,
});

export type UploadAppleFdeEscrowKeyRequest = typeof UploadAppleFdeEscrowKeyRequest.Type;

/**
 * Lifecycle of a queued MDM command.
 *
 * `queued`, `sent` and `deferred` are active: the device may still run the
 * command. `succeeded` and `failed` are outcomes reported by the device (or
 * reconciled from what it reports). `expired` means the delivery deadline
 * passed before the device ran it, `superseded` means a newer command made it
 * obsolete, and `cancelled` means the device left management first.
 */
export const DeviceCommandStatus = Schema.Literals([
  "queued",
  "sent",
  "deferred",
  "succeeded",
  "failed",
  "expired",
  "superseded",
  "cancelled",
  "unknown",
]);

export type DeviceCommandStatus = typeof DeviceCommandStatus.Type;

/** Statuses where the device can still run the command. */
export const DEVICE_COMMAND_ACTIVE_STATUSES = ["queued", "sent", "deferred"] as const;

export const DEVICE_COMMAND_STATUS_LABELS: Record<DeviceCommandStatus, string> = {
  queued: "Queued",
  sent: "Sent",
  deferred: "Deferred by device",
  succeeded: "Succeeded",
  failed: "Failed",
  expired: "Expired",
  superseded: "Superseded",
  cancelled: "Cancelled",
  unknown: "Unknown",
};

/**
 * Map a stored status onto the public lifecycle. Rows written before the
 * lifecycle was introduced stored Apple's `NotNow` result as `not-now`.
 */
export const normalizeDeviceCommandStatus = (
  value: string | null | undefined,
): DeviceCommandStatus => {
  switch (value) {
    case "queued":
    case "sent":
    case "succeeded":
    case "failed":
    case "expired":
    case "superseded":
    case "cancelled":
      return value;
    case "deferred":
    case "not-now":
      return "deferred";
    default:
      return "unknown";
  }
};

/** Short, human-readable label for a stored command status. */
export const deviceCommandStatusLabel = (value: string | null | undefined): string =>
  DEVICE_COMMAND_STATUS_LABELS[normalizeDeviceCommandStatus(value)];

export const DeviceCommandInfo = Schema.Struct({
  id: Schema.String,
  requestType: Schema.String,
  status: DeviceCommandStatus,
  /** Human-readable lifecycle label for the status. */
  statusLabel: Schema.String,
  /** OMA-URI (Windows) or target the command addressed, when it carries one. */
  locURI: Schema.optional(NullableString),
  resultStatus: Schema.optional(NullableString),
  resultDetail: Schema.optional(NullableString),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  /** Delivery deadline. Absent only for request types without a budget. */
  expiresAt: Schema.optional(NullableString),
});

export const DeviceCommandsResponse = Schema.Struct({
  commands: Schema.Array(DeviceCommandInfo),
});

export const DeviceDeclarationInfo = Schema.Struct({
  identifier: Schema.String,
  declarationType: Schema.String,
  active: Schema.Boolean,
  valid: Schema.String,
  serverToken: Schema.optional(NullableString),
  reasons: Schema.optional(Schema.NullOr(Schema.Unknown)),
  updatedAt: Schema.String,
});

export const DeviceDeclarationsResponse = Schema.Struct({
  declarations: Schema.Array(DeviceDeclarationInfo),
});

/**
 * Derived health rollup. `missing` is the MIA state: the device is still
 * enrolled but has not checked in for the MIA threshold (14 days), which sits
 * between `attention` (stale at 7 days) and the 30-day auto-unenrol.
 */
export const DeviceHealthLevel = Schema.Literals([
  "healthy",
  "attention",
  "missing",
  "critical",
  "unknown",
]);

export type DeviceHealthLevel = typeof DeviceHealthLevel.Type;

export const DeviceHealthReasonSeverity = Schema.Literals(["info", "warning", "critical"]);

export type DeviceHealthReasonSeverity = typeof DeviceHealthReasonSeverity.Type;

export const DeviceHealthReason = Schema.Struct({
  code: Schema.String,
  label: Schema.String,
  severity: DeviceHealthReasonSeverity,
});

export type DeviceHealthReason = typeof DeviceHealthReason.Type;

export const DeviceHealth = Schema.Struct({
  level: DeviceHealthLevel,
  reasons: Schema.Array(DeviceHealthReason),
  lastSeenAt: Schema.optional(NullableString),
  stale: Schema.Boolean,
  /** Check-in recency presence; absent on rows derived before it existed. */
  online: Schema.optional(Schema.Boolean),
});

export type DeviceHealth = typeof DeviceHealth.Type;

/** Identity certificate metadata. Private keys are never exposed. */
export const DeviceCertificateInfo = Schema.Struct({
  serial: Schema.String,
  notAfter: Schema.String,
  revokedAt: Schema.optional(NullableString),
  createdAt: Schema.String,
});

export type DeviceCertificateInfo = typeof DeviceCertificateInfo.Type;

/** APNs delivery state for a single Apple device. */
export const DevicePushErrorCode = Schema.Literals(["invalid_token", "delivery_failed"]);

export type DevicePushErrorCode = typeof DevicePushErrorCode.Type;

export const DevicePushInfo = Schema.Struct({
  /** The device has a token and push magic, so a push could be attempted. */
  configured: Schema.Boolean,
  lastAttemptAt: Schema.optional(NullableString),
  lastSuccessAt: Schema.optional(NullableString),
  lastError: Schema.optional(NullableString),
  lastErrorCode: Schema.optional(Schema.NullOr(DevicePushErrorCode)),
  consecutiveFailures: Schema.Number,
  /** Apple rejected the token; the device has to enroll again. */
  invalidToken: Schema.Boolean,
});

export type DevicePushInfo = typeof DevicePushInfo.Type;

/**
 * One user connection Apple reports for a device.
 *
 * `platformUserId` is Apple's opaque identifier (`UserID`/`EnrollmentUserID`).
 * A user channel is only usable once `UserAuthenticate` approved it (or the
 * enrollment is an Apple User Enrollment); `configured` says whether APNs push
 * credentials exist for it.
 */
export const AppleDeviceUserProfile = Schema.Struct({
  identifier: Schema.String,
  displayName: Schema.optional(NullableString),
  payloadType: Schema.optional(NullableString),
  managed: Schema.Boolean,
});

export type AppleDeviceUserProfile = typeof AppleDeviceUserProfile.Type;

/** How an Apple user channel was bound to a directory person. */
export const AppleUserIdentitySource = Schema.Literals([
  "certificate",
  "managed-apple-account",
  "manual",
]);

export type AppleUserIdentitySource = typeof AppleUserIdentitySource.Type;

export const AppleUserDirectoryIdentity = Schema.Struct({
  userId: Schema.String,
  name: Schema.String,
  email: Schema.String,
  source: AppleUserIdentitySource,
  /** The IdP subject the binding was verified against, when there is one. */
  upn: Schema.optional(NullableString),
  verifiedAt: Schema.optional(NullableString),
});

export type AppleUserDirectoryIdentity = typeof AppleUserDirectoryIdentity.Type;

export const BindAppleUserIdentityRequest = Schema.Struct({
  /** Directory user this channel belongs to. */
  userId: Schema.String,
});

export type BindAppleUserIdentityRequest = typeof BindAppleUserIdentityRequest.Type;

export const AppleDeviceUser = Schema.Struct({
  platformUserId: Schema.String,
  shortName: Schema.optional(NullableString),
  longName: Schema.optional(NullableString),
  /**
   * `authenticated` means UserAuthenticate bound the user to the device.
   * `enrollment` means the user came from an Apple User Enrollment, where the
   * enrollment itself is the user. `unbound` is a row that has a push channel
   * (Shared iPad) but no handshake.
   */
  binding: Schema.Literals(["authenticated", "enrollment", "unbound"]),
  /** A push token and push magic are stored for this channel. */
  configured: Schema.Boolean,
  authenticatedAt: Schema.optional(NullableString),
  lastSeenAt: Schema.optional(NullableString),
  push: DevicePushInfo,
  /** Profiles the user channel last reported for its login context. */
  profiles: Schema.Array(AppleDeviceUserProfile),
  /**
   * The directory person this channel is bound to. User-scoped policy is only
   * delivered for a bound channel.
   */
  identity: Schema.optional(Schema.NullOr(AppleUserDirectoryIdentity)),
  /** Per-user actions currently available on this channel. */
  actions: Schema.Array(Schema.String),
});

export type AppleDeviceUser = typeof AppleDeviceUser.Type;

export const AppleDeviceUsersResponse = Schema.Struct({
  users: Schema.Array(AppleDeviceUser),
  /** How the device itself is enrolled (BYOD devices have one user). */
  enrollmentMode: Schema.optional(Schema.NullOr(Schema.Literals(["device", "user"]))),
});

export type AppleDeviceUsersResponse = typeof AppleDeviceUsersResponse.Type;

/** Tenant-wide APNs delivery rollup. */
export const DevicePushHealthCounts = Schema.Struct({
  /** Apple devices that currently have a push token and magic. */
  configured: Schema.Number,
  /** Devices with at least one recorded delivery attempt. */
  attempted: Schema.Number,
  /** Last delivery succeeded and no failure is outstanding. */
  succeeded: Schema.Number,
  /** Devices whose most recent delivery has not been followed by a success. */
  failing: Schema.Number,
  /** Devices Apple has told us can no longer receive pushes. */
  invalidToken: Schema.Number,
});

export type DevicePushHealthCounts = typeof DevicePushHealthCounts.Type;

export const DevicePushFailure = Schema.Struct({
  deviceId: Schema.String,
  deviceName: Schema.String,
  at: Schema.String,
  error: Schema.optional(NullableString),
  errorCode: Schema.optional(Schema.NullOr(DevicePushErrorCode)),
  consecutiveFailures: Schema.Number,
});

export type DevicePushFailure = typeof DevicePushFailure.Type;

export const DevicePushHealthResponse = Schema.Struct({
  counts: DevicePushHealthCounts,
  recentFailures: Schema.Array(DevicePushFailure),
});

export type DevicePushHealthResponse = typeof DevicePushHealthResponse.Type;

/** Chronological per-device feed assembled from existing records. */
export const DeviceActivityKind = Schema.Literals([
  "audit",
  "command",
  "declaration",
  "lifecycle",
  "certificate",
]);

export type DeviceActivityKind = typeof DeviceActivityKind.Type;

export const DeviceActivityEntry = Schema.Struct({
  id: Schema.String,
  kind: DeviceActivityKind,
  title: Schema.String,
  detail: Schema.optional(NullableString),
  status: Schema.optional(NullableString),
  at: Schema.String,
});

export type DeviceActivityEntry = typeof DeviceActivityEntry.Type;

export const DeviceActivityResponse = Schema.Struct({
  events: Schema.Array(DeviceActivityEntry),
  /** Older events exist behind this page; request the next page with `nextCursor`. */
  hasMore: Schema.Boolean,
  /**
   * Opaque keyset position of the last event on this page. Absent when there
   * is no older activity. Clients must not parse or construct it.
   */
  nextCursor: Schema.optional(NullableString),
});

export type DeviceActivityResponse = typeof DeviceActivityResponse.Type;

export const DeviceHealthResponse = Schema.Struct({
  health: DeviceHealth,
  declarations: Schema.Array(DeviceDeclarationInfo),
  certificates: Schema.Array(DeviceCertificateInfo),
  push: DevicePushInfo,
  /** Windows security inventory, absent for other platforms. */
  windows: Schema.optional(Schema.NullOr(WindowsSecurityInfo)),
});

export type DeviceHealthResponse = typeof DeviceHealthResponse.Type;

export const DeviceHealthCounts = Schema.Struct({
  total: Schema.Number,
  healthy: Schema.Number,
  attention: Schema.Number,
  critical: Schema.Number,
  /** Enrolled devices past the MIA threshold (14 days without a check-in). */
  missing: Schema.Number,
  /**
   * Devices past the stale threshold (7 days), regardless of their health
   * level. MIA devices are stale too, so this count includes `missing`.
   */
  stale: Schema.Number,
  unknown: Schema.Number,
});

export type DeviceHealthCounts = typeof DeviceHealthCounts.Type;

export const DeviceHealthReasonGroup = Schema.Struct({
  /** Stable rule code, for grouping across devices. */
  code: Schema.String,
  /** High-level wording suitable for an overview. */
  label: Schema.String,
  severity: DeviceHealthReasonSeverity,
  /** Devices carrying this reason. */
  count: Schema.Number,
});

export type DeviceHealthReasonGroup = typeof DeviceHealthReasonGroup.Type;

/** A non-healthy device resolved to the fields the overview renders. */
export const DeviceHealthAttentionDevice = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  level: DeviceHealthLevel,
  reasons: Schema.Array(DeviceHealthReason),
  lastSeenAt: NullableString,
});

export type DeviceHealthAttentionDevice = typeof DeviceHealthAttentionDevice.Type;

export const DeviceHealthSummaryResponse = Schema.Struct({
  counts: DeviceHealthCounts,
  /** Fleet-level signals, critical first. Empty when every device is healthy. */
  reasons: Schema.Array(DeviceHealthReasonGroup),
  /** Worst devices to surface; the full list lives on the devices page. */
  devices: Schema.Array(DeviceHealthAttentionDevice),
});

export type DeviceHealthSummaryResponse = typeof DeviceHealthSummaryResponse.Type;

/**
 * Tenant credential rollup. `missing` means the credential has not been
 * configured; `unknown` means it exists but its expiry could not be parsed.
 */
export const CredentialLevel = Schema.Literals([
  "ok",
  "warning",
  "critical",
  "expired",
  "missing",
  "unknown",
]);

export type CredentialLevel = typeof CredentialLevel.Type;

export const CredentialInfo = Schema.Struct({
  configured: Schema.Boolean,
  expiresAt: Schema.optional(NullableString),
  /** Whole days until expiry; zero or negative once expired. Null when unparseable. */
  daysLeft: Schema.optional(Schema.NullOr(Schema.Number)),
  level: CredentialLevel,
});

export type CredentialInfo = typeof CredentialInfo.Type;

export const DeviceCertificateCounts = Schema.Struct({
  total: Schema.Number,
  /** Active certificates expiring within 30 days. */
  expiringSoon: Schema.Number,
  expired: Schema.Number,
  revoked: Schema.Number,
});

export type DeviceCertificateCounts = typeof DeviceCertificateCounts.Type;

/**
 * APNs credential health. `keyMatchesCertificate` is null when no private key
 * is stored (a certificate uploaded without the paired CSR key) or the key
 * cannot be read; `topicMatchesCertificate` is null when the certificate is
 * unparseable. A mismatch is a hard failure — pushes cannot be delivered.
 */
export const ApnsCredentialHealth = Schema.Struct({
  ...CredentialInfo.fields,
  commonName: NullableString,
  topic: NullableString,
  keyConfigured: Schema.Boolean,
  keyMatchesCertificate: Schema.NullOr(Schema.Boolean),
  topicMatchesCertificate: Schema.NullOr(Schema.Boolean),
  /** Apple Push Certificates Portal: renew here with the same Apple Account. */
  renewalUrl: Schema.String,
});

export type ApnsCredentialHealth = typeof ApnsCredentialHealth.Type;

/** A retired SCEP CA that is still a verification anchor during the overlap. */
export const ScepRetiredCaState = Schema.Struct({
  fingerprintSha256: Schema.String,
  source: Schema.Literals(["generated", "imported"]),
  retiredAt: Schema.String,
  /** Last moment identities issued by this CA are accepted. */
  trustUntil: Schema.String,
  notAfter: Schema.String,
  daysUntilUntrusted: Schema.Number,
  /** Active identities still chained to this CA. */
  identities: Schema.Number,
});

export type ScepRetiredCaState = typeof ScepRetiredCaState.Type;

/**
 * SCEP CA health, including the rotation state. `rotationDue` is the point at
 * which maintenance rotates automatically; `retiring` lists predecessor CAs
 * that still verify identities issued before that rotation.
 */
export const ScepCaCredentialHealth = Schema.Struct({
  ...CredentialInfo.fields,
  commonName: NullableString,
  fingerprintSha256: NullableString,
  source: Schema.NullOr(Schema.Literals(["generated", "imported"])),
  rotationDue: Schema.Boolean,
  /** When automatic rotation starts; null when no CA exists yet. */
  rotationDueAt: NullableString,
  retiring: Schema.Array(ScepRetiredCaState),
  /** Active identities with no recorded issuing CA (issued before rotation history). */
  unattributedIdentities: Schema.Number,
  /** Active identities whose issuing CA is no longer trusted. */
  untrustedIdentities: Schema.Number,
});

export type ScepCaCredentialHealth = typeof ScepCaCredentialHealth.Type;

/**
 * Deployment origin TLS certificate. It is shared by every tenant because they
 * share the enrolment origin; the row is the latest scheduled probe.
 */
export const ServerCertificateInfo = Schema.Struct({
  ...CredentialInfo.fields,
  origin: NullableString,
  hostname: NullableString,
  checkedAt: NullableString,
  subject: NullableString,
  issuer: NullableString,
  authorized: Schema.NullOr(Schema.Boolean),
  authorizationError: NullableString,
  /** Why the last probe failed; null when it completed. */
  error: NullableString,
});

export type ServerCertificateInfo = typeof ServerCertificateInfo.Type;

export const CredentialHealthResponse = Schema.Struct({
  apns: ApnsCredentialHealth,
  scepCa: ScepCaCredentialHealth,
  deviceCertificates: DeviceCertificateCounts,
  serverCertificate: ServerCertificateInfo,
});

export type CredentialHealthResponse = typeof CredentialHealthResponse.Type;

export const DeviceIdentityRevokeResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  /** Number of identity certificates that were active and are now revoked. */
  revoked: Schema.Number,
});

export const DeviceActionResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  /** Present for a lock command so the administrator can unlock the device. */
  pin: Schema.optional(Schema.String),
  /** The command that was queued, or the still-active duplicate that was reused. */
  commandId: Schema.optional(Schema.String),
  /** True when an identical command was already queued or in flight. */
  deduplicated: Schema.optional(Schema.Boolean),
  /**
   * Activation Lock caveat for an erase. Apple cannot confirm Activation Lock
   * is clear, so the dashboard must not imply that it is.
   */
  activationLockWarning: Schema.optional(Schema.String),
  /**
   * What the queued Return to Service erase carries. Present only for that
   * action, so the dashboard can explain exactly what the device will keep.
   */
  returnToService: Schema.optional(
    Schema.Struct({
      wifiProfileIncluded: Schema.Boolean,
      enrollmentProfileIncluded: Schema.Boolean,
      bootstrapTokenIncluded: Schema.Boolean,
      /** True when the device's ADE assignment supplies the profile. */
      automatedDeviceEnrollment: Schema.Boolean,
    }),
  ),
});

export const DeviceActionRequest = Schema.Struct({
  action: Schema.optional(
    Schema.Literals([
      "sync",
      "lock",
      "wipe",
      "return-to-service",
      "restart",
      "shutdown",
      "clear-passcode",
      "install-app",
      "collect-security-info",
      "refresh-applications",
      "collect-activation-lock-code",
      "rotate-filevault-key",
      "set-recovery-lock",
      "verify-recovery-lock",
      "start-lost-mode",
      "stop-lost-mode",
      "reset-password",
      "clear-app-data",
      "request-device-info",
      "relinquish-ownership",
    ]),
  ),
  manifestUrl: Schema.optional(Schema.String),
  iTunesStoreId: Schema.optional(Schema.Number),
  /** New Recovery Lock password; generated when omitted. */
  recoveryLockPassword: Schema.optional(Schema.String),
});

export const PatchDeviceRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  notes: Schema.optional(NullableString),
  assetTag: Schema.optional(NullableString),
});

/** One Apple per-user channel action. */
export const AppleUserActionRequest = Schema.Struct({
  action: AppleUserActionName,
});

export const AppleUserActionResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  /** The command queued for the user channel (absent for `sync`). */
  commandId: Schema.optional(Schema.String),
  /** True when an identical user-channel command was already in flight. */
  deduplicated: Schema.optional(Schema.Boolean),
});

import { DynamicGroupKind } from "./dynamicGroups.js";
import { DynamicGroupRules } from "./dynamicGroups.js";
import { Schema } from "effect";
import { ApplicationPlatform } from "./Application.js";
import { ApplicationSource } from "./Application.js";
import { JsonRecord } from "./Errors.js";
import { NullableString } from "./Errors.js";
import { ConfigurationScope } from "./Policy.js";

export const TENANT_EXPORT_VERSION = 1;

/** Reject bundles larger than this before doing any database work. */
export const TENANT_IMPORT_MAX_BYTES = 8 * 1024 * 1024;

/** Per-collection cap for an export, so a huge tenant cannot exhaust memory. */
export const TENANT_EXPORT_MAX_ROWS = 10_000;

export const TenantExportProfile = Schema.Struct({
  name: Schema.String,
  /** Optional on import so a bundle can be renamed while restoring. */
  slug: Schema.optional(NullableString),
  logo: Schema.optional(NullableString),
  displayName: Schema.optional(NullableString),
  supportEmail: Schema.optional(NullableString),
  brandColor: Schema.optional(NullableString),
  metadata: Schema.optional(Schema.NullOr(JsonRecord)),
});

export type TenantExportProfile = typeof TenantExportProfile.Type;

export const TenantExportMember = Schema.Struct({
  email: Schema.String,
  name: Schema.optional(NullableString),
  role: Schema.String,
  createdAt: Schema.optional(NullableString),
});

export type TenantExportMember = typeof TenantExportMember.Type;

export const TenantExportDeviceRef = Schema.Struct({
  key: Schema.String,
  name: Schema.optional(NullableString),
  serial: Schema.optional(NullableString),
  /** How the device joined: manual rows survive a dynamic recompute. */
  source: Schema.optional(Schema.Literals(["manual", "dynamic", "directory"])),
});

export type TenantExportDeviceRef = typeof TenantExportDeviceRef.Type;

export const TenantExportGroup = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  notes: Schema.optional(NullableString),
  /** A dynamic group keeps its rules and is no longer restored as manual. */
  kind: Schema.optional(DynamicGroupKind),
  rules: Schema.optional(Schema.NullOr(DynamicGroupRules)),
  /**
   * Directory group whose membership drives this group. Restore re-links it
   * only when that directory group still exists in the tenant; older bundles
   * omit it and restore an unlinked group.
   */
  directoryGroupId: Schema.optional(NullableString),
  /** Device members are metadata only; devices themselves are never imported. */
  devices: Schema.optional(Schema.Array(TenantExportDeviceRef)),
  /**
   * Child groups this group nests. Inherited device rows are not exported;
   * restore re-derives them from these edges. Older bundles omit the field and
   * restore a flat group.
   */
  childGroupKeys: Schema.optional(Schema.Array(Schema.String)),
  /** Devices explicitly excluded from this group. */
  excludedDeviceKeys: Schema.optional(Schema.Array(Schema.String)),
  /** Directory people explicitly excluded, matched by email on restore. */
  excludedUserEmails: Schema.optional(Schema.Array(Schema.String)),
  policyKeys: Schema.Array(Schema.String),
});

/**
 * Per-device assignments. Devices are never created by a restore, so a bundle
 * carries the device key (and serial fallback) plus the policies and
 * applications that were assigned directly to it.
 */
export const TenantExportDeviceAssignment = Schema.Struct({
  deviceKey: Schema.String,
  deviceSerial: Schema.optional(NullableString),
  /** Directly included policies. */
  policyKeys: Schema.Array(Schema.String),
  /** Policies excluded from the device even when a group includes them. */
  excludedPolicyKeys: Schema.Array(Schema.String),
  applicationKeys: Schema.Array(Schema.String),
});

export type TenantExportDeviceAssignment = typeof TenantExportDeviceAssignment.Type;

export type TenantExportGroup = typeof TenantExportGroup.Type;

export const TenantExportPolicy = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  notes: Schema.optional(NullableString),
  /** Absent means enabled, so backups made before the flag restore enabled. */
  enabled: Schema.optional(Schema.Boolean),
  /** Configuration kind mapped to its stored JSON payload. */
  configurations: Schema.optional(JsonRecord),
  /** Non-default delivery scope per configuration kind. */
  configurationScopes: Schema.optional(Schema.Record(Schema.String, ConfigurationScope)),
});

export type TenantExportPolicy = typeof TenantExportPolicy.Type;

export const TenantExportInstaller = Schema.Struct({
  platform: ApplicationPlatform,
  source: ApplicationSource,
  bundleId: Schema.optional(NullableString),
  version: Schema.optional(NullableString),
  manifestUrl: Schema.optional(NullableString),
  storeId: Schema.optional(NullableString),
  fileName: Schema.optional(NullableString),
  contentType: Schema.optional(NullableString),
  size: Schema.optional(Schema.NullOr(Schema.Number)),
  sha256: Schema.optional(NullableString),
  r2Key: Schema.optional(NullableString),
  minOsVersion: Schema.optional(NullableString),
  requiredCapability: Schema.optional(NullableString),
  priority: Schema.optional(Schema.Number),
});

export type TenantExportInstaller = typeof TenantExportInstaller.Type;

export const TenantExportApplication = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  platform: ApplicationPlatform,
  bundleId: Schema.optional(NullableString),
  version: Schema.optional(NullableString),
  source: ApplicationSource,
  manifestUrl: Schema.optional(NullableString),
  storeId: Schema.optional(NullableString),
  fileName: Schema.optional(NullableString),
  contentType: Schema.optional(NullableString),
  size: Schema.optional(Schema.NullOr(Schema.Number)),
  sha256: Schema.optional(NullableString),
  /** Hint only. Object bytes are never part of a bundle. */
  r2Key: Schema.optional(NullableString),
  notes: Schema.optional(NullableString),
  /** Multi-installer catalogues; older bundles omit this and use the flat fields. */
  installers: Schema.optional(Schema.Array(TenantExportInstaller)),
  groupKeys: Schema.Array(Schema.String),
  /**
   * Directory user groups assigned this application. Directory groups are not
   * exported, so these are ids that restore only re-links when they still exist.
   */
  userGroupIds: Schema.optional(Schema.Array(Schema.String)),
});

export type TenantExportApplication = typeof TenantExportApplication.Type;

export const TenantExportEnrollment = Schema.Struct({
  code: Schema.optional(NullableString),
  enabledApple: Schema.Boolean,
  enabledWindows: Schema.Boolean,
  enabledAndroid: Schema.Boolean,
  enabledAssetTag: Schema.Boolean,
  maxDevices: Schema.Number,
});

export type TenantExportEnrollment = typeof TenantExportEnrollment.Type;

export const TenantExportPreRegistration = Schema.Struct({
  serial: Schema.String,
  name: Schema.optional(NullableString),
  assetTag: Schema.optional(NullableString),
  notes: Schema.optional(NullableString),
  groupKey: Schema.optional(NullableString),
  /** Set when the serial already enrolled; restore must not make it reusable. */
  consumedDeviceKey: Schema.optional(NullableString),
});

export type TenantExportPreRegistration = typeof TenantExportPreRegistration.Type;

/** SCEP-issued identity metadata. Private keys are never exported. */
export const TenantExportCertificate = Schema.Struct({
  serial: Schema.String,
  enrollmentId: Schema.optional(NullableString),
  deviceKey: Schema.optional(NullableString),
  notAfter: Schema.String,
  revokedAt: Schema.optional(NullableString),
  createdAt: Schema.String,
});

export type TenantExportCertificate = typeof TenantExportCertificate.Type;

export const TenantExportAuditEntry = Schema.Struct({
  action: Schema.String,
  targetType: Schema.String,
  targetId: Schema.optional(NullableString),
  actorEmail: Schema.optional(NullableString),
  metadata: Schema.optional(Schema.NullOr(Schema.Unknown)),
  createdAt: Schema.String,
});

export type TenantExportAuditEntry = typeof TenantExportAuditEntry.Type;

export const TenantExportUserAssignment = Schema.Struct({
  email: Schema.String,
  policyKeys: Schema.Array(Schema.String),
  excludedPolicyKeys: Schema.Array(Schema.String),
});

export type TenantExportUserAssignment = typeof TenantExportUserAssignment.Type;

/** A tenant directory person; restored so user assignments keep their target. */
export const TenantExportDirectoryUser = Schema.Struct({
  email: Schema.String,
  name: Schema.String,
  externalId: Schema.optional(NullableString),
  source: Schema.Literals(["manual", "entra", "scim"]),
  disabled: Schema.Boolean,
});

export type TenantExportDirectoryUser = typeof TenantExportDirectoryUser.Type;

export const TenantExportUserGroupAssignment = Schema.Struct({
  groupId: Schema.String,
  policyKeys: Schema.Array(Schema.String),
  excludedPolicyKeys: Schema.Array(Schema.String),
});

export type TenantExportUserGroupAssignment = typeof TenantExportUserGroupAssignment.Type;

export const TenantExportEnvelope = Schema.Struct({
  version: Schema.Literal(TENANT_EXPORT_VERSION),
  exportedAt: Schema.String,
  tenant: TenantExportProfile,
  members: Schema.Array(TenantExportMember),
  groups: Schema.Array(TenantExportGroup),
  policies: Schema.Array(TenantExportPolicy),
  applications: Schema.Array(TenantExportApplication),
  /** Direct device-to-policy/application assignments (restore only). */
  deviceAssignments: Schema.optional(Schema.Array(TenantExportDeviceAssignment)),
  /** Directory people referenced by user assignments. */
  directoryUsers: Schema.optional(Schema.Array(TenantExportDirectoryUser)),
  /** Policy assignments to directory users and user groups. */
  userAssignments: Schema.optional(Schema.Array(TenantExportUserAssignment)),
  userGroupAssignments: Schema.optional(Schema.Array(TenantExportUserGroupAssignment)),
  enrollment: Schema.optional(TenantExportEnrollment),
  preRegistrations: Schema.Array(TenantExportPreRegistration),
  scepCertificates: Schema.Array(TenantExportCertificate),
  auditLog: Schema.optional(Schema.Array(TenantExportAuditEntry)),
  auditTruncated: Schema.optional(Schema.Boolean),
});

export type TenantExportEnvelope = typeof TenantExportEnvelope.Type;

export const TenantExportQuery = Schema.Struct({
  /** `true`/`1` includes recent audit entries in the bundle (export-only). */
  includeAudit: Schema.optional(Schema.String),
});

export type TenantExportQuery = typeof TenantExportQuery.Type;

/** One scheduled or manual tenant backup attempt. */
export const BackupRunInfo = Schema.Struct({
  id: Schema.String,
  status: Schema.Literals(["running", "succeeded", "failed"]),
  trigger: Schema.Literals(["scheduled", "manual"]),
  retention: Schema.Literals(["default", "pinned"]),
  /** R2 object key. It is never a public URL; downloads go through the API. */
  r2Key: Schema.optional(NullableString),
  sizeBytes: Schema.optional(Schema.NullOr(Schema.Number)),
  startedAt: Schema.String,
  completedAt: Schema.optional(NullableString),
  /** Truncated, secret-free failure description. */
  error: Schema.optional(NullableString),
});

export type BackupRunInfo = typeof BackupRunInfo.Type;

export const TenantBackupsResponse = Schema.Struct({
  backups: Schema.Array(BackupRunInfo),
});

export type TenantBackupsResponse = typeof TenantBackupsResponse.Type;

/** Confirmation for an in-place restore: the operator retypes the tenant slug. */
export const BackupRestoreRequest = Schema.Struct({
  confirm: Schema.String,
});

export type BackupRestoreRequest = typeof BackupRestoreRequest.Type;

export const BackupRestoreResponse = Schema.Struct({
  backupId: Schema.String,
  /** Pinned snapshot taken immediately before the restore. */
  preRestoreBackupId: Schema.String,
  restoredAt: Schema.String,
  counts: Schema.Struct({
    groups: Schema.Number,
    policies: Schema.Number,
    applications: Schema.Number,
    preRegistrations: Schema.Number,
    /** Device group memberships re-linked to devices still in the tenant. */
    devices: Schema.Number,
    /** Device-level policy and application links restored. */
    deviceAssignments: Schema.Number,
  }),
  skipped: Schema.Struct({
    members: Schema.Number,
    devices: Schema.Number,
    /** Device-level links whose device no longer exists in the tenant. */
    deviceAssignments: Schema.Number,
    /** Directory links dropped because the directory group is gone or the group is dynamic. */
    directoryLinks: Schema.optional(Schema.Number),
    certificates: Schema.Number,
    auditLog: Schema.Number,
  }),
  applicationsWithoutFiles: Schema.Number,
});

export type BackupRestoreResponse = typeof BackupRestoreResponse.Type;

/** A device the teardown could not reach, reported back to the operator. */
export const TenantDeletionUnreachableDevice = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  platform: Schema.Literals(["apple", "win", "android"]),
  reason: Schema.String,
});

export type TenantDeletionUnreachableDevice = typeof TenantDeletionUnreachableDevice.Type;

/** What a completed tenant deletion actually reclaimed. */
export const DeleteTenantResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  reclaimed: Schema.Struct({
    devices: Schema.Number,
    /** Devices the platform accepted an unenroll request for. */
    contacted: Schema.Number,
    unreachableDevices: Schema.Array(TenantDeletionUnreachableDevice),
    objects: Schema.Number,
    subscription: Schema.Literals(["cancelled", "at_period_end", "none"]),
  }),
});

export type DeleteTenantResponse = typeof DeleteTenantResponse.Type;

/**
 * An imported bundle. Arrays are optional so a trimmed or hand-edited bundle
 * still validates; unsupported versions are rejected by the handler.
 */
export const TenantImportRequest = Schema.Struct({
  version: Schema.Number,
  exportedAt: Schema.optional(Schema.String),
  tenant: TenantExportProfile,
  members: Schema.optional(Schema.Array(TenantExportMember)),
  groups: Schema.optional(Schema.Array(TenantExportGroup)),
  policies: Schema.optional(Schema.Array(TenantExportPolicy)),
  applications: Schema.optional(Schema.Array(TenantExportApplication)),
  deviceAssignments: Schema.optional(Schema.Array(TenantExportDeviceAssignment)),
  directoryUsers: Schema.optional(Schema.Array(TenantExportDirectoryUser)),
  userAssignments: Schema.optional(Schema.Array(TenantExportUserAssignment)),
  userGroupAssignments: Schema.optional(Schema.Array(TenantExportUserGroupAssignment)),
  enrollment: Schema.optional(TenantExportEnrollment),
  preRegistrations: Schema.optional(Schema.Array(TenantExportPreRegistration)),
  scepCertificates: Schema.optional(Schema.Array(TenantExportCertificate)),
  auditLog: Schema.optional(Schema.Array(TenantExportAuditEntry)),
  auditTruncated: Schema.optional(Schema.Boolean),
});

export type TenantImportRequest = typeof TenantImportRequest.Type;

export const TenantImportCounts = Schema.Struct({
  groups: Schema.Number,
  policies: Schema.Number,
  applications: Schema.Number,
  preRegistrations: Schema.Number,
});

export type TenantImportCounts = typeof TenantImportCounts.Type;

export const TenantImportSkipped = Schema.Struct({
  members: Schema.Number,
  devices: Schema.Number,
  certificates: Schema.Number,
  auditLog: Schema.Number,
});

export type TenantImportSkipped = typeof TenantImportSkipped.Type;

export const TenantImportResponse = Schema.Struct({
  tenantId: Schema.String,
  slug: Schema.String,
  counts: TenantImportCounts,
  skipped: TenantImportSkipped,
  /** Uploaded applications whose object bytes are not part of a bundle. */
  applicationsWithoutFiles: Schema.Number,
});

export type TenantImportResponse = typeof TenantImportResponse.Type;

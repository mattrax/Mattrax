import { Effect } from "effect";
import { and, desc, eq, inArray } from "drizzle-orm";
import { schema } from "@mattrax/enterprise-core";
import {
  TENANT_EXPORT_MAX_ROWS,
  TENANT_EXPORT_VERSION,
  type TenantExportApplication,
  type TenantExportAuditEntry,
  type TenantExportCertificate,
  type TenantExportEnvelope,
  type TenantExportEnrollment,
  type TenantExportGroup,
  type TenantExportMember,
  type TenantExportPolicy,
  type TenantExportPreRegistration,
  type TenantExportProfile,
} from "@mattrax/enterprise-domain";
import type {
  EnterpriseApplication,
  EnterpriseDb,
  EnterpriseGroup,
  EnterpriseOrganization,
  EnterprisePolicy,
} from "./schema.ts";

export type TenantExportBundle = {
  readonly body: string;
  readonly filename: string;
  readonly version: number;
  readonly counts: {
    readonly members: number;
    readonly groups: number;
    readonly policies: number;
    readonly applications: number;
    readonly preRegistrations: number;
    readonly certificates: number;
  };
  readonly bundle: TenantExportEnvelope;
};

const iso = (date: Date | number | null | undefined) => {
  if (date == null) return new Date(0).toISOString();
  return (date instanceof Date ? date : new Date(date)).toISOString();
};

/** Filesystem-safe tenant name for the download `Content-Disposition`. */
const safeFilename = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "tenant";

/**
 * `organization.metadata` is stored as JSON text. A malformed historical value
 * must not make the rest of a bundle unexportable.
 */
const exportMetadata = (value: string | null | undefined): Record<string, unknown> | null => {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

/**
 * Build the versioned tenant bundle shared by the download endpoint and the
 * scheduled/manual backup job. The shape is deliberately unchanged from the
 * original HTTP handler; `now` and `includeAudit` are the only knobs.
 */
export const buildTenantExport = (
  db: EnterpriseDb,
  organization: EnterpriseOrganization,
  options: { readonly includeAudit?: boolean; readonly now?: Date } = {},
): Effect.Effect<TenantExportBundle, unknown> =>
  Effect.gen(function* () {
    const organizationId = organization.id;
    const members = (yield* db
      .select()
      .from(schema.member)
      .where(eq(schema.member.organizationId, organizationId))) as Array<{
      userId: string;
      role: string;
      createdAt: Date;
    }>;
    const userIds = [...new Set(members.map((member) => member.userId))];
    const users = userIds.length
      ? ((yield* db
          .select({ id: schema.user.id, name: schema.user.name, email: schema.user.email })
          .from(schema.user)
          .where(inArray(schema.user.id, userIds))) as Array<{
          id: string;
          name: string;
          email: string;
        }>)
      : [];
    const usersById = new Map(users.map((user) => [user.id, user]));

    const groups = (yield* db
      .select()
      .from(schema.enterpriseGroup)
      .where(eq(schema.enterpriseGroup.organizationId, organizationId))) as Array<EnterpriseGroup>;
    const groupIds = groups.map((group) => group.id);
    const policies = (yield* db
      .select()
      .from(schema.policy)
      .where(eq(schema.policy.organizationId, organizationId))) as Array<EnterprisePolicy>;
    const policyIds = policies.map((policy) => policy.id);
    const applications = (yield* db
      .select()
      .from(schema.application)
      .where(
        eq(schema.application.organizationId, organizationId),
      )) as Array<EnterpriseApplication>;
    const applicationIds = applications.map((application) => application.id);

    const groupDevices = groupIds.length
      ? ((yield* db
          .select()
          .from(schema.groupDevice)
          .where(inArray(schema.groupDevice.groupId, groupIds))) as Array<{
          groupId: string;
          deviceId: string;
        }>)
      : [];
    const deviceIds = [...new Set(groupDevices.map((link) => link.deviceId))];
    const devices = deviceIds.length
      ? ((yield* db
          .select({
            id: schema.device.id,
            name: schema.device.name,
            serial: schema.device.serial,
          })
          .from(schema.device)
          .where(
            and(
              eq(schema.device.organizationId, organizationId),
              inArray(schema.device.id, deviceIds),
            ),
          )) as Array<{ id: string; name: string; serial: string | null }>)
      : [];
    const devicesById = new Map(devices.map((device) => [device.id, device]));

    const groupPolicies = groupIds.length
      ? ((yield* db
          .select()
          .from(schema.groupPolicy)
          .where(inArray(schema.groupPolicy.groupId, groupIds))) as Array<{
          groupId: string;
          policyId: string;
        }>)
      : [];
    const policyKeys = new Set(policyIds);
    const groupPolicyKeys = new Map<string, string[]>();
    for (const link of groupPolicies) {
      if (!policyKeys.has(link.policyId)) continue;
      groupPolicyKeys.set(link.groupId, [
        ...(groupPolicyKeys.get(link.groupId) ?? []),
        link.policyId,
      ]);
    }

    const configurations = policyIds.length
      ? ((yield* db
          .select()
          .from(schema.configuration)
          .where(inArray(schema.configuration.policyId, policyIds))) as Array<{
          policyId: string;
          kind: string;
          data: unknown;
        }>)
      : [];
    const policyConfigurations = new Map<string, Record<string, unknown>>();
    for (const configuration of configurations) {
      const current = policyConfigurations.get(configuration.policyId) ?? {};
      current[configuration.kind] = configuration.data;
      policyConfigurations.set(configuration.policyId, current);
    }

    const applicationGroups = applicationIds.length
      ? ((yield* db
          .select()
          .from(schema.applicationGroup)
          .where(inArray(schema.applicationGroup.applicationId, applicationIds))) as Array<{
          applicationId: string;
          groupId: string;
        }>)
      : [];
    const groupKeys = new Set(groupIds);
    const applicationGroupKeys = new Map<string, string[]>();
    for (const link of applicationGroups) {
      if (!groupKeys.has(link.groupId)) continue;
      applicationGroupKeys.set(link.applicationId, [
        ...(applicationGroupKeys.get(link.applicationId) ?? []),
        link.groupId,
      ]);
    }

    const enrollment = yield* db.query.enterpriseEnrollment.findFirst({
      where: { organizationId },
    });
    const preRegistrations = (yield* db
      .select()
      .from(schema.devicePreRegistration)
      .where(eq(schema.devicePreRegistration.organizationId, organizationId))) as Array<{
      serial: string;
      name: string | null;
      assetTag: string | null;
      notes: string | null;
      groupId: string | null;
    }>;
    const certificates = (yield* db
      .select()
      .from(schema.scepIssuedCertificate)
      .where(eq(schema.scepIssuedCertificate.organizationId, organizationId))) as Array<{
      serial: string;
      enrollmentId: string | null;
      deviceId: string | null;
      notAfter: Date;
      revokedAt: Date | null;
      createdAt: Date;
    }>;

    let auditLog: TenantExportAuditEntry[] | undefined;
    let auditTruncated: boolean | undefined;
    if (options.includeAudit) {
      const rows = (yield* db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.organizationId, organizationId))
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(TENANT_EXPORT_MAX_ROWS + 1)) as Array<{
        action: string;
        targetType: string;
        targetId: string | null;
        actorEmail: string | null;
        metadata: unknown;
        createdAt: Date;
      }>;
      auditTruncated = rows.length > TENANT_EXPORT_MAX_ROWS;
      auditLog = rows.slice(0, TENANT_EXPORT_MAX_ROWS).map((entry) => ({
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        actorEmail: entry.actorEmail,
        metadata: entry.metadata,
        createdAt: iso(entry.createdAt),
      }));
    }

    const profile: TenantExportProfile = {
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo ?? null,
      displayName: organization.displayName ?? null,
      supportEmail: organization.supportEmail ?? null,
      brandColor: organization.brandColor ?? null,
      metadata: exportMetadata(organization.metadata),
    };
    const exportedMembers: TenantExportMember[] = members.flatMap((member) => {
      const user = usersById.get(member.userId);
      if (!user) return [];
      return [
        {
          email: user.email,
          name: user.name,
          role: member.role,
          createdAt: iso(member.createdAt),
        },
      ];
    });
    const exportedGroups: TenantExportGroup[] = groups.map((group) => ({
      key: group.id,
      name: group.name,
      notes: group.notes,
      devices: groupDevices.flatMap((link) => {
        if (link.groupId !== group.id) return [];
        const device = devicesById.get(link.deviceId);
        if (!device) return [];
        return [{ key: device.id, name: device.name, serial: device.serial }];
      }),
      policyKeys: groupPolicyKeys.get(group.id) ?? [],
    }));
    const exportedPolicies: TenantExportPolicy[] = policies.map((policy) => ({
      key: policy.id,
      name: policy.name,
      notes: policy.notes,
      configurations: policyConfigurations.get(policy.id) ?? {},
    }));
    const exportedApplications: TenantExportApplication[] = applications.map((application) => ({
      key: application.id,
      name: application.name,
      platform: application.platform,
      bundleId: application.bundleId,
      version: application.version,
      source: application.source,
      manifestUrl: application.manifestUrl,
      storeId: application.storeId,
      fileName: application.fileName,
      contentType: application.contentType,
      size: application.size,
      sha256: application.sha256,
      r2Key: application.r2Key,
      notes: application.notes,
      groupKeys: applicationGroupKeys.get(application.id) ?? [],
    }));
    const exportedEnrollment: TenantExportEnrollment | undefined = enrollment
      ? {
          code: enrollment.code,
          enabledApple: enrollment.enabledApple ?? true,
          enabledWindows: enrollment.enabledWindows ?? true,
          enabledAndroid: enrollment.enabledAndroid ?? false,
          enabledAssetTag: enrollment.enabledAssetTag ?? false,
          maxDevices: enrollment.maxDevices ?? 100,
        }
      : undefined;
    const exportedPreRegistrations: TenantExportPreRegistration[] = preRegistrations.map((row) => ({
      serial: row.serial,
      name: row.name,
      assetTag: row.assetTag,
      notes: row.notes,
      groupKey: row.groupId && groupKeys.has(row.groupId) ? row.groupId : null,
    }));
    const exportedCertificates: TenantExportCertificate[] = certificates.map((row) => ({
      serial: row.serial,
      enrollmentId: row.enrollmentId,
      deviceKey: row.deviceId && devicesById.has(row.deviceId) ? row.deviceId : null,
      notAfter: iso(row.notAfter),
      revokedAt: row.revokedAt ? iso(row.revokedAt) : null,
      createdAt: iso(row.createdAt),
    }));

    const exportedAt = options.now ?? new Date();
    const bundle: TenantExportEnvelope = {
      version: TENANT_EXPORT_VERSION,
      exportedAt: exportedAt.toISOString(),
      tenant: profile,
      members: exportedMembers,
      groups: exportedGroups,
      policies: exportedPolicies,
      applications: exportedApplications,
      ...(exportedEnrollment ? { enrollment: exportedEnrollment } : {}),
      preRegistrations: exportedPreRegistrations,
      scepCertificates: exportedCertificates,
      ...(auditLog ? { auditLog } : {}),
      ...(auditTruncated !== undefined ? { auditTruncated } : {}),
    };
    return {
      body: JSON.stringify(bundle, null, 2),
      filename: `tenant-${safeFilename(organization.slug)}-${exportedAt
        .toISOString()
        .slice(0, 10)}.json`,
      version: TENANT_EXPORT_VERSION,
      counts: {
        members: exportedMembers.length,
        groups: exportedGroups.length,
        policies: exportedPolicies.length,
        applications: exportedApplications.length,
        preRegistrations: exportedPreRegistrations.length,
        certificates: exportedCertificates.length,
      },
      bundle,
    };
  });

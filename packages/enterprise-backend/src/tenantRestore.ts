import { Data, Effect, Option, Schema } from "effect";
import { eq, inArray } from "drizzle-orm";
import {
  TENANT_EXPORT_MAX_ROWS,
  TENANT_EXPORT_VERSION,
  TENANT_IMPORT_MAX_BYTES,
  TenantImportRequest,
  validateTenantBranding,
  type TenantExportGroup,
} from "@mattrax/enterprise-domain";
import { validateConfiguration } from "@mattrax/management-backend-enterprise";
import { schema } from "@mattrax/enterprise-core";
import {
  readTenantBackup,
  runTenantBackup,
  type BackupActionError,
  type BackupActor,
} from "./backup.ts";
import type { EnterpriseDb, EnterpriseOrganization } from "./schema.ts";

/** Restore obeys the same bundle size limit as a fresh import. */
export const TENANT_RESTORE_MAX_BYTES = TENANT_IMPORT_MAX_BYTES;

export class TenantRestoreError extends Data.TaggedError("TenantRestoreError")<{
  readonly reason: "invalid_bundle" | "snapshot_failed" | "write_failed";
  readonly message: string;
}> {}

export type TenantRestoreResult = {
  readonly backupId: string;
  /** Pinned snapshot taken immediately before the restore, for rollback. */
  readonly preRestoreBackupId: string;
  readonly restoredAt: string;
  readonly counts: {
    readonly groups: number;
    readonly policies: number;
    readonly applications: number;
    readonly preRegistrations: number;
    /** Device group memberships re-linked to devices still in the tenant. */
    readonly devices: number;
    /** Device-level policy and application links restored. */
    readonly deviceAssignments: number;
  };
  readonly skipped: {
    readonly members: number;
    readonly devices: number;
    /** Device-level links whose device no longer exists in the tenant. */
    readonly deviceAssignments: number;
    readonly certificates: number;
    readonly auditLog: number;
  };
  /** Uploaded applications whose object bytes could not be re-linked. */
  readonly applicationsWithoutFiles: number;
};

type ParsedBundle = {
  name: string;
  branding: {
    displayName: string | null;
    logo: string | null;
    supportEmail: string | null;
    brandColor: string | null;
  };
  metadata: string | null;
  enrollment?: {
    code: string | null;
    enabledApple?: boolean;
    enabledWindows?: boolean;
    enabledAndroid?: boolean;
    enabledAssetTag?: boolean;
    maxDevices?: number;
  };
  policies: ReadonlyArray<{
    key: string;
    name: string;
    notes: string | null;
    configurations: ReadonlyArray<readonly [string, Schema.Json]>;
  }>;
  groups: ReadonlyArray<TenantExportGroup>;
  applications: ReadonlyArray<{
    key: string;
    name: string;
    platform: "apple" | "win" | "android";
    bundleId: string | null;
    version: string | null;
    source: "manifest" | "store" | "upload";
    manifestUrl: string | null;
    storeId: string | null;
    fileName: string | null;
    contentType: string | null;
    size: number | null;
    sha256: string | null;
    r2Key: string | null;
    notes: string | null;
    groupKeys: ReadonlyArray<string>;
  }>;
  deviceAssignments: ReadonlyArray<{
    deviceKey: string;
    deviceSerial: string | null;
    policyKeys: ReadonlyArray<string>;
    excludedPolicyKeys: ReadonlyArray<string>;
    applicationKeys: ReadonlyArray<string>;
  }>;
  preRegistrations: ReadonlyArray<{
    serial: string;
    name: string | null;
    assetTag: string | null;
    notes: string | null;
    groupKey: string | null;
  }>;
  members: number;
  certificates: number;
  auditLog: number;
};

const invalid = (message: string) => new TenantRestoreError({ reason: "invalid_bundle", message });

const text = (value: string | null | undefined, max: number): string | null => {
  const trimmed = value?.trim();

  if (!trimmed) return null;

  if (trimmed.length > max) throw invalid(`A value is longer than ${max} characters`);

  return trimmed;
};

/**
 * Decode and validate a bundle for an in-place restore. Unlike import, ids are
 * remapped but device group memberships are re-linked by the exported device
 * key (and serial fallback) because those devices still exist in this tenant.
 */
export const parseTenantRestoreBundle = (
  text_: string,
): Effect.Effect<ParsedBundle, TenantRestoreError, never> =>
  Effect.gen(function* () {
    if (new TextEncoder().encode(text_).byteLength > TENANT_RESTORE_MAX_BYTES)
      return yield* Effect.fail(
        invalid(
          `The backup is larger than the ${Math.floor(TENANT_RESTORE_MAX_BYTES / 1024 / 1024)} MB restore limit`,
        ),
      );

    const raw = yield* Effect.try({
      // SAFETY: JSON.parse returns the untyped JSON grammar; the schema
      // decode immediately below validates every field before use.
      try: (): Schema.Json => JSON.parse(text_) as Schema.Json,
      catch: () => invalid("The backup is not valid JSON"),
    });

    const bundle = yield* Schema.decodeUnknownEffect(TenantImportRequest)(raw).pipe(
      Effect.mapError((error) =>
        invalid(`The backup does not match the bundle format: ${error.message}`),
      ),
    );

    if (bundle.version !== TENANT_EXPORT_VERSION)
      return yield* Effect.fail(
        invalid(
          `Unsupported backup version ${String(bundle.version)}. This server restores version ${TENANT_EXPORT_VERSION}.`,
        ),
      );

    const profile = bundle.tenant;
    const name = text(profile.name, 255);

    if (!name) return yield* Effect.fail(invalid("The backup tenant name is required"));

    const brandingErrors = validateTenantBranding(profile);
    const brandingError = Object.values(brandingErrors)[0];

    if (brandingError) return yield* Effect.fail(invalid(brandingError));

    const metadata = profile.metadata ? JSON.stringify(profile.metadata) : null;

    if (metadata && metadata.length > 60_000)
      return yield* Effect.fail(
        invalid("The tenant metadata is too large (limit 60000 characters)"),
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
          invalid(`The backup contains too many ${label} (limit ${TENANT_EXPORT_MAX_ROWS})`),
        );
    }

    const groupKeys = new Set<string>();

    for (const group of groups) {
      const key = text(group.key, 255);

      if (!key) return yield* Effect.fail(invalid("Every group needs a key"));

      if (groupKeys.has(key)) return yield* Effect.fail(invalid(`Duplicate group key "${key}"`));
      groupKeys.add(key);

      if (!text(group.name, 255)) return yield* Effect.fail(invalid(`Group "${key}" needs a name`));

      if (!Array.isArray(group.policyKeys))
        return yield* Effect.fail(
          invalid(`Group "${group.name}" must list its policy assignments`),
        );
    }

    const policyKeys = new Set<string>();
    const parsedPolicies: Array<ParsedBundle["policies"][number]> = [];

    for (const policy of policies) {
      const key = text(policy.key, 255);

      if (!key) return yield* Effect.fail(invalid("Every policy needs a key"));

      if (policyKeys.has(key)) return yield* Effect.fail(invalid(`Duplicate policy key "${key}"`));
      policyKeys.add(key);

      const policyName = text(policy.name, 255);

      if (!policyName) return yield* Effect.fail(invalid(`Policy "${key}" needs a name`));

      const configurations = policy.configurations ?? {};

      if (!Schema.is(Schema.JsonObject)(configurations))
        return yield* Effect.fail(invalid(`Policy "${policyName}" has invalid configuration data`));

      const entries: Array<readonly [string, Schema.Json]> = [];

      for (const [kind, data] of Object.entries(configurations)) {
        if (data === null || data === undefined)
          return yield* Effect.fail(
            invalid(`Policy "${policyName}" has an empty "${kind}" configuration`),
          );

        const configuration = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(data));

        if (configuration === undefined)
          return yield* Effect.fail(
            invalid(`Policy "${policyName}" has invalid configuration data`),
          );

        yield* validateConfiguration(kind, configuration).pipe(
          Effect.mapError((message) => invalid(`Policy "${policyName}": ${message}`)),
        );
        entries.push([kind, configuration]);
      }

      parsedPolicies.push({
        key,
        name: policyName,
        notes: text(policy.notes, 10_000),
        configurations: entries,
      });
    }

    for (const group of groups)
      for (const policyKey of group.policyKeys)
        if (!policyKeys.has(policyKey))
          return yield* Effect.fail(
            invalid(
              `Group "${group.name}" references policy "${policyKey}", which is not in this backup`,
            ),
          );

    const applicationKeys = new Set<string>();

    for (const application of applications) {
      const key = text(application.key, 255);

      if (!key) return yield* Effect.fail(invalid("Every application needs a key"));

      if (applicationKeys.has(key))
        return yield* Effect.fail(invalid(`Duplicate application key "${key}"`));
      applicationKeys.add(key);

      const applicationName = text(application.name, 255);

      if (!applicationName) return yield* Effect.fail(invalid(`Application "${key}" needs a name`));

      if (
        application.platform === "apple" &&
        application.source === "manifest" &&
        !application.manifestUrl?.trim()
      )
        return yield* Effect.fail(
          invalid(`Apple manifest application "${applicationName}" requires a manifest URL`),
        );

      if (application.source === "store" && !Number.isSafeInteger(Number(application.storeId)))
        return yield* Effect.fail(
          invalid(`Application "${applicationName}" must have a whole-number store ID`),
        );

      for (const groupKey of application.groupKeys ?? [])
        if (!groupKeys.has(groupKey))
          return yield* Effect.fail(
            invalid(
              `Application "${applicationName}" references group "${groupKey}", which is not in this backup`,
            ),
          );
    }

    const deviceAssignments = bundle.deviceAssignments ?? [];

    if (deviceAssignments.length > TENANT_EXPORT_MAX_ROWS)
      return yield* Effect.fail(
        invalid(
          `The backup contains too many device assignments (limit ${TENANT_EXPORT_MAX_ROWS})`,
        ),
      );

    const assignmentDeviceKeys = new Set<string>();
    const parsedDeviceAssignments: Array<ParsedBundle["deviceAssignments"][number]> = [];

    for (const assignment of deviceAssignments) {
      const deviceKey = text(assignment.deviceKey, 255);

      if (!deviceKey)
        return yield* Effect.fail(invalid("Every device assignment needs a device key"));

      if (assignmentDeviceKeys.has(deviceKey))
        return yield* Effect.fail(invalid(`Duplicate device assignment "${deviceKey}"`));
      assignmentDeviceKeys.add(deviceKey);

      const excluded = new Set(assignment.excludedPolicyKeys);

      for (const policyKey of assignment.policyKeys) {
        if (!policyKeys.has(policyKey))
          return yield* Effect.fail(
            invalid(
              `Device assignment "${deviceKey}" references policy "${policyKey}", which is not in this backup`,
            ),
          );

        if (excluded.has(policyKey))
          return yield* Effect.fail(
            invalid(`Device assignment "${deviceKey}" includes and excludes policy "${policyKey}"`),
          );
      }

      for (const policyKey of assignment.excludedPolicyKeys)
        if (!policyKeys.has(policyKey))
          return yield* Effect.fail(
            invalid(
              `Device assignment "${deviceKey}" references policy "${policyKey}", which is not in this backup`,
            ),
          );

      for (const applicationKey of assignment.applicationKeys)
        if (!applicationKeys.has(applicationKey))
          return yield* Effect.fail(
            invalid(
              `Device assignment "${deviceKey}" references application "${applicationKey}", which is not in this backup`,
            ),
          );

      parsedDeviceAssignments.push({
        deviceKey,
        deviceSerial: text(assignment.deviceSerial, 255),
        policyKeys: [...new Set(assignment.policyKeys)],
        excludedPolicyKeys: [...new Set(assignment.excludedPolicyKeys)],
        applicationKeys: [...new Set(assignment.applicationKeys)],
      });
    }

    const serials = new Set<string>();

    for (const row of preRegistrations) {
      const serial = text(row.serial, 255);

      if (!serial) return yield* Effect.fail(invalid("Every pre-registration needs a serial"));

      if (serials.has(serial.toLowerCase()))
        return yield* Effect.fail(invalid(`Duplicate pre-registration serial "${serial}"`));
      serials.add(serial.toLowerCase());

      if (row.groupKey && !groupKeys.has(row.groupKey))
        return yield* Effect.fail(
          invalid(
            `Pre-registration "${serial}" references group "${row.groupKey}", which is not in this backup`,
          ),
        );
    }

    const enrollment = bundle.enrollment;

    if (
      enrollment?.maxDevices !== undefined &&
      (!Number.isSafeInteger(enrollment.maxDevices) ||
        enrollment.maxDevices < 0 ||
        enrollment.maxDevices > 1_000_000)
    )
      return yield* Effect.fail(
        invalid("The enrollment device limit must be a whole number between 0 and 1000000"),
      );

    if (enrollment?.code != null && enrollment.code.length > 255)
      return yield* Effect.fail(invalid("The enrollment code must be 255 characters or fewer"));

    const parsed: ParsedBundle = {
      name,
      branding: {
        displayName: text(profile.displayName, 255),
        logo: text(profile.logo, 500_000),
        supportEmail: text(profile.supportEmail, 320),
        brandColor: text(profile.brandColor, 7),
      },
      metadata,
      policies: parsedPolicies,
      groups,
      applications: applications.map((application) => ({
        // SAFETY: the schema decode above guarantees these strings exist and
        // the validation loop rejected empty keys and names.
        key: text(application.key, 255)!,
        name: text(application.name, 255)!,
        platform: application.platform,
        bundleId: text(application.bundleId, 255),
        version: text(application.version, 255),
        source: application.source,
        manifestUrl: application.manifestUrl ?? null,
        storeId: text(application.storeId, 255),
        fileName: text(application.fileName, 255),
        contentType: text(application.contentType, 255),
        size: application.size ?? null,
        sha256: text(application.sha256, 255),
        r2Key: application.r2Key ?? null,
        notes: text(application.notes, 10_000),
        groupKeys: application.groupKeys ?? [],
      })),
      preRegistrations: preRegistrations.map((row) => ({
        // SAFETY: the validation loop above rejected pre-registrations without
        // a usable serial.
        serial: text(row.serial, 255)!,
        name: text(row.name, 255),
        assetTag: text(row.assetTag, 255),
        notes: text(row.notes, 10_000),
        groupKey: row.groupKey ?? null,
      })),
      deviceAssignments: parsedDeviceAssignments,
      members: bundle.members?.length ?? 0,
      certificates: bundle.scepCertificates?.length ?? 0,
      auditLog: bundle.auditLog?.length ?? 0,
    };

    if (enrollment)
      parsed.enrollment = {
        code: enrollment.code?.trim() || null,
        enabledApple: enrollment.enabledApple,
        enabledWindows: enrollment.enabledWindows,
        enabledAndroid: enrollment.enabledAndroid,
        enabledAssetTag: enrollment.enabledAssetTag,
        maxDevices: enrollment.maxDevices,
      };

    return parsed;
  }).pipe(
    // `text()` bounds string fields by throwing; turn only that validation
    // failure into a typed error so unexpected defects still surface.
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Effect defects are untyped by contract.
    Effect.catchDefect((defect) =>
      defect instanceof TenantRestoreError ? Effect.fail(defect) : Effect.die(defect),
    ),
  );

const newId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

const hashJson = (value: Schema.Json) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))),
  ).pipe(
    Effect.map((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    ),
  );

/**
 * Replace this tenant's configuration with a backup's, keeping members,
 * devices, certificates and audit history. The existing `policy`, group,
 * application and pre-registration rows are removed first, inside the same
 * transaction as the inserts, so a failure leaves the previous configuration
 * untouched.
 *
 * Device group membership is re-linked when the exported device key (or its
 * serial) still exists in the tenant, and direct device-level policy/application
 * assignments are restored the same way. Uploaded application objects are also
 * reused: they live under this tenant's `a/<tenant>/` prefix and were not
 * touched by the restore.
 */
const applyBundle = (
  db: EnterpriseDb,
  organization: EnterpriseOrganization,
  bundle: ParsedBundle,
  actor: BackupActor,
  timestamp: Date,
): Effect.Effect<
  {
    counts: TenantRestoreResult["counts"];
    skippedDevices: number;
    /** Device-level assignment rows whose device no longer exists. */
    skippedDeviceAssignments: number;
    applicationsWithoutFiles: number;
  },
  unknown,
  never
> =>
  Effect.gen(function* () {
    const existingDevices = yield* db
      .select({ id: schema.device.id, serial: schema.device.serial })
      .from(schema.device)
      .where(eq(schema.device.organizationId, organization.id));

    const deviceIds = new Set(existingDevices.map((device) => device.id));

    const serials = new Map(
      existingDevices.flatMap((device) =>
        device.serial ? [[device.serial.toLowerCase(), device.id] as const] : [],
      ),
    );

    /**
     * Resolve an exported device to a device that still exists. The stable id
     * is authoritative; the serial is the fallback for a bundle captured before
     * the device was re-enrolled (which mints a new id).
     */
    const resolveDevice = (key: string, serial: string | null | undefined) =>
      (deviceIds.has(key) ? key : undefined) ??
      (serial ? serials.get(serial.toLowerCase()) : undefined);

    const enrollment = yield* db.query.enterpriseEnrollment.findFirst({
      where: { organizationId: organization.id },
    });

    const existingPolicies = yield* db
      .select({ id: schema.policy.id })
      .from(schema.policy)
      .where(eq(schema.policy.organizationId, organization.id));

    const existingGroups = yield* db
      .select({ id: schema.enterpriseGroup.id })
      .from(schema.enterpriseGroup)
      .where(eq(schema.enterpriseGroup.organizationId, organization.id));

    const existingApplications = yield* db
      .select({ id: schema.application.id })
      .from(schema.application)
      .where(eq(schema.application.organizationId, organization.id));

    const policyIds = existingPolicies.map((row) => row.id);
    const groupIds = existingGroups.map((row) => row.id);
    const applicationIds = existingApplications.map((row) => row.id);

    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        // Children first. Production cascades these from the parent rows, but
        // deleting explicitly keeps the order visible and measurable in tests.
        yield* tx
          .delete(schema.devicePreRegistration)
          .where(eq(schema.devicePreRegistration.organizationId, organization.id));

        if (applicationIds.length > 0) {
          yield* tx
            .delete(schema.applicationGroup)
            .where(inArray(schema.applicationGroup.applicationId, applicationIds));
          yield* tx
            .delete(schema.applicationDevice)
            .where(inArray(schema.applicationDevice.applicationId, applicationIds));
        }

        if (groupIds.length > 0) {
          yield* tx.delete(schema.groupPolicy).where(inArray(schema.groupPolicy.groupId, groupIds));
          yield* tx.delete(schema.groupDevice).where(inArray(schema.groupDevice.groupId, groupIds));
        }

        if (policyIds.length > 0) {
          yield* tx
            .delete(schema.configuration)
            .where(inArray(schema.configuration.policyId, policyIds));
          yield* tx
            .delete(schema.policyDeployment)
            .where(inArray(schema.policyDeployment.policyId, policyIds));
          yield* tx
            .delete(schema.devicePolicy)
            .where(inArray(schema.devicePolicy.policyId, policyIds));
        }

        yield* tx
          .delete(schema.application)
          .where(eq(schema.application.organizationId, organization.id));
        yield* tx
          .delete(schema.enterpriseGroup)
          .where(eq(schema.enterpriseGroup.organizationId, organization.id));
        yield* tx.delete(schema.policy).where(eq(schema.policy.organizationId, organization.id));

        const policyIdByKey = new Map<string, string>();

        for (const policy of bundle.policies) {
          const policyId = newId();
          policyIdByKey.set(policy.key, policyId);
          yield* tx.insert(schema.policy).values({
            id: policyId,
            organizationId: organization.id,
            name: policy.name,
            notes: policy.notes,
            createdAt: timestamp,
            updatedAt: timestamp,
          });

          if (policy.configurations.length > 0) {
            const values = yield* Effect.all(
              policy.configurations.map(([kind, data]) =>
                Effect.map(hashJson(data), (hash) => ({ policyId, kind, data, hash })),
              ),
            );

            yield* tx.insert(schema.configuration).values(values);
          }

          yield* tx.insert(schema.policyDeployment).values({
            id: newId(),
            organizationId: organization.id,
            policyId,
            version: 1,
            snapshot: Object.fromEntries(policy.configurations),
            createdByUserId: actor.userId,
            createdAt: timestamp,
          });
        }

        const groupIdByKey = new Map<string, string>();

        for (const group of bundle.groups) {
          const groupId = newId();
          groupIdByKey.set(group.key, groupId);
          yield* tx.insert(schema.enterpriseGroup).values({
            id: groupId,
            organizationId: organization.id,
            name: text(group.name, 255)!,
            notes: text(group.notes, 10_000),
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }

        const groupPolicyValues: Array<{ groupId: string; policyId: string }> = [];

        for (const group of bundle.groups) {
          const groupId = groupIdByKey.get(group.key)!;

          for (const policyKey of group.policyKeys) {
            const policyId = policyIdByKey.get(policyKey);

            if (policyId) groupPolicyValues.push({ groupId, policyId });
          }
        }

        if (groupPolicyValues.length > 0)
          yield* tx.insert(schema.groupPolicy).ignore().values(groupPolicyValues);

        let skippedDevices = 0;
        const groupDeviceValues: Array<{ groupId: string; deviceId: string }> = [];
        const seenMemberships = new Set<string>();

        for (const group of bundle.groups) {
          const groupId = groupIdByKey.get(group.key)!;

          for (const device of group.devices ?? []) {
            const deviceId = resolveDevice(device.key, device.serial);

            if (!deviceId) {
              skippedDevices++;
              continue;
            }

            const membership = `${groupId}:${deviceId}`;

            if (seenMemberships.has(membership)) continue;
            seenMemberships.add(membership);
            groupDeviceValues.push({ groupId, deviceId });
          }
        }

        if (groupDeviceValues.length > 0)
          yield* tx.insert(schema.groupDevice).ignore().values(groupDeviceValues);

        const applicationIdByKey = new Map<string, string>();
        let applicationsWithoutFiles = 0;

        for (const application of bundle.applications) {
          const applicationId = newId();
          applicationIdByKey.set(application.key, applicationId);
          yield* tx.insert(schema.application).values({
            id: applicationId,
            organizationId: organization.id,
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
            // Same tenant, so the object under `a/<tenant>/` still exists.
            r2Key: application.r2Key,
            notes: application.notes,
            createdAt: timestamp,
            updatedAt: timestamp,
          });

          if (application.source === "upload" && !application.r2Key) applicationsWithoutFiles++;
        }

        const applicationGroupValues: Array<{ groupId: string; applicationId: string }> = [];

        for (const application of bundle.applications) {
          const applicationId = applicationIdByKey.get(application.key)!;

          for (const groupKey of application.groupKeys) {
            const groupId = groupIdByKey.get(groupKey);

            if (groupId) applicationGroupValues.push({ groupId, applicationId });
          }
        }

        if (applicationGroupValues.length > 0)
          yield* tx.insert(schema.applicationGroup).ignore().values(applicationGroupValues);

        // Device-level assignments are part of the configuration, not the
        // device: the device itself survives a restore. A bundle entry whose
        // device has since been deleted is skipped and reported rather than
        // failing the whole restore.
        let skippedDeviceAssignments = 0;
        const devicePolicyValues: Array<{
          deviceId: string;
          policyId: string;
          mode: "include" | "exclude";
        }> = [];
        const applicationDeviceValues: Array<{ deviceId: string; applicationId: string }> = [];

        for (const assignment of bundle.deviceAssignments) {
          const deviceId = resolveDevice(assignment.deviceKey, assignment.deviceSerial);

          if (!deviceId) {
            skippedDeviceAssignments++;
            continue;
          }

          for (const policyKey of assignment.policyKeys)
            // SAFETY: parseTenantRestoreBundle rejected unknown policy keys.
            devicePolicyValues.push({
              deviceId,
              policyId: policyIdByKey.get(policyKey)!,
              mode: "include",
            });

          for (const policyKey of assignment.excludedPolicyKeys)
            // SAFETY: parseTenantRestoreBundle rejected unknown policy keys.
            devicePolicyValues.push({
              deviceId,
              policyId: policyIdByKey.get(policyKey)!,
              mode: "exclude",
            });

          for (const applicationKey of assignment.applicationKeys)
            // SAFETY: parseTenantRestoreBundle rejected unknown application keys.
            applicationDeviceValues.push({
              deviceId,
              applicationId: applicationIdByKey.get(applicationKey)!,
            });
        }

        if (devicePolicyValues.length > 0)
          yield* tx.insert(schema.devicePolicy).ignore().values(devicePolicyValues);

        if (applicationDeviceValues.length > 0)
          yield* tx.insert(schema.applicationDevice).ignore().values(applicationDeviceValues);

        for (const row of bundle.preRegistrations)
          yield* tx.insert(schema.devicePreRegistration).values({
            id: newId(),
            organizationId: organization.id,
            serial: row.serial,
            name: row.name,
            assetTag: row.assetTag,
            notes: row.notes,
            groupId: row.groupKey ? (groupIdByKey.get(row.groupKey) ?? null) : null,
            consumedDeviceId: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          });

        if (bundle.enrollment) {
          const value = {
            code: bundle.enrollment.code,
            enabledApple: bundle.enrollment.enabledApple,
            enabledWindows: bundle.enrollment.enabledWindows,
            enabledAndroid: bundle.enrollment.enabledAndroid,
            enabledAssetTag: bundle.enrollment.enabledAssetTag,
            maxDevices: bundle.enrollment.maxDevices,
            updatedAt: timestamp,
          };

          if (enrollment)
            yield* tx
              .update(schema.enterpriseEnrollment)
              .set(value)
              .where(eq(schema.enterpriseEnrollment.organizationId, organization.id));
          else
            yield* tx.insert(schema.enterpriseEnrollment).values({
              id: organization.id,
              organizationId: organization.id,
              ...value,
              createdAt: timestamp,
            });
        }

        yield* tx
          .update(schema.organization)
          .set({
            name: bundle.name,
            displayName: bundle.branding.displayName,
            logo: bundle.branding.logo,
            supportEmail: bundle.branding.supportEmail,
            brandColor: bundle.branding.brandColor,
            metadata: bundle.metadata,
            updatedAt: timestamp,
          })
          .where(eq(schema.organization.id, organization.id));

        return {
          counts: {
            groups: bundle.groups.length,
            policies: bundle.policies.length,
            applications: bundle.applications.length,
            preRegistrations: bundle.preRegistrations.length,
            devices: groupDeviceValues.length,
            deviceAssignments: devicePolicyValues.length + applicationDeviceValues.length,
          },
          skippedDevices,
          skippedDeviceAssignments,
          applicationsWithoutFiles,
        };
      }),
    );
  });

/**
 * Restore one backup into its own tenant. A pinned snapshot is taken first so
 * the operator can restore the pre-restore state if the bundle turns out to be
 * the wrong one. The restore itself is a single transaction.
 */
export const restoreTenantFromBackup = (
  db: EnterpriseDb,
  storage: Parameters<typeof runTenantBackup>[1],
  organization: EnterpriseOrganization,
  options: {
    readonly backupId: string;
    readonly actor: BackupActor;
    readonly now?: Date;
    /** The operator must retype the tenant slug; ids cannot be restored blind. */
    readonly confirm: string;
  },
): Effect.Effect<TenantRestoreResult, BackupActionError | TenantRestoreError, never> =>
  Effect.gen(function* () {
    if (options.confirm !== organization.slug)
      return yield* Effect.fail(invalid("Type the tenant slug to confirm this restore"));

    const loaded = yield* readTenantBackup(db, storage, organization.id, options.backupId);

    const bundle = yield* parseTenantRestoreBundle(loaded.text);

    // A bundle can only reference objects this tenant owns. Accepting an
    // arbitrary key would make the download endpoint read another tenant's
    // bytes (or an object the restore never created).
    const foreignObject = bundle.applications.find(
      (application) =>
        application.r2Key != null &&
        application.r2Key !== "" &&
        !application.r2Key.startsWith(`a/${organization.id}/`),
    );

    if (foreignObject)
      return yield* Effect.fail(
        invalid(`Application "${foreignObject.name}" references an object outside this tenant`),
      );

    const timestamp = options.now ?? new Date();

    const snapshot = yield* runTenantBackup(db, storage, organization.id, "manual", {
      retention: "pinned",
      actor: options.actor,
      now: timestamp,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new TenantRestoreError({
            reason: "snapshot_failed",
            message: `Could not take a pre-restore snapshot: ${String(
              cause instanceof Error ? cause.message : cause,
            ).slice(0, 500)}`,
          }),
      ),
    );

    if (snapshot.status !== "succeeded")
      return yield* Effect.fail(
        new TenantRestoreError({
          reason: "snapshot_failed",
          message: `Could not take a pre-restore snapshot: ${
            snapshot.error ?? "the backup run failed"
          }`,
        }),
      );

    const applied = yield* applyBundle(db, organization, bundle, options.actor, timestamp).pipe(
      Effect.mapError(
        (cause) =>
          new TenantRestoreError({
            reason: "write_failed",
            message: `Could not write the restored configuration: ${String(
              cause instanceof Error ? cause.message : cause,
            ).slice(0, 500)}`,
          }),
      ),
    );

    yield* Effect.gen(function* () {
      yield* db.insert(schema.auditLog).values({
        id: newId(),
        organizationId: organization.id,
        actorUserId: options.actor.userId,
        actorEmail: options.actor.email,
        action: "tenant.restored",
        targetType: "tenant",
        targetId: organization.id,
        metadata: {
          backupId: options.backupId,
          preRestoreBackupId: snapshot.id,
          counts: applied.counts,
          skipped: {
            members: bundle.members,
            devices: applied.skippedDevices,
            deviceAssignments: applied.skippedDeviceAssignments,
            certificates: bundle.certificates,
            auditLog: bundle.auditLog,
          },
        },
        createdAt: timestamp,
      });
    }).pipe(
      Effect.mapError(
        (cause) =>
          new TenantRestoreError({
            reason: "write_failed",
            message: `The restore was applied but the audit entry failed: ${String(
              cause instanceof Error ? cause.message : cause,
            ).slice(0, 500)}`,
          }),
      ),
    );

    return {
      backupId: options.backupId,
      preRestoreBackupId: snapshot.id,
      restoredAt: timestamp.toISOString(),
      counts: applied.counts,
      skipped: {
        members: bundle.members,
        devices: applied.skippedDevices,
        deviceAssignments: applied.skippedDeviceAssignments,
        certificates: bundle.certificates,
        auditLog: bundle.auditLog,
      },
      applicationsWithoutFiles: applied.applicationsWithoutFiles,
    };
  });

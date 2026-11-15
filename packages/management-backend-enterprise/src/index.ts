import { Effect, Layer, Match, Option, Predicate, Schema } from "effect";
import { and, asc, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import {
  Db,
  deviceLimitForOrganization,
  schema as s,
  type PlanLimitsConfig,
} from "@mattrax/enterprise-core";
import {
  deriveDeviceHealth,
  resolveTenantBranding,
  shouldApplyReportedName,
} from "@mattrax/enterprise-domain";
import { ApnsService } from "@mattrax/apns";
import { importPrivateKeyJwk, openSecret, pemEncode, sealSecret } from "@mattrax/crypto";
import { PlistValue } from "@mattrax/plist";
import { buildAppleEnrollmentProfile } from "@mattrax/dm-apple";
import {
  InternalServerError,
  ManagementBackend,
  ServerInitiatedUnenrollment,
  UnknownDevice,
  type AppleDeviceEvent,
  type CheckinScope,
  type DdmDeclarationItems,
  type DdmTokens,
  type ManagementManifest,
} from "@mattrax/management-backend";
import { certificateDeviceIdsFor, createWindowsBackend } from "./windows.ts";
import { normalizeIssuedCertificateSerial } from "./scep.ts";
import { isPlistObject, type PlistInput, type PlistObject } from "./internal/plistValue.js";
import { parseDeviceInventory } from "./inventory.ts";
import { parseSecurityInfo } from "./securityInfo.ts";
import {
  APPLE_APPLICATION_INVENTORY_PAYLOAD,
  APPLE_DEVICE_INFORMATION_PAYLOAD,
  parseInstalledApplications,
} from "./applications.ts";
import { resolveEffectivePolicyForDevice } from "./policyResolutionStore.ts";
import { syncDynamicGroupsForDevice } from "./dynamicGroups.ts";
import {
  SYSTEM_AUDIT_ACTIONS,
  commandFailureTransition,
  declarationFailedTransition,
  writeSystemAudit,
} from "./audit.ts";
import {
  ACTIVE_COMMAND_STATUSES,
  COMMAND_EXPIRED_DETAIL,
  DEVICE_COMMAND_ACTIVE_LIMIT,
  DEVICE_COMMAND_INSTALL_ATTEMPT_WINDOW_MS,
  RECONCILED_RESULT_STATUS,
  commandDedupeKey,
  commandStatusIsActive,
  deviceCommandExpiresAt,
  installApplicationTarget,
  planCommandDelivery,
  reconcileDeviceCommands,
  shouldRetryInstall,
  type CommandPayload,
} from "./commands.ts";
import {
  buildAssetContent,
  buildAssetDeclaration,
  buildConfigurationDeclaration,
  buildLegacyProfile,
  certificateAllowsOrganization,
  configurationAssetIdentifier,
  configurationAssetServerToken,
  configurationDeclarationIdentifier,
  configurationServerToken,
  isCertificateKind,
  parseConfigurationKind,
  splitConfigurationAssetIdentifier,
  splitConfigurationDeclarationIdentifier,
  verifyAssetRequestToken,
  type DeclarationContext,
  type PolicyConfigurationRow,
} from "./policy.ts";

const DEVICE_INFORMATION_ACTIVATION_ID = "DAAF574F-36D4-4089-B2E3-D2008B65D5BE";
const DEVICE_INFORMATION_ACTIVATION_SERVER_TOKEN = "660CF896-1647-4FAD-B8A8-7A2190B5B554";
const DEVICE_INFORMATION_CONFIGURATION_ID = "13DE3EE0-D5A8-46E9-B967-27E56A4D918F";
const MANAGEMENT_DECLARATION_ID = "F8C4C3A1-2B6E-4D7F-A9E5-3C8B7D9E2F4A";
const MANAGEMENT_DECLARATION_SERVER_TOKEN = "CFC79DC6-B2A3-434D-8F2A-E03E11197A67";

export const DEVICE_INFORMATION_STATUS_ITEMS = [
  "device.identifier.serial-number",
  "device.identifier.udid",
  "device.model.family",
  "device.model.identifier",
  "device.model.marketing-name",
  "device.model.number",
  "device.operating-system.build-version",
  "device.operating-system.family",
  "device.operating-system.marketing-name",
  "device.operating-system.supplemental.build-version",
  "device.operating-system.supplemental.extra-version",
  "device.operating-system.version",
  "device.power.battery-health",
  "diskmanagement.filevault.enabled",
  "diskmanagement.storage.available",
  "diskmanagement.storage.total",
  "management.client-capabilities",
  "management.declarations",
];

const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);
const now = () => new Date();

const internal = () => new InternalServerError();

const record = (value: PlistInput): PlistObject | undefined =>
  isPlistObject(value) ? value : undefined;

const stringField = (value: PlistInput, key: string) => {
  const field = record(value)?.[key];

  return Schema.is(Schema.String)(field) ? field : undefined;
};

const decodeHeader = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const certificateOu = (identityCertificate: string | undefined): string | null => {
  if (!identityCertificate) return null;
  const text = decodeHeader(identityCertificate);

  return text.match(/(?:^|[,/\n])\s*OU\s*=\s*([^,/\n]+)/i)?.[1]?.trim() ?? null;
};

const certHash = async (identityCertificate: string | undefined) => {
  if (!identityCertificate) return null;

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(identityCertificate),
  );

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const hashToken = async (parts: Iterable<string>) => {
  const sorted = [...parts].sort();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sorted.join("|")));

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
};

const jsonHash = async (value: Schema.Json) => hashToken([JSON.stringify(value)]);

/**
 * The status-subscription declaration's server token must change whenever the
 * subscribed item list changes, otherwise devices keep their cached declaration
 * and never report newly added inventory items.
 */
export const deviceInformationConfigurationToken = (
  items: ReadonlyArray<string> = DEVICE_INFORMATION_STATUS_ITEMS,
) => hashToken(items);

type DeviceRow = typeof s.device.$inferSelect;

const findDeviceByScope = (
  scope: CheckinScope,
  requireIdentity = false,
): Effect.Effect<DeviceRow | null, unknown, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const organizationId = certificateOu(scope.identityCertificate);

    if (requireIdentity && !organizationId) return null;

    const [device] = yield* db
      .select()
      .from(s.device)
      .where(
        organizationId
          ? and(eq(s.device.dmIdentifier, scope.udid), eq(s.device.organizationId, organizationId))
          : eq(s.device.dmIdentifier, scope.udid),
      )
      .limit(1);

    if (!device) return null;

    // A UDID is only an identifier: bind it to the certificate that first
    // enrolled it so another tenant device cannot check in as this device.
    if (
      scope.identityCertificateFingerprintSha256 &&
      device.dmIdentityFingerprint &&
      device.dmIdentityFingerprint !== scope.identityCertificateFingerprintSha256
    )
      return null;

    return device;
  });

/**
 * Bind the SCEP certificate issued at enrollment to the internal device row.
 *
 * SCEP challenges are tenant-wide, so Apple certificates are recorded with an
 * `enrollmentId` but no `deviceId`. The mTLS identity certificate serial is the
 * only reliable link between an issued certificate and the device presenting
 * it. Binding it enables per-device revocation, renewal checks, credential
 * health and the device certificate list.
 *
 * Never steal a certificate: a serial already bound to another device or
 * tenant is logged and ignored.
 */
const bindAppleIdentityCertificate = (
  device: Pick<DeviceRow, "id" | "organizationId" | "dmIdentifier">,
  scope: CheckinScope,
) =>
  Effect.gen(function* () {
    if (!scope.identityCertificateSerial) return;
    const serial = normalizeIssuedCertificateSerial(scope.identityCertificateSerial);

    if (!serial) return;

    const db = yield* Db;

    // The serial is a global primary key, so read it unscoped first and apply
    // tenant/device ownership checks in code. A scoped lookup would silently
    // treat another tenant's certificate as missing.
    const [certificate] = yield* db
      .select()
      .from(s.scepIssuedCertificate)
      .where(eq(s.scepIssuedCertificate.serial, serial))
      .limit(1);

    if (!certificate) return;

    if (certificate.organizationId !== device.organizationId) {
      yield* Effect.logWarning(
        "Refusing to bind a SCEP identity certificate issued to another tenant",
      );

      return;
    }

    if (certificate.deviceId && !certificateDeviceIdsFor(device).includes(certificate.deviceId)) {
      yield* Effect.logWarning(
        "Refusing to rebind a SCEP identity certificate already bound to another device",
      );

      return;
    }

    if (certificate.deviceId === device.id) return;

    yield* db
      .update(s.scepIssuedCertificate)
      // Legacy rows keyed by `device.dmIdentifier` are migrated to the internal
      // id as they are seen, matching the Windows path.
      .set({ deviceId: device.id })
      .where(
        and(
          eq(s.scepIssuedCertificate.serial, certificate.serial),
          eq(s.scepIssuedCertificate.organizationId, device.organizationId),
        ),
      );
  });

type ScopedConfiguration = PolicyConfigurationRow & { readonly groupId: string };

const scopedConfigurations = (
  deviceId: string,
): Effect.Effect<ReadonlyArray<ScopedConfiguration>, unknown, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;

    const [device] = yield* db
      .select({ id: s.device.id, organizationId: s.device.organizationId })
      .from(s.device)
      .where(eq(s.device.id, deviceId))
      .limit(1);

    if (!device) return [];

    // Precedence and exclusions live in the shared resolver so Apple, Windows
    // and the effective-policy API all agree.
    const effective = yield* resolveEffectivePolicyForDevice(db, device);

    return effective.configurations.map((configuration) => ({
      policyId: configuration.policyId,
      kind: configuration.kind,
      data: configuration.data,
      hash: configuration.hash ?? "",
      organizationId: device.organizationId,
      groupId:
        configuration.scope === "group"
          ? (configuration.groupIds[0] ?? `group:${configuration.policyId}`)
          : `direct:${configuration.policyId}`,
    }));
  });

const deviceTokenFor = (deviceId: string) =>
  Effect.gen(function* () {
    const db = yield* Db;

    const [apple] = yield* db
      .select({ deviceToken: s.deviceApple.deviceToken })
      .from(s.deviceApple)
      .where(eq(s.deviceApple.deviceId, deviceId))
      .limit(1);

    return apple?.deviceToken ?? deviceId;
  }).pipe(Effect.mapError(internal));

const declarationItemsForDevice = (
  deviceId: string,
  deviceToken: string,
  context: Pick<DeclarationContext, "origin" | "authSecret">,
): Effect.Effect<DdmDeclarationItems, unknown, Db> =>
  Effect.gen(function* () {
    const rows = yield* scopedConfigurations(deviceId);
    const groups = new Map<string, Array<{ kind: string; policyId: string }>>();

    for (const row of rows) {
      const group = groups.get(row.groupId) ?? [];
      group.push(row);
      groups.set(row.groupId, group);
    }

    const activations = [
      {
        identifier: DEVICE_INFORMATION_ACTIVATION_ID,
        serverToken: DEVICE_INFORMATION_ACTIVATION_SERVER_TOKEN,
      },
    ];

    for (const [groupId, configurations] of groups) {
      activations.push({
        identifier: groupId,
        serverToken: yield* Effect.promise(() =>
          hashToken(
            configurations.map((row) => configurationDeclarationIdentifier(row.policyId, row.kind)),
          ),
        ),
      });
    }

    const uniqueConfigurations = new Map<string, ScopedConfiguration>();

    for (const row of rows)
      uniqueConfigurations.set(configurationDeclarationIdentifier(row.policyId, row.kind), row);

    const deviceInformationServerToken = yield* Effect.promise(() =>
      deviceInformationConfigurationToken(),
    );

    const configurations = [
      {
        identifier: DEVICE_INFORMATION_CONFIGURATION_ID,
        serverToken: deviceInformationServerToken,
      },
      ...(yield* Effect.promise(() =>
        Promise.all(
          [...uniqueConfigurations].map(async ([identifier, row]) => ({
            identifier,
            serverToken: await configurationServerToken(row, {
              origin: context.origin,
              deviceToken,
            }),
          })),
        ),
      )),
    ];

    const assets = yield* Effect.promise(() =>
      Promise.all(
        [...uniqueConfigurations.values()].flatMap((row) =>
          isCertificateKind(row.kind)
            ? [
                configurationAssetServerToken(row, {
                  origin: context.origin,
                  deviceToken,
                }).then((serverToken) => ({
                  identifier: configurationAssetIdentifier(row.policyId, row.kind),
                  serverToken,
                })),
              ]
            : [],
        ),
      ),
    );

    return {
      activations,
      configurations,
      assets,
      management: [
        { identifier: MANAGEMENT_DECLARATION_ID, serverToken: MANAGEMENT_DECLARATION_SERVER_TOKEN },
      ],
    };
  });

const updateInventoryFromStatus = (
  deviceId: string,
  organizationId: string,
  statusItems: PlistInput,
  options: { readonly authSecret?: string } = {},
): Effect.Effect<void, unknown, Db> =>
  Effect.gen(function* () {
    const root = record(statusItems);

    if (!root) return;
    const db = yield* Db;
    const inventory = parseDeviceInventory(root);

    // Compliance is derived, not stored. Capture the rollup before the write
    // so a level transition can be audited (and mirrored to webhooks) even
    // when it comes from inventory rather than declaration validity.
    const [deviceBefore] = yield* db
      .select()
      .from(s.device)
      .where(eq(s.device.id, deviceId))
      .limit(1);

    const declarationsBefore = yield* db
      .select()
      .from(s.deviceDeclaration)
      .where(eq(s.deviceDeclaration.deviceId, deviceId));

    const healthInput = (
      device: typeof s.device.$inferSelect,
      declarations: ReadonlyArray<typeof s.deviceDeclaration.$inferSelect>,
    ) => ({
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
    });

    const previousHealth = deviceBefore
      ? deriveDeviceHealth(healthInput(deviceBefore, declarationsBefore))
      : null;

    const auditComplianceChange = (
      next: ReturnType<typeof deriveDeviceHealth>,
    ): Effect.Effect<void, unknown, never> =>
      previousHealth && previousHealth.level !== next.level
        ? writeSystemAudit(
            db,
            {
              organizationId,
              action: SYSTEM_AUDIT_ACTIONS.complianceChanged,
              targetType: "device",
              targetId: deviceId,
              metadata: {
                from: previousHealth.level,
                to: next.level,
                reasons: next.reasons.map((reason) => reason.code).slice(0, 10),
              },
            },
            { authSecret: options.authSecret },
          )
        : Effect.void;

    const update: Partial<typeof s.device.$inferInsert> = { lastSeenAt: now() };

    if (inventory.serial) update.serial = inventory.serial;

    if (inventory.model) update.model = inventory.model;

    if (inventory.modelIdentifier) update.modelIdentifier = inventory.modelIdentifier;

    if (inventory.modelNumber) update.modelNumber = inventory.modelNumber;

    if (inventory.osEdition) update.osEdition = inventory.osEdition;

    if (inventory.osVersion) update.osVersion = inventory.osVersion;

    if (inventory.osBuild) update.osBuild = inventory.osBuild;

    if (inventory.fileVaultEnabled !== undefined)
      update.fileVaultEnabled = inventory.fileVaultEnabled;

    if (inventory.batteryHealth !== undefined)
      update.batteryHealth = inventory.batteryHealth ?? null;

    if (inventory.capabilities !== undefined) update.capabilities = inventory.capabilities;

    if (inventory.diskTotal) update.diskTotal = inventory.diskTotal;

    if (inventory.diskUsed) update.diskUsed = inventory.diskUsed;

    // Only stamp the inventory clock when at least one subscribed item was
    // actually understood, so a malformed/empty report cannot make a stale
    // device look freshly inventoried.
    const hasInventory =
      inventory.serial !== undefined ||
      inventory.model !== undefined ||
      inventory.modelIdentifier !== undefined ||
      inventory.modelNumber !== undefined ||
      inventory.osEdition !== undefined ||
      inventory.osVersion !== undefined ||
      inventory.osBuild !== undefined ||
      inventory.fileVaultEnabled !== undefined ||
      inventory.batteryHealth !== undefined ||
      inventory.capabilities !== undefined ||
      inventory.diskTotal !== undefined;

    if (hasInventory) update.inventoryUpdatedAt = now();
    yield* db.update(s.device).set(update).where(eq(s.device.id, deviceId));

    // Apple sends status items as a nested path tree; some clients flatten the
    // keys. Accept both shapes.
    const declarations =
      record(record(root.management)?.declarations) ?? record(root["management.declarations"]);

    if (!declarations) {
      // Inventory-only report: the compliance rollup may still have moved
      // (storage, battery, FileVault), so compare it before returning.
      if (deviceBefore)
        yield* auditComplianceChange(
          deriveDeviceHealth(healthInput({ ...deviceBefore, ...update }, declarationsBefore)),
        );

      return;
    }

    const timestamp = now();
    // Status reports arrive on every check-in. The previous declaration states
    // were read before the write so audit events fire only on a transition.
    const previousValid = new Map<string, string>();

    for (const row of declarationsBefore) previousValid.set(row.identifier, row.valid);

    const transitions: Array<{
      identifier: string;
      declarationType: string;
      previousValid: string | null;
      valid: string;
    }> = [];

    for (const declarationType of ["activations", "configurations", "assets", "management"]) {
      const values = declarations[declarationType];

      if (!Array.isArray(values)) continue;

      for (const item of values) {
        const entry = record(item);
        const identifier = stringField(entry, "Identifier") ?? stringField(entry, "identifier");

        if (!entry || !identifier) continue;
        const valid = stringField(entry, "Valid") ?? stringField(entry, "valid") ?? "unknown";
        const active = entry.Active === true || entry.active === true;

        const serverToken =
          stringField(entry, "ServerToken") ?? stringField(entry, "server-token") ?? null;

        if (declarationFailedTransition(previousValid.get(identifier), valid))
          transitions.push({
            identifier,
            declarationType,
            previousValid: previousValid.get(identifier) ?? null,
            valid,
          });
        yield* db
          .insert(s.deviceDeclaration)
          .values({
            deviceId,
            identifier,
            declarationType,
            active,
            valid,
            serverToken,
            reasons: entry.Reasons ?? entry.reasons ?? null,
            updatedAt: timestamp,
          })
          .onDuplicateKeyUpdate({
            set: {
              declarationType,
              active,
              valid,
              serverToken,
              reasons: entry.Reasons ?? entry.reasons ?? null,
              updatedAt: timestamp,
            },
          });
      }
    }

    for (const transition of transitions)
      yield* writeSystemAudit(
        db,
        {
          organizationId,
          action: SYSTEM_AUDIT_ACTIONS.declarationInvalid,
          targetType: "device",
          targetId: deviceId,
          metadata: {
            identifier: transition.identifier,
            declarationType: transition.declarationType,
            previousValid: transition.previousValid,
            valid: transition.valid,
          },
        },
        { authSecret: options.authSecret },
      );

    if (deviceBefore) {
      const declarationsAfter = yield* db
        .select()
        .from(s.deviceDeclaration)
        .where(eq(s.deviceDeclaration.deviceId, deviceId));

      yield* auditComplianceChange(
        deriveDeviceHealth(healthInput({ ...deviceBefore, ...update }, declarationsAfter)),
      );
    }
  });

/**
 * Seal and upsert one escrowed device secret. Re-reporting the same value only
 * refreshes `updatedAt`; `rotatedAt` moves when the plaintext changes.
 */
const writeDeviceSecret = (
  device: Pick<DeviceRow, "id" | "organizationId">,
  kind: "filevault_recovery_key" | "bootstrap_token",
  plaintext: string,
  authSecret: string | undefined,
): Effect.Effect<void, unknown, Db> =>
  Effect.gen(function* () {
    if (!authSecret) {
      // Never write a plaintext secret as a fallback.
      yield* Effect.logWarning(
        `Cannot escrow ${kind}: the deployment has no AUTH_SECRET configured`,
      );

      return;
    }

    const db = yield* Db;

    const [existing] = yield* db
      .select()
      .from(s.deviceSecret)
      .where(and(eq(s.deviceSecret.deviceId, device.id), eq(s.deviceSecret.kind, kind)))
      .limit(1);

    const sealed = yield* Effect.tryPromise({
      try: () => sealSecret(authSecret, plaintext),
      catch: internal,
    });

    const timestamp = now();

    if (!existing) {
      yield* db.insert(s.deviceSecret).values({
        deviceId: device.id,
        organizationId: device.organizationId,
        kind,
        sealedValue: sealed,
        createdAt: timestamp,
        updatedAt: timestamp,
        rotatedAt: timestamp,
      });

      return;
    }

    // Compare without logging either value; a malformed/old seal is treated as
    // a rotation so the fresh value replaces it.
    const unchanged = yield* Effect.promise(() =>
      openSecret(authSecret, existing.sealedValue)
        .then((value) => value === plaintext)
        .catch(() => false),
    );

    const secretUpdate: Partial<typeof s.deviceSecret.$inferInsert> = {
      sealedValue: sealed,
      updatedAt: timestamp,
    };

    if (!unchanged) secretUpdate.rotatedAt = timestamp;

    yield* db
      .update(s.deviceSecret)
      .set(secretUpdate)
      .where(and(eq(s.deviceSecret.deviceId, device.id), eq(s.deviceSecret.kind, kind)));
  });

/**
 * Apply a `SecurityInfo` command result. The recovery key is sealed before it
 * reaches storage and is never logged.
 */
const applySecurityInfo = (
  device: Pick<DeviceRow, "id" | "organizationId">,
  queryResponses: PlistInput,
  options: { readonly authSecret?: string },
): Effect.Effect<void, unknown, Db> =>
  Effect.gen(function* () {
    const report = parseSecurityInfo(queryResponses);

    if (!report) return;
    const db = yield* Db;
    const timestamp = now();

    if (report.fileVaultStatus !== undefined) {
      yield* db
        .update(s.device)
        .set({
          fileVaultEnabled:
            report.fileVaultStatus === "unknown" ? null : report.fileVaultStatus === "enabled",
          lastSeenAt: timestamp,
        })
        .where(eq(s.device.id, device.id));
    }

    if (report.recoveryKey !== undefined)
      yield* writeDeviceSecret(
        device,
        "filevault_recovery_key",
        report.recoveryKey,
        options.authSecret,
      );

    if (report.bootstrapTokenEscrowed !== undefined)
      yield* db
        .update(s.deviceApple)
        .set({ bootstrapTokenEscrowed: report.bootstrapTokenEscrowed })
        .where(eq(s.deviceApple.deviceId, device.id));
  });

/**
 * Replace the device's installed-application inventory with the latest full
 * report. An empty report clears every row; a missing report is ignored.
 */
const applyInstalledApplications = (
  device: Pick<DeviceRow, "id" | "organizationId">,
  queryResponses: PlistInput,
): Effect.Effect<void, unknown, Db> =>
  Effect.gen(function* () {
    const applications = parseInstalledApplications(queryResponses);

    if (applications === undefined) return;
    const db = yield* Db;
    const timestamp = now();

    const existing = yield* db
      .select()
      .from(s.deviceApplication)
      .where(eq(s.deviceApplication.deviceId, device.id));

    const byBundle = new Map(existing.map((row) => [row.bundleId, row]));

    for (const application of applications) {
      const current = byBundle.get(application.bundleId);

      if (!current) {
        yield* db.insert(s.deviceApplication).values({
          deviceId: device.id,
          organizationId: device.organizationId,
          bundleId: application.bundleId,
          name: application.name ?? null,
          version: application.version ?? null,
          shortVersion: application.shortVersion ?? null,
          bundleSize: application.bundleSize ?? null,
          dynamicSize: application.dynamicSize ?? null,
          hasUpdateAvailable: application.hasUpdateAvailable,
          isManaged: application.isManaged,
          lastReportedAt: timestamp,
        });
        continue;
      }

      yield* db
        .update(s.deviceApplication)
        .set({
          name: application.name ?? null,
          version: application.version ?? null,
          shortVersion: application.shortVersion ?? null,
          bundleSize: application.bundleSize ?? null,
          dynamicSize: application.dynamicSize ?? null,
          hasUpdateAvailable: application.hasUpdateAvailable,
          isManaged: application.isManaged,
          lastReportedAt: timestamp,
        })
        .where(
          and(
            eq(s.deviceApplication.deviceId, device.id),
            eq(s.deviceApplication.bundleId, application.bundleId),
          ),
        );
    }

    const reported = new Set(applications.map((application) => application.bundleId));
    const stale = existing.filter((row) => !reported.has(row.bundleId)).map((row) => row.bundleId);

    if (stale.length > 0)
      yield* db
        .delete(s.deviceApplication)
        .where(
          and(
            eq(s.deviceApplication.deviceId, device.id),
            inArray(s.deviceApplication.bundleId, stale),
          ),
        );
    yield* db
      .update(s.device)
      .set({ applicationsUpdatedAt: timestamp, lastSeenAt: timestamp })
      .where(eq(s.device.id, device.id));
  });

export class ManagementBackendEnterpriseLive extends ManagementBackend {
  static readonly make = (options: {
    readonly db: Db["Service"];
    readonly origin: string;
    /** Push transport for the immediate post-enrollment check-in. */
    readonly apns?: ApnsService.Service;
    /** Application secret used to unseal the tenant APNs private key and sign Windows WSTEP tokens. */
    readonly authSecret?: string;
    /**
     * Tenant that owns Windows devices. When omitted, Windows enrollment fails
     * closed: Windows discovery/enrollment carries no tenant identity, so
     * guessing would let an anonymous caller enrol into the wrong tenant.
     */
    readonly windowsOrganizationId?: string;
    readonly requireWindowsDeviceIdentity?: boolean;
    readonly requireAppleDeviceIdentity?: boolean;
    /** Deployment plan catalogue; omitted means unlimited plans. */
    readonly planLimits?: PlanLimitsConfig;
    /** Federated Entra WSTEP options; omitted disables Federated discovery. */
    readonly windowsFederated?: Parameters<typeof createWindowsBackend>[0]["federated"];
  }): ManagementBackend.Service => {
    const { db, origin, apns, authSecret } = options;

    const provideDb = <A, E>(effect: Effect.Effect<A, E, Db>) =>
      effect.pipe(Effect.provideService(Db, db));

    /**
     * mttx pushes a check-in immediately after a device first reports its push
     * token, so the freshly enrolled device receives its configuration without
     * waiting for the next poll. Failures are logged and ignored.
     */
    const pushEnrolledDevice = (deviceId: string, organizationId: string) =>
      Effect.gen(function* () {
        if (!apns || !authSecret) return;

        const [apple] = yield* db
          .select()
          .from(s.deviceApple)
          .where(eq(s.deviceApple.deviceId, deviceId))
          .limit(1);

        if (!apple?.token || !apple.pushMagic) return;

        const [certificate] = yield* db
          .select()
          .from(s.applePushCertificate)
          .where(eq(s.applePushCertificate.organizationId, organizationId))
          .limit(1);

        if (!certificate?.encryptedKey) return;

        // SAFETY: The APNs key is stored as a JWK by the settings writer, and
        // importPrivateKeyJwk validates the key material before use.
        const jwk = JSON.parse(
          yield* Effect.tryPromise({
            try: () => openSecret(authSecret, certificate.encryptedKey!),
            catch: () => new Error("Failed to decrypt the APNs private key"),
          }),
        ) as JsonWebKey;

        const key = yield* Effect.tryPromise({
          try: () => importPrivateKeyJwk(jwk),
          catch: () => new Error("Failed to import the APNs private key"),
        });

        const pkcs8 = yield* Effect.tryPromise({
          try: () => crypto.subtle.exportKey("pkcs8", key),
          catch: () => new Error("Failed to export the APNs private key"),
        });

        yield* apns.push({
          pushToken: apple.token,
          pushMagic: apple.pushMagic,
          topic: apple.topic ?? certificate.topic,
          certPem: certificate.certPem,
          privateKeyPem: pemEncode("PRIVATE KEY", pkcs8),
        });
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning(`Failed to send post-enrollment APNs push: ${String(error)}`),
        ),
      );

    const requireDevice = (scope: CheckinScope) =>
      findDeviceByScope(scope, options.requireAppleDeviceIdentity).pipe(
        Effect.flatMap((device) =>
          device ? Effect.succeed(device) : Effect.fail(new UnknownDevice()),
        ),
        Effect.mapError((cause) => (cause instanceof UnknownDevice ? cause : internal())),
      );

    /**
     * Dynamic group membership must not make a device check-in fail. A group
     * that cannot be evaluated is retried on the next check-in and by daily
     * maintenance.
     */
    const syncDeviceGroups = (organizationId: string, deviceId: string, at = now()) =>
      syncDynamicGroupsForDevice(db, organizationId, deviceId, { now: at }).pipe(
        Effect.catch(() => Effect.void),
      );

    /** Whether an application is still assigned to the device, directly or by group. */
    const applicationAssignedToDevice = (deviceId: string, applicationId: string) =>
      Effect.gen(function* () {
        const [direct] = yield* db
          .select({ deviceId: s.applicationDevice.deviceId })
          .from(s.applicationDevice)
          .where(
            and(
              eq(s.applicationDevice.deviceId, deviceId),
              eq(s.applicationDevice.applicationId, applicationId),
            ),
          )
          .limit(1);

        if (direct) return true;

        const groups = yield* db
          .select({ groupId: s.applicationGroup.groupId })
          .from(s.applicationGroup)
          .where(eq(s.applicationGroup.applicationId, applicationId));

        if (groups.length === 0) return false;

        const [member] = yield* db
          .select({ deviceId: s.groupDevice.deviceId })
          .from(s.groupDevice)
          .where(
            and(
              eq(s.groupDevice.deviceId, deviceId),
              inArray(
                s.groupDevice.groupId,
                groups.map((group) => group.groupId),
              ),
            ),
          )
          .limit(1);

        return Boolean(member);
      });

    /**
     * Re-queue an app install that is still assigned to the device after the
     * device proved it missing, so legacy (non-declarative) app delivery
     * converges instead of waiting for an operator. `shouldRetryInstall` bounds
     * it to three attempts a day, so a broken manifest cannot loop.
     */
    const requeueMissingInstalls = (
      device: DeviceRow,
      installs: ReadonlyArray<{ readonly requestType: string; readonly payload: CommandPayload }>,
      at: Date,
    ): Effect.Effect<void, unknown, Db> =>
      Effect.gen(function* () {
        if (installs.length === 0 || device.status !== "enrolled") return;

        const applications = yield* db
          .select({
            id: s.application.id,
            manifestUrl: s.application.manifestUrl,
            storeId: s.application.storeId,
            bundleId: s.application.bundleId,
          })
          .from(s.application)
          .where(eq(s.application.organizationId, device.organizationId));

        const history = yield* db
          .select({
            requestType: s.deviceCommand.requestType,
            payload: s.deviceCommand.payload,
            createdAt: s.deviceCommand.createdAt,
          })
          .from(s.deviceCommand)
          .where(
            and(
              eq(s.deviceCommand.deviceId, device.id),
              eq(s.deviceCommand.requestType, "InstallApplication"),
              gte(
                s.deviceCommand.createdAt,
                new Date(at.getTime() - DEVICE_COMMAND_INSTALL_ATTEMPT_WINDOW_MS),
              ),
            ),
          )
          .orderBy(desc(s.deviceCommand.createdAt))
          .limit(20);

        let requeued = false;

        for (const install of installs) {
          const target = installApplicationTarget(install.payload);

          const application = applications.find(
            (candidate) =>
              (target.manifestUrl != null && candidate.manifestUrl === target.manifestUrl) ||
              (target.storeId != null && candidate.storeId === target.storeId),
          );

          if (!application?.bundleId) continue;

          if (!(yield* applicationAssignedToDevice(device.id, application.id))) continue;

          if (!shouldRetryInstall(history, { ...install, now: at })) continue;

          const dedupeKey = yield* Effect.promise(() =>
            commandDedupeKey(install.requestType, install.payload),
          );

          yield* db
            .insert(s.deviceCommand)
            .values({
              id: crypto.randomUUID(),
              organizationId: device.organizationId,
              deviceId: device.id,
              requestType: install.requestType,
              payload: install.payload,
              status: "queued",
              dedupeKey,
              expiresAt: deviceCommandExpiresAt(install.requestType, at),
              resultStatus: null,
              resultDetail: null,
              createdAt: at,
              updatedAt: at,
            })
            // A concurrent check-in may have queued the same install first.
            // The no-op update leaves its retry timer alone.
            .onDuplicateKeyUpdate({ set: { requestType: install.requestType } });

          requeued = true;
        }

        if (requeued) yield* pushEnrolledDevice(device.id, device.organizationId);
      });

    /**
     * Reconcile a device's active commands against the state it reports.
     *
     * Apple only sends a result for a command it processed, so a command whose
     * result was lost - or that a re-enrolment overtook - would stay `sent`
     * forever. The rules themselves live in `commands.ts` so they stay pure and
     * unit tested; this only resolves the inventory evidence they need.
     */
    const reconcileCommands = (device: DeviceRow): Effect.Effect<void, unknown, Db> =>
      Effect.gen(function* () {
        const at = now();

        const [lifecycle] = yield* db
          .select({ applicationsUpdatedAt: s.device.applicationsUpdatedAt })
          .from(s.device)
          .where(eq(s.device.id, device.id))
          .limit(1);

        const applicationsUpdatedAt = lifecycle?.applicationsUpdatedAt ?? null;

        const active = yield* db
          .select()
          .from(s.deviceCommand)
          .where(
            and(
              eq(s.deviceCommand.deviceId, device.id),
              inArray(s.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES]),
            ),
          )
          .orderBy(asc(s.deviceCommand.createdAt))
          .limit(DEVICE_COMMAND_ACTIVE_LIMIT);

        if (active.length === 0) return;

        const installCommands = active.filter((row) => row.requestType === "InstallApplication");

        const applications =
          installCommands.length > 0
            ? yield* db
                .select({
                  id: s.application.id,
                  manifestUrl: s.application.manifestUrl,
                  storeId: s.application.storeId,
                  bundleId: s.application.bundleId,
                })
                .from(s.application)
                .where(eq(s.application.organizationId, device.organizationId))
            : [];

        const targetBundleIds = (payload: CommandPayload) => {
          const target = installApplicationTarget(payload);

          return applications
            .filter(
              (application) =>
                (target.manifestUrl != null && application.manifestUrl === target.manifestUrl) ||
                (target.storeId != null && application.storeId === target.storeId),
            )
            .flatMap((application) => (application.bundleId ? [application.bundleId] : []));
        };

        const installed =
          applicationsUpdatedAt && installCommands.length > 0
            ? yield* db
                .select({ bundleId: s.deviceApplication.bundleId })
                .from(s.deviceApplication)
                .where(eq(s.deviceApplication.deviceId, device.id))
            : [];

        const reconciled = reconcileDeviceCommands(
          active.map((row) => ({
            id: row.id,
            requestType: row.requestType,
            status: row.status,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            expiresAt: row.expiresAt,
            targetBundleIds: targetBundleIds(row.payload),
          })),
          {
            status: device.status,
            applicationsUpdatedAt,
            installedBundleIds: new Set(installed.map((row) => row.bundleId)),
          },
          at,
        );

        for (const command of reconciled)
          yield* db
            .update(s.deviceCommand)
            .set({
              status: command.status,
              dedupeKey: null,
              resultStatus: command.resultStatus,
              resultDetail: command.resultDetail,
              updatedAt: at,
            })
            .where(
              and(eq(s.deviceCommand.id, command.id), eq(s.deviceCommand.deviceId, device.id)),
            );

        const failed = new Set(
          reconciled.filter((command) => command.status === "failed").map((command) => command.id),
        );

        yield* requeueMissingInstalls(
          device,
          active.filter((row) => failed.has(row.id) && row.requestType === "InstallApplication"),
          at,
        );
      }).pipe(
        // Reconciliation is best effort: a failure must never fail the
        // device's check-in. The next inventory report reconciles again.
        Effect.catch((error) =>
          Effect.logWarning(`Failed to reconcile device commands: ${String(error)}`),
        ),
      );

    const windowsBackendOptions: Parameters<typeof createWindowsBackend>[0] = {
      db,
      origin,
      authSecret,
      windowsOrganizationId: options.windowsOrganizationId,
      requireDeviceIdentity: options.requireWindowsDeviceIdentity,
      planLimits: options.planLimits,
      federated: options.windowsFederated,
    };

    return ManagementBackend.of({
      appleDeviceEvent: (scope: CheckinScope, event: AppleDeviceEvent) =>
        provideDb(
          Effect.gen(function* () {
            return yield* Effect.gen(function* () {
              if (Predicate.isTagged("Authenticate")(event)) {
                const organizationId = certificateOu(scope.identityCertificate);

                if (!organizationId) return yield* Effect.fail(new UnknownDevice());

                const [organization] = yield* db
                  .select()
                  .from(s.organization)
                  .where(eq(s.organization.id, organizationId))
                  .limit(1);

                if (!organization) return yield* Effect.fail(new UnknownDevice());

                const [existingByUdid] = yield* db
                  .select()
                  .from(s.device)
                  .where(
                    and(
                      eq(s.device.organizationId, organizationId),
                      eq(s.device.dmIdentifier, scope.udid),
                    ),
                  )
                  .limit(1);

                const serialNumber = event.serialNumber?.trim() || null;

                const [preRegistration] = serialNumber
                  ? yield* db
                      .select()
                      .from(s.devicePreRegistration)
                      .where(
                        and(
                          eq(s.devicePreRegistration.organizationId, organizationId),
                          eq(s.devicePreRegistration.serial, serialNumber),
                        ),
                      )
                      .limit(1)
                  : [];

                // A pre-registered serial may already belong to a device row
                // enrolled under an older UDID. Reuse that row instead of
                // hitting the tenant's `(organization, serial)` unique index.
                const [existingBySerial] =
                  !existingByUdid && preRegistration && serialNumber
                    ? yield* db
                        .select()
                        .from(s.device)
                        .where(
                          and(
                            eq(s.device.organizationId, organizationId),
                            eq(s.device.serial, serialNumber),
                          ),
                        )
                        .limit(1)
                    : [];

                const existing = existingByUdid ?? existingBySerial;

                // New devices must fit the deployment plan. Re-authenticating
                // an existing device (or reclaiming a pre-registered serial)
                // is always allowed, so a lowered limit never strands devices
                // that are already managed.
                if (!existing) {
                  const planStatus = yield* deviceLimitForOrganization({
                    db,
                    organizationId,
                    config: options.planLimits,
                  }).pipe(Effect.mapError(() => new InternalServerError()));

                  if (planStatus.reached) return yield* Effect.fail(new UnknownDevice());
                }

                const identityFingerprint = scope.identityCertificateFingerprintSha256;

                // Only an unenrolled slot may be reclaimed by a new identity.
                // Overwriting an enrolled device from a different certificate
                // would let one enrolled device hijack another device's UDID.
                if (
                  existingByUdid &&
                  identityFingerprint &&
                  existingByUdid.dmIdentityFingerprint &&
                  existingByUdid.dmIdentityFingerprint !== identityFingerprint &&
                  existingByUdid.status === "enrolled"
                )
                  return yield* Effect.fail(new UnknownDevice());
                const deviceId = existing?.id ?? id();

                const preRegistrationMetadata: Partial<typeof s.device.$inferInsert> = {};

                if (preRegistration) {
                  const name = preRegistration.name?.trim();

                  if (name) preRegistrationMetadata.name = name;

                  if (preRegistration.assetTag != null)
                    preRegistrationMetadata.assetTag = preRegistration.assetTag;

                  if (preRegistration.notes != null)
                    preRegistrationMetadata.notes = preRegistration.notes;
                }

                const common = {
                  organizationId,
                  proto: "apple" as const,
                  status: "enrolling" as const,
                  name: serialNumber ?? event.model ?? scope.udid,
                  model: event.model ?? null,
                  serial: serialNumber,
                  osVersion: event.osVersion ?? null,
                  vendor: "Apple",
                  physicalName: serialNumber ?? event.model ?? scope.udid,
                  dmIdentifier: scope.udid,
                  dmCertHash: yield* Effect.promise(() => certHash(scope.identityCertificate)),
                  dmIdentityFingerprint:
                    identityFingerprint ?? existing?.dmIdentityFingerprint ?? null,
                  ddmDeclarationsToken: null,
                  lastSeenAt: now(),
                  ...preRegistrationMetadata,
                };

                if (existing) {
                  yield* db.update(s.device).set(common).where(eq(s.device.id, deviceId));
                  // A re-enrolment starts a new MDM session and Apple discards
                  // the previous command queue, so anything still active was
                  // queued for an enrolment that no longer exists.
                  yield* db
                    .update(s.deviceCommand)
                    .set({
                      status: "expired",
                      dedupeKey: null,
                      resultStatus: RECONCILED_RESULT_STATUS,
                      resultDetail: "The device re-enrolled before the command was delivered.",
                      updatedAt: now(),
                    })
                    .where(
                      and(
                        eq(s.deviceCommand.deviceId, deviceId),
                        inArray(s.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES]),
                      ),
                    );
                } else {
                  yield* db.insert(s.device).values({ id: deviceId, enrolledAt: now(), ...common });
                }

                if (preRegistration) {
                  // The group is tenant-scoped at import time; re-check
                  // ownership here so a stale or forged row cannot cross
                  // tenants if the group was reassigned.
                  const [group] = preRegistration.groupId
                    ? yield* db
                        .select()
                        .from(s.enterpriseGroup)
                        .where(
                          and(
                            eq(s.enterpriseGroup.id, preRegistration.groupId),
                            eq(s.enterpriseGroup.organizationId, organizationId),
                          ),
                        )
                        .limit(1)
                    : [];

                  if (group)
                    yield* db
                      .insert(s.groupDevice)
                      .values({ groupId: group.id, deviceId })
                      .onDuplicateKeyUpdate({ set: { groupId: group.id } });
                  yield* db
                    .update(s.devicePreRegistration)
                    .set({ consumedDeviceId: deviceId, updatedAt: now() })
                    .where(
                      and(
                        eq(s.devicePreRegistration.id, preRegistration.id),
                        eq(s.devicePreRegistration.organizationId, organizationId),
                      ),
                    );
                }

                yield* db
                  .insert(s.deviceApple)
                  .values({
                    deviceId,
                    token: null,
                    pushMagic: null,
                    topic: null,
                    unlockToken: null,
                    deviceToken: id() + id(),
                    tokenUpdatedAt: null,
                  })
                  .onDuplicateKeyUpdate({
                    set: {
                      token: null,
                      pushMagic: null,
                      topic: null,
                      unlockToken: null,
                      deviceToken: id() + id(),
                      tokenUpdatedAt: null,
                    },
                  });
                yield* bindAppleIdentityCertificate(
                  { id: deviceId, organizationId, dmIdentifier: scope.udid },
                  scope,
                );
                yield* syncDeviceGroups(organizationId, deviceId);

                // Collect the identity and the installed-application list on
                // the first check-in. Apple only reports either in response to
                // a command, so without this a brand-new Mac stays a serial
                // number with no software inventory until an admin clicks
                // Refresh. Both are idempotent queries with bounded budgets.
                yield* Effect.forEach(
                  [
                    {
                      requestType: "DeviceInformation",
                      payload: APPLE_DEVICE_INFORMATION_PAYLOAD,
                    },
                    {
                      requestType: "InstalledApplicationList",
                      payload: APPLE_APPLICATION_INVENTORY_PAYLOAD,
                    },
                  ],
                  ({ requestType, payload }) =>
                    Effect.gen(function* () {
                      const [active] = yield* db
                        .select({ id: s.deviceCommand.id })
                        .from(s.deviceCommand)
                        .where(
                          and(
                            eq(s.deviceCommand.deviceId, deviceId),
                            eq(s.deviceCommand.requestType, requestType),
                            inArray(s.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES]),
                          ),
                        )
                        .limit(1);

                      if (active) return;

                      const at = now();

                      yield* db.insert(s.deviceCommand).values({
                        id: id(),
                        organizationId,
                        deviceId,
                        requestType,
                        payload,
                        status: "queued",
                        dedupeKey: yield* Effect.promise(() =>
                          commandDedupeKey(requestType, payload),
                        ),
                        expiresAt: deviceCommandExpiresAt(requestType, at),
                        createdAt: at,
                        updatedAt: at,
                      });
                    }),
                  { concurrency: 1, discard: true },
                );

                return;
              }

              const device = yield* findDeviceByScope(scope, options.requireAppleDeviceIdentity);

              if (!device) return yield* Effect.fail(new UnknownDevice());
              yield* bindAppleIdentityCertificate(device, scope);

              if (Predicate.isTagged("TokenUpdate")(event)) {
                if (event.channel === "user" && event.userId) {
                  yield* db
                    .insert(s.deviceAppleUser)
                    .values({
                      deviceId: device.id,
                      userId: event.userId,
                      token: event.pushToken,
                      pushMagic: event.pushMagic,
                      topic: event.topic,
                      unlockToken: event.unlockToken ?? null,
                      updatedAt: now(),
                    })
                    .onDuplicateKeyUpdate({
                      set: {
                        token: event.pushToken,
                        pushMagic: event.pushMagic,
                        topic: event.topic,
                        unlockToken: event.unlockToken ?? null,
                        updatedAt: now(),
                      },
                    });
                } else {
                  const appleUpdate: Partial<typeof s.deviceApple.$inferInsert> = {
                    token: event.pushToken,
                    pushMagic: event.pushMagic,
                    topic: event.topic,
                    tokenUpdatedAt: now(),
                  };

                  if (event.unlockToken) appleUpdate.unlockToken = event.unlockToken;

                  if (event.enrollmentId) appleUpdate.enrollmentId = event.enrollmentId;

                  if (event.awaitingConfiguration !== undefined)
                    appleUpdate.configured = !event.awaitingConfiguration;

                  yield* db
                    .update(s.deviceApple)
                    .set(appleUpdate)
                    .where(eq(s.deviceApple.deviceId, device.id));
                }

                if (event.channel === "device" && device.status === "enrolling") {
                  yield* db
                    .update(s.device)
                    .set({ status: "enrolled", lastSeenAt: now() })
                    .where(eq(s.device.id, device.id));
                  yield* writeSystemAudit(
                    db,
                    {
                      organizationId: device.organizationId,
                      action: SYSTEM_AUDIT_ACTIONS.deviceEnrolled,
                      targetType: "device",
                      targetId: device.id,
                      metadata: {
                        platform: "apple",
                        serial: device.serial ?? null,
                        model: device.model ?? null,
                      },
                    },
                    { authSecret },
                  );
                  yield* pushEnrolledDevice(device.id, device.organizationId);
                  yield* syncDeviceGroups(device.organizationId, device.id);
                }

                return;
              }

              if (Predicate.isTagged("BootstrapToken")(event)) {
                // Keep the plaintext column for pre-sealing rows only. New
                // tokens are sealed in `device_secret` and the clear copy is
                // cleared, so the escrowed secret has one at-rest location.
                yield* writeDeviceSecret(device, "bootstrap_token", event.token, authSecret);
                yield* db
                  .update(s.deviceApple)
                  .set({
                    bootstrapToken: authSecret ? null : event.token,
                    bootstrapTokenEscrowed: true,
                  })
                  .where(eq(s.deviceApple.deviceId, device.id));
                yield* db
                  .update(s.device)
                  .set({ lastSeenAt: now() })
                  .where(eq(s.device.id, device.id));
                yield* syncDeviceGroups(device.organizationId, device.id);

                return;
              }

              if (Predicate.isTagged("CheckOut")(event)) {
                if (event.userId) {
                  yield* db
                    .delete(s.deviceAppleUser)
                    .where(
                      and(
                        eq(s.deviceAppleUser.deviceId, device.id),
                        eq(s.deviceAppleUser.userId, event.userId),
                      ),
                    );
                  yield* db
                    .update(s.device)
                    .set({ lastSeenAt: now() })
                    .where(eq(s.device.id, device.id));
                  yield* syncDeviceGroups(device.organizationId, device.id);

                  return;
                }

                yield* db
                  .update(s.device)
                  .set({ status: "unenrolled", lastSeenAt: now() })
                  .where(eq(s.device.id, device.id));
                // Nothing queued for a device that left management can ever be
                // delivered, so close it out instead of expiring it later.
                yield* db
                  .update(s.deviceCommand)
                  .set({
                    status: "cancelled",
                    dedupeKey: null,
                    resultStatus: RECONCILED_RESULT_STATUS,
                    resultDetail: "The device unenrolled before the command was delivered.",
                    updatedAt: now(),
                  })
                  .where(
                    and(
                      eq(s.deviceCommand.deviceId, device.id),
                      inArray(s.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES]),
                    ),
                  );

                if (device.status !== "unenrolled")
                  yield* writeSystemAudit(
                    db,
                    {
                      organizationId: device.organizationId,
                      action: SYSTEM_AUDIT_ACTIONS.deviceCheckedOut,
                      targetType: "device",
                      targetId: device.id,
                      metadata: { platform: "apple", previousStatus: device.status },
                    },
                    { authSecret },
                  );
                yield* db
                  .update(s.deviceApple)
                  .set({
                    token: null,
                    pushMagic: null,
                    topic: null,
                    unlockToken: null,
                    tokenUpdatedAt: null,
                  })
                  .where(eq(s.deviceApple.deviceId, device.id));
                // A device that checked out must not be able to renew its old
                // SCEP identity. There is no admin audit context on this
                // protocol path, so the revokedAt timestamp is the record.
                yield* db
                  .update(s.scepIssuedCertificate)
                  .set({ revokedAt: now() })
                  .where(
                    and(
                      inArray(s.scepIssuedCertificate.deviceId, certificateDeviceIdsFor(device)),
                      eq(s.scepIssuedCertificate.organizationId, device.organizationId),
                      isNull(s.scepIssuedCertificate.revokedAt),
                    ),
                  );
                yield* syncDeviceGroups(device.organizationId, device.id);

                return;
              }

              if (Predicate.isTagged("CommandResult")(event)) {
                const [command] = yield* db
                  .select()
                  .from(s.deviceCommand)
                  .where(
                    and(
                      eq(s.deviceCommand.id, event.commandUUID),
                      eq(s.deviceCommand.deviceId, device.id),
                    ),
                  )
                  .limit(1);

                const nextStatus = Match.value(event.status).pipe(
                  Match.when("Acknowledged", () => "succeeded"),
                  Match.when("NotNow", () => "deferred"),
                  Match.when("Idle", () => "sent"),
                  Match.orElse(() => "failed"),
                );

                yield* db
                  .update(s.deviceCommand)
                  .set({
                    status: nextStatus,
                    // Terminal commands release their de-duplication key so
                    // the same action can be queued again later.
                    dedupeKey: commandStatusIsActive(nextStatus) ? undefined : null,
                    resultStatus: event.status,
                    resultDetail: event.errorDetail ?? null,
                    updatedAt: now(),
                  })
                  .where(
                    and(
                      eq(s.deviceCommand.id, event.commandUUID),
                      eq(s.deviceCommand.deviceId, device.id),
                    ),
                  );

                // A device can repeat the same result on retries. Only the
                // first transition into failed/deferred is audited, and the
                // detail text (which may echo device data) is not stored.
                if (command && commandFailureTransition(command.status, nextStatus))
                  yield* writeSystemAudit(
                    db,
                    {
                      organizationId: device.organizationId,
                      action:
                        nextStatus === "failed"
                          ? SYSTEM_AUDIT_ACTIONS.commandFailed
                          : SYSTEM_AUDIT_ACTIONS.commandNotNow,
                      targetType: "device_command",
                      targetId: event.commandUUID,
                      metadata: {
                        deviceId: device.id,
                        requestType: command.requestType,
                        resultStatus: event.status,
                      },
                    },
                    { authSecret },
                  );
                // SecurityInfo and InstalledApplicationList responses are
                // attached to the same command result envelope. Persist both
                // idempotently so retries cannot duplicate rows.

                const queryResponses = Option.getOrUndefined(
                  Schema.decodeUnknownOption(PlistValue)(event.queryResponses),
                );

                yield* applySecurityInfo(device, queryResponses, { authSecret });
                yield* applyInstalledApplications(device, queryResponses);

                // `DeviceInformation` answers carry the name Apple reports for
                // itself. An administrator's rename always wins; otherwise the
                // name follows the device while it is still an auto-derived
                // placeholder.
                const reportedName = record(queryResponses)?.DeviceName;

                if (Schema.is(Schema.String)(reportedName) && reportedName.trim()) {
                  const name = reportedName.trim();

                  const nameUpdate: Partial<typeof s.device.$inferInsert> = {
                    physicalName: name,
                  };

                  if (
                    shouldApplyReportedName({
                      currentName: device.name,
                      reportedName: name,
                      placeholders: [
                        device.dmIdentifier,
                        device.serial,
                        device.model,
                        device.physicalName,
                      ],
                    })
                  )
                    nameUpdate.name = name;

                  yield* db.update(s.device).set(nameUpdate).where(eq(s.device.id, device.id));
                }

                yield* db
                  .update(s.device)
                  .set({ lastSeenAt: now() })
                  .where(eq(s.device.id, device.id));
                yield* syncDeviceGroups(device.organizationId, device.id);

                // A device-reported install failure is drift too: re-queue it
                // while the app is still assigned and the retry budget allows.
                if (command?.requestType === "InstallApplication" && nextStatus === "failed")
                  yield* requeueMissingInstalls(
                    device,
                    [{ requestType: command.requestType, payload: command.payload }],
                    now(),
                  ).pipe(
                    Effect.catch((error) =>
                      Effect.logWarning(
                        `Failed to re-queue install ${command.id}: ${String(error)}`,
                      ),
                    ),
                  );
                // A fresh inventory is evidence about every other command the
                // device has in flight, not just the one it is answering.
                yield* reconcileCommands(device);

                return;
              }

              if (Predicate.isTagged("DeclarationStatus")(event)) {
                yield* updateInventoryFromStatus(
                  device.id,
                  device.organizationId,
                  Option.getOrUndefined(Schema.decodeUnknownOption(PlistValue)(event.statusItems)),
                  { authSecret },
                );
                yield* syncDeviceGroups(device.organizationId, device.id);

                return;
              }

              yield* db
                .update(s.device)
                .set({ lastSeenAt: now() })
                .where(eq(s.device.id, device.id));
              yield* syncDeviceGroups(device.organizationId, device.id);
            }).pipe(
              Effect.mapError((cause) => (cause instanceof UnknownDevice ? cause : internal())),
            );
          }),
        ),

      appleManagementCheckin: (
        scope: CheckinScope,
      ): Effect.Effect<
        ManagementManifest,
        UnknownDevice | ServerInitiatedUnenrollment | InternalServerError
      > =>
        provideDb(
          Effect.gen(function* () {
            const device = yield* requireDevice(scope);
            yield* bindAppleIdentityCertificate(device, scope);

            if (device.status === "unenrolling")
              return yield* Effect.fail(new ServerInitiatedUnenrollment());

            if (device.status !== "enrolled") return { _tag: "Idle" as const };
            // Commands are only meaningful inside their delivery budget. Expire
            // the ones that ran out of time instead of handing a three-week-old
            // lock to a device that just came back online, then retry the ones
            // the device deferred or never acknowledged. Re-sending the same
            // command UUID is idempotent for the device.
            const at = now();

            const activeCommands = yield* db
              .select()
              .from(s.deviceCommand)
              .where(
                and(
                  eq(s.deviceCommand.deviceId, device.id),
                  inArray(s.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES]),
                ),
              )
              .orderBy(asc(s.deviceCommand.createdAt))
              .limit(DEVICE_COMMAND_ACTIVE_LIMIT);

            const delivery = planCommandDelivery(activeCommands, at);

            if (delivery.expire.length > 0)
              yield* db
                .update(s.deviceCommand)
                .set({
                  status: "expired",
                  dedupeKey: null,
                  resultStatus: RECONCILED_RESULT_STATUS,
                  resultDetail: COMMAND_EXPIRED_DETAIL,
                  updatedAt: at,
                })
                .where(
                  and(
                    eq(s.deviceCommand.deviceId, device.id),
                    inArray(s.deviceCommand.id, [...delivery.expire]),
                  ),
                );

            if (delivery.requeue.length > 0)
              yield* db
                .update(s.deviceCommand)
                .set({ status: "queued", updatedAt: at })
                .where(
                  and(
                    eq(s.deviceCommand.deviceId, device.id),
                    inArray(s.deviceCommand.id, [...delivery.requeue]),
                  ),
                );

            const command = delivery.deliver;

            if (command) {
              yield* db
                .update(s.deviceCommand)
                .set({ status: "sent", updatedAt: at })
                .where(
                  and(eq(s.deviceCommand.id, command.id), eq(s.deviceCommand.deviceId, device.id)),
                );

              return {
                _tag: "Command" as const,
                commandUUID: command.id,
                requestType: command.requestType,
                payload: command.payload ?? {},
              };
            }

            const deviceToken = yield* deviceTokenFor(device.id);

            const items = yield* declarationItemsForDevice(device.id, deviceToken, {
              origin,
              authSecret: authSecret ?? "",
            }).pipe(Effect.mapError(internal));

            const token = yield* Effect.tryPromise({
              try: () =>
                hashToken(
                  [
                    ...items.activations,
                    ...items.configurations,
                    ...items.assets,
                    ...items.management,
                  ].map((item) => `${item.identifier}_MTTX_${item.serverToken}`),
                ),
              catch: internal,
            });

            if (device.ddmDeclarationsToken === token) return { _tag: "Idle" as const };

            // Do not persist the token here: that would mark the sync complete
            // before the device has fetched anything. The declaration
            // endpoints record it once the device actually asks for content.
            return { _tag: "DdmSync" as const, serverToken: token };
          }).pipe(
            Effect.mapError((cause) =>
              cause instanceof UnknownDevice || cause instanceof ServerInitiatedUnenrollment
                ? cause
                : internal(),
            ),
          ),
        ),

      getAppleBootstrapToken: (scope) =>
        provideDb(
          Effect.gen(function* () {
            const device = yield* requireDevice(scope);

            const [sealed] = yield* db
              .select({ sealedValue: s.deviceSecret.sealedValue })
              .from(s.deviceSecret)
              .where(
                and(
                  eq(s.deviceSecret.deviceId, device.id),
                  eq(s.deviceSecret.kind, "bootstrap_token"),
                ),
              )
              .limit(1);

            if (sealed && authSecret) {
              const token = yield* Effect.promise(() =>
                openSecret(authSecret, sealed.sealedValue).catch(() => null),
              );

              if (token) return token;
            }

            // Pre-sealing rows kept the token in the clear. Read them until the
            // device sends `SetBootstrapToken` again.
            const [apple] = yield* db
              .select({ bootstrapToken: s.deviceApple.bootstrapToken })
              .from(s.deviceApple)
              .where(eq(s.deviceApple.deviceId, device.id))
              .limit(1);

            return apple?.bootstrapToken ?? null;
          }).pipe(
            Effect.mapError((cause) => (cause instanceof UnknownDevice ? cause : internal())),
          ),
        ),

      getAppleDeclarationTokens: (
        scope: CheckinScope,
      ): Effect.Effect<DdmTokens, UnknownDevice | InternalServerError> =>
        provideDb(
          Effect.gen(function* () {
            const device = yield* requireDevice(scope);
            const deviceToken = yield* deviceTokenFor(device.id);

            const items = yield* declarationItemsForDevice(device.id, deviceToken, {
              origin,
              authSecret: authSecret ?? "",
            }).pipe(Effect.mapError(internal));

            const categoryToken = (category: keyof DdmDeclarationItems) =>
              hashToken(
                items[category].map((item) => `${item.identifier}_MTTX_${item.serverToken}`),
              );

            const tokens = yield* Effect.tryPromise({
              try: async () => ({
                activationsToken: await categoryToken("activations"),
                configurationsToken: await categoryToken("configurations"),
                assetsToken: await categoryToken("assets"),
                managementToken: await categoryToken("management"),
                declarationsToken: await hashToken(
                  [
                    ...items.activations,
                    ...items.configurations,
                    ...items.assets,
                    ...items.management,
                  ].map((item) => `${item.identifier}_MTTX_${item.serverToken}`),
                ),
              }),
              catch: internal,
            });

            // The device has now fetched the sync token, so this version has
            // been observed. Persist it to stop repeating the DDM sync prompt.
            yield* db
              .update(s.device)
              .set({ ddmDeclarationsToken: tokens.declarationsToken })
              .where(eq(s.device.id, device.id))
              .pipe(Effect.mapError(internal));

            return tokens;
          }),
        ),

      getAppleDeclarationItems: (
        scope: CheckinScope,
      ): Effect.Effect<DdmDeclarationItems, UnknownDevice | InternalServerError> =>
        provideDb(
          Effect.gen(function* () {
            const device = yield* requireDevice(scope);
            const deviceToken = yield* deviceTokenFor(device.id);

            const items = yield* declarationItemsForDevice(device.id, deviceToken, {
              origin,
              authSecret: authSecret ?? "",
            }).pipe(Effect.mapError(internal));

            const token = yield* Effect.tryPromise({
              try: () =>
                hashToken(
                  [
                    ...items.activations,
                    ...items.configurations,
                    ...items.assets,
                    ...items.management,
                  ].map((item) => `${item.identifier}_MTTX_${item.serverToken}`),
                ),
              catch: internal,
            });

            yield* db
              .update(s.device)
              .set({ ddmDeclarationsToken: token })
              .where(eq(s.device.id, device.id))
              .pipe(Effect.mapError(internal));

            return items;
          }),
        ),

      getAppleDeclaration: (scope: CheckinScope, type: string, identifier: string) =>
        provideDb(
          Effect.gen(function* () {
            const device = yield* requireDevice(scope);
            const deviceToken = yield* deviceTokenFor(device.id);

            const context: DeclarationContext = {
              origin,
              authSecret: authSecret ?? "",
              deviceToken,
              deviceId: device.id,
            };

            if (type === "activation" && identifier === DEVICE_INFORMATION_ACTIVATION_ID) {
              return {
                Type: "com.apple.activation.simple",
                Identifier: DEVICE_INFORMATION_ACTIVATION_ID,
                ServerToken: DEVICE_INFORMATION_ACTIVATION_SERVER_TOKEN,
                Payload: { StandardConfigurations: [DEVICE_INFORMATION_CONFIGURATION_ID] },
              };
            }

            if (type === "activation") {
              const rows = yield* scopedConfigurations(device.id).pipe(Effect.mapError(internal));

              const configurations = rows
                .filter((row) => row.groupId === identifier)
                .map((row) => configurationDeclarationIdentifier(row.policyId, row.kind));

              if (configurations.length === 0) return null;

              return {
                Type: "com.apple.activation.simple",
                Identifier: identifier,
                ServerToken: yield* Effect.tryPromise({
                  try: () => hashToken(configurations),
                  catch: internal,
                }),
                Payload: { StandardConfigurations: configurations },
              };
            }

            if (type === "configuration" && identifier === DEVICE_INFORMATION_CONFIGURATION_ID) {
              return {
                Type: "com.apple.configuration.management.status-subscriptions",
                Identifier: DEVICE_INFORMATION_CONFIGURATION_ID,
                ServerToken: yield* Effect.promise(() => deviceInformationConfigurationToken()),
                Payload: { StatusItems: DEVICE_INFORMATION_STATUS_ITEMS.map((Name) => ({ Name })) },
              };
            }

            if (type === "configuration") {
              const { policyId, kind } = splitConfigurationDeclarationIdentifier(identifier);

              const rows = yield* scopedConfigurations(device.id).pipe(Effect.mapError(internal));

              const row = rows.find((item) => item.policyId === policyId && item.kind === kind);

              if (!row) return null;

              return yield* Effect.tryPromise({
                try: () => buildConfigurationDeclaration(row, context),
                catch: internal,
              });
            }

            if (type === "asset") {
              const parsed = splitConfigurationAssetIdentifier(identifier);

              if (!parsed) return null;

              const rows = yield* scopedConfigurations(device.id).pipe(Effect.mapError(internal));

              const row = rows.find(
                (item) => item.policyId === parsed.policyId && item.kind === parsed.kind,
              );

              if (!row || !isCertificateKind(row.kind)) return null;

              return yield* Effect.tryPromise({
                try: () => buildAssetDeclaration(row, context),
                catch: internal,
              });
            }

            if (type === "management" && identifier === MANAGEMENT_DECLARATION_ID) {
              const [organization] = yield* db
                .select()
                .from(s.organization)
                .where(eq(s.organization.id, device.organizationId))
                .limit(1)
                .pipe(Effect.mapError(internal));

              const branding = organization
                ? resolveTenantBranding(organization)
                : resolveTenantBranding({ name: "Mattrax" });

              return {
                Type: "com.apple.management.organization-info",
                Identifier: MANAGEMENT_DECLARATION_ID,
                ServerToken: MANAGEMENT_DECLARATION_SERVER_TOKEN,
                Payload: {
                  Email: branding.supportEmail,
                  Name: branding.displayName,
                  URL: origin,
                },
              };
            }

            return null;
          }),
        ),

      getAppleAsset: (identityCertificate, identifier, token) =>
        provideDb(
          Effect.gen(function* () {
            const parsed = splitConfigurationAssetIdentifier(identifier);

            if (!parsed) return null;

            const [row] = yield* db
              .select()
              .from(s.configuration)
              .innerJoin(s.policy, eq(s.policy.id, s.configuration.policyId))
              .where(
                and(
                  eq(s.configuration.policyId, parsed.policyId),
                  eq(s.configuration.kind, parsed.kind),
                ),
              )
              .limit(1)
              .pipe(Effect.mapError(internal));

            if (!row || !isCertificateKind(row.configuration.kind)) return null;

            const data = Schema.decodeUnknownOption(Schema.Json)(row.configuration.data);

            if (Option.isNone(data)) return null;

            const configRow: PolicyConfigurationRow = {
              policyId: row.configuration.policyId,
              kind: row.configuration.kind,
              data: data.value,
              hash: row.configuration.hash,
              organizationId: row.policy.organizationId,
            };

            // Tenant-scoped: either the device presents an identity
            // certificate from the owning tenant, or the DDM asset URL carries
            // a valid, unexpired token bound to a device that still belongs to
            // that tenant and is enrolled.
            const tenantAllowed =
              identityCertificate !== undefined &&
              certificateAllowsOrganization(identityCertificate, row.policy.organizationId);

            const assetToken = yield* Effect.tryPromise({
              try: () => verifyAssetRequestToken(authSecret ?? "", token, configRow),
              catch: internal,
            });

            const tokenAllowed = assetToken
              ? yield* Effect.gen(function* () {
                  const [device] = yield* db
                    .select({ organizationId: s.device.organizationId, status: s.device.status })
                    .from(s.device)
                    .where(eq(s.device.id, assetToken.deviceId))
                    .limit(1)
                    .pipe(Effect.mapError(internal));

                  return (
                    device?.organizationId === row.policy.organizationId &&
                    device.status === "enrolled"
                  );
                })
              : false;

            if (!tenantAllowed && !tokenAllowed) return null;

            return buildAssetContent(configRow);
          }),
        ),

      getAppleProfile: (policyId, kind) =>
        provideDb(
          Effect.gen(function* () {
            const [row] = yield* db
              .select()
              .from(s.configuration)
              .where(and(eq(s.configuration.policyId, policyId), eq(s.configuration.kind, kind)))
              .limit(1)
              .pipe(Effect.mapError(internal));

            if (!row) return null;
            const parsed = parseConfigurationKind(row.kind);

            if (parsed.type !== "device" && parsed.type !== "custom") return null;

            const data = Schema.decodeUnknownOption(Schema.Json)(row.data);

            if (Option.isNone(data)) return null;

            return yield* Effect.tryPromise({
              try: () =>
                buildLegacyProfile({
                  policyId: row.policyId,
                  kind: row.kind,
                  data: data.value,
                  hash: row.hash,
                }),
              catch: internal,
            });
          }),
        ),

      ...createWindowsBackend(windowsBackendOptions),
    });
  };

  static readonly layer = (
    origin: string,
    options?: {
      readonly apns?: ApnsService.Service;
      readonly authSecret?: string;
      readonly windowsOrganizationId?: string;
      readonly requireWindowsDeviceIdentity?: boolean;
      readonly requireAppleDeviceIdentity?: boolean;
      readonly planLimits?: PlanLimitsConfig;
      readonly windowsFederated?: Parameters<typeof createWindowsBackend>[0]["federated"];
    },
  ) =>
    Layer.effect(
      ManagementBackend,
      Effect.gen(function* () {
        const db = yield* Db;

        return ManagementBackendEnterpriseLive.make({ db, origin, ...options });
      }),
    );
}

export const enterpriseEnrollmentProfile = (config: {
  origin: string;
  topic: string;
  organizationId: string;
  organizationName?: string;
  supportEmail?: string;
  challenge?: string;
  displayName?: string;
  identifier?: string;
  profileUuid?: string;
}) =>
  buildAppleEnrollmentProfile({
    origin: config.origin,
    topic: config.topic,
    organizationId: config.organizationId,
    organizationName: config.organizationName ?? "Mattrax",
    supportEmail: config.supportEmail,
    challenge: config.challenge ?? crypto.randomUUID(),
    displayName: config.displayName,
    identifier: config.identifier,
    profileUuid: config.profileUuid,
  });

export const policyHash = jsonHash;

export {
  SYSTEM_AUDIT_ACTOR,
  SYSTEM_AUDIT_ACTIONS,
  commandFailureTransition,
  declarationFailedTransition,
  isDeclarationFailure,
  pushInvalidTokenTransition,
  writeSystemAudit,
  type SystemAuditEvent,
  type SystemAuditOptions,
} from "./audit.ts";

export {
  WEBHOOK_DELIVERY_RETENTION_DAYS,
  WEBHOOK_DELIVERY_TIMEOUT_MS,
  WEBHOOK_MAX_RETRY_ATTEMPTS,
  buildWebhookPayload,
  dispatchWebhookEvent,
  generateWebhookSecret,
  pruneWebhookDeliveries,
  retryFailedWebhookDeliveries,
  sendTestWebhook,
  signWebhookDelivery,
  toWebhookEndpointInfo,
  verifyWebhookSignature,
  webhookEventForAuditAction,
  webhookSecretPrefix,
  type WebhookDeliveryOptions,
  type WebhookDeliveryOutcome,
  type WebhookEndpointRow,
  type WebhookEventInput,
  type WebhookPayload,
  type WebhookRetryOptions,
  type WebhookRetryResult,
} from "./webhooks.ts";

export { createScepChallenge, verifyScepChallenge } from "@mattrax/scep";

export {
  ScepRepositoryLive,
  issueScepChallenge,
  scepChallengeId,
  type IssueScepChallengeOptions,
  type IssuedScepChallenge,
} from "./scep.ts";

export * from "./policy.ts";

export * from "./commands.ts";

export * from "./commandMaintenance.ts";

export * from "./policyResolution.ts";

export { resolveEffectivePolicyForDevice } from "./policyResolutionStore.ts";

export * from "./windows.ts";

export * from "./federated.ts";

export {
  parseDeviceInventory,
  normalizeBatteryHealth,
  normalizeBoolean,
  normalizeCapabilities,
  statusItemValue,
  type DeviceInventory,
} from "./inventory.ts";

export {
  parseSecurityInfo,
  type FileVaultStatus,
  type SecurityInfoReport,
} from "./securityInfo.ts";

export {
  APPLE_APPLICATION_INVENTORY_PAYLOAD,
  APPLE_DEVICE_INFORMATION_PAYLOAD,
  parseInstalledApplications,
  type InstalledApplicationReport,
} from "./applications.ts";

export {
  syncDynamicGroup,
  syncDynamicGroupsForDevice,
  syncDynamicGroupsForTenant,
  previewDynamicGroup,
  type DynamicGroupPreview,
  type DynamicGroupSyncOptions,
  type DynamicGroupSyncResult,
} from "./dynamicGroups.ts";

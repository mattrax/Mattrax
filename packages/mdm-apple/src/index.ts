import { Cause, Effect, Layer, Match, Option, Predicate, Schema } from "effect";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import {
  Db,
  deviceLimitForOrganization,
  reconcileApplicationUninstalls,
  recordApplicationInstall,
  schema as s,
} from "@mattrax/enterprise-core";
import type { PlanLimitsConfig } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import {
  DeviceHealthManagementApp,
  appleSoftwareUpdateEnforcementDeclaration,
  appleSoftwareUpdateEnforcementSupported,
  deriveDeviceHealth,
  installerSkipReason,
  osPolicyPlatformForDevice,
  osPolicyRuleFromRow,
  resolveTenantBranding,
  selectInstaller,
  shouldApplyReportedName,
  shouldPushDeviceName,
  appleDeviceNameSettingsPayload,
  appleDeviceNameFromSettingsPayload,
  DEVICE_NAME_PUSH_RETRY_MS,
  APPLE_DEVICE_NAME_MAX_LENGTH,
  latestKnownDeviceName,
  APPLE_LOCK_SCREEN_MESSAGE_CONFIGURATION_KIND,
  APPLICATION_UNINSTALL_DEADLINE_MS,
  LOCK_SCREEN_MESSAGE_PUSH_RETRY_MS,
  isAppleLockScreenMessageDevice,
  isConfirmedMacOsDevice,
  parseAppleLockScreenMessageConfiguration,
  resolveAppleLockScreenMessage,
} from "@mattrax/enterprise-domain";
import type { ApnsService } from "@mattrax/apns";
import { importPrivateKeyJwk, openSecret, pemEncode, sealSecret } from "@mattrax/crypto";
import { PlistValue } from "@mattrax/plist";
import {
  appleOsFamily,
  buildInstallApplicationPayload,
  buildInstallEnterpriseApplicationPayload,
  buildAppleManifest,
  buildScriptProfile,
  createAppleProfileSigner,
  signAppleProfilePlist,
  appleInstallAssetExpiresAt,
  scriptProfileIdentifier,
  signAppleAssetToken,
  appleUploadKind,
  appleUploadSupportsDevice,
  buildRemoveApplicationPayload,
  isAppleIpaUpload,
  verifyAppleAssetToken,
} from "@mattrax/dm-apple";
import { serializePlist } from "@mattrax/plist";
import { buildAdeEnrollmentProfile } from "./adeProfile.js";
import { policyApplicationKey } from "@mattrax/enterprise-domain";
import { resolveAssignedScriptIds, scriptAgentToken } from "@mattrax/enterprise-domain";
import {
  InternalServerError,
  ManagementBackend,
  ServerInitiatedUnenrollment,
  UnknownDevice,
} from "@mattrax/management-backend";
import type {
  AppleDeviceEvent,
  AppleReturnToServiceConfiguration,
  CheckinScope,
  DdmDeclarationItems,
  DdmTokens,
  ManagementManifest,
} from "@mattrax/management-backend";
import { certificateDeviceIdsFor, createWindowsBackend } from "@mattrax/mdm-windows";
import { assignedApplicationIdsForDevice } from "@mattrax/mdm-core";
import { normalizeIssuedCertificateSerial } from "@mattrax/mdm-core";
import { isPlistObject } from "@mattrax/mdm-core";
import type { PlistInput, PlistObject } from "@mattrax/mdm-core";
import { parseDeviceInventory } from "@mattrax/mdm-core";
import {
  APPLE_MANAGED_LOCAL_ADMIN_USERNAME,
  applePasswordHash,
  generateLocalAdminPassword,
  localAdminRotationDue,
  setAutoAdminPasswordPayload,
  parseActivationLockBypassCode,
  parseAppleLocalAccounts,
  parseAppleLostModeLocation,
  parseRecoveryLockVerification,
  parseRotatedRecoveryKey,
  parseSecurityInfo,
} from "@mattrax/mdm-core";
import {
  APPLE_APPLICATION_INVENTORY_PAYLOAD,
  APPLE_DEVICE_INFORMATION_PAYLOAD,
  parseInstalledApplications,
} from "@mattrax/mdm-core";
import { resolveEffectivePolicyForDevice, resolveEffectivePolicyForUser } from "@mattrax/mdm-core";
import { setupIsReady } from "@mattrax/mdm-core";
import { syncDynamicGroupsForDevice } from "@mattrax/mdm-core";
import { deleteDepartedTenantDevice } from "@mattrax/mdm-core";
import { ScepRepositoryLive } from "@mattrax/mdm-core";
import {
  BackgroundDelivery,
  BackgroundDeliveryLive,
  dispatchWebhookEvent,
} from "@mattrax/mdm-core";
import type { BackgroundDeliveryOptions, BackgroundDeliveryService } from "@mattrax/mdm-core";
import { ensureScepCa } from "@mattrax/scep";
import {
  SYSTEM_AUDIT_ACTIONS,
  commandFailureTransition,
  declarationFailedTransition,
  describeAuditFailure,
  writeSystemAudit,
} from "@mattrax/mdm-core";
import type { SystemAuditOptions } from "@mattrax/mdm-core";
import { DEVICE_INFORMATION_BASE_STATUS_ITEMS, appleStatusItemsForDevice } from "@mattrax/mdm-core";
import { appleDeliveryModeChanged, decideAppleDelivery } from "@mattrax/mdm-core";
import { describeSkippedConfigurations, scopeConfigurationsToDevice } from "@mattrax/mdm-core";
import type { SkippedConfiguration } from "@mattrax/mdm-core";
import {
  APPLE_LOCK_SCREEN_PROFILE_IDENTIFIER_PREFIX,
  appleLockScreenProfileIdentifier,
  buildAppleLockScreenProfile,
  buildLegacyProfiles,
  installProfilePayload,
  installedProfiles,
  planLegacyProfileChanges,
  profileDigest,
  readAppleLockScreenProfile,
} from "@mattrax/mdm-core";
import { isScriptProfileIdentifier, planScriptProfileChanges } from "@mattrax/mdm-core";
import type { DesiredScriptProfile } from "@mattrax/mdm-core";
import {
  ACTIVE_COMMAND_STATUSES,
  COMMAND_EXPIRED_DETAIL,
  DEVICE_COMMAND_ACTIVE_LIMIT,
  DEVICE_COMMAND_INSTALL_ATTEMPT_WINDOW_MS,
  RECONCILED_RESULT_STATUS,
  commandDedupeKeyEffect,
  commandStatusIsActive,
  deviceCommandExpiresAt,
  installApplicationTarget,
  isApplicationInstallRequest,
  planCommandDelivery,
  reconcileDeviceCommands,
  shouldRetryInstall,
  shouldRetryInstallBundle,
} from "@mattrax/mdm-core";
import type { CommandPayload } from "@mattrax/mdm-core";
import { parseAppleUserProfiles } from "@mattrax/mdm-core";
import {
  applyEscrowCertificate,
  buildAssetContent,
  buildAssetDeclaration,
  buildConfigurationDeclaration,
  buildLegacyProfile,
  CATALOGUE_APPLICATION_ASSET_KIND,
  catalogueApplicationAssetIdentifier,
  certificateAllowsOrganization,
  configurationAssetIdentifier,
  configurationAssetServerToken,
  configurationDeclarationIdentifier,
  configurationServerToken,
  isApplicationKind,
  isCertificateKind,
  parseAppleApplicationConfiguration,
  parseCatalogueApplicationAssetIdentifier,
  parseConfigurationKind,
  splitConfigurationAssetIdentifier,
  splitConfigurationDeclarationIdentifier,
  verifyAssetRequestToken,
} from "@mattrax/mdm-core";
import type {
  AppleApplicationConfiguration,
  DeclarationContext,
  PolicyConfigurationRow,
} from "@mattrax/mdm-core";

const DEVICE_INFORMATION_ACTIVATION_ID = "DAAF574F-36D4-4089-B2E3-D2008B65D5BE";

const DEVICE_INFORMATION_ACTIVATION_SERVER_TOKEN = "660CF896-1647-4FAD-B8A8-7A2190B5B554";

const DEVICE_INFORMATION_CONFIGURATION_ID = "13DE3EE0-D5A8-46E9-B967-27E56A4D918F";

const MANAGEMENT_DECLARATION_ID = "F8C4C3A1-2B6E-4D7F-A9E5-3C8B7D9E2F4A";

const MANAGEMENT_DECLARATION_SERVER_TOKEN = "CFC79DC6-B2A3-434D-8F2A-E03E11197A67";

/**
 * Built-in DDM software-update enforcement declaration.
 *
 * The declaration is generated from the tenant OS policy rather than stored
 * as a policy configuration, so an enforcing rule reaches every supervised
 * Apple device without the operator assigning a policy to a group.
 */
export const OS_UPDATE_ENFORCEMENT_ACTIVATION_ID = "2E0D4D7C-6F16-4A8C-9D28-2B7C3A1F5E90";

export const OS_UPDATE_ENFORCEMENT_ACTIVATION_SERVER_TOKEN = "B0F7C8A4-7D3E-42B1-8A5C-6C1E9D2F4A73";

export const OS_UPDATE_ENFORCEMENT_CONFIGURATION_ID = "C6A1E9D4-3B72-4F58-8E0A-7D5B2C4F1A96";

/**
 * Base DDM status subscription. Devices also subscribe the platform-specific
 * items from `statusItems.ts`; this export is the always-present subset.
 */
export const DEVICE_INFORMATION_STATUS_ITEMS = DEVICE_INFORMATION_BASE_STATUS_ITEMS;

const id = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

/**
 * A serial-only Apple re-enrollment may reclaim a row the tenant already owns
 * when the row has gone quiet for this long, even without an ABM assignment or
 * pre-registration. Matches the default maintenance stale-device window.
 */
const APPLE_SERIAL_RECLAIM_STALE_MS = 30 * 24 * 60 * 60 * 1000;

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

/**
 * Return an Apps and Books licence after the device proved the app is gone.
 *
 * Wired by the deployment host so this package does not depend on the VPP
 * client; resolves false when the licence could not be returned.
 */
export type AppleVppLicenceRelease = (input: {
  /** Connection owned by the caller; the release runs inside its check-in. */
  readonly db: Db["Service"];
  readonly organizationId: string;
  readonly deviceId: string;
  readonly adamId: string;
}) => Promise<boolean>;

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

    yield* (
      db
        .update(s.scepIssuedCertificate)
        // Legacy rows keyed by `device.dmIdentifier` are migrated to the internal
        // id as they are seen, matching the Windows path.
        .set({ deviceId: device.id })
        .where(
          and(
            eq(s.scepIssuedCertificate.serial, certificate.serial),
            eq(s.scepIssuedCertificate.organizationId, device.organizationId),
          ),
        )
    );
  });

type ScopedConfiguration = PolicyConfigurationRow & { readonly groupId: string };

type ScopedConfigurations = {
  readonly configurations: ReadonlyArray<ScopedConfiguration>;
  /** Configurations filtered out because the device's OS cannot apply them. */
  readonly skipped: ReadonlyArray<SkippedConfiguration>;
  /**
   * The winning lock screen message default for this device, if a policy
   * provides one. It is resolved here because this is already the one place a
   * check-in resolves the device's effective policy.
   */
  readonly lockScreenMessage:
    | (NonNullable<ReturnType<typeof parseAppleLockScreenMessageConfiguration>> & {
        readonly policyName?: string;
      })
    | undefined;
};

/**
 * The policy configurations the device can actually apply, after precedence
 * resolution and OS scoping.
 *
 * `mode` selects the certificate representation: a DDM certificate declaration
 * needs macOS 14/iOS 17, while the legacy path installs a `pkcs1` profile on
 * much older releases.
 */
const scopedConfigurations = (
  device: DeviceRow,
  mode: "ddm" | "legacy",
): Effect.Effect<ScopedConfigurations, unknown, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;

    // Precedence and exclusions live in the shared resolver so Apple, Windows
    // and the effective-policy API all agree.
    const effective = yield* resolveEffectivePolicyForDevice(db, device);

    // The lock screen default is an imperative command, not a declaration.
    // Keep the winning configuration out of the declaration pipeline and hand
    // it to the check-in's re-apply logic instead.
    const lockScreenConfiguration = effective.configurations.find(
      (configuration) => configuration.kind === APPLE_LOCK_SCREEN_MESSAGE_CONFIGURATION_KIND,
    );

    const lockScreenMessage = lockScreenConfiguration
      ? (() => {
          const parsed = parseAppleLockScreenMessageConfiguration(lockScreenConfiguration.data);

          return parsed ? { ...parsed, policyName: lockScreenConfiguration.policyName } : undefined;
        })()
      : undefined;

    const rows: Array<ScopedConfiguration> = effective.configurations.map((configuration) => ({
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

    const scoped = yield* Effect.promise(() =>
      scopeConfigurationsToDevice<ScopedConfiguration>(rows, device, mode),
    );

    return {
      configurations: scoped.delivered.filter(
        (configuration) => configuration.kind !== APPLE_LOCK_SCREEN_MESSAGE_CONFIGURATION_KIND,
      ),
      skipped: scoped.skipped,
      lockScreenMessage,
    };
  });

/** The delivery mode last recorded for a device. */
const recordedDeliveryMode = (mode: string | null | undefined): "ddm" | "legacy" =>
  mode === "legacy" ? "legacy" : "ddm";

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

type OsUpdateEnforcement = {
  readonly serverToken: string;
  readonly declaration: NonNullable<ReturnType<typeof appleSoftwareUpdateEnforcementDeclaration>>;
};

/**
 * The tenant OS policy compiled to a DDM declaration for one device.
 *
 * Delivery conditions are deliberately conservative: only DDM devices whose
 * OS Apple supports, whose enrolment is supervised, and whose platform rule is
 * `enforce` get the declaration. Everything else is left to the explicit
 * `ScheduleOSUpdate` fallback. A `warn` rule changes no device, so it emits
 * nothing. The server token is derived from the rule and its timestamp, so a
 * rule edit (including a deferral restart) makes the device fetch it again.
 */
const osUpdateEnforcementForDevice = (
  device: DeviceRow,
  mode: "ddm" | "legacy",
): Effect.Effect<OsUpdateEnforcement | null, ReturnType<typeof internal>, Db> =>
  Effect.gen(function* () {
    if (mode !== "ddm") return null;

    const platform = osPolicyPlatformForDevice(device);

    if (!platform || platform === "windows" || platform === "android") return null;

    if (!appleSoftwareUpdateEnforcementSupported(device)) return null;

    const db = yield* Db;

    const [apple] = yield* db
      .select({ enrollmentMode: s.deviceApple.enrollmentMode })
      .from(s.deviceApple)
      .where(eq(s.deviceApple.deviceId, device.id))
      .limit(1);

    // A user-enrolled device is BYOD and cannot apply a system-scoped,
    // supervised declaration. Apple only allows supervised enrolment.
    if (apple?.enrollmentMode === "user") return null;

    const [row] = yield* db
      .select({
        platform: s.tenantOsPolicy.platform,
        minimumVersion: s.tenantOsPolicy.minimumVersion,
        enforcement: s.tenantOsPolicy.enforcement,
        deferralDays: s.tenantOsPolicy.deferralDays,
        updatedAt: s.tenantOsPolicy.updatedAt,
      })
      .from(s.tenantOsPolicy)
      .where(
        and(
          eq(s.tenantOsPolicy.organizationId, device.organizationId),
          eq(s.tenantOsPolicy.platform, platform),
        ),
      )
      .limit(1);

    if (!row) return null;

    const declaration = appleSoftwareUpdateEnforcementDeclaration(osPolicyRuleFromRow(row));

    if (!declaration) return null;

    const serverToken = (yield* Effect.promise(() =>
      hashToken(
        JSON.stringify({
          identifier: OS_UPDATE_ENFORCEMENT_CONFIGURATION_ID,
          platform,
          updatedAt: row.updatedAt.toISOString(),
          declaration,
        }),
      ),
    )).toUpperCase();

    return { declaration, serverToken };
  }).pipe(Effect.mapError(internal));

const declarationItemsForDevice = (
  device: DeviceRow,
  deviceToken: string,
  context: Pick<DeclarationContext, "origin" | "authSecret">,
  mode: "ddm" | "legacy",
): Effect.Effect<DdmDeclarationItems, unknown, Db> =>
  Effect.gen(function* () {
    const { configurations: scoped } = yield* scopedConfigurations(device, mode);
    // Application configurations are delivered as imperative install commands,
    // not declarations: there is no declaration type that installs an arbitrary
    // uploaded `.pkg` on every supported OS.
    const rows = scoped.filter((row) => !isApplicationKind(row.kind));
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
      deviceInformationConfigurationToken(appleStatusItemsForDevice(device)),
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

    // The tenant OS policy is a system declaration, not a policy
    // configuration: every supervised DDM device gets the same enforcement
    // target without an assignment. Its activation is separate from the
    // device-information activation so the two tokens change independently.
    const osUpdateEnforcement = yield* osUpdateEnforcementForDevice(device, mode);

    if (osUpdateEnforcement) {
      activations.push({
        identifier: OS_UPDATE_ENFORCEMENT_ACTIVATION_ID,
        serverToken: OS_UPDATE_ENFORCEMENT_ACTIVATION_SERVER_TOKEN,
      });
      configurations.push({
        identifier: OS_UPDATE_ENFORCEMENT_CONFIGURATION_ID,
        serverToken: osUpdateEnforcement.serverToken,
      });
    }

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

/**
 * Bind a Shared iPad channel to the directory person its Managed Apple Account
 * identifies.
 *
 * A Shared iPad login never authenticates, so Apple's only per-user identity is
 * the Managed Apple Account identifier it sends as `UserShortName`. Directory
 * people are keyed by their email, and Apple issues these accounts as email
 * addresses, so an exact match is the correlation. It is the weakest of the
 * three sources (a certificate proves it cryptographically), which is why the
 * binding records `managed-apple-account` and never overwrites an existing one.
 */
const bindManagedAppleAccountIdentity = (
  device: DeviceRow,
  appleUserId: string,
  managedAppleAccount: string | undefined,
): Effect.Effect<void, unknown, Db> =>
  Effect.gen(function* () {
    const email = managedAppleAccount?.trim().toLowerCase();

    if (!email || !email.includes("@")) return;
    const db = yield* Db;

    const [channel] = yield* db
      .select({ directoryUserId: s.deviceAppleUser.directoryUserId })
      .from(s.deviceAppleUser)
      .where(
        and(eq(s.deviceAppleUser.deviceId, device.id), eq(s.deviceAppleUser.userId, appleUserId)),
      )
      .limit(1);

    // A manual or certificate binding always wins.
    if (!channel || channel.directoryUserId) return;

    const [person] = yield* db
      .select({ id: s.user.id, email: s.user.email })
      .from(s.user)
      .where(
        and(
          eq(s.user.organizationId, device.organizationId),
          eq(s.user.email, email),
          eq(s.user.disabled, false),
        ),
      )
      .limit(1);

    if (!person) return;

    yield* db
      .update(s.deviceAppleUser)
      .set({
        directoryUserId: person.id,
        identitySource: "managed-apple-account",
        identityUpn: person.email,
        identityVerifiedAt: now(),
        // A late binding changes the declaration set; force a full sync.
        ddmDeclarationsToken: null,
        updatedAt: now(),
      })
      .where(
        and(eq(s.deviceAppleUser.deviceId, device.id), eq(s.deviceAppleUser.userId, appleUserId)),
      );
  }).pipe(Effect.mapError((cause) => (cause instanceof UnknownDevice ? cause : internal())));

/** The Apple user channel row plus its verified directory binding, if any. */
const boundAppleUser = (
  device: DeviceRow,
  appleUserId: string,
): Effect.Effect<
  {
    readonly directoryUserId: string;
    readonly identitySource: string | null;
    readonly ddmDeclarationsToken: string | null;
  } | null,
  InstanceType<typeof UnknownDevice> | InternalServerError,
  Db
> =>
  Effect.gen(function* () {
    const db = yield* Db;

    const [row] = yield* db
      .select({
        directoryUserId: s.deviceAppleUser.directoryUserId,
        identitySource: s.deviceAppleUser.identitySource,
        identityVerifiedAt: s.deviceAppleUser.identityVerifiedAt,
        ddmDeclarationsToken: s.deviceAppleUser.ddmDeclarationsToken,
      })
      .from(s.deviceAppleUser)
      .where(
        and(eq(s.deviceAppleUser.deviceId, device.id), eq(s.deviceAppleUser.userId, appleUserId)),
      )
      .limit(1);

    if (!row) return yield* Effect.fail(new UnknownDevice());

    // A channel with no verified directory identity receives no user policy.
    // It can still check in for commands, which is why this is `null` rather
    // than an UnknownDevice failure.
    if (!row.directoryUserId || !row.identityVerifiedAt) return null;

    return {
      directoryUserId: row.directoryUserId,
      identitySource: row.identitySource,
      ddmDeclarationsToken: row.ddmDeclarationsToken,
    };
  }).pipe(Effect.mapError((cause) => (cause instanceof UnknownDevice ? cause : internal())));

type UserDeclarationSet = {
  readonly items: DdmDeclarationItems;
  readonly token: string;
  readonly rows: ReadonlyArray<ScopedConfiguration>;
  readonly groups: ReadonlyMap<string, ReadonlyArray<ScopedConfiguration>>;
};

/**
 * Build the declarations one bound user channel should sync.
 *
 * User-scoped configurations only: the resolver for a user already excludes
 * device-scoped settings, and this path is never used for the device channel.
 * Applications are imperative installs, not declarations, so they are skipped
 * exactly as on the device channel.
 */
const userDeclarationItems = (
  device: DeviceRow,
  deviceToken: string,
  context: Pick<DeclarationContext, "origin" | "authSecret">,
  directoryUserId: string,
): Effect.Effect<UserDeclarationSet, unknown, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const effective = yield* resolveEffectivePolicyForUser(db, device, directoryUserId);

    const rows: Array<ScopedConfiguration> = effective.configurations
      .filter((configuration) => !isApplicationKind(configuration.kind))
      .map((configuration) => ({
        policyId: configuration.policyId,
        kind: configuration.kind,
        data: configuration.data,
        hash: configuration.hash ?? "",
        organizationId: device.organizationId,
        groupId:
          configuration.scope === "group"
            ? `user:group:${configuration.groupIds[0] ?? configuration.policyId}`
            : `user:${configuration.policyId}`,
      }));

    const scoped = yield* Effect.promise(() =>
      scopeConfigurationsToDevice<ScopedConfiguration>(rows, device, "ddm"),
    );

    const delivered = scoped.delivered;
    const groups = new Map<string, Array<ScopedConfiguration>>();

    for (const row of delivered) {
      const group = groups.get(row.groupId) ?? [];
      group.push(row);
      groups.set(row.groupId, group);
    }

    const activations = yield* Effect.promise(() =>
      Promise.all(
        [...groups].map(async ([groupId, configurations]) => ({
          identifier: groupId,
          serverToken: await hashToken(
            configurations.map((row) => configurationDeclarationIdentifier(row.policyId, row.kind)),
          ),
        })),
      ),
    );

    const unique = new Map<string, ScopedConfiguration>();

    for (const row of delivered)
      unique.set(configurationDeclarationIdentifier(row.policyId, row.kind), row);

    const configurations = yield* Effect.promise(() =>
      Promise.all(
        [...unique].map(async ([identifier, row]) => ({
          identifier,
          serverToken: await configurationServerToken(row, {
            origin: context.origin,
            deviceToken,
          }),
        })),
      ),
    );

    const assets = yield* Effect.promise(() =>
      Promise.all(
        [...unique.values()].flatMap((row) =>
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

    const items: DdmDeclarationItems = {
      activations,
      configurations,
      assets,
      management: [],
    };

    const token = yield* Effect.promise(() =>
      hashToken(
        [...items.activations, ...items.configurations, ...items.assets, ...items.management].map(
          (item) => `${item.identifier}_MTTX_${item.serverToken}`,
        ),
      ),
    );

    return { items, token, rows: delivered, groups };
  });

/** Persist a user channel's declaration status without touching device inventory. */
const updateUserDeclarationsFromStatus = (
  deviceId: string,
  userId: string,
  statusItems: PlistInput,
  at: Date,
): Effect.Effect<{ readonly changed: boolean }, unknown, Db> =>
  Effect.gen(function* () {
    const root = record(statusItems);

    if (!root) return { changed: false };

    const declarations =
      record(record(root.management)?.declarations) ?? record(root["management.declarations"]);

    if (!declarations) return { changed: false };
    const db = yield* Db;

    const previousRows = yield* db
      .select()
      .from(s.deviceUserDeclaration)
      .where(
        and(
          eq(s.deviceUserDeclaration.deviceId, deviceId),
          eq(s.deviceUserDeclaration.userId, userId),
        ),
      );

    const previous = new Map(previousRows.map((row) => [row.identifier, row]));

    let changed = false;

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

        const before = previous.get(identifier);

        if (
          !before ||
          before.valid !== valid ||
          before.active !== active ||
          before.serverToken !== serverToken ||
          before.declarationType !== declarationType
        )
          changed = true;

        yield* db
          .insert(s.deviceUserDeclaration)
          .values({
            deviceId,
            userId,
            identifier,
            declarationType,
            active,
            valid,
            serverToken,
            reasons: entry.Reasons ?? entry.reasons ?? null,
            updatedAt: at,
          })
          .onDuplicateKeyUpdate({
            set: {
              declarationType,
              active,
              valid,
              serverToken,
              reasons: entry.Reasons ?? entry.reasons ?? null,
              updatedAt: at,
            },
          });
      }
    }

    return { changed };
  });

type AppleStatusReportOutcome = {
  readonly inventoryChanged: boolean;
  readonly declarationsChanged: boolean;
  readonly healthChanged: boolean;
};

const emptyStatusOutcome = (): AppleStatusReportOutcome => ({
  inventoryChanged: false,
  declarationsChanged: false,
  healthChanged: false,
});

const updateInventoryFromStatus = (
  deviceId: string,
  organizationId: string,
  statusItems: PlistInput,
  options: SystemAuditOptions = {},
): Effect.Effect<AppleStatusReportOutcome, unknown, Db> =>
  Effect.gen(function* () {
    const root = record(statusItems);

    if (!root) return emptyStatusOutcome();
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
      passcodePresent: device.passcodePresent,
      passcodeCompliant: device.passcodeCompliant,
      osUpdateInstallState: device.osUpdateInstallState,
      osUpdatePendingVersion: device.osUpdatePendingVersion,
      osUpdateFailureCount: device.osUpdateFailureCount,
      managedCertificateCount: device.managedCertificateCount,
      managementApps: Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.Array(DeviceHealthManagementApp))(device.managementApps),
      ),
    });

    const previousHealth = deviceBefore
      ? deriveDeviceHealth(healthInput(deviceBefore, declarationsBefore))
      : null;

    const auditComplianceChange = (
      next: ReturnType<typeof deriveDeviceHealth>,
    ): Effect.Effect<boolean, unknown, never> =>
      previousHealth && previousHealth.level !== next.level
        ? writeSystemAudit(
            db,
            {
              organizationId,
              action: SYSTEM_AUDIT_ACTIONS.complianceChanged,
              targetType: "device",
              targetId: deviceId,
              deviceId,
              protocol: "apple",
              metadata: {
                from: previousHealth.level,
                to: next.level,
                reasons: next.reasons.map((reason) => reason.code).slice(0, 10),
              },
            },
            options,
          ).pipe(Effect.as(true))
        : Effect.succeed(false);

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

    if (inventory.passcodePresent !== undefined) update.passcodePresent = inventory.passcodePresent;

    if (inventory.passcodeCompliant !== undefined)
      update.passcodeCompliant = inventory.passcodeCompliant;

    if (inventory.osUpdateInstallState !== undefined)
      update.osUpdateInstallState = inventory.osUpdateInstallState;

    if (inventory.osUpdatePendingVersion !== undefined)
      update.osUpdatePendingVersion = inventory.osUpdatePendingVersion;

    if (inventory.osUpdatePendingBuild !== undefined)
      update.osUpdatePendingBuild = inventory.osUpdatePendingBuild;

    if (inventory.osUpdateFailureReason !== undefined)
      update.osUpdateFailureReason = inventory.osUpdateFailureReason;

    if (inventory.osUpdateFailureCount !== undefined)
      update.osUpdateFailureCount = inventory.osUpdateFailureCount;

    if (inventory.osUpdateFailedAt !== undefined)
      update.osUpdateFailedAt = inventory.osUpdateFailedAt;

    if (inventory.securityLockdownMode !== undefined)
      update.securityLockdownMode = inventory.securityLockdownMode;

    if (inventory.managedCertificateCount !== undefined)
      update.managedCertificateCount = inventory.managedCertificateCount;

    if (inventory.managementApps !== undefined) update.managementApps = inventory.managementApps;

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
      inventory.diskTotal !== undefined ||
      inventory.passcodePresent !== undefined ||
      inventory.passcodeCompliant !== undefined ||
      inventory.osUpdateInstallState !== undefined ||
      inventory.osUpdatePendingVersion !== undefined ||
      inventory.osUpdateFailureCount !== undefined ||
      inventory.securityLockdownMode !== undefined ||
      inventory.managedCertificateCount !== undefined ||
      inventory.managementApps !== undefined;

    if (hasInventory) update.inventoryUpdatedAt = now();
    yield* db.update(s.device).set(update).where(eq(s.device.id, deviceId));

    // FileVault is usually enabled days after enrolment, which is also when the
    // escrowed recovery key is first written. Fetch it as soon as the status
    // report shows the disk encrypted rather than waiting for an administrator.
    if (deviceBefore?.fileVaultEnabled !== true && inventory.fileVaultEnabled === true)
      yield* enqueueSecurityInfo({ id: deviceId, organizationId }, now());

    // Apple sends status items as a nested path tree; some clients flatten the
    // keys. Accept both shapes.
    const declarations =
      record(record(root.management)?.declarations) ?? record(root["management.declarations"]);

    // `Object.fromEntries` keeps this readable without asserting the device
    // row to an index-signature type: the key came from `update`, which is a
    // partial device patch.
    // Timestamps move on every report even when the device's inventory is
    // identical, so they are not part of the comparison.
    const NON_INVENTORY_COLUMNS = new Set(["lastSeenAt", "inventoryUpdatedAt"]);
    const beforeValues = Object.fromEntries(Object.entries(deviceBefore ?? {}));

    const inventoryChanged = Object.entries(update).some(
      ([key, value]) =>
        !NON_INVENTORY_COLUMNS.has(key) &&
        JSON.stringify(value ?? null) !== JSON.stringify(beforeValues[key] ?? null),
    );

    if (!declarations) {
      // Inventory-only report: the compliance rollup may still have moved
      // (storage, battery, FileVault), so compare it before returning.
      const healthChanged = deviceBefore
        ? yield* auditComplianceChange(
            deriveDeviceHealth(healthInput({ ...deviceBefore, ...update }, declarationsBefore)),
          )
        : false;

      return { inventoryChanged, declarationsChanged: false, healthChanged };
    }

    const timestamp = now();
    // Status reports arrive on every check-in. The previous declaration states
    // were read before the write so audit events fire only on a transition.
    const previousValid = new Map<string, string>();
    const previousRows = new Map(declarationsBefore.map((row) => [row.identifier, row]));

    for (const row of declarationsBefore) previousValid.set(row.identifier, row.valid);

    let declarationsChanged = false;

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

        const before = previousRows.get(identifier);

        if (
          !before ||
          before.valid !== valid ||
          before.active !== active ||
          before.serverToken !== serverToken ||
          before.declarationType !== declarationType
        )
          declarationsChanged = true;

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

      const healthChanged = yield* auditComplianceChange(
        deriveDeviceHealth(healthInput({ ...deviceBefore, ...update }, declarationsAfter)),
      );

      return { inventoryChanged, declarationsChanged, healthChanged };
    }

    return { inventoryChanged, declarationsChanged, healthChanged: false };
  });

/**
 * Seal and upsert one escrowed device secret. Re-reporting the same value only
 * refreshes `updatedAt`; `rotatedAt` moves when the plaintext changes.
 */
const writeDeviceSecret = (
  device: Pick<DeviceRow, "id" | "organizationId">,
  kind:
    | "filevault_recovery_key"
    | "bootstrap_token"
    | "activation_lock_bypass_code"
    | "recovery_lock_password"
    | "local_admin_password"
    | "local_admin_password_pending",
  plaintext: string,
  authSecret: string | undefined,
  options: { readonly format?: "plaintext" | "cms"; readonly commandId?: string } = {},
): Effect.Effect<void, unknown, Db> =>
  Effect.gen(function* () {
    const format = options.format ?? "plaintext";

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
        format,
        pendingCommandId: options.commandId ?? null,
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
      format,
      pendingCommandId: options.commandId ?? null,
      updatedAt: timestamp,
    };

    if (!unchanged) secretUpdate.rotatedAt = timestamp;

    yield* db
      .update(s.deviceSecret)
      .set(secretUpdate)
      .where(and(eq(s.deviceSecret.deviceId, device.id), eq(s.deviceSecret.kind, kind)));
  });

/**
 * Queue a `SecurityInfo` refresh. Used at enrolment, when FileVault flips on,
 * after bootstrap-token rotation and by maintenance. The de-duplication index
 * makes repeated triggers collapse into the request already in flight.
 */
const enqueueSecurityInfo = (
  device: Pick<DeviceRow, "id" | "organizationId">,
  at: Date,
): Effect.Effect<void, unknown, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const commandId = crypto.randomUUID();
    const payload = {};
    const dedupeKey = yield* commandDedupeKeyEffect("SecurityInfo", payload);

    yield* db
      .insert(s.deviceCommand)
      .values({
        id: commandId,
        organizationId: device.organizationId,
        deviceId: device.id,
        requestType: "SecurityInfo",
        payload,
        status: "queued",
        dedupeKey,
        expiresAt: deviceCommandExpiresAt("SecurityInfo", at),
        resultStatus: null,
        resultDetail: null,
        createdAt: at,
        updatedAt: at,
      })
      .onDuplicateKeyUpdate({ set: { requestType: "SecurityInfo" } });

    yield* db
      .update(s.deviceApple)
      .set({ securityInfoRequestedAt: at })
      .where(eq(s.deviceApple.deviceId, device.id));
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

    const [before] = yield* db
      .select({ fileVaultEnabled: s.device.fileVaultEnabled })
      .from(s.device)
      .where(eq(s.device.id, device.id))
      .limit(1);

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
        report.recoveryKey.value,
        options.authSecret,
        { format: report.recoveryKey.format },
      );

    const appleUpdate: Partial<typeof s.deviceApple.$inferInsert> = {
      securityInfoUpdatedAt: timestamp,
    };

    if (report.bootstrapTokenEscrowed !== undefined)
      appleUpdate.bootstrapTokenEscrowed = report.bootstrapTokenEscrowed;

    if (report.isActivationLockManageable !== undefined)
      appleUpdate.isActivationLockManageable = report.isActivationLockManageable;

    yield* db.update(s.deviceApple).set(appleUpdate).where(eq(s.deviceApple.deviceId, device.id));

    // FileVault turned on between the status report and this answer, and the
    // device did not have a wrapped key yet: ask for one more report so the key
    // written to /var/db/FileVaultPRK.dat is collected.
    if (
      report.fileVaultStatus === "enabled" &&
      before?.fileVaultEnabled !== true &&
      report.recoveryKey === undefined &&
      report.fileVaultHasPersonalRecoveryKey !== false
    )
      yield* enqueueSecurityInfo(device, timestamp);
  });

/**
 * Replace the device's installed-application inventory with the latest full
 * report. An empty report clears every row; a missing report is ignored.
 */
const applyInstalledApplications = (
  device: Pick<DeviceRow, "id" | "organizationId">,
  queryResponses: PlistInput,
  options: { readonly releaseVppLicence?: AppleVppLicenceRelease } = {},
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

    const transitions = yield* reconcileApplicationUninstalls(db, {
      deviceId: device.id,
      organizationId: device.organizationId,
      applications,
      at: timestamp,
    });

    // A returned licence frees the seat for another device, but only now that
    // this device reported the app gone. A release failure is logged: the
    // uninstall itself already succeeded and the licence can be returned from
    // the Apps and Books page.
    for (const transition of transitions) {
      if (transition.status !== "succeeded" || !transition.adamId) continue;

      const release = options.releaseVppLicence;

      if (!release) continue;

      const [assignment] = yield* db
        .select({ adamId: s.deviceVppAssignment.adamId })
        .from(s.deviceVppAssignment)
        .where(
          and(
            eq(s.deviceVppAssignment.organizationId, device.organizationId),
            eq(s.deviceVppAssignment.deviceId, device.id),
            eq(s.deviceVppAssignment.adamId, transition.adamId),
            eq(s.deviceVppAssignment.state, "assigned"),
          ),
        )
        .limit(1);

      if (!assignment) continue;

      const released = yield* Effect.tryPromise({
        try: () =>
          release({
            db,
            organizationId: device.organizationId,
            deviceId: device.id,
            adamId: transition.adamId!,
          }),
        catch: (cause) => cause,
      }).pipe(Effect.catch(() => Effect.succeed(false)));

      if (!released)
        yield* Effect.logWarning(
          `The VPP licence ${transition.adamId} for ${transition.bundleId} on ${device.id} could not be returned after the uninstall`,
        );
    }
  });

/**
 * Replace the local-account inventory from a `UserList` answer.
 *
 * Apple does not report administrator status or last-login time, so those
 * columns stay null; only the managed account Mattrax created is known to be an
 * administrator. The GUID Apple reports for that account is stored on
 * `device_apple` because `SetAutoAdminPassword` needs it.
 */
const applyLocalAccounts = (
  device: Pick<DeviceRow, "id" | "organizationId">,
  queryResponses: PlistInput,
): Effect.Effect<void, unknown, Db> =>
  Effect.gen(function* () {
    const accounts = parseAppleLocalAccounts(queryResponses);

    if (accounts === undefined) return;
    const db = yield* Db;
    const timestamp = now();

    const existing = yield* db
      .select()
      .from(s.deviceLocalAccount)
      .where(eq(s.deviceLocalAccount.deviceId, device.id));

    const byUsername = new Map(existing.map((row) => [row.username, row]));
    const reported = new Set(accounts.map((account) => account.username));

    for (const account of accounts) {
      const current = byUsername.get(account.username);
      const managed = account.username === APPLE_MANAGED_LOCAL_ADMIN_USERNAME;

      const values = {
        organizationId: device.organizationId,
        deviceId: device.id,
        username: account.username,
        fullName: account.fullName ?? null,
        uid: account.uid ?? null,
        guid: account.guid ?? null,
        // Apple does not report admin status. The account Mattrax creates is
        // an admin by construction; every other account is unknown.
        isAdmin: managed ? true : null,
        isManaged: managed,
        hasSecureToken: account.hasSecureToken ?? null,
        isLoggedIn: account.isLoggedIn ?? null,
        mobileAccount: account.mobileAccount ?? null,
        dataQuota: account.dataQuota ?? null,
        dataUsed: account.dataUsed ?? null,
        // Apple never reports this, so preserve a value if a future source did.
        lastLoginAt: current?.lastLoginAt ?? null,
        firstSeenAt: current?.firstSeenAt ?? timestamp,
        lastSeenAt: timestamp,
        reportedAt: timestamp,
      };

      if (current)
        yield* db
          .update(s.deviceLocalAccount)
          .set(values)
          .where(
            and(
              eq(s.deviceLocalAccount.deviceId, device.id),
              eq(s.deviceLocalAccount.username, account.username),
            ),
          );
      else
        yield* db.insert(s.deviceLocalAccount).values({
          id: crypto.randomUUID(),
          ...values,
        });

      if (managed && account.guid)
        yield* db
          .update(s.deviceApple)
          .set({ localAdminGuid: account.guid })
          .where(eq(s.deviceApple.deviceId, device.id));
    }

    const stale = existing.filter((row) => !reported.has(row.username)).map((row) => row.username);

    // A managed account that disappeared is gone; its stale GUID must never be
    // reused for a password rotation.
    if (!accounts.some((account) => account.username === APPLE_MANAGED_LOCAL_ADMIN_USERNAME))
      yield* db
        .update(s.deviceApple)
        .set({ localAdminGuid: null })
        .where(eq(s.deviceApple.deviceId, device.id));

    if (stale.length > 0)
      yield* db
        .delete(s.deviceLocalAccount)
        .where(
          and(
            eq(s.deviceLocalAccount.deviceId, device.id),
            inArray(s.deviceLocalAccount.username, stale),
          ),
        );

    yield* db
      .update(s.deviceApple)
      .set({ localAccountsUpdatedAt: timestamp })
      .where(eq(s.deviceApple.deviceId, device.id));
  });

/**
 * Store the fix Apple returns from `DeviceLocation`. Only a device that is
 * actually in Lost Mode may have a location, so a stale or spoofed answer after
 * Lost Mode ends is ignored.
 */
const applyLostModeLocation = (
  device: Pick<DeviceRow, "id">,
  queryResponses: PlistInput,
): Effect.Effect<void, unknown, Db> =>
  Effect.gen(function* () {
    const location = parseAppleLostModeLocation(queryResponses);

    if (!location) return;
    const db = yield* Db;

    const [apple] = yield* db
      .select({ lostModeEnabled: s.deviceApple.lostModeEnabled })
      .from(s.deviceApple)
      .where(eq(s.deviceApple.deviceId, device.id))
      .limit(1);

    if (apple?.lostModeEnabled !== true) return;

    const timestamp = now();

    yield* db
      .update(s.deviceApple)
      .set({
        lostModeLatitude: String(location.latitude),
        lostModeLongitude: String(location.longitude),
        lostModeHorizontalAccuracy:
          location.horizontalAccuracy === undefined ? null : String(location.horizontalAccuracy),
        lostModeVerticalAccuracy:
          location.verticalAccuracy === undefined ? null : String(location.verticalAccuracy),
        lostModeLocationReportedAt: location.reportedAt ? new Date(location.reportedAt) : timestamp,
        lostModeLocationUpdatedAt: timestamp,
      })
      .where(eq(s.deviceApple.deviceId, device.id));
  });

/**
 * The tenant's FileVault escrow certificate, when one has been configured.
 * Profiles that escrow recovery keys are rewritten with it so the CMS payload a
 * Mac returns can be unwrapped during a reveal.
 */
const tenantEscrowCertificate = (
  organizationId: string,
): Effect.Effect<string | null, unknown, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;

    const [escrow] = yield* db
      .select({ certificatePem: s.appleFdeEscrowKey.certificatePem })
      .from(s.appleFdeEscrowKey)
      .where(eq(s.appleFdeEscrowKey.organizationId, organizationId))
      .limit(1);

    return escrow?.certificatePem ?? null;
  });

/** Delivery mode recorded for a device, defaulting to declarative management. */
const deliveryModeForDevice = (deviceId: string): Effect.Effect<"ddm" | "legacy", unknown, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;

    const [apple] = yield* db
      .select({ declarationMode: s.deviceApple.declarationMode })
      .from(s.deviceApple)
      .where(eq(s.deviceApple.deviceId, deviceId))
      .limit(1);

    return recordedDeliveryMode(apple?.declarationMode);
  });

/** Queue one imperative command, de-duplicated against identical active work. */
const queueAppleCommand = (
  device: Pick<DeviceRow, "id" | "organizationId">,
  requestType: string,
  payload: CommandPayload,
  at: Date,
): Effect.Effect<{ readonly id: string }, unknown, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;
    const id = crypto.randomUUID();
    const dedupeKey = yield* commandDedupeKeyEffect(requestType, payload);

    yield* (
      db
        .insert(s.deviceCommand)
        .values({
          id,
          organizationId: device.organizationId,
          deviceId: device.id,
          requestType,
          payload,
          status: "queued",
          dedupeKey,
          expiresAt: deviceCommandExpiresAt(requestType, at),
          resultStatus: null,
          resultDetail: null,
          createdAt: at,
          updatedAt: at,
        })
        // A concurrent check-in may have queued the same work first. The no-op
        // update keeps the existing row (and its delivery timer) in place.
        .onDuplicateKeyUpdate({ set: { requestType } })
    );

    return { id };
  });

const base64EncodeBytes = (bytes: Uint8Array): string => {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
};

const base64DecodeBytes = (value: string): Uint8Array => {
  const binary = atob(
    value.replaceAll(/\s/g, "").padEnd(Math.ceil(value.replaceAll(/\s/g, "").length / 4) * 4, "="),
  );

  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

/** Read a lock screen profile out of an `InstallProfile` command payload. */
const lockScreenProfileFromInstallPayload = async (
  payload: Schema.Json | null | undefined,
): Promise<Awaited<ReturnType<typeof readAppleLockScreenProfile>>> => {
  if (!Schema.is(Schema.JsonObject)(payload)) return undefined;

  const encoded = payload["Payload"];

  if (!Schema.is(Schema.String)(encoded)) return undefined;

  try {
    return await readAppleLockScreenProfile(base64DecodeBytes(encoded));
  } catch {
    return undefined;
  }
};

/** Apple only has a local account during macOS Setup Assistant. */
const appleDeviceIsMac = (device: Pick<DeviceRow, "osEdition" | "model">) =>
  isConfirmedMacOsDevice(device);

/**
 * Queue the managed local administrator account for a Mac that is held in
 * Setup Assistant. `SkipPrimarySetupAccountCreation` skips the interactive
 * account pane; `AutoSetupAdminAccounts` creates a hidden admin instead. The
 * password is generated per device, sealed in `device_secret`, and can be
 * revealed to an administrator with a step-up check.
 */
const queueLocalAdminAccount = (
  device: DeviceRow,
  authSecret: string | undefined,
  at: Date,
): Effect.Effect<void, unknown, Db> =>
  Effect.gen(function* () {
    if (!appleDeviceIsMac(device) || !authSecret) return;

    const db = yield* Db;

    const [existing] = yield* db
      .select({ id: s.deviceCommand.id })
      .from(s.deviceCommand)
      .where(
        and(
          eq(s.deviceCommand.deviceId, device.id),
          eq(s.deviceCommand.requestType, "AccountConfiguration"),
          inArray(s.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES, "succeeded"]),
        ),
      )
      .limit(1);

    if (existing) return;

    const password = generateLocalAdminPassword();
    const passwordHash = yield* applePasswordHash(password);

    yield* writeDeviceSecret(device, "local_admin_password", password, authSecret);
    yield* queueAppleCommand(
      device,
      "AccountConfiguration",
      {
        SkipPrimarySetupAccountCreation: true,
        AutoSetupAdminAccounts: [
          {
            shortName: "mattrax-admin",
            fullName: "Mattrax Administrator",
            hidden: true,
            passwordHash,
          },
        ],
        ManagedLocalUserShortName: "mattrax-admin",
      },
      at,
    );
  });

/**
 * Queue `UserList` for a Mac. Apple reports local accounts only on request, so
 * enrolment and the daily sweep are the two moments the inventory is
 * refreshed. The request is rate-limited per device so a Mac that never answers
 * is not asked on every check-in.
 */
const queueLocalAccountsInventory = (
  device: DeviceRow,
  at: Date,
): Effect.Effect<void, unknown, Db> =>
  Effect.gen(function* () {
    if (!appleDeviceIsMac(device)) return;
    const db = yield* Db;

    const [apple] = yield* db
      .select({ localAccountsRequestedAt: s.deviceApple.localAccountsRequestedAt })
      .from(s.deviceApple)
      .where(eq(s.deviceApple.deviceId, device.id))
      .limit(1);

    if (
      apple?.localAccountsRequestedAt &&
      at.getTime() - apple.localAccountsRequestedAt.getTime() < 24 * 60 * 60 * 1000
    )
      return;

    const [existing] = yield* db
      .select({ id: s.deviceCommand.id })
      .from(s.deviceCommand)
      .where(
        and(
          eq(s.deviceCommand.deviceId, device.id),
          eq(s.deviceCommand.requestType, "UserList"),
          inArray(s.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES, "succeeded"]),
        ),
      )
      .limit(1);

    if (existing) return;

    yield* queueAppleCommand(device, "UserList", {}, at);
    yield* db
      .update(s.deviceApple)
      .set({ localAccountsRequestedAt: at })
      .where(eq(s.deviceApple.deviceId, device.id));
  });

/**
 * How often a lost device is asked for a fresh location. A fix goes stale
 * quickly, but Apple has no push trigger for location and a command on every
 * check-in would be noise. One request an hour is enough to follow a device
 * that is still checking in.
 */
export const LOST_MODE_LOCATION_REFRESH_MS = 60 * 60 * 1000;

const queueLostModeLocation = (
  device: DeviceRow,
  at: Date,
  options: { readonly force?: boolean } = {},
): Effect.Effect<void, unknown, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;

    const [apple] = yield* db
      .select({
        lostModeEnabled: s.deviceApple.lostModeEnabled,
        locationUpdatedAt: s.deviceApple.lostModeLocationUpdatedAt,
      })
      .from(s.deviceApple)
      .where(eq(s.deviceApple.deviceId, device.id))
      .limit(1);

    if (apple?.lostModeEnabled !== true) return;

    if (
      options.force !== true &&
      apple.locationUpdatedAt &&
      at.getTime() - apple.locationUpdatedAt.getTime() < LOST_MODE_LOCATION_REFRESH_MS
    )
      return;

    const [active] = yield* db
      .select({ id: s.deviceCommand.id })
      .from(s.deviceCommand)
      .where(
        and(
          eq(s.deviceCommand.deviceId, device.id),
          eq(s.deviceCommand.requestType, "DeviceLocation"),
          inArray(s.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES]),
        ),
      )
      .limit(1);

    if (active) return;

    yield* queueAppleCommand(device, "DeviceLocation", {}, at);
  });

/**
 * How many managed administrator passwords one tenant may rotate in a single
 * maintenance run. A Mac must acknowledge each `SetAutoAdminPassword` before
 * the next rotation of that device, and a fleet-wide burst would otherwise
 * replace every password (and wake every device) at once.
 */
export const LOCAL_ADMIN_ROTATION_CONCURRENCY_PER_TENANT = 25;

export type LocalAdminRotationResult = {
  readonly queued: number;
  /** Devices skipped because a rotation is already in flight or no GUID. */
  readonly skipped: number;
};

/**
 * Queue `SetAutoAdminPassword` for Macs whose tenant policy says the managed
 * administrator password is due. The new password is sealed under the pending
 * kind and only becomes the revealed value when the device acknowledges the
 * command, so a reveal never shows a password the Mac never applied.
 */
export const rotateAppleLocalAdminPasswords = (
  db: EnterpriseDb,
  options: {
    readonly now: Date;
    readonly authSecret?: string;
    readonly limitPerTenant?: number;
    readonly organizationId?: string;
  },
): Effect.Effect<LocalAdminRotationResult, unknown, Db> =>
  Effect.gen(function* () {
    if (!options.authSecret) return { queued: 0, skipped: 0 };
    const authSecret = options.authSecret;
    const cap = options.limitPerTenant ?? LOCAL_ADMIN_ROTATION_CONCURRENCY_PER_TENANT;
    const now = options.now;

    const organizations = yield* db
      .select({
        id: s.organization.id,
        rotationDays: s.organization.localAdminRotationDays,
      })
      .from(s.organization)
      .where(
        options.organizationId
          ? and(
              eq(s.organization.id, options.organizationId),
              isNotNull(s.organization.localAdminRotationDays),
            )
          : isNotNull(s.organization.localAdminRotationDays),
      );

    let queued = 0;
    let skipped = 0;

    for (const organization of organizations) {
      const days = organization.rotationDays;

      if (!days || days <= 0) continue;
      const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

      const candidates = yield* db
        .select({
          id: s.device.id,
          organizationId: s.device.organizationId,
          osEdition: s.device.osEdition,
          model: s.device.model,
          localAdminGuid: s.deviceApple.localAdminGuid,
          rotatedAt: s.deviceSecret.rotatedAt,
        })
        .from(s.device)
        .innerJoin(s.deviceApple, eq(s.deviceApple.deviceId, s.device.id))
        .innerJoin(
          s.deviceSecret,
          and(
            eq(s.deviceSecret.deviceId, s.device.id),
            eq(s.deviceSecret.kind, "local_admin_password"),
          ),
        )
        .where(
          and(
            eq(s.device.organizationId, organization.id),
            eq(s.device.proto, "apple"),
            eq(s.device.status, "enrolled"),
            isNotNull(s.deviceApple.localAdminGuid),
            lte(s.deviceSecret.rotatedAt, cutoff),
          ),
        )
        .limit(cap + 1);

      const macs = candidates.filter((device) => appleDeviceIsMac(device));
      const due = macs.filter((device) =>
        localAdminRotationDue({
          rotationDays: days,
          rotatedAt: device.rotatedAt,
          now,
          hasGuid: Boolean(device.localAdminGuid),
        }),
      );
      skipped += macs.length - Math.min(due.length, cap);

      for (const device of due.slice(0, cap)) {
        if (!device.localAdminGuid) {
          skipped += 1;
          continue;
        }

        // A rotation already in flight must finish before another replaces it;
        // otherwise the sealed pending password and the queued hash disagree.
        const [active] = yield* db
          .select({ id: s.deviceCommand.id })
          .from(s.deviceCommand)
          .where(
            and(
              eq(s.deviceCommand.deviceId, device.id),
              eq(s.deviceCommand.requestType, "SetAutoAdminPassword"),
              inArray(s.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES]),
            ),
          )
          .limit(1);

        if (active) {
          skipped += 1;
          continue;
        }

        const password = generateLocalAdminPassword();
        const passwordHash = yield* applePasswordHash(password);

        const payload = setAutoAdminPasswordPayload({
          guid: device.localAdminGuid,
          passwordHash,
        });
        const dedupeKey = yield* commandDedupeKeyEffect("SetAutoAdminPassword", payload);
        const sealedValue = yield* Effect.tryPromise(() => sealSecret(authSecret, password));
        const rotationId = crypto.randomUUID();

        // Queue the command and write its pending secret together, so a crash
        // cannot leave a password bound to no command (or the reverse).
        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx.insert(s.deviceCommand).values({
              id: rotationId,
              organizationId: device.organizationId,
              deviceId: device.id,
              requestType: "SetAutoAdminPassword",
              payload,
              status: "queued",
              dedupeKey,
              expiresAt: deviceCommandExpiresAt("SetAutoAdminPassword", now),
              resultStatus: null,
              resultDetail: null,
              createdAt: now,
              updatedAt: now,
            });
            yield* tx
              .insert(s.deviceSecret)
              .values({
                deviceId: device.id,
                organizationId: device.organizationId,
                kind: "local_admin_password_pending",
                sealedValue,
                format: "plaintext",
                pendingCommandId: rotationId,
                createdAt: now,
                updatedAt: now,
                rotatedAt: now,
              })
              .onDuplicateKeyUpdate({
                set: {
                  sealedValue,
                  pendingCommandId: rotationId,
                  updatedAt: now,
                  rotatedAt: now,
                },
              });
          }),
        );
        yield* writeSystemAudit(
          db,
          {
            organizationId: device.organizationId,
            action: SYSTEM_AUDIT_ACTIONS.localAdminPasswordRotationQueued,
            targetType: "device",
            targetId: device.id,
            deviceId: device.id,
            protocol: "apple",
            metadata: { rotationDays: days, scheduled: true },
          },
          { authSecret },
        );
        queued += 1;
      }
    }

    return { queued, skipped };
  });

type ReturnToServiceConfig = {
  enabled: boolean;
  wifiProfileData?: Uint8Array;
  bootstrapToken?: Uint8Array;
};

type SetupState = {
  readonly apple:
    | Pick<
        typeof s.deviceApple.$inferSelect,
        "awaitingConfiguration" | "configured" | "declarationMode"
      >
    | undefined;
  readonly declarations: ReadonlyArray<typeof s.deviceDeclaration.$inferSelect>;
  readonly commands: ReadonlyArray<{
    readonly requestType: string;
    readonly status: string;
  }>;
};

/** Load the state that decides whether Setup Assistant can be released. */
const loadSetupState = (deviceId: string): Effect.Effect<SetupState, unknown, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;

    const [apple] = yield* db
      .select({
        awaitingConfiguration: s.deviceApple.awaitingConfiguration,
        configured: s.deviceApple.configured,
        declarationMode: s.deviceApple.declarationMode,
      })
      .from(s.deviceApple)
      .where(eq(s.deviceApple.deviceId, deviceId))
      .limit(1);

    const declarations = yield* db
      .select()
      .from(s.deviceDeclaration)
      .where(eq(s.deviceDeclaration.deviceId, deviceId));

    const commands = yield* db
      .select({
        requestType: s.deviceCommand.requestType,
        status: s.deviceCommand.status,
      })
      .from(s.deviceCommand)
      .where(eq(s.deviceCommand.deviceId, deviceId));

    return { apple, declarations, commands };
  });

/**
 * Queue `DeviceConfigured` once every setup precondition is satisfied. Safe to
 * call after every declaration report and setup command result: the command
 * de-duplication key keeps exactly one release in flight.
 */
const releaseAwaitingConfiguration = (device: DeviceRow): Effect.Effect<boolean, unknown, Db> =>
  Effect.gen(function* () {
    const state = yield* loadSetupState(device.id);

    if (!state.apple?.awaitingConfiguration || state.apple.configured) return false;

    const deliveryMode = state.apple.declarationMode ?? "ddm";

    const scoped = yield* scopedConfigurations(
      device,
      deliveryMode === "legacy" ? "legacy" : "ddm",
    );

    const expectedSetupPayload = scoped.configurations.some(
      (configuration) => !isApplicationKind(configuration.kind),
    );

    if (
      !setupIsReady({
        awaitingConfiguration: state.apple.awaitingConfiguration,
        configured: state.apple.configured,
        deliveryMode: state.apple.declarationMode,
        expectedSetupPayload,
        isMac: appleDeviceIsMac(device),
        declarations: state.declarations,
        commands: state.commands,
      })
    )
      return false;

    const at = now();

    yield* queueAppleCommand(device, "DeviceConfigured", {}, at);

    return true;
  });

/** The escrowed bootstrap token, preferring the sealed `device_secret` row. */
const readAppleBootstrapToken = (
  device: Pick<DeviceRow, "id">,
  authSecret: string | undefined,
): Effect.Effect<string | null, unknown, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;

    const [sealed] = yield* db
      .select({ sealedValue: s.deviceSecret.sealedValue })
      .from(s.deviceSecret)
      .where(
        and(eq(s.deviceSecret.deviceId, device.id), eq(s.deviceSecret.kind, "bootstrap_token")),
      )
      .limit(1);

    if (sealed && authSecret) {
      const token = yield* Effect.promise(() =>
        openSecret(authSecret, sealed.sealedValue).catch(() => null),
      );

      if (token) return token;
    }

    const [apple] = yield* db
      .select({ bootstrapToken: s.deviceApple.bootstrapToken })
      .from(s.deviceApple)
      .where(eq(s.deviceApple.deviceId, device.id))
      .limit(1);

    return apple?.bootstrapToken ?? null;
  });

/**
 * The profile history that belongs to policy delivery.
 *
 * The lock screen profile is imperative and deliberately absent from the
 * policy's compiled configuration list, so legacy reconciliation must never
 * treat it as a profile the policy removed.
 */
const policyInstalledProfiles = (
  installed: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> =>
  new Map(
    [...installed].filter(
      ([identifier]) => !identifier.startsWith(APPLE_LOCK_SCREEN_PROFILE_IDENTIFIER_PREFIX),
    ),
  );

/** Legacy profiles the device has installed, from its own command history. */
const installedLegacyProfiles = (
  deviceId: string,
): Effect.Effect<ReadonlyMap<string, string>, unknown, Db> =>
  Effect.gen(function* () {
    const db = yield* Db;

    const history = yield* db
      .select({ requestType: s.deviceCommand.requestType, payload: s.deviceCommand.payload })
      .from(s.deviceCommand)
      .where(
        and(
          eq(s.deviceCommand.deviceId, deviceId),
          inArray(s.deviceCommand.requestType, ["InstallProfile", "RemoveProfile"]),
          eq(s.deviceCommand.status, "succeeded"),
        ),
      )
      .orderBy(desc(s.deviceCommand.createdAt))
      .limit(200);

    return yield* Effect.promise(() =>
      installedProfiles(
        history.map((row) => ({ requestType: row.requestType, payload: row.payload })),
      ),
    );
  });

export class ManagementBackendEnterpriseLive extends ManagementBackend {
  static readonly make = (options: {
    readonly db: Db["Service"];
    readonly origin: string;
    /** Push transport for the immediate post-enrollment check-in. */
    readonly apns?: ApnsService.Service;
    /** Scoped queue used by the production Layer; direct `make` calls may omit it. */
    readonly backgroundDelivery?: BackgroundDeliveryService;
    /** Application secret used to unseal the tenant APNs private key and sign Windows WSTEP tokens. */
    readonly authSecret?: string;
    /** Injectable webhook transport for tests and self-hosted adapters. */
    readonly webhookFetch?: typeof globalThis.fetch;
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
    /**
     * Read one object from tenant storage. Used to serve uploaded `.pkg`
     * artefacts to devices through a signed, expiring asset URL. Omitting it
     * makes uploaded application installs fail closed (they are reported as not
     * deliverable rather than returning an empty package).
     */
    readonly readApplicationObject?: (key: string) => Promise<Uint8Array | null>;
    /**
     * Return an Apps and Books licence once an uninstall's inventory report
     * proves the app is gone. Omitted deployments keep the assignment row and
     * can release it from the Apps and Books page.
     */
    readonly releaseAppleVppLicence?: AppleVppLicenceRelease;
    /**
     * Deployment Apple profile signing identity. When absent, profiles are
     * signed with the tenant's SCEP CA, matching the enrollment download path.
     */
    readonly appleProfileSigning?: Parameters<typeof createAppleProfileSigner>[0];
    /** Lifetime of the one-time SCEP challenge in an ADE profile. */
    readonly enrollmentProfileTtlSeconds?: number;
    /**
     * How long repeated check-ins fold into one `mdm.checkin` audit row, in
     * milliseconds. Defaults to 15 minutes; `0` records every check-in.
     */
    readonly auditCheckinCoalesceWindowMs?: number;
  }): ManagementBackend.Service => {
    const { db, origin, apns, authSecret, readApplicationObject } = options;

    const auditOptions: SystemAuditOptions = {
      authSecret,
      webhookFetch: options.webhookFetch,
      coalesceWindowMs: options.auditCheckinCoalesceWindowMs,
      webhookDispatch: options.backgroundDelivery
        ? (event) =>
            options
              .backgroundDelivery!.enqueue(
                `webhook:${event.type}`,
                dispatchWebhookEvent(db, event, { authSecret, fetch: options.webhookFetch }),
              )
              .pipe(Effect.asVoid)
        : undefined,
    };

    const appleProfileSigner = options.appleProfileSigning
      ? createAppleProfileSigner(options.appleProfileSigning)
      : undefined;

    const enrollmentProfileTtlSeconds = options.enrollmentProfileTtlSeconds ?? 60 * 60;

    const provideDb = <A, E>(effect: Effect.Effect<A, E, Db>) =>
      effect.pipe(Effect.provideService(Db, db));

    /**
     * Build the signed Automated Device Enrollment profile for a serial.
     *
     * This is the same profile the ADE enrollment URL serves, generated from
     * the tenant's ABM profile revision and a fresh one-time SCEP challenge.
     * Returning it from `Authenticate` keeps the Setup Assistant flow
     * zero-touch when the device did not (or could not) fetch the URL itself.
     * Every failure is logged and treated as "no inline profile": the URL
     * remains the canonical path, so a broken signing identity must not stop
     * an otherwise valid enrollment.
     */
    const inlineAdeEnrollmentProfile = (input: {
      readonly organizationId: string;
      readonly serial: string;
    }): Effect.Effect<string | undefined> =>
      Effect.gen(function* () {
        if (!authSecret) return undefined;

        const [abmDevice] = yield* db
          .select()
          .from(s.abmDevice)
          .where(
            and(
              eq(s.abmDevice.organizationId, input.organizationId),
              eq(s.abmDevice.serial, input.serial),
              eq(s.abmDevice.enrollmentState, "ASSIGNED"),
            ),
          )
          .limit(1);

        // A device Apple removed from ABM must not receive a profile even if a
        // stale row still says ASSIGNED.
        if (!abmDevice || abmDevice.profileStatus === "removed") return undefined;

        const [abm] = yield* db
          .select()
          .from(s.appleBusinessManager)
          .where(eq(s.appleBusinessManager.organizationId, input.organizationId))
          .limit(1);

        const [apnsCertificate] = yield* db
          .select()
          .from(s.applePushCertificate)
          .where(eq(s.applePushCertificate.organizationId, input.organizationId))
          .limit(1);

        const [organization] = yield* db
          .select()
          .from(s.organization)
          .where(eq(s.organization.id, input.organizationId))
          .limit(1);

        const profileUuid = abmDevice.assignedProfileUuid ?? abm?.profileUuid;
        const topic = apnsCertificate?.topic;

        if (!profileUuid || !topic || !organization) return undefined;

        const branding = resolveTenantBranding(organization);

        const signed = yield* buildAdeEnrollmentProfile({
          db,
          origin,
          authSecret,
          organizationId: input.organizationId,
          topic,
          organizationName: branding.displayName,
          supportEmail: branding.supportEmail,
          profileUuid,
          displayName: `${branding.displayName} Automated Device Enrollment`,
          ttlSeconds: enrollmentProfileTtlSeconds,
          sign: (plist) =>
            appleProfileSigner
              ? Effect.tryPromise(() => appleProfileSigner.sign(plist))
              : Effect.gen(function* () {
                  const ca = yield* ensureScepCa(ScepRepositoryLive.make(db, { authSecret }), {
                    organizationId: input.organizationId,
                  });

                  return yield* Effect.tryPromise(() =>
                    signAppleProfilePlist(plist, {
                      certificatePem: ca.certPem,
                      privateKey: ca.privateKey,
                    }),
                  );
                }),
        });

        return base64EncodeBytes(signed);
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning(
            `Could not build the inline ADE profile for ${input.serial}: ${String(error)}`,
          ).pipe(Effect.as(undefined)),
        ),
      );

    /**
     * mttx pushes a check-in immediately after a device first reports its push
     * token, so the freshly enrolled device receives its configuration without
     * waiting for the next poll. Failures are logged and ignored.
     */
    const pushEnrolledDevice = (deviceId: string, organizationId: string) => {
      const delivery = Effect.gen(function* () {
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
        const sealed = yield* Effect.tryPromise({
          try: () => openSecret(authSecret, certificate.encryptedKey!),
          catch: () => new Error("Failed to decrypt the APNs private key"),
        });
        const jwk = yield* Effect.try({
          try: () => JSON.parse(sealed) as JsonWebKey,
          catch: () => new Error("Failed to parse the APNs private key"),
        });

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
      });

      return options.backgroundDelivery
        ? options.backgroundDelivery.enqueue("apns:post-enrollment", delivery).pipe(Effect.asVoid)
        : delivery.pipe(
            Effect.catch((error) =>
              Effect.logWarning(`Failed to send post-enrollment APNs push: ${String(error)}`),
            ),
          );
    };

    /**
     * Queue `SecurityInfo` so a Mac's FileVault key and Activation Lock state
     * are refreshed without an administrator pressing a button. Deduplicated
     * against an active request, so repeated triggers cannot flood the queue.
     */
    /**
     * Deliver the policy's legacy equivalents to a device that cannot apply
     * declarations: one `InstallProfile` per compiled `.mobileconfig`, and a
     * `RemoveProfile` for a profile the policy no longer contains.
     *
     * The diff is computed from the command history, so a profile whose content
     * changed is re-installed and a removed one is uninstalled without a second
     * state table.
     */
    const syncLegacyPolicy = (
      device: DeviceRow,
      configurations: ReadonlyArray<ScopedConfiguration>,
      at: Date,
    ): Effect.Effect<{ readonly installed: number; readonly removed: number }, unknown, Db> =>
      Effect.gen(function* () {
        const [active] = yield* db
          .select({ id: s.deviceCommand.id })
          .from(s.deviceCommand)
          .where(
            and(
              eq(s.deviceCommand.deviceId, device.id),
              inArray(s.deviceCommand.requestType, ["InstallProfile", "RemoveProfile"]),
              inArray(s.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES]),
            ),
          )
          .limit(1);

        // Let the in-flight profile finish before recomputing the diff.
        if (active) return { installed: 0, removed: 0 };

        const escrowCertificatePem = yield* tenantEscrowCertificate(device.organizationId);

        const built = yield* Effect.promise(() =>
          buildLegacyProfiles(configurations, { escrowCertificatePem }),
        );

        for (const skipped of built.unsupported)
          yield* Effect.logWarning(
            `Legacy policy ${skipped.policyId}/${skipped.kind} not delivered to ${device.id}: ${skipped.reason}`,
          );

        const installed = policyInstalledProfiles(yield* installedLegacyProfiles(device.id));

        const changes = yield* Effect.promise(() =>
          planLegacyProfileChanges(built.profiles, installed),
        );

        for (const profile of changes.install)
          yield* queueAppleCommand(device, "InstallProfile", installProfilePayload(profile), at);

        for (const identifier of changes.remove)
          yield* queueAppleCommand(device, "RemoveProfile", { Identifier: identifier }, at);

        return { installed: changes.install.length, removed: changes.remove.length };
      });

    /**
     * Remove profiles installed by the legacy path once a device can apply
     * declarations. Without this, an upgraded device would carry both the old
     * profiles and the new declarations, applying the same settings twice.
     */
    const removeLegacyPolicyProfiles = (
      device: DeviceRow,
      at: Date,
    ): Effect.Effect<void, unknown, Db> =>
      Effect.gen(function* () {
        const installed = policyInstalledProfiles(yield* installedLegacyProfiles(device.id));

        for (const identifier of installed.keys())
          yield* queueAppleCommand(device, "RemoveProfile", { Identifier: identifier }, at);
      });

    /**
     * Install, update and remove `com.mattrax.script` profiles for one Mac.
     *
     * The agent runs scripts from these payloads on their trigger, and posts
     * results to the token-authenticated endpoint. A manual run changes the
     * profile's `RunID`, which is what makes the agent execute it exactly once
     * instead of waiting for a trigger.
     *
     * The diff comes from the same command history policy delivery uses, so a
     * device that re-enrols receives its scripts again without another table.
     */
    const syncAppleScripts = (device: DeviceRow, at: Date): Effect.Effect<void, unknown, Db> =>
      Effect.gen(function* () {
        // One profile command in flight per device keeps the queue small and
        // matches legacy policy delivery's ordering rule.
        const [active] = yield* db
          .select({ id: s.deviceCommand.id })
          .from(s.deviceCommand)
          .where(
            and(
              eq(s.deviceCommand.deviceId, device.id),
              inArray(s.deviceCommand.requestType, ["InstallProfile", "RemoveProfile"]),
              inArray(s.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES]),
            ),
          )
          .limit(1);

        if (active) return;

        const installed = yield* installedLegacyProfiles(device.id);

        const removeProfiles = (identifiers: ReadonlyArray<string>) =>
          Effect.forEach(identifiers, (identifier) =>
            queueAppleCommand(device, "RemoveProfile", { Identifier: identifier }, at),
          );

        if (!authSecret) {
          yield* Effect.logWarning(
            `Cannot deliver scripts to ${device.id}: AUTH_SECRET is not configured.`,
          );

          return;
        }

        const [organization] = yield* db
          .select({ scriptsEnabled: s.organization.scriptsEnabled })
          .from(s.organization)
          .where(eq(s.organization.id, device.organizationId))
          .limit(1);

        const installedScripts = new Map(
          [...installed].filter(([identifier]) => isScriptProfileIdentifier(identifier)),
        );

        if (!organization?.scriptsEnabled) {
          yield* removeProfiles([...installedScripts.keys()]);

          return;
        }

        const scripts = yield* db
          .select()
          .from(s.script)
          .where(
            and(eq(s.script.organizationId, device.organizationId), eq(s.script.enabled, true)),
          )
          .limit(200);

        if (scripts.length === 0) {
          yield* removeProfiles([...installedScripts.keys()]);

          return;
        }

        const assignments = yield* db
          .select()
          .from(s.scriptAssignment)
          .where(eq(s.scriptAssignment.organizationId, device.organizationId));

        const memberships = yield* db
          .select({ groupId: s.groupDevice.groupId })
          .from(s.groupDevice)
          .where(eq(s.groupDevice.deviceId, device.id));

        const assigned = resolveAssignedScriptIds(assignments, {
          deviceId: device.id,
          groupIds: new Set(memberships.map((row) => row.groupId)),
        });

        const candidates = scripts.filter((script) => assigned.has(script.id));

        if (candidates.length === 0) {
          yield* removeProfiles([...installedScripts.keys()]);

          return;
        }

        const queuedRuns = yield* db
          .select({
            id: s.scriptExecution.id,
            scriptId: s.scriptExecution.scriptId,
            createdAt: s.scriptExecution.createdAt,
            expiresAt: s.scriptExecution.expiresAt,
          })
          .from(s.scriptExecution)
          .where(
            and(
              eq(s.scriptExecution.organizationId, device.organizationId),
              eq(s.scriptExecution.deviceId, device.id),
              eq(s.scriptExecution.status, "queued"),
              inArray(
                s.scriptExecution.scriptId,
                candidates.map((script) => script.id),
              ),
            ),
          )
          .orderBy(asc(s.scriptExecution.createdAt))
          .limit(200);

        const runByScript = new Map<string, string>();

        // The oldest unexpired manual run wins, so one profile carries one run.
        for (const run of queuedRuns) {
          if (run.expiresAt && run.expiresAt.getTime() <= at.getTime()) continue;

          if (!runByScript.has(run.scriptId)) runByScript.set(run.scriptId, run.id);
        }

        const token = yield* Effect.promise(() => scriptAgentToken(device.id, authSecret));

        const desired: DesiredScriptProfile[] = [];

        for (const script of candidates) {
          const environment = Option.getOrUndefined(
            Schema.decodeUnknownOption(
              Schema.Array(
                Schema.Struct({
                  name: Schema.String,
                  value: Schema.String,
                  secret: Schema.Boolean,
                }),
              ),
            )(script.environment),
          );

          const profile = yield* Effect.promise(() =>
            buildScriptProfile({
              scriptId: script.id,
              name: script.name,
              description: script.description,
              language: script.language,
              body: script.body,
              runAs: script.runAs,
              timeoutSeconds: script.timeoutSeconds,
              environment: (environment ?? []).map(({ name, value, secret }) => ({
                name,
                value,
                secret,
              })),
              trigger: {
                type: script.triggerType,
                intervalSeconds: script.intervalSeconds,
                cronExpression: script.cronExpression,
              },
              runId: runByScript.get(script.id) ?? null,
              serverUrl: `${origin}/api`,
              deviceToken: token,
            }),
          );

          desired.push({
            scriptId: script.id,
            identifier: scriptProfileIdentifier(script.id),
            digest: yield* Effect.promise(() => profileDigest(profile)),
            profile,
          });
        }

        const changes = planScriptProfileChanges(desired, installedScripts);

        for (const profile of changes.install)
          yield* queueAppleCommand(
            device,
            "InstallProfile",
            installProfilePayload({
              identifier: profile.identifier,
              policyId: profile.scriptId,
              kind: "com.mattrax.script",
              content: profile.profile,
            }),
            at,
          );

        for (const identifier of changes.remove)
          yield* queueAppleCommand(device, "RemoveProfile", { Identifier: identifier }, at);

        return { installed: changes.install.length, removed: changes.remove.length };
      });

    const requireDevice = (scope: CheckinScope) =>
      findDeviceByScope(scope, options.requireAppleDeviceIdentity).pipe(
        Effect.flatMap((device) =>
          device ? Effect.succeed(device) : Effect.fail(new UnknownDevice()),
        ),
        Effect.mapError((cause) => (cause instanceof UnknownDevice ? cause : internal())),
      );

    /**
     * Require the user-channel mapping a device established on this tenant.
     * `scope.userId` alone is not an authorization: it must belong to the
     * device row that the mTLS identity resolved to.
     */
    const requireDeviceUser = (device: DeviceRow, userId: string) =>
      Effect.gen(function* () {
        const [user] = yield* db
          .select({ userId: s.deviceAppleUser.userId })
          .from(s.deviceAppleUser)
          .where(
            and(eq(s.deviceAppleUser.deviceId, device.id), eq(s.deviceAppleUser.userId, userId)),
          )
          .limit(1);

        if (!user) return yield* Effect.fail(new UnknownDevice());

        return user;
      }).pipe(Effect.mapError((cause) => (cause instanceof UnknownDevice ? cause : internal())));

    /**
     * Deliver the oldest active command for one channel (device, or one user).
     *
     * Commands are channel-scoped: a device-scoped wipe must never be handed to
     * a user connection, and a user's `ProfileList` must never be answered by
     * the device. Expiry and deferred retries are applied to the same channel
     * only; the daily sweep expires anything a channel never comes back for.
     */
    const deliverQueuedCommand = (
      device: DeviceRow,
      userId: string | null,
      at: Date,
    ): Effect.Effect<
      { commandUUID: string; requestType: string; payload: unknown } | null,
      unknown,
      Db
    > =>
      Effect.gen(function* () {
        const channel = userId
          ? eq(s.deviceCommand.userId, userId)
          : isNull(s.deviceCommand.userId);

        const activeCommands = yield* db
          .select()
          .from(s.deviceCommand)
          .where(
            and(
              eq(s.deviceCommand.deviceId, device.id),
              channel,
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

        if (!command) return null;

        yield* db
          .update(s.deviceCommand)
          .set({ status: "sent", updatedAt: at })
          .where(
            and(
              eq(s.deviceCommand.id, command.id),
              eq(s.deviceCommand.deviceId, device.id),
              channel,
            ),
          );

        return {
          commandUUID: command.id,
          requestType: command.requestType,
          payload: command.payload ?? {},
        };
      });

    /**
     * Re-queue the supervised `Settings`/`DeviceName` command when the
     * administrator opted into "apply name on each sync".
     *
     * Called from the command check-in so the new command can be delivered in
     * the same response. The retry window in `shouldPushDeviceName` stops an
     * OS that ignores the value from producing a command on every poll, and an
     * active identical command is never duplicated or audited twice.
     */
    const queueDeviceNameUpdate = (
      device: DeviceRow,
      enrollmentMode: string | null,
      at: Date,
    ): Effect.Effect<void, never, Db> =>
      Effect.gen(function* () {
        const retrySince = new Date(at.getTime() - DEVICE_NAME_PUSH_RETRY_MS);
        const name = device.name.trim();
        const pushEligible =
          device.namePushEnabled === true &&
          device.proto === "apple" &&
          device.status === "enrolled" &&
          enrollmentMode !== "user";

        // Apple rejects over-long values. Do not queue something the device
        // will refuse; record why the automatic path skipped it once per
        // retry window so the device timeline is not silent.
        if (
          pushEligible &&
          name.length > APPLE_DEVICE_NAME_MAX_LENGTH &&
          latestKnownDeviceName({
            reportedName: device.physicalName,
            reportedNameAt: device.physicalNameAt,
            appliedName: device.appliedName,
            appliedNameAt: device.appliedNameAt,
          }) !== name
        ) {
          const [recentSkip] = yield* db
            .select({ id: s.auditLog.id })
            .from(s.auditLog)
            .where(
              and(
                eq(s.auditLog.deviceId, device.id),
                eq(s.auditLog.action, SYSTEM_AUDIT_ACTIONS.deviceNamePushSkipped),
                gte(s.auditLog.createdAt, retrySince),
              ),
            )
            .limit(1);

          if (!recentSkip)
            yield* writeSystemAudit(
              db,
              {
                organizationId: device.organizationId,
                action: SYSTEM_AUDIT_ACTIONS.deviceNamePushSkipped,
                targetType: "device",
                targetId: device.id,
                deviceId: device.id,
                protocol: "apple",
                metadata: {
                  platform: "apple",
                  reason: `name exceeds ${APPLE_DEVICE_NAME_MAX_LENGTH} characters`,
                  length: name.length,
                  limit: APPLE_DEVICE_NAME_MAX_LENGTH,
                  trigger: "checkin",
                },
              },
              auditOptions,
            );

          return;
        }

        if (
          !shouldPushDeviceName({
            proto: device.proto,
            status: device.status,
            enrollmentMode,
            enabled: device.namePushEnabled,
            name,
            reportedName: device.physicalName,
            reportedNameAt: device.physicalNameAt,
            appliedName: device.appliedName,
            appliedAt: device.appliedNameAt,
            now: at,
          })
        )
          return;

        const settings = yield* db
          .select({
            id: s.deviceCommand.id,
            payload: s.deviceCommand.payload,
            status: s.deviceCommand.status,
            expiresAt: s.deviceCommand.expiresAt,
            updatedAt: s.deviceCommand.updatedAt,
          })
          .from(s.deviceCommand)
          .where(
            and(
              eq(s.deviceCommand.deviceId, device.id),
              eq(s.deviceCommand.requestType, "Settings"),
            ),
          );

        const time = (value: Date | string | null): number | undefined => {
          if (!value) return undefined;
          const parsed = value instanceof Date ? value.getTime() : new Date(value).getTime();

          return Number.isFinite(parsed) ? parsed : undefined;
        };

        // A command past its delivery deadline cannot run and must not block a
        // fresh insert on the unique de-duplication key.
        const expiredActive = settings.filter((row) => {
          if (!commandStatusIsActive(row.status)) return false;
          const deadline = time(row.expiresAt);

          return deadline !== undefined && deadline <= at.getTime();
        });

        yield* Effect.forEach(
          expiredActive,
          (row) =>
            db
              .update(s.deviceCommand)
              .set({
                status: "expired",
                dedupeKey: null,
                resultStatus: RECONCILED_RESULT_STATUS,
                resultDetail: COMMAND_EXPIRED_DETAIL,
                updatedAt: at,
              })
              .where(eq(s.deviceCommand.id, row.id)),
          { concurrency: 1, discard: true },
        );

        // One attempt per retry window, whatever its outcome. A queued or
        // in-flight duplicate would otherwise be re-inserted (and re-audited)
        // on every poll, and a failure would hammer an OS that rejects the
        // value. Expired commands are not evidence that a push is still
        // pending, so they do not suppress a retry.
        const recent = settings.some((row) => {
          if (!["queued", "sent", "deferred", "succeeded", "failed"].includes(row.status ?? ""))
            return false;

          const deadline = time(row.expiresAt);
          const updated = time(row.updatedAt);

          if (deadline === undefined || deadline <= at.getTime()) return false;
          if (updated === undefined || updated < retrySince.getTime()) return false;

          return appleDeviceNameFromSettingsPayload(row.payload) === name;
        });

        if (recent) return;

        const payload = appleDeviceNameSettingsPayload(name);

        yield* queueAppleCommand(device, "Settings", payload, at);
        yield* writeSystemAudit(
          db,
          {
            organizationId: device.organizationId,
            action: SYSTEM_AUDIT_ACTIONS.deviceNamePushQueued,
            targetType: "device",
            targetId: device.id,
            deviceId: device.id,
            protocol: "apple",
            metadata: {
              platform: "apple",
              deviceName: name,
              trigger: "checkin",
            },
          },
          auditOptions,
        );
      }).pipe(
        // A failed name push must never fail the device's check-in. The next
        // poll or the daily maintenance run retries it.
        Effect.catch((error) =>
          Effect.logWarning(`Failed to queue the device name for ${device.id}: ${String(error)}`),
        ),
      );

    /**
     * Install, update or remove the supervised iOS/iPadOS lock screen profile.
     *
     * Apple publishes the feature as the `com.apple.shareddeviceconfiguration`
     * profile payload, delivered through `InstallProfile` / `RemoveProfile`.
     * The desired message comes from the per-device override or, when absent,
     * the winning policy default.
     *
     * The diff uses the device's own successful profile history, so an
     * unchanged profile queues nothing. A failed install is retried at most
     * once a day for the same message/asset-tag/name, while a genuine change
     * is applied on the next check-in.
     */
    const syncLockScreenProfile = (
      device: DeviceRow,
      enrollmentMode: string | null,
      policy: ScopedConfigurations["lockScreenMessage"],
      at: Date,
    ): Effect.Effect<void, never, Db> =>
      Effect.gen(function* () {
        if (
          !isAppleLockScreenMessageDevice({
            proto: device.proto,
            enrollmentMode: enrollmentMode === "user" ? "user" : null,
            osEdition: device.osEdition,
            model: device.model,
          })
        )
          return;

        if (device.status !== "enrolled") return;

        const identifier = appleLockScreenProfileIdentifier(device.id);
        const installed = yield* installedLegacyProfiles(device.id);
        const installedDigest = installed.get(identifier);

        // Serialise profile commands: an in-flight install/remove may be about
        // this profile, and computing the diff again would duplicate work.
        const [active] = yield* db
          .select({ id: s.deviceCommand.id })
          .from(s.deviceCommand)
          .where(
            and(
              eq(s.deviceCommand.deviceId, device.id),
              inArray(s.deviceCommand.requestType, ["InstallProfile", "RemoveProfile"]),
              inArray(s.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES]),
            ),
          )
          .limit(1);

        if (active) return;

        const resolved = resolveAppleLockScreenMessage({
          deviceMessage: device.lockScreenMessage,
          deviceIncludeAssetTag: device.lockScreenIncludeAssetTag,
          policy: policy ?? null,
          assetTag: device.assetTag,
        });

        if (!resolved.message) {
          if (!installedDigest) return;

          yield* queueAppleCommand(device, "RemoveProfile", { Identifier: identifier }, at);
          yield* db
            .update(s.device)
            .set({
              queuedLockScreenName: device.name,
              queuedLockScreenDigest: null,
              queuedLockScreenAt: at,
            })
            .where(eq(s.device.id, device.id));
          yield* writeSystemAudit(
            db,
            {
              organizationId: device.organizationId,
              action: SYSTEM_AUDIT_ACTIONS.deviceLockScreenMessagePushed,
              targetType: "device",
              targetId: device.id,
              deviceId: device.id,
              protocol: "apple",
              metadata: {
                platform: "apple",
                operation: "remove",
                trigger: "checkin",
              },
            },
            auditOptions,
          );

          return;
        }

        // A resolved default that cannot be delivered (for example Include
        // asset tag on a device with no asset tag) leaves the last profile in
        // place rather than clearing a working message.
        if (resolved.problem) {
          yield* Effect.logWarning(
            `Lock screen message not delivered to ${device.id}: ${resolved.problem}`,
          );

          return;
        }

        const assetTagInfo = resolved.includeAssetTag ? device.assetTag?.trim() || null : null;
        const profile = yield* Effect.promise(() =>
          buildAppleLockScreenProfile({
            deviceId: device.id,
            message: resolved.message!,
            assetTagInfo,
          }),
        );
        const digest = yield* Effect.promise(() => profileDigest(profile.content));

        // Already installed and the name has not changed: nothing to send.
        if (installedDigest === digest && device.queuedLockScreenName === device.name) return;

        // One attempt per retry window for an unchanged desired state, so an OS
        // that ignores or fails the profile is not asked on every check-in.
        if (
          device.queuedLockScreenDigest === digest &&
          device.queuedLockScreenName === device.name &&
          device.queuedLockScreenAt &&
          at.getTime() - device.queuedLockScreenAt.getTime() < LOCK_SCREEN_MESSAGE_PUSH_RETRY_MS
        )
          return;

        yield* queueAppleCommand(device, "InstallProfile", installProfilePayload(profile), at);
        yield* db
          .update(s.device)
          .set({
            queuedLockScreenName: device.name,
            queuedLockScreenDigest: digest,
            queuedLockScreenAt: at,
          })
          .where(eq(s.device.id, device.id));
        yield* writeSystemAudit(
          db,
          {
            organizationId: device.organizationId,
            action: SYSTEM_AUDIT_ACTIONS.deviceLockScreenMessagePushed,
            targetType: "device",
            targetId: device.id,
            deviceId: device.id,
            protocol: "apple",
            metadata: {
              platform: "apple",
              operation: "install",
              lockScreenMessage: resolved.message,
              includeAssetTag: resolved.includeAssetTag,
              source: resolved.source,
              ...(resolved.policyName ? { policyName: resolved.policyName } : {}),
              trigger: "checkin",
            },
          },
          auditOptions,
        );
      }).pipe(
        // A failed profile push must never fail the device's check-in. The next
        // poll or the daily maintenance run retries it.
        Effect.catch((error) =>
          Effect.logWarning(
            `Failed to sync the lock screen profile for ${device.id}: ${String(error)}`,
          ),
        ),
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

    /** Catalogue application ids still reaching this device. */
    const applicationAssignedIds = (device: DeviceRow) =>
      assignedApplicationIdsForDevice(db, {
        organizationId: device.organizationId,
        deviceId: device.id,
      }).pipe(Effect.map((ids) => new Set(ids)));

    /** Whether an application is still assigned to the device, directly or by group. */
    const applicationAssignedToDevice = (
      organizationId: string,
      deviceId: string,
      applicationId: string,
    ) =>
      Effect.map(assignedApplicationIdsForDevice(db, { organizationId, deviceId }), (ids) =>
        ids.includes(applicationId),
      );

    type CatalogueApplication = typeof s.application.$inferSelect;

    type CatalogueInstaller = typeof s.applicationInstaller.$inferSelect;

    type ResolvedPolicyApplication = {
      readonly catalogueApplicationId?: string;
      readonly installerId?: string;
      readonly source: "upload" | "manifest" | "store";
      readonly bundleId: string;
      readonly version: string;
      readonly title: string;
      readonly sha256?: string;
      readonly fileName?: string;
      readonly contentType?: string;
      readonly uploadKind?: "pkg" | "ipa";
      readonly manifestUrl?: string;
      readonly storeId?: string;
      readonly configuration?: Schema.JsonObject;
      readonly managementFlags?: number;
    };

    type ResolvedPolicyApplicationResult = {
      readonly application?: ResolvedPolicyApplication;
      readonly reason?: string;
    };

    /**
     * Combine the policy configuration with the catalogue row it references.
     * Returns null (with a reason) when the app cannot be installed at all, so
     * the caller logs the reason instead of queueing a command Apple rejects.
     */
    const resolvePolicyApplication = (
      configuration: AppleApplicationConfiguration,
      catalogue: CatalogueApplication | undefined,
      installer: CatalogueInstaller | undefined,
    ): ResolvedPolicyApplicationResult => {
      if (configuration.type === "catalogue") {
        if (!catalogue)
          return {
            reason:
              "the referenced application is not in this tenant's catalogue (it may have been deleted)",
          };

        const bundleId = installer?.bundleId ?? catalogue.bundleId;

        if (!bundleId)
          return {
            reason: "the catalogue entry has no bundle identifier, so installs cannot be tracked",
          };

        const version = installer?.version ?? catalogue.version ?? "0";
        const title = catalogue.name;
        const source = installer?.source ?? catalogue.source;
        const installerId = installer?.id;

        if (source === "upload") {
          const r2Key = installer?.r2Key ?? catalogue.r2Key;
          const sha256 = installer?.sha256 ?? catalogue.sha256;
          const fileName = installer?.fileName ?? catalogue.fileName;
          const contentType = installer?.contentType ?? catalogue.contentType;

          if (!r2Key || !sha256) return { reason: "the catalogue entry has no uploaded file" };

          const uploadKind = appleUploadKind({ fileName, contentType });

          if (!uploadKind)
            return {
              reason:
                "the uploaded file is neither a signed .pkg nor an .ipa, so it has no install command",
            };

          return {
            application: {
              catalogueApplicationId: catalogue.id,
              installerId,
              source: "upload",
              bundleId,
              version,
              title,
              sha256,
              fileName: fileName ?? undefined,
              contentType: contentType ?? undefined,
              uploadKind,
              configuration: configuration.configuration,
              managementFlags: 1,
            },
          };
        }

        if (source === "store") {
          const storeId = installer?.storeId ?? catalogue.storeId;

          if (!storeId) return { reason: "the catalogue entry has no App Store id" };

          return {
            application: {
              catalogueApplicationId: catalogue.id,
              installerId,
              source: "store",
              bundleId,
              version,
              title,
              storeId,
              configuration: configuration.configuration,
              managementFlags: 1,
            },
          };
        }

        const manifestUrl = installer?.manifestUrl ?? catalogue.manifestUrl;

        if (!manifestUrl) return { reason: "the catalogue entry has no manifest URL" };

        return {
          application: {
            catalogueApplicationId: catalogue.id,
            installerId,
            source: "manifest",
            bundleId,
            version,
            title,
            manifestUrl,
            configuration: configuration.configuration,
            managementFlags: 1,
          },
        };
      }

      return {
        application: {
          source: configuration.source,
          bundleId: configuration.bundleId,
          version: configuration.version ?? "0",
          title: configuration.title ?? configuration.bundleId,
          sha256: configuration.sha256,
          fileName: configuration.fileName,
          contentType: configuration.contentType,
          uploadKind:
            configuration.source === "upload"
              ? appleUploadKind({
                  fileName: configuration.fileName,
                  contentType: configuration.contentType,
                })
              : undefined,
          manifestUrl: configuration.manifestUrl,
          storeId: configuration.storeId,
          configuration: configuration.configuration,
          managementFlags: configuration.managementFlags ?? 1,
        },
      };
    };

    const serverOrigin = origin.replace(/\/+$/, "");

    /**
     * Record one device check-in, folded into the current window.
     *
     * A check-in is the highest-volume MDM event, so identical repeats update
     * the existing row instead of appending. The row still carries the latest
     * verified address, identity certificate and `checkIns` count; state
     * changes below (enrollment, delivery, results, failures) always append a
     * separate row and are never folded.
     */
    const auditCheckin = (
      device: DeviceRow,
      scope: CheckinScope,
      channel: "device" | "user",
    ): Effect.Effect<void, never, never> =>
      writeSystemAudit(
        db,
        {
          organizationId: device.organizationId,
          action: SYSTEM_AUDIT_ACTIONS.mdmCheckin,
          targetType: "device",
          targetId: device.id,
          deviceId: device.id,
          protocol: "apple",
          ip: scope.clientIp ?? null,
          userAgent: scope.userAgent ?? null,
          certificateFingerprint: scope.identityCertificateFingerprintSha256 ?? null,
          certificateSerial: scope.identityCertificateSerial ?? null,
          principalId: Predicate.isTagged(scope, "user") ? scope.userId : null,
          metadata: { platform: "apple", channel, channels: [channel] },
          coalesce: true,
        },
        auditOptions,
      );

    /**
     * Queue installs for `mttx.apple.application.<id>` policy configurations.
     *
     * The command carries a device-bound, expiring URL for the package, so it
     * is built per device rather than shared. Work is skipped when the device
     * already reports the bundle or has an attempt in flight, and retries are
     * bounded by the same three-a-day budget as catalogue installs.
     */
    const queuePolicyApplicationInstalls = (
      device: DeviceRow,
      configurations: ReadonlyArray<PolicyConfigurationRow>,
      at: Date,
    ): Effect.Effect<void, unknown, Db> =>
      Effect.gen(function* () {
        const rows = configurations.filter((configuration) =>
          isApplicationKind(configuration.kind),
        );

        if (rows.length === 0) return;

        const catalogue = yield* db
          .select()
          .from(s.application)
          .where(eq(s.application.organizationId, device.organizationId));

        const catalogueById = new Map(catalogue.map((app) => [app.id, app]));

        const catalogueInstallers = yield* db
          .select()
          .from(s.applicationInstaller)
          .where(eq(s.applicationInstaller.organizationId, device.organizationId));

        const installersByApplication = new Map<string, typeof catalogueInstallers>();

        for (const installer of catalogueInstallers) {
          const current = installersByApplication.get(installer.applicationId) ?? [];

          current.push(installer);
          installersByApplication.set(installer.applicationId, current);
        }

        const deviceCapabilities = Array.isArray(device.capabilities)
          ? device.capabilities.filter((value): value is string => typeof value === "string")
          : undefined;

        const installed = yield* db
          .select({ bundleId: s.deviceApplication.bundleId })
          .from(s.deviceApplication)
          .where(eq(s.deviceApplication.deviceId, device.id));

        const installedBundles = new Set(installed.map((row) => row.bundleId));

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
              inArray(s.deviceCommand.requestType, [
                "InstallApplication",
                "InstallEnterpriseApplication",
              ]),
              gte(
                s.deviceCommand.createdAt,
                new Date(at.getTime() - DEVICE_COMMAND_INSTALL_ATTEMPT_WINDOW_MS),
              ),
            ),
          )
          .orderBy(desc(s.deviceCommand.createdAt))
          .limit(20);

        const macos = appleOsFamily(device.osEdition) === "macOS";

        const [appleEnrollment] = yield* db
          .select({ enrollmentMode: s.deviceApple.enrollmentMode })
          .from(s.deviceApple)
          .where(eq(s.deviceApple.deviceId, device.id))
          .limit(1);

        const userEnrolled = appleEnrollment?.enrollmentMode === "user";

        // A store app in a policy has no licence consumer. When Apps and Books
        // is configured, installing it here would bypass the licence pool, so
        // it is skipped in favour of the applications page, which assigns a
        // licence first.
        const [vpp] = yield* db
          .select({ organizationId: s.vppToken.organizationId })
          .from(s.vppToken)
          .where(eq(s.vppToken.organizationId, device.organizationId))
          .limit(1);

        for (const row of [...rows].sort((left, right) =>
          `${left.policyId}:${left.kind}`.localeCompare(`${right.policyId}:${right.kind}`),
        )) {
          const configuration = parseAppleApplicationConfiguration(row.data);

          if (!configuration) {
            yield* Effect.logWarning(
              `Policy application ${row.policyId}/${row.kind} is not a valid Apple application configuration and was not delivered to ${device.id}`,
            );
            continue;
          }

          const catalogueApplication =
            configuration.type === "catalogue"
              ? catalogueById.get(configuration.applicationId!)
              : undefined;

          const catalogueInstallers =
            configuration.type === "catalogue" && catalogueApplication
              ? (installersByApplication.get(catalogueApplication.id) ?? [])
              : [];

          // An uploaded .pkg only reaches macOS and an .ipa only iPhone/iPad;
          // filter before selection so the other artefact still wins.
          const candidates = catalogueInstallers.filter(
            (installer) =>
              installer.source !== "upload" ||
              appleUploadKind({
                fileName: installer.fileName,
                contentType: installer.contentType,
              }) === undefined ||
              appleUploadSupportsDevice({
                fileName: installer.fileName,
                contentType: installer.contentType,
                osEdition: device.osEdition,
              }),
          );

          const installer = selectInstaller(candidates, {
            proto: "apple",
            osVersion: device.osVersion,
            capabilities: deviceCapabilities,
          });

          // A catalogue that has installers must not fall back to its legacy
          // columns: that would deliver an artefact this device does not match.
          if (catalogueInstallers.length > 0 && !installer) {
            yield* Effect.logWarning(
              `Policy application ${row.policyId}/${row.kind} was not delivered to ${device.id}: ${
                installerSkipReason(candidates, {
                  proto: "apple",
                  osVersion: device.osVersion,
                  capabilities: deviceCapabilities,
                }) ?? "no installer matches this device"
              }`,
            );
            continue;
          }

          const resolved = resolvePolicyApplication(configuration, catalogueApplication, installer);

          if (!resolved.application) {
            yield* Effect.logWarning(
              `Policy application ${row.policyId}/${row.kind} was not delivered to ${device.id}: ${resolved.reason}`,
            );
            continue;
          }

          const application = resolved.application;

          if (installedBundles.has(application.bundleId)) continue;

          if (!shouldRetryInstallBundle(history, { bundleId: application.bundleId, now: at }))
            continue;

          if (application.source === "store" && vpp) {
            yield* Effect.logWarning(
              `Policy application ${row.policyId}/${row.kind} was not delivered to ${device.id}: Apps and Books is configured, so install it from the applications page to consume a licence`,
            );
            continue;
          }

          let requestType = "InstallApplication";
          let payload: CommandPayload;

          if (application.source === "upload") {
            const uploadKind = application.uploadKind;

            if (uploadKind === "pkg" && !macos) {
              yield* Effect.logWarning(
                `Policy application ${row.policyId}/${row.kind} is a .pkg and was not delivered to ${device.id}: uploaded packages install on macOS only`,
              );
              continue;
            }

            if (uploadKind === "ipa" && macos) {
              yield* Effect.logWarning(
                `Policy application ${row.policyId}/${row.kind} is an .ipa and was not delivered to ${device.id}: .ipa installs on iOS and iPadOS only`,
              );
              continue;
            }

            if (uploadKind === "ipa" && userEnrolled) {
              yield* Effect.logWarning(
                `Policy application ${row.policyId}/${row.kind} was not delivered to ${device.id}: Apple User Enrollment (BYOD) devices cannot install a managed .ipa`,
              );
              continue;
            }

            if (!uploadKind) {
              yield* Effect.logWarning(
                `Policy application ${row.policyId}/${row.kind} was not delivered to ${device.id}: the uploaded file is neither a .pkg nor an .ipa`,
              );
              continue;
            }

            if (!readApplicationObject) {
              yield* Effect.logWarning(
                `Policy application ${row.policyId}/${row.kind} was not delivered to ${device.id}: tenant storage is not configured for package delivery`,
              );
              continue;
            }

            if (!application.sha256 || !application.fileName) continue;

            // Multi-installer catalogues sign the selected installer, so two
            // versions of the same app cannot share one asset URL. A legacy
            // catalogue row without installer rows falls back to its own id.
            const assetOwnerId = application.installerId ?? application.catalogueApplicationId;

            const identifier = assetOwnerId
              ? catalogueApplicationAssetIdentifier(assetOwnerId)
              : configurationAssetIdentifier(row.policyId, row.kind);

            const token = yield* Effect.tryPromise({
              try: () =>
                signAppleAssetToken(authSecret ?? "", {
                  policyId: assetOwnerId ?? row.policyId,
                  kind: assetOwnerId ? CATALOGUE_APPLICATION_ASSET_KIND : row.kind,
                  deviceId: device.id,
                  expiresAt: appleInstallAssetExpiresAt(at.getTime()),
                }),
              catch: internal,
            });

            if (uploadKind === "pkg") {
              const url = `${serverOrigin}/mdm/apple/assets/${encodeURIComponent(identifier)}?token=${encodeURIComponent(token)}`;

              requestType = "InstallEnterpriseApplication";
              payload = buildInstallEnterpriseApplicationPayload({
                manifest: buildAppleManifest({
                  url,
                  sha256: application.sha256,
                  bundleId: application.bundleId,
                  version: application.version,
                  title: application.title,
                }),
                configuration: application.configuration,
                managementFlags: application.managementFlags,
              });
            } else {
              // InstallApplication has no inline manifest: point it at the
              // OTA manifest endpoint, which carries the same signed token and
              // in turn points at the signed package asset.
              const manifestUrl = `${serverOrigin}/mdm/apple/manifests/${encodeURIComponent(identifier)}?token=${encodeURIComponent(token)}`;

              requestType = "InstallApplication";
              payload = buildInstallApplicationPayload({
                manifestUrl,
                configuration: application.configuration,
                managementFlags: application.managementFlags,
              });
            }
          } else if (application.source === "store" && application.storeId) {
            payload = buildInstallApplicationPayload({
              storeId: application.storeId,
              configuration: application.configuration,
              managementFlags: application.managementFlags,
            });
          } else if (application.source === "manifest" && application.manifestUrl) {
            payload = buildInstallApplicationPayload({
              manifestUrl: application.manifestUrl,
              configuration: application.configuration,
              managementFlags: application.managementFlags,
            });
          } else {
            continue;
          }

          yield* queueAppleCommand(device, requestType, payload, at);

          if (application.catalogueApplicationId)
            yield* recordApplicationInstall(db, {
              organizationId: device.organizationId,
              deviceId: device.id,
              applicationId: application.catalogueApplicationId,
              installerId: application.installerId ?? null,
              platform: "apple",
              bundleId: application.bundleId,
              at,
            });
        }
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

        const installers = yield* db
          .select({
            id: s.applicationInstaller.id,
            applicationId: s.applicationInstaller.applicationId,
            bundleId: s.applicationInstaller.bundleId,
          })
          .from(s.applicationInstaller)
          .where(eq(s.applicationInstaller.organizationId, device.organizationId));

        const installersById = new Map(installers.map((row) => [row.id, row] as const));

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
          const targetCatalogueId = target.assetIdentifier
            ? parseCatalogueApplicationAssetIdentifier(target.assetIdentifier)
            : null;
          const installer = targetCatalogueId ? installersById.get(targetCatalogueId) : undefined;

          // A legacy upload signs the application id rather than an installer
          // id, so the identifier can name either row.
          const application = applications.find(
            (candidate) =>
              candidate.id === (installer?.applicationId ?? targetCatalogueId) ||
              (target.manifestUrl != null && candidate.manifestUrl === target.manifestUrl) ||
              (target.storeId != null && candidate.storeId === target.storeId) ||
              (target.bundleId != null && candidate.bundleId === target.bundleId),
          );

          if (!application || !(application.bundleId ?? installer?.bundleId)) continue;

          // A policy-owned install may target a catalogue app that is not
          // assigned through the catalogue. The policy check-in re-queues that
          // install, so only catalogue-assigned work is retried here.
          if (
            !(yield* applicationAssignedToDevice(device.organizationId, device.id, application.id))
          )
            continue;

          if (!shouldRetryInstall(history, { ...install, now: at })) continue;

          const dedupeKey = yield* commandDedupeKeyEffect(install.requestType, install.payload);

          yield* (
            db
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
              .onDuplicateKeyUpdate({ set: { requestType: install.requestType } })
          );

          requeued = true;
        }

        if (requeued) yield* pushEnrolledDevice(device.id, device.organizationId);
      });

    /**
     * Remove catalogue apps that are no longer assigned to this device and
     * opted into remove-on-unassign.
     *
     * Assignment edits queue removals immediately, but a device can lose
     * access through a group membership change, group deletion or direct
     * device removal. Running the same rule at check-in makes those paths
     * converge without a separate hook on every mutation. Only apps with
     * persisted install provenance are removed, so a user-installed app is
     * never claimed.
     */
    const queueUnassignedApplicationRemovals = (
      device: DeviceRow,
      configurations: ReadonlyArray<PolicyConfigurationRow>,
      at: Date,
    ): Effect.Effect<void, unknown, Db> =>
      Effect.gen(function* () {
        if (device.status !== "enrolled") return;

        const [apple] = yield* db
          .select({ enrollmentMode: s.deviceApple.enrollmentMode })
          .from(s.deviceApple)
          .where(eq(s.deviceApple.deviceId, device.id))
          .limit(1);

        // User Enrollment (BYOD) devices do not accept RemoveApplication.
        if (apple?.enrollmentMode === "user") return;

        const applications = yield* db
          .select({
            id: s.application.id,
            bundleId: s.application.bundleId,
            removeOnUnassign: s.application.removeOnUnassign,
          })
          .from(s.application)
          .where(
            and(
              eq(s.application.organizationId, device.organizationId),
              eq(s.application.removeOnUnassign, true),
            ),
          );

        if (applications.length === 0) return;

        const assigned = yield* applicationAssignedIds(device);

        // A policy can deliver a catalogue app without an assignment row, and
        // it is still "assigned" for this rule. Without this an app attached to
        // a policy would be removed at every check-in and reinstalled by the
        // policy, flapping forever.
        for (const configuration of configurations) {
          if (!isApplicationKind(configuration.kind)) continue;

          const applicationId = parseAppleApplicationConfiguration(
            configuration.data,
          )?.applicationId;

          if (applicationId) assigned.add(applicationId);
        }

        const candidates = applications.filter(
          (application) => application.bundleId && !assigned.has(application.id),
        );

        if (candidates.length === 0) return;

        const provenance = yield* db
          .select({
            applicationId: s.applicationInstall.applicationId,
            installerId: s.applicationInstall.installerId,
          })
          .from(s.applicationInstall)
          .where(
            and(
              eq(s.applicationInstall.deviceId, device.id),
              eq(s.applicationInstall.organizationId, device.organizationId),
            ),
          );

        const installed = yield* db
          .select({ bundleId: s.deviceApplication.bundleId })
          .from(s.deviceApplication)
          .where(eq(s.deviceApplication.deviceId, device.id));

        const queued = yield* db
          .select({ applicationId: s.applicationUninstall.applicationId })
          .from(s.applicationUninstall)
          .where(
            and(
              eq(s.applicationUninstall.deviceId, device.id),
              eq(s.applicationUninstall.organizationId, device.organizationId),
              eq(s.applicationUninstall.status, "queued"),
            ),
          );

        const installedBundles = new Set(installed.map((row) => row.bundleId));
        const queuedIds = new Set(queued.map((row) => row.applicationId));

        for (const application of candidates) {
          if (!application.bundleId || queuedIds.has(application.id)) continue;

          const installedByMattrax = provenance.find((row) => row.applicationId === application.id);

          if (!installedByMattrax || !installedBundles.has(application.bundleId)) continue;

          const command = yield* queueAppleCommand(
            device,
            "RemoveApplication",
            buildRemoveApplicationPayload(application.bundleId),
            at,
          );

          const [existing] = yield* db
            .select({ id: s.applicationUninstall.id })
            .from(s.applicationUninstall)
            .where(
              and(
                eq(s.applicationUninstall.deviceId, device.id),
                eq(s.applicationUninstall.applicationId, application.id),
              ),
            )
            .limit(1);

          const values = {
            organizationId: device.organizationId,
            deviceId: device.id,
            applicationId: application.id,
            installerId: installedByMattrax.installerId,
            platform: "apple" as const,
            bundleId: application.bundleId,
            adamId: null,
            commandId: command.id,
            status: "queued" as const,
            requestedAt: at,
            deadline: new Date(at.getTime() + APPLICATION_UNINSTALL_DEADLINE_MS),
            observedVersion: null,
            resultDetail: null,
            updatedAt: at,
          };

          if (existing)
            yield* db
              .update(s.applicationUninstall)
              .set(values)
              .where(eq(s.applicationUninstall.id, existing.id));
          else
            yield* db
              .insert(s.applicationUninstall)
              .values({ id: crypto.randomUUID(), createdAt: at, ...values });

          // The assignment-edit path audits this too; a check-in sweep is the
          // only place Apple applies the rule, so it must leave the same trace.
          yield* writeSystemAudit(
            db,
            {
              organizationId: device.organizationId,
              action: "application.uninstall_queued",
              targetType: "application",
              targetId: application.id,
              deviceId: device.id,
              protocol: "apple",
              metadata: {
                applicationId: application.id,
                bundleId: application.bundleId,
                reason: "remove-on-unassign",
              },
              coalesce: true,
            },
            auditOptions,
          );
        }
      }).pipe(
        Effect.catch((error) =>
          Effect.logWarning(
            `Failed to reconcile remove-on-unassign apps for ${device.id}: ${String(error)}`,
          ),
        ),
      );

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

        const installCommands = active.filter((row) =>
          isApplicationInstallRequest(row.requestType),
        );

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

        // An uploaded .ipa install carries only Mattrax's signed manifest URL,
        // so its bundle identity has to come from the installer the URL names.
        const installers =
          installCommands.length > 0
            ? yield* db
                .select({
                  id: s.applicationInstaller.id,
                  bundleId: s.applicationInstaller.bundleId,
                })
                .from(s.applicationInstaller)
                .where(eq(s.applicationInstaller.organizationId, device.organizationId))
            : [];

        const installerBundles = new Map(
          installers.flatMap((row) => (row.bundleId ? [[row.id, row.bundleId] as const] : [])),
        );

        const applicationBundles = new Map(
          applications.flatMap((row) => (row.bundleId ? [[row.id, row.bundleId] as const] : [])),
        );

        const targetBundleIds = (payload: CommandPayload) => {
          const target = installApplicationTarget(payload);
          const bundles = applications
            .filter(
              (application) =>
                (target.manifestUrl != null && application.manifestUrl === target.manifestUrl) ||
                (target.storeId != null && application.storeId === target.storeId) ||
                (target.bundleId != null && application.bundleId === target.bundleId),
            )
            .flatMap((application) => (application.bundleId ? [application.bundleId] : []));

          const targetCatalogueId = target.assetIdentifier
            ? parseCatalogueApplicationAssetIdentifier(target.assetIdentifier)
            : null;

          if (targetCatalogueId) {
            const bundle =
              installerBundles.get(targetCatalogueId) ?? applicationBundles.get(targetCatalogueId);

            if (bundle) bundles.push(bundle);
          }

          return bundles;
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
          active.filter(
            (row) => failed.has(row.id) && isApplicationInstallRequest(row.requestType),
          ),
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
      auditCheckinCoalesceWindowMs: options.auditCheckinCoalesceWindowMs,
    };

    /**
     * Record an Apple check-in the protocol layer rejected (an unparseable
     * plist, a bad signature, an invalid DDM report). Tenant attribution comes
     * from the identity certificate's OU; the UDID, when the payload parsed
     * far enough to carry one, binds the row to the device. Best effort: the
     * empty 400 the device receives is already decided.
     */
    const appleRecordFailure = (
      report: Parameters<NonNullable<ManagementBackend.Service["appleRecordFailure"]>>[0],
    ): Effect.Effect<void> =>
      provideDb(
        Effect.gen(function* () {
          const organizationId = certificateOu(report.identityCertificate);

          // No verified tenant: drop it rather than guess. The identity is
          // still visible in the request log, and writing into a tenant would
          // let an anonymous caller pollute its audit history.
          if (!organizationId) return;

          // A failure is attributed by the identity the device presented, not
          // by what its payload asserts. A certificate bound to device B must
          // never let a caller that presents it write against device A.
          let device: DeviceRow | undefined;
          let attribution: "bound" | "asserted" | undefined;

          const serial = normalizeIssuedCertificateSerial(report.identityCertificateSerial ?? "");

          if (serial) {
            const [certificate] = yield* db
              .select()
              .from(s.scepIssuedCertificate)
              .where(eq(s.scepIssuedCertificate.serial, serial))
              .limit(1);

            // The serial is global; reject a certificate issued to another
            // tenant before using its device binding.
            if (certificate?.organizationId === organizationId && certificate.deviceId) {
              const [byId] = yield* db
                .select()
                .from(s.device)
                .where(
                  and(
                    eq(s.device.organizationId, organizationId),
                    eq(s.device.id, certificate.deviceId),
                  ),
                )
                .limit(1);

              // Legacy rows were bound by `device.dmIdentifier`; try that only
              // when the internal id did not resolve.
              const [bound] =
                byId !== undefined
                  ? [byId]
                  : yield* db
                      .select()
                      .from(s.device)
                      .where(
                        and(
                          eq(s.device.organizationId, organizationId),
                          eq(s.device.dmIdentifier, certificate.deviceId),
                        ),
                      )
                      .limit(1);

              if (bound) {
                device = bound;
                attribution = "bound";
              }
            }
          }

          if (!device && report.identityCertificateFingerprintSha256) {
            const [bound] = yield* db
              .select()
              .from(s.device)
              .where(
                and(
                  eq(s.device.organizationId, organizationId),
                  eq(s.device.proto, "apple"),
                  eq(s.device.dmIdentityFingerprint, report.identityCertificateFingerprintSha256),
                ),
              )
              .limit(1);

            if (bound) {
              device = bound;
              attribution = "bound";
            }
          }

          if (!device && report.udid) {
            const [asserted] = yield* db
              .select()
              .from(s.device)
              .where(
                and(
                  eq(s.device.organizationId, organizationId),
                  eq(s.device.proto, "apple"),
                  eq(s.device.dmIdentifier, report.udid),
                ),
              )
              .limit(1);

            if (asserted) {
              device = asserted;
              attribution = "asserted";
            }
          }

          yield* writeSystemAudit(
            db,
            {
              organizationId,
              action: SYSTEM_AUDIT_ACTIONS.mdmFailure,
              targetType: device ? "device" : "enrollment",
              targetId: device?.id ?? null,
              deviceId: device?.id ?? null,
              protocol: "apple",
              ip: report.clientIp ?? null,
              userAgent: report.userAgent ?? null,
              certificateFingerprint: report.identityCertificateFingerprintSha256 ?? null,
              certificateSerial: report.identityCertificateSerial ?? null,
              principalId: report.userId ?? null,
              metadata: {
                platform: "apple",
                phase: report.phase ?? "checkin",
                code: report.code,
                reason: describeAuditFailure(report.message),
                ...(attribution ? { attribution } : {}),
                ...(report.udid ? { udid: report.udid } : {}),
                ...(report.userId ? { userId: report.userId } : {}),
              },
            },
            auditOptions,
          );
        }),
      ).pipe(
        Effect.catchCauseIf(
          (cause) => !Cause.hasInterrupts(cause),
          (cause) =>
            Effect.logWarning(`Could not record the Apple check-in failure: ${String(cause)}`),
        ),
      ) as Effect.Effect<void>;

    return ManagementBackend.of({
      appleRecordFailure,

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
                      eq(s.device.proto, "apple"),
                      eq(s.device.dmIdentifier, scope.udid),
                    ),
                  )
                  .limit(1);

                const serialNumber = event.serialNumber?.trim() || null;

                // A device can be re-assigned to another tenant (for example
                // after an ABM reassignment) and enrol again. Its previous
                // tenant must not keep a managed row that only the stale-device
                // sweep would eventually hide.
                //
                // The serial and UDID in an Authenticate body are asserted by
                // the device. A serial match is only actionable when this tenant
                // independently owns that exact serial (ABM or pre-registration).
                // A UDID-only match is never proof and is left to the sweep.
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

                const [abmAssignment] = serialNumber
                  ? yield* db
                      .select()
                      .from(s.abmDevice)
                      .where(
                        and(
                          eq(s.abmDevice.organizationId, organizationId),
                          eq(s.abmDevice.serial, serialNumber),
                          eq(s.abmDevice.enrollmentState, "ASSIGNED"),
                        ),
                      )
                      .limit(1)
                  : [];

                const serialProof = Boolean(preRegistration || abmAssignment);

                // `device_proto_serial_idx` keeps this cross-tenant lookup
                // index-only instead of scanning matching serials across
                // tenants.
                const serialMatches =
                  serialNumber && serialProof
                    ? yield* db
                        .select()
                        .from(s.device)
                        .where(and(eq(s.device.proto, "apple"), eq(s.device.serial, serialNumber)))
                    : [];

                // Proof is per departing row and tied to the serial that
                // matched it. Never fold UDID matches into this list: a device
                // can assert any UDID, and that must not delete another
                // tenant's row.
                const departedDevices = serialProof
                  ? serialMatches.filter(
                      (row) => row.organizationId !== organizationId && row.serial === serialNumber,
                    )
                  : [];

                // A same-serial device may already exist under an older UDID.
                // Reuse that row instead of hitting the tenant's
                // `(organization, serial)` unique index, but only with a
                // pre-registration or an already-released (unenrolled/stale)
                // slot. ABM assignment alone is not intra-tenant proof: an
                // enrolled device could otherwise claim a colleague's serial.
                const [existingBySerial] =
                  !existingByUdid && serialNumber
                    ? yield* db
                        .select()
                        .from(s.device)
                        .where(
                          and(
                            eq(s.device.organizationId, organizationId),
                            eq(s.device.proto, "apple"),
                            eq(s.device.serial, serialNumber),
                          ),
                        )
                        .limit(1)
                    : [];

                if (existingBySerial) {
                  const staleCutoff = Date.now() - APPLE_SERIAL_RECLAIM_STALE_MS;

                  const reclaimable =
                    Boolean(preRegistration) ||
                    existingBySerial.status === "unenrolled" ||
                    existingBySerial.lastSeenAt.getTime() < staleCutoff;

                  if (!reclaimable) {
                    yield* Effect.logWarning(
                      `Refusing to reclaim Apple serial ${serialNumber} (device ${existingBySerial.id}) for tenant ${organizationId}: no pre-registration, or stale/unenrolled row`,
                    );

                    return yield* Effect.fail(new UnknownDevice());
                  }
                }

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
                  physicalNameAt: now(),
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
                  // The user channels belonged to the previous MDM session and
                  // are re-established by UserAuthenticate/TokenUpdate. Their
                  // declaration state goes with them.
                  yield* db
                    .delete(s.deviceAppleUser)
                    .where(eq(s.deviceAppleUser.deviceId, deviceId));
                  yield* db
                    .delete(s.deviceUserDeclaration)
                    .where(eq(s.deviceUserDeclaration.deviceId, deviceId));
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
                    enrollmentId: event.enrollmentId ?? null,
                    enrollmentMode: event.enrollmentMode,
                    token: null,
                    pushMagic: null,
                    topic: null,
                    unlockToken: null,
                    deviceToken: id() + id(),
                    tokenUpdatedAt: null,
                  })
                  .onDuplicateKeyUpdate({
                    set: {
                      enrollmentId: event.enrollmentId ?? null,
                      enrollmentMode: event.enrollmentMode,
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
                    // Escrow the FileVault key and Activation Lock state at
                    // enrolment. On iOS this also reports passcode/Activation
                    // Lock manageability; on a Mac the key appears once the disk
                    // is encrypted and is re-requested then.
                    { requestType: "SecurityInfo", payload: {} },
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
                        dedupeKey: yield* commandDedupeKeyEffect(requestType, payload),
                        expiresAt: deviceCommandExpiresAt(requestType, at),
                        createdAt: at,
                        updatedAt: at,
                      });
                    }),
                  { concurrency: 1, discard: true },
                );

                // Only remove the previous tenant's row once this enrollment
                // has been recorded, so a failed Authenticate cannot leave the
                // device with no row in either tenant. Certificate revocation
                // and child-row cleanup are best effort: they must not fail an
                // enrollment that the current tenant has already accepted.
                // `departedDevices` only contains rows matched by the exact
                // serial proven above, so there is no request-global proof to
                // re-check here.
                yield* Effect.forEach(
                  departedDevices,
                  (departed) =>
                    deleteDepartedTenantDevice({
                      db,
                      device: departed,
                      reason: "Apple Authenticate enrolled the same serial in another tenant",
                      authSecret,
                      webhookDispatch: auditOptions.webhookDispatch,
                    }).pipe(
                      Effect.catch((error) =>
                        Effect.logWarning(
                          `Failed to clean up device ${departed.id} from tenant ${departed.organizationId}: ${String(error)}`,
                        ),
                      ),
                    ),
                  { concurrency: 1, discard: true },
                );

                // A device that did not already exist is a fresh enrollment.
                // If ABM assigned it to this tenant, hand Setup Assistant the
                // signed ADE profile so it does not need a manual install.
                const inlineProfile =
                  !existing && serialNumber
                    ? yield* inlineAdeEnrollmentProfile({
                        organizationId,
                        serial: serialNumber,
                      })
                    : undefined;

                return inlineProfile ? { enrollmentProfile: inlineProfile } : undefined;
              }

              const device = yield* findDeviceByScope(scope, options.requireAppleDeviceIdentity);

              if (!device) return yield* Effect.fail(new UnknownDevice());
              yield* bindAppleIdentityCertificate(device, scope);

              if (Predicate.isTagged("UserAuthenticate")(event)) {
                // macOS starts a user-channel session with this handshake. The
                // device identity has already been verified and bound; a user
                // we cannot bind to this tenant's device is refused with
                // UnknownDevice, which the protocol layer turns into 410.
                // `enrolling` is allowed because a user can log in before the
                // device's first TokenUpdate has marked it fully enrolled.
                if (
                  !Predicate.isTagged(scope, "user") ||
                  (device.status !== "enrolled" && device.status !== "enrolling")
                )
                  return yield* Effect.fail(new UnknownDevice());

                const at = now();

                yield* db
                  .insert(s.deviceAppleUser)
                  .values({
                    deviceId: device.id,
                    userId: scope.userId,
                    userShortName: scope.userShortName ?? null,
                    authenticatedAt: at,
                    lastSeenAt: at,
                    updatedAt: at,
                  })
                  .onDuplicateKeyUpdate({
                    set: {
                      userShortName: scope.userShortName ?? null,
                      authenticatedAt: at,
                      lastSeenAt: at,
                      updatedAt: at,
                    },
                  });

                return;
              }

              if (Predicate.isTagged("TokenUpdate")(event)) {
                if (event.channel === "user" && event.userId) {
                  if (
                    !Predicate.isTagged(scope, "user") ||
                    (device.status !== "enrolled" && device.status !== "enrolling")
                  )
                    return yield* Effect.fail(new UnknownDevice());

                  // Shared iPad never authenticates its users, so Apple sends
                  // the sentinel id and expects no UserAuthenticate. Every macOS
                  // user channel must have completed the handshake first:
                  // otherwise any managed device could register an arbitrary
                  // user's push channel. An unknown OS is treated as macOS so
                  // the check fails closed.
                  const sharedIpad = appleOsFamily(device.osEdition) === "iOS";

                  if (scope.source === "user-channel" && !sharedIpad) {
                    const [authenticated] = yield* db
                      .select({ authenticatedAt: s.deviceAppleUser.authenticatedAt })
                      .from(s.deviceAppleUser)
                      .where(
                        and(
                          eq(s.deviceAppleUser.deviceId, device.id),
                          eq(s.deviceAppleUser.userId, event.userId),
                        ),
                      )
                      .limit(1);

                    if (!authenticated?.authenticatedAt)
                      return yield* Effect.fail(new UnknownDevice());
                  }

                  const at = now();

                  yield* db
                    .insert(s.deviceAppleUser)
                    .values({
                      deviceId: device.id,
                      userId: event.userId,
                      userShortName: event.userShortName ?? scope.userShortName ?? null,
                      userLongName: event.userLongName ?? null,
                      token: event.pushToken,
                      pushMagic: event.pushMagic,
                      topic: event.topic,
                      unlockToken: event.unlockToken ?? null,
                      lastSeenAt: at,
                      updatedAt: at,
                    })
                    .onDuplicateKeyUpdate({
                      set: {
                        userShortName: event.userShortName ?? scope.userShortName ?? null,
                        userLongName: event.userLongName ?? null,
                        token: event.pushToken,
                        pushMagic: event.pushMagic,
                        topic: event.topic,
                        unlockToken: event.unlockToken ?? null,
                        lastSeenAt: at,
                        updatedAt: at,
                      },
                    });

                  yield* db
                    .update(s.device)
                    .set({ lastSeenAt: at })
                    .where(eq(s.device.id, device.id));

                  // A Shared iPad login identifies itself only by its Managed
                  // Apple Account, so this is where that account is correlated
                  // with the directory.
                  if (sharedIpad)
                    yield* bindManagedAppleAccountIdentity(
                      device,
                      event.userId,
                      event.userShortName ?? scope.userShortName,
                    ).pipe(
                      Effect.catch((error) =>
                        Effect.logWarning(
                          `Failed to bind the Managed Apple Account for ${event.userId} on ${device.id}: ${String(error)}`,
                        ),
                      ),
                    );

                  // Keep the enrollment kind correct for devices that enrolled
                  // before the column existed: a user-enrollment user channel
                  // can only come from an Apple User Enrollment.
                  if (scope.source === "user-enrollment")
                    yield* db
                      .update(s.deviceApple)
                      .set({ enrollmentMode: "user" })
                      .where(eq(s.deviceApple.deviceId, device.id));

                  yield* auditCheckin(device, scope, "user");

                  return;
                } else {
                  const [previousApple] = yield* db
                    .select({
                      awaitingConfiguration: s.deviceApple.awaitingConfiguration,
                      configured: s.deviceApple.configured,
                      returnToServiceRequestedAt: s.deviceApple.returnToServiceRequestedAt,
                      returnToServiceCompletedAt: s.deviceApple.returnToServiceCompletedAt,
                    })
                    .from(s.deviceApple)
                    .where(eq(s.deviceApple.deviceId, device.id))
                    .limit(1);

                  // Apple reports `AwaitingConfiguration` on every device
                  // TokenUpdate. Absent means false: the device did not enter
                  // the ADE await-configuration state.
                  const awaitingConfiguration = event.awaitingConfiguration === true;

                  const appleUpdate: Partial<typeof s.deviceApple.$inferInsert> = {
                    token: event.pushToken,
                    pushMagic: event.pushMagic,
                    topic: event.topic,
                    tokenUpdatedAt: now(),
                    awaitingConfiguration,
                    configured: !awaitingConfiguration,
                  };

                  if (event.unlockToken) appleUpdate.unlockToken = event.unlockToken;

                  if (event.enrollmentId) appleUpdate.enrollmentId = event.enrollmentId;

                  yield* db
                    .update(s.deviceApple)
                    .set(appleUpdate)
                    .where(eq(s.deviceApple.deviceId, device.id));

                  yield* auditCheckin(device, scope, "device");

                  const timestamp = now();

                  if (awaitingConfiguration) {
                    // The device is still in Setup Assistant. Keep it in the
                    // `enrolling` state so the console never reports it as a
                    // finished, policy-free enrolment, and queue the setup
                    // payload the release depends on.
                    yield* db
                      .update(s.device)
                      .set({ status: "enrolling", lastSeenAt: timestamp })
                      .where(eq(s.device.id, device.id));

                    if (previousApple?.awaitingConfiguration !== true)
                      yield* writeSystemAudit(
                        db,
                        {
                          organizationId: device.organizationId,
                          action: SYSTEM_AUDIT_ACTIONS.deviceAwaitingSetup,
                          targetType: "device",
                          targetId: device.id,
                          deviceId: device.id,
                          protocol: "apple",
                          metadata: {
                            platform: "apple",
                            serial: device.serial ?? null,
                            model: device.model ?? null,
                          },
                        },
                        auditOptions,
                      );

                    yield* queueLocalAdminAccount(device, authSecret, timestamp).pipe(
                      Effect.catch((error) =>
                        Effect.logWarning(
                          `Failed to queue the local admin account for ${device.id}: ${String(error)}`,
                        ),
                      ),
                    );
                    yield* pushEnrolledDevice(device.id, device.organizationId);
                  } else if (device.status === "enrolling") {
                    yield* db
                      .update(s.device)
                      .set({ status: "enrolled", lastSeenAt: timestamp })
                      .where(eq(s.device.id, device.id));
                    yield* writeSystemAudit(
                      db,
                      {
                        organizationId: device.organizationId,
                        action: SYSTEM_AUDIT_ACTIONS.deviceEnrolled,
                        targetType: "device",
                        targetId: device.id,
                        deviceId: device.id,
                        protocol: "apple",
                        metadata: {
                          platform: "apple",
                          serial: device.serial ?? null,
                          model: device.model ?? null,
                        },
                      },
                      auditOptions,
                    );
                    yield* pushEnrolledDevice(device.id, device.organizationId);
                    yield* syncDeviceGroups(device.organizationId, device.id);
                  } else {
                    yield* db
                      .update(s.device)
                      .set({ lastSeenAt: timestamp })
                      .where(eq(s.device.id, device.id));
                  }

                  // macOS reports local accounts only on request. Ask at
                  // enrolment so the inventory exists before an operator looks
                  // for it; the daily sweep covers devices that miss this.
                  if (!awaitingConfiguration)
                    yield* queueLocalAccountsInventory(device, timestamp).pipe(
                      Effect.catch((error) =>
                        Effect.logWarning(
                          `Failed to queue the local-account inventory for ${device.id}: ${String(error)}`,
                        ),
                      ),
                    );

                  // A lost device keeps reporting; refresh its location on a
                  // bounded cadence without queueing a command per check-in.
                  if (!awaitingConfiguration)
                    yield* queueLostModeLocation(device, timestamp).pipe(
                      Effect.catch((error) =>
                        Effect.logWarning(
                          `Failed to queue the Lost Mode location for ${device.id}: ${String(error)}`,
                        ),
                      ),
                    );

                  // A Return to Service re-enrolment is complete when the
                  // device reports its push token again. Record it on the
                  // timeline exactly once.
                  if (
                    previousApple?.returnToServiceRequestedAt &&
                    !previousApple.returnToServiceCompletedAt
                  ) {
                    yield* db
                      .update(s.deviceApple)
                      .set({ returnToServiceCompletedAt: timestamp })
                      .where(eq(s.deviceApple.deviceId, device.id));
                    yield* writeSystemAudit(
                      db,
                      {
                        organizationId: device.organizationId,
                        action: SYSTEM_AUDIT_ACTIONS.deviceReturnToServiceCompleted,
                        targetType: "device",
                        targetId: device.id,
                        deviceId: device.id,
                        protocol: "apple",
                        metadata: { platform: "apple", serial: device.serial ?? null },
                      },
                      auditOptions,
                    );
                  }
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

                // A rotated bootstrap token changes FileVault unlock state; ask
                // for a fresh security report so escrow metadata stays current.
                yield* enqueueSecurityInfo(device, now());

                return;
              }

              if (Predicate.isTagged("CheckOut")(event)) {
                if (event.userId) {
                  const at = now();

                  // A checked-out user channel can never receive its queued
                  // work, so close it instead of letting it expire unseen.
                  yield* db
                    .update(s.deviceCommand)
                    .set({
                      status: "cancelled",
                      dedupeKey: null,
                      resultStatus: RECONCILED_RESULT_STATUS,
                      resultDetail:
                        "The user channel checked out before the command was delivered.",
                      updatedAt: at,
                    })
                    .where(
                      and(
                        eq(s.deviceCommand.deviceId, device.id),
                        eq(s.deviceCommand.userId, event.userId),
                        inArray(s.deviceCommand.status, [...ACTIVE_COMMAND_STATUSES]),
                      ),
                    );
                  yield* db
                    .delete(s.deviceAppleUser)
                    .where(
                      and(
                        eq(s.deviceAppleUser.deviceId, device.id),
                        eq(s.deviceAppleUser.userId, event.userId),
                      ),
                    );
                  // Per-user declaration state belongs to the channel that
                  // reported it, so it goes with the channel.
                  yield* db
                    .delete(s.deviceUserDeclaration)
                    .where(
                      and(
                        eq(s.deviceUserDeclaration.deviceId, device.id),
                        eq(s.deviceUserDeclaration.userId, event.userId),
                      ),
                    );
                  yield* db
                    .update(s.device)
                    .set({ lastSeenAt: at })
                    .where(eq(s.device.id, device.id));

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
                      deviceId: device.id,
                      protocol: "apple",
                      metadata: { platform: "apple", previousStatus: device.status },
                    },
                    auditOptions,
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
                // User channels belong to this enrolment; without the device
                // channel there is nothing left to serve them. Their declaration
                // rows are per channel state and must not outlive it.
                yield* db
                  .delete(s.deviceAppleUser)
                  .where(eq(s.deviceAppleUser.deviceId, device.id));
                yield* db
                  .delete(s.deviceUserDeclaration)
                  .where(eq(s.deviceUserDeclaration.deviceId, device.id));
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
                // A user channel may only resolve commands queued for that
                // user, and the device channel may only resolve device-scoped
                // work. Otherwise one channel could acknowledge the other's
                // command.
                const commandUser = Predicate.isTagged(scope, "user") ? scope.userId : null;

                const commandScope = commandUser
                  ? eq(s.deviceCommand.userId, commandUser)
                  : isNull(s.deviceCommand.userId);

                const [command] = yield* db
                  .select()
                  .from(s.deviceCommand)
                  .where(
                    and(
                      eq(s.deviceCommand.id, event.commandUUID),
                      eq(s.deviceCommand.deviceId, device.id),
                      commandScope,
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
                      commandScope,
                    ),
                  );

                // A device can repeat the same result on retries. Only the
                // first transition is audited, and the detail text (which may
                // echo device data) is not stored.
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
                      deviceId: device.id,
                      protocol: "apple",
                      ip: scope.clientIp ?? null,
                      userAgent: scope.userAgent ?? null,
                      certificateFingerprint: scope.identityCertificateFingerprintSha256 ?? null,
                      certificateSerial: scope.identityCertificateSerial ?? null,
                      metadata: {
                        deviceId: device.id,
                        requestType: command.requestType,
                        resultStatus: event.status,
                      },
                    },
                    auditOptions,
                  );
                else if (command && command.status !== nextStatus && nextStatus === "succeeded")
                  // Successes have no dedicated lifecycle action; this is the
                  // one row that records the result was received.
                  yield* writeSystemAudit(
                    db,
                    {
                      organizationId: device.organizationId,
                      action: SYSTEM_AUDIT_ACTIONS.mdmCommandResult,
                      targetType: "device_command",
                      targetId: event.commandUUID,
                      deviceId: device.id,
                      protocol: "apple",
                      ip: scope.clientIp ?? null,
                      userAgent: scope.userAgent ?? null,
                      certificateFingerprint: scope.identityCertificateFingerprintSha256 ?? null,
                      certificateSerial: scope.identityCertificateSerial ?? null,
                      metadata: {
                        deviceId: device.id,
                        requestType: command.requestType,
                        resultStatus: event.status,
                        channel: commandUser ? "user" : "device",
                      },
                    },
                    auditOptions,
                  );

                // An InstallProfile acknowledgment is the only reliable
                // evidence that the lock screen profile is on the device.
                // Record the values carried by that profile, once, and never
                // let an older acknowledgement overwrite a newer applied state.
                if (
                  command &&
                  command.status !== "succeeded" &&
                  nextStatus === "succeeded" &&
                  command.requestType === "InstallProfile"
                ) {
                  const applied = yield* Effect.promise(() =>
                    lockScreenProfileFromInstallPayload(command.payload),
                  );

                  if (
                    applied &&
                    applied.identifier === appleLockScreenProfileIdentifier(device.id) &&
                    (!device.appliedLockScreenAt ||
                      command.updatedAt.getTime() >= device.appliedLockScreenAt.getTime())
                  ) {
                    const appliedAt = now();

                    yield* db
                      .update(s.device)
                      .set({
                        appliedLockScreenMessage: applied.message,
                        appliedLockScreenAssetTag: applied.assetTagInfo,
                        appliedLockScreenName: device.queuedLockScreenName ?? device.name,
                        appliedLockScreenAt: appliedAt,
                      })
                      .where(eq(s.device.id, device.id));
                    yield* db
                      .update(s.deviceCommand)
                      .set({
                        resultDetail: applied.assetTagInfo
                          ? `Lock screen profile installed with asset tag "${applied.assetTagInfo}".`
                          : "Lock screen profile installed.",
                        updatedAt: appliedAt,
                      })
                      .where(
                        and(
                          eq(s.deviceCommand.id, command.id),
                          eq(s.deviceCommand.deviceId, device.id),
                        ),
                      );
                  }
                }

                if (
                  command &&
                  command.status !== "succeeded" &&
                  nextStatus === "succeeded" &&
                  command.requestType === "RemoveProfile"
                ) {
                  const identifier =
                    Schema.is(Schema.JsonObject)(command.payload) &&
                    Schema.is(Schema.String)(command.payload["Identifier"])
                      ? command.payload["Identifier"]
                      : undefined;

                  if (
                    identifier === appleLockScreenProfileIdentifier(device.id) &&
                    (!device.appliedLockScreenAt ||
                      command.updatedAt.getTime() >= device.appliedLockScreenAt.getTime())
                  ) {
                    const appliedAt = now();

                    yield* db
                      .update(s.device)
                      .set({
                        appliedLockScreenMessage: null,
                        appliedLockScreenAssetTag: null,
                        appliedLockScreenName: null,
                        appliedLockScreenAt: appliedAt,
                      })
                      .where(eq(s.device.id, device.id));
                    yield* db
                      .update(s.deviceCommand)
                      .set({
                        resultDetail: "Lock screen profile removed.",
                        updatedAt: appliedAt,
                      })
                      .where(
                        and(
                          eq(s.deviceCommand.id, command.id),
                          eq(s.deviceCommand.deviceId, device.id),
                        ),
                      );
                  }
                }

                // A `Settings` command that changed the device name is the
                // only reliable acknowledgement: record the applied value so
                // the drift indicator can distinguish "never pushed" from
                // "pushed and still different". The device's next inventory
                // report updates `physicalName` independently.
                //
                // Only the first terminal transition for an active command can
                // claim the applied value. A duplicate result for an already
                // acknowledged command, or an older command whose result
                // arrives after a newer acknowledgement, must not overwrite it.
                if (
                  command?.requestType === "Settings" &&
                  nextStatus === "succeeded" &&
                  commandStatusIsActive(command.status) &&
                  !(
                    device.appliedNameAt &&
                    command.createdAt.getTime() < device.appliedNameAt.getTime()
                  )
                ) {
                  const pushedName = appleDeviceNameFromSettingsPayload(command.payload);

                  if (pushedName) {
                    const appliedAt = now();

                    yield* db
                      .update(s.device)
                      .set({ appliedName: pushedName, appliedNameAt: appliedAt })
                      .where(eq(s.device.id, device.id));
                    yield* db
                      .update(s.deviceCommand)
                      .set({
                        resultDetail: `Device name set to "${pushedName}".`,
                        updatedAt: appliedAt,
                      })
                      .where(
                        and(
                          eq(s.deviceCommand.id, command.id),
                          eq(s.deviceCommand.deviceId, device.id),
                        ),
                      );
                  }
                }

                // A user channel has its own inventory. Persist only the
                // per-user state and never let it overwrite device inventory,
                // status or setup state.
                if (commandUser) {
                  const at = now();

                  const profiles =
                    command?.requestType === "ProfileList"
                      ? parseAppleUserProfiles(
                          Option.getOrUndefined(
                            Schema.decodeUnknownOption(PlistValue)(event.queryResponses),
                          ),
                        )
                      : undefined;

                  yield* db
                    .update(s.deviceAppleUser)
                    .set(profiles === undefined ? { lastSeenAt: at } : { lastSeenAt: at, profiles })
                    .where(
                      and(
                        eq(s.deviceAppleUser.deviceId, device.id),
                        eq(s.deviceAppleUser.userId, commandUser),
                      ),
                    );

                  return;
                }

                if (command?.requestType === "DeviceConfigured" && nextStatus === "succeeded") {
                  const releasedAt = now();

                  yield* db
                    .update(s.deviceApple)
                    .set({
                      configured: true,
                      awaitingConfiguration: false,
                      setupReleasedAt: releasedAt,
                    })
                    .where(eq(s.deviceApple.deviceId, device.id));
                  yield* db
                    .update(s.device)
                    .set({ status: "enrolled", lastSeenAt: releasedAt })
                    .where(eq(s.device.id, device.id));
                  yield* writeSystemAudit(
                    db,
                    {
                      organizationId: device.organizationId,
                      action: SYSTEM_AUDIT_ACTIONS.deviceSetupComplete,
                      targetType: "device",
                      targetId: device.id,
                      deviceId: device.id,
                      protocol: "apple",
                      metadata: { platform: "apple", serial: device.serial ?? null },
                    },
                    auditOptions,
                  );
                  yield* writeSystemAudit(
                    db,
                    {
                      organizationId: device.organizationId,
                      action: SYSTEM_AUDIT_ACTIONS.deviceEnrolled,
                      targetType: "device",
                      targetId: device.id,
                      deviceId: device.id,
                      protocol: "apple",
                      metadata: {
                        platform: "apple",
                        serial: device.serial ?? null,
                        model: device.model ?? null,
                      },
                    },
                    auditOptions,
                  );
                  yield* pushEnrolledDevice(device.id, device.organizationId);
                  yield* syncDeviceGroups(device.organizationId, device.id);
                } else if (
                  command &&
                  ["AccountConfiguration", "InstallProfile", "RemoveProfile"].includes(
                    command.requestType,
                  )
                ) {
                  // The declaration report may already have arrived; this
                  // command result is the last missing precondition.
                  yield* releaseAwaitingConfiguration(device).pipe(
                    Effect.catch((error) =>
                      Effect.logWarning(
                        `Failed to evaluate ADE setup release for ${device.id}: ${String(error)}`,
                      ),
                    ),
                  );
                }
                // SecurityInfo and InstalledApplicationList responses are
                // attached to the same command result envelope. Persist both
                // idempotently so retries cannot duplicate rows.

                const queryResponses = Option.getOrUndefined(
                  Schema.decodeUnknownOption(PlistValue)(event.queryResponses),
                );

                if (
                  command?.requestType === "EnableLostMode" &&
                  nextStatus === "succeeded" &&
                  command.status !== "succeeded"
                ) {
                  const [lostMode] = yield* db
                    .select({ commandId: s.deviceApple.lostModeCommandId })
                    .from(s.deviceApple)
                    .where(eq(s.deviceApple.deviceId, device.id))
                    .limit(1);

                  // A delayed acknowledgement for a command a newer Lost Mode
                  // request already replaced must not flip the state.
                  if (!lostMode?.commandId || lostMode.commandId === command.id) {
                    const acknowledgedAt = now();

                    yield* db
                      .update(s.deviceApple)
                      .set({ lostModeEnabled: true, lostModeAcknowledgedAt: acknowledgedAt })
                      .where(eq(s.deviceApple.deviceId, device.id));

                    // Apple reports the location from its own command. Queue it
                    // only now that Lost Mode is actually on; the device answers
                    // it on a following check-in.
                    yield* queueLostModeLocation(device, acknowledgedAt).pipe(
                      Effect.catch((error) =>
                        Effect.logWarning(
                          `Failed to queue the Lost Mode location for ${device.id}: ${String(error)}`,
                        ),
                      ),
                    );
                  }
                }

                if (
                  command?.requestType === "DisableLostMode" &&
                  nextStatus === "succeeded" &&
                  command.status !== "succeeded"
                ) {
                  const [lostMode] = yield* db
                    .select({ commandId: s.deviceApple.lostModeCommandId })
                    .from(s.deviceApple)
                    .where(eq(s.deviceApple.deviceId, device.id))
                    .limit(1);

                  if (!lostMode?.commandId || lostMode.commandId === command.id)
                    // A device that is no longer lost must not keep showing a
                    // location; the last message stays as history.
                    yield* db
                      .update(s.deviceApple)
                      .set({
                        lostModeEnabled: false,
                        lostModeLatitude: null,
                        lostModeLongitude: null,
                        lostModeHorizontalAccuracy: null,
                        lostModeVerticalAccuracy: null,
                        lostModeLocationReportedAt: null,
                        lostModeLocationUpdatedAt: null,
                      })
                      .where(eq(s.deviceApple.deviceId, device.id));
                }

                if (command?.requestType === "DeviceLocation")
                  yield* applyLostModeLocation(device, queryResponses);

                if (command?.requestType === "UserList")
                  yield* applyLocalAccounts(device, queryResponses);

                if (
                  command?.requestType === "SetAutoAdminPassword" &&
                  command.status !== nextStatus
                ) {
                  if (nextStatus === "succeeded") {
                    const rotatedAt = now();

                    const [pending] = yield* db
                      .select({
                        kind: s.deviceSecret.kind,
                        commandId: s.deviceSecret.pendingCommandId,
                      })
                      .from(s.deviceSecret)
                      .where(
                        and(
                          eq(s.deviceSecret.deviceId, device.id),
                          eq(s.deviceSecret.kind, "local_admin_password_pending"),
                        ),
                      )
                      .limit(1);

                    // Without a pending value there is nothing to promote; do
                    // not delete the password the device still uses.
                    if (pending && (!pending.commandId || pending.commandId === command.id)) {
                      // The pending value only becomes the revealed password
                      // once the Mac confirms it applied the hash.
                      yield* db
                        .delete(s.deviceSecret)
                        .where(
                          and(
                            eq(s.deviceSecret.deviceId, device.id),
                            eq(s.deviceSecret.kind, "local_admin_password"),
                          ),
                        );
                      yield* db
                        .update(s.deviceSecret)
                        .set({ kind: "local_admin_password", updatedAt: rotatedAt, rotatedAt })
                        .where(
                          and(
                            eq(s.deviceSecret.deviceId, device.id),
                            eq(s.deviceSecret.kind, "local_admin_password_pending"),
                          ),
                        );
                    }
                  } else if (nextStatus === "failed") {
                    // Never leave a password that the device rejected, but only
                    // if this is still the pending rotation for this command.
                    const [pending] = yield* db
                      .select({ commandId: s.deviceSecret.pendingCommandId })
                      .from(s.deviceSecret)
                      .where(
                        and(
                          eq(s.deviceSecret.deviceId, device.id),
                          eq(s.deviceSecret.kind, "local_admin_password_pending"),
                        ),
                      )
                      .limit(1);

                    if (pending && (!pending.commandId || pending.commandId === command.id))
                      yield* db
                        .delete(s.deviceSecret)
                        .where(
                          and(
                            eq(s.deviceSecret.deviceId, device.id),
                            eq(s.deviceSecret.kind, "local_admin_password_pending"),
                          ),
                        );
                  }
                }

                yield* applySecurityInfo(device, queryResponses, auditOptions);
                yield* applyInstalledApplications(device, queryResponses, {
                  releaseVppLicence: options.releaseAppleVppLicence,
                });

                // Activation Lock bypass codes come from their own command, not
                // `SecurityInfo`. Apple only returns a code before the device is
                // locked, so it is sealed and kept for the next reveal.
                const bypassCode = parseActivationLockBypassCode(queryResponses);

                if (bypassCode !== undefined)
                  yield* writeDeviceSecret(
                    device,
                    "activation_lock_bypass_code",
                    bypassCode,
                    authSecret,
                  );

                // `RotateFileVaultKey` returns the replacement personal recovery
                // key wrapped for the tenant escrow certificate.
                const rotatedKey = parseRotatedRecoveryKey(queryResponses);

                if (rotatedKey !== undefined) {
                  yield* writeDeviceSecret(
                    device,
                    "filevault_recovery_key",
                    rotatedKey.value,
                    authSecret,
                    { format: rotatedKey.format },
                  );
                  yield* db
                    .update(s.deviceApple)
                    .set({ securityInfoUpdatedAt: now() })
                    .where(eq(s.deviceApple.deviceId, device.id));
                }

                // A successful erase destroys the disk the recovery key protects
                // and the device generates a new Activation Lock bypass code on
                // its next setup, so the old escrow values are history.
                if (command?.requestType === "EraseDevice" && nextStatus === "succeeded")
                  yield* Effect.gen(function* () {
                    yield* db
                      .delete(s.deviceSecret)
                      .where(
                        and(
                          eq(s.deviceSecret.deviceId, device.id),
                          inArray(s.deviceSecret.kind, [
                            "filevault_recovery_key",
                            "activation_lock_bypass_code",
                            "recovery_lock_password",
                            "local_admin_password",
                            "local_admin_password_pending",
                          ]),
                        ),
                      );
                    // The erase destroys the managed account and any Lost Mode
                    // state, so neither survives it.
                    yield* db
                      .update(s.deviceApple)
                      .set({
                        localAdminGuid: null,
                        lostModeEnabled: false,
                        lostModeMessage: null,
                        lostModePhone: null,
                        lostModeFootnote: null,
                        lostModeLatitude: null,
                        lostModeLongitude: null,
                        lostModeHorizontalAccuracy: null,
                        lostModeVerticalAccuracy: null,
                        lostModeLocationReportedAt: null,
                        lostModeLocationUpdatedAt: null,
                      })
                      .where(eq(s.deviceApple.deviceId, device.id));
                    yield* db
                      .delete(s.deviceLocalAccount)
                      .where(eq(s.deviceLocalAccount.deviceId, device.id));
                  });

                // `PasswordVerified` is the answer to a `VerifyRecoveryLock`
                // command; record it so the device page can report the check.
                const recoveryLockVerified = parseRecoveryLockVerification(queryResponses);

                if (
                  command?.requestType === "VerifyRecoveryLock" &&
                  recoveryLockVerified !== undefined
                )
                  yield* db
                    .update(s.deviceCommand)
                    .set({
                      resultDetail: recoveryLockVerified
                        ? "The device verified the Recovery Lock password."
                        : "The device rejected the Recovery Lock password.",
                      updatedAt: now(),
                    })
                    .where(eq(s.deviceCommand.id, command.id));

                // `DeviceInformation` answers carry the name Apple reports for
                // itself. An administrator's rename always wins; otherwise the
                // name follows the device while it is still an auto-derived
                // placeholder.
                const reportedName = record(queryResponses)?.DeviceName;

                if (Schema.is(Schema.String)(reportedName) && reportedName.trim()) {
                  const name = reportedName.trim();

                  const nameUpdate: Partial<typeof s.device.$inferInsert> = {
                    physicalName: name,
                    physicalNameAt: now(),
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
                // A user channel's status report describes that user's
                // declarations, not the device inventory.
                if (Predicate.isTagged(scope, "user")) {
                  yield* db
                    .update(s.deviceAppleUser)
                    .set({ lastSeenAt: now() })
                    .where(
                      and(
                        eq(s.deviceAppleUser.deviceId, device.id),
                        eq(s.deviceAppleUser.userId, scope.userId),
                      ),
                    );

                  const statusItems = Option.getOrUndefined(
                    Schema.decodeUnknownOption(PlistValue)(event.statusItems),
                  );

                  if (statusItems !== undefined) {
                    const changed = yield* updateUserDeclarationsFromStatus(
                      device.id,
                      scope.userId,
                      statusItems,
                      now(),
                    ).pipe(Effect.mapError(internal));

                    if (changed.changed)
                      yield* writeSystemAudit(
                        db,
                        {
                          organizationId: device.organizationId,
                          action: SYSTEM_AUDIT_ACTIONS.mdmStatusReport,
                          targetType: "device",
                          targetId: device.id,
                          deviceId: device.id,
                          protocol: "apple",
                          ip: scope.clientIp ?? null,
                          userAgent: scope.userAgent ?? null,
                          certificateFingerprint:
                            scope.identityCertificateFingerprintSha256 ?? null,
                          certificateSerial: scope.identityCertificateSerial ?? null,
                          metadata: { platform: "apple", channel: "user", declarations: true },
                        },
                        auditOptions,
                      );
                  }

                  return;
                }

                const outcome = yield* updateInventoryFromStatus(
                  device.id,
                  device.organizationId,
                  Option.getOrUndefined(Schema.decodeUnknownOption(PlistValue)(event.statusItems)),
                  auditOptions,
                );

                // A report is only an event when it changed something. Polls
                // that repeat the same inventory stay invisible; the check-in
                // row already proves the device is alive.
                if (
                  outcome.inventoryChanged ||
                  outcome.declarationsChanged ||
                  outcome.healthChanged
                )
                  yield* writeSystemAudit(
                    db,
                    {
                      organizationId: device.organizationId,
                      action: SYSTEM_AUDIT_ACTIONS.mdmStatusReport,
                      targetType: "device",
                      targetId: device.id,
                      deviceId: device.id,
                      protocol: "apple",
                      ip: scope.clientIp ?? null,
                      userAgent: scope.userAgent ?? null,
                      certificateFingerprint: scope.identityCertificateFingerprintSha256 ?? null,
                      certificateSerial: scope.identityCertificateSerial ?? null,
                      metadata: {
                        platform: "apple",
                        channel: "device",
                        inventoryChanged: outcome.inventoryChanged,
                        declarationsChanged: outcome.declarationsChanged,
                        healthChanged: outcome.healthChanged,
                      },
                    },
                    auditOptions,
                  );

                // The DDM report is the last gate for an ADE device held in
                // Setup Assistant: release it once every declaration is valid.
                yield* releaseAwaitingConfiguration(device).pipe(
                  Effect.catch((error) =>
                    Effect.logWarning(
                      `Failed to evaluate ADE setup release for ${device.id}: ${String(error)}`,
                    ),
                  ),
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

            yield* auditCheckin(
              device,
              scope,
              Predicate.isTagged(scope, "user") ? "user" : "device",
            );

            const at = now();

            // A user connection only ever sees its own commands and the
            // declarations resolved for its own login. Device-scoped policy,
            // inventory and setup never reach this branch: serving them here
            // would apply device configuration inside the user's context.
            if (Predicate.isTagged(scope, "user")) {
              if (device.status !== "enrolled") return { _tag: "Idle" as const };

              yield* requireDeviceUser(device, scope.userId);

              yield* db
                .update(s.deviceAppleUser)
                .set({ lastSeenAt: at })
                .where(
                  and(
                    eq(s.deviceAppleUser.deviceId, device.id),
                    eq(s.deviceAppleUser.userId, scope.userId),
                  ),
                );

              const command = yield* deliverQueuedCommand(device, scope.userId, at);

              if (command) return { _tag: "Command" as const, ...command };

              // The user channel's declarative support follows the device's:
              // macOS below 13 has no declarative management at all, so there
              // is nothing to sync into this login.
              const mode = yield* deliveryModeForDevice(device.id).pipe(Effect.mapError(internal));

              if (mode !== "ddm") return { _tag: "Idle" as const };

              // User policy is only served to a verified directory identity.
              // An unbound channel still checks in for commands and push.
              const bound = yield* boundAppleUser(device, scope.userId);

              if (!bound) return { _tag: "Idle" as const };

              const deviceToken = yield* deviceTokenFor(device.id);

              const declarations = yield* userDeclarationItems(
                device,
                deviceToken,
                { origin, authSecret: authSecret ?? "" },
                bound.directoryUserId,
              ).pipe(Effect.mapError(internal));

              // Same contract as the device channel: a matching token means the
              // login already has this exact set. A channel that had declarations
              // and now has none still differs, so it gets one sync to remove them.
              if (bound.ddmDeclarationsToken === declarations.token)
                return { _tag: "Idle" as const };

              // The token is persisted when the channel fetches the items, not
              // here: a device that never syncs must be asked again. The
              // delivery event is written by `getAppleDeclarationItems`, so a
              // sync looks like one delivery, not two.
              return { _tag: "DdmSync" as const, serverToken: declarations.token };
            }

            const [appleState] = yield* db
              .select({
                declarationMode: s.deviceApple.declarationMode,
                declarationModeReason: s.deviceApple.declarationModeReason,
                awaitingConfiguration: s.deviceApple.awaitingConfiguration,
                enrollmentMode: s.deviceApple.enrollmentMode,
              })
              .from(s.deviceApple)
              .where(eq(s.deviceApple.deviceId, device.id))
              .limit(1);

            // An ADE device held in Setup Assistant is still `enrolling` but
            // must receive its setup commands. Every other non-enrolled state
            // has no live MDM session, so it gets an empty answer.
            if (
              device.status !== "enrolled" &&
              !(device.status === "enrolling" && appleState?.awaitingConfiguration === true)
            )
              return { _tag: "Idle" as const };

            // Declarations need both a supported OS and an advertised capability.
            // A device that fails either is moved to legacy profiles rather than
            // being told to sync declarations it will reject.
            const decision = decideAppleDelivery({
              osEdition: device.osEdition,
              osVersion: device.osVersion,
              capabilities: Option.getOrUndefined(
                Schema.decodeUnknownOption(Schema.Json)(device.capabilities),
              ),
            });

            const modeChangedToLegacy =
              decision.mode === "legacy" && appleState?.declarationMode !== "legacy";

            const scoped = yield* scopedConfigurations(
              device,
              decision.mode === "legacy" ? "legacy" : "ddm",
            ).pipe(Effect.mapError(internal));

            // Remove-on-unassign runs before policy installs so a policy app is
            // excluded from removal by `scoped` and cannot flap.
            yield* queueUnassignedApplicationRemovals(device, scoped.configurations, at);

            // Application installs are imperative commands, not declarations, so
            // they are queued for both delivery modes. `scoped` already applied
            // policy precedence and exclusions.
            yield* queuePolicyApplicationInstalls(device, scoped.configurations, at).pipe(
              Effect.catch((error) =>
                Effect.logWarning(
                  `Failed to queue policy application installs for ${device.id}: ${String(error)}`,
                ),
              ),
            );

            if (decision.mode === "legacy") {
              const skippedNote = describeSkippedConfigurations(scoped.skipped);

              const reason = skippedNote ? `${decision.reason} ${skippedNote}` : decision.reason;

              if (
                appleDeliveryModeChanged(
                  {
                    mode: appleState?.declarationMode,
                    reason: appleState?.declarationModeReason,
                  },
                  { mode: "legacy", reason },
                )
              )
                yield* db
                  .update(s.deviceApple)
                  .set({
                    declarationMode: "legacy",
                    declarationModeReason: reason,
                    declarationModeUpdatedAt: at,
                  })
                  .where(eq(s.deviceApple.deviceId, device.id));

              // The device cannot fetch declarations; clear the remembered sync
              // token so a future upgrade performs a full sync.
              if (appleState?.declarationMode === "ddm")
                yield* db
                  .update(s.device)
                  .set({ ddmDeclarationsToken: null })
                  .where(eq(s.device.id, device.id));

              const legacy = yield* syncLegacyPolicy(
                device,
                scoped.configurations.filter(
                  (configuration) => !isApplicationKind(configuration.kind),
                ),
                at,
              ).pipe(Effect.mapError(internal));

              // Only a real diff is a delivery: a device that is already in
              // sync polls without producing a policy event.
              if (legacy.installed + legacy.removed > 0)
                yield* writeSystemAudit(
                  db,
                  {
                    organizationId: device.organizationId,
                    action: SYSTEM_AUDIT_ACTIONS.mdmPolicyDelivered,
                    targetType: "device",
                    targetId: device.id,
                    deviceId: device.id,
                    protocol: "apple",
                    ip: scope.clientIp ?? null,
                    userAgent: scope.userAgent ?? null,
                    certificateFingerprint: scope.identityCertificateFingerprintSha256 ?? null,
                    certificateSerial: scope.identityCertificateSerial ?? null,
                    metadata: {
                      platform: "apple",
                      channel: "device",
                      mode: "legacy",
                      installed: legacy.installed,
                      removed: legacy.removed,
                    },
                  },
                  auditOptions,
                );
            } else if (appleState?.declarationMode === "legacy") {
              // Back on declarative management: retire the legacy profiles so a
              // setting is not applied by both channels, and force a sync.
              yield* removeLegacyPolicyProfiles(device, at).pipe(
                Effect.catch((error) =>
                  Effect.logWarning(
                    `Failed to remove legacy profiles for ${device.id}: ${String(error)}`,
                  ),
                ),
              );
              yield* db
                .update(s.device)
                .set({ ddmDeclarationsToken: null })
                .where(eq(s.device.id, device.id));
            }

            // The legacy branch above has already persisted its reason (with
            // the skipped-configuration summary); only the declarative path is
            // recorded here.
            if (
              decision.mode === "ddm" &&
              appleDeliveryModeChanged(
                { mode: appleState?.declarationMode, reason: appleState?.declarationModeReason },
                decision,
              )
            )
              yield* db
                .update(s.deviceApple)
                .set({
                  declarationMode: decision.mode,
                  declarationModeReason: decision.reason,
                  declarationModeUpdatedAt: at,
                })
                .where(eq(s.deviceApple.deviceId, device.id));

            // Script payloads are independent of policy delivery: they are
            // installed for every Mac, including one with no policies, and
            // their diff comes from the device's own command history.
            yield* syncAppleScripts(device, at).pipe(
              Effect.catch((error) =>
                Effect.logWarning(`Failed to deliver scripts to ${device.id}: ${String(error)}`),
              ),
            );

            // "Apply name to device with each sync": the command check-in is
            // the device's regular poll, so this is where the name is
            // re-queued and delivered in the same response.
            yield* queueDeviceNameUpdate(device, appleState?.enrollmentMode ?? null, at);

            // The lock screen default is resolved alongside the effective
            // policy above, so the profile is synced from the same state the
            // policy page shows.
            yield* syncLockScreenProfile(
              device,
              appleState?.enrollmentMode ?? null,
              scoped.lockScreenMessage,
              at,
            );

            const delivery = yield* deliverQueuedCommand(device, null, at);

            if (delivery) return { _tag: "Command" as const, ...delivery };

            // Older clients cannot apply a declaration; they receive their
            // policy through the profile commands queued above instead.
            if (decision.mode === "legacy") {
              if (modeChangedToLegacy) yield* pushEnrolledDevice(device.id, device.organizationId);

              return { _tag: "Idle" as const };
            }

            const deviceToken = yield* deviceTokenFor(device.id);

            const items = yield* declarationItemsForDevice(
              device,
              deviceToken,
              { origin, authSecret: authSecret ?? "" },
              "ddm",
            ).pipe(Effect.mapError(internal));

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
            // before the device has fetched anything. The declaration items
            // handler records it (and the policy-delivery event) once the
            // device actually asks for content.
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

            return yield* readAppleBootstrapToken(device, authSecret);
          }).pipe(
            Effect.mapError((cause) => (cause instanceof UnknownDevice ? cause : internal())),
          ),
        ),

      appleReturnToServiceConfiguration: (scope) =>
        provideDb(
          Effect.gen(function* () {
            const device = yield* requireDevice(scope);

            if (device.status !== "enrolled" && device.status !== "enrolling")
              return {
                enabled: false,
                reason: "The device is not enrolled",
              } satisfies AppleReturnToServiceConfiguration;

            const effective = yield* resolveEffectivePolicyForDevice(db, device);

            // The profile is already a complete `.mobileconfig`; Apple installs
            // it before Setup Assistant so the device can rejoin the network.
            const wifi = effective.configurations
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

            if (!wifi)
              return {
                enabled: false,
                reason:
                  "No Wi-Fi configuration is assigned to this device. Add a Wi-Fi policy before using Return to Service.",
              } satisfies AppleReturnToServiceConfiguration;

            const token = yield* readAppleBootstrapToken(device, authSecret);

            const configuration: ReturnToServiceConfig = {
              enabled: true,
              wifiProfileData: base64DecodeBytes(wifi),
            };

            if (token) configuration.bootstrapToken = base64DecodeBytes(token);

            return configuration satisfies AppleReturnToServiceConfiguration;
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

            // User-scoped declarations only. A bound channel gets the tokens
            // for its own set; an unbound channel gets a stable empty set and
            // therefore syncs nothing into the user's context.
            if (Predicate.isTagged(scope, "user")) {
              yield* requireDeviceUser(device, scope.userId);

              const emptyToken = yield* Effect.tryPromise({
                try: () => hashToken([]),
                catch: internal,
              });

              const bound = yield* boundAppleUser(device, scope.userId);

              if (!bound)
                return {
                  activationsToken: emptyToken,
                  configurationsToken: emptyToken,
                  assetsToken: emptyToken,
                  managementToken: emptyToken,
                  declarationsToken: emptyToken,
                };

              const deviceToken = yield* deviceTokenFor(device.id);

              const { items } = yield* userDeclarationItems(
                device,
                deviceToken,
                { origin, authSecret: authSecret ?? "" },
                bound.directoryUserId,
              ).pipe(Effect.mapError(internal));

              const categoryToken = (category: keyof DdmDeclarationItems) =>
                hashToken(
                  items[category].map((item) => `${item.identifier}_MTTX_${item.serverToken}`),
                );

              return yield* Effect.tryPromise({
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
            }

            const deviceToken = yield* deviceTokenFor(device.id);

            const mode = yield* deliveryModeForDevice(device.id).pipe(Effect.mapError(internal));

            const items = yield* declarationItemsForDevice(
              device,
              deviceToken,
              { origin, authSecret: authSecret ?? "" },
              mode,
            ).pipe(Effect.mapError(internal));

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

            // Do not persist the token here: a device can fetch tokens and
            // then drop before fetching items. The items handler records it
            // only once the payload has actually been delivered, so the next
            // check-in retries a failed sync.
            return tokens;
          }),
        ),

      getAppleDeclarationItems: (
        scope: CheckinScope,
      ): Effect.Effect<DdmDeclarationItems, UnknownDevice | InternalServerError> =>
        provideDb(
          Effect.gen(function* () {
            const device = yield* requireDevice(scope);

            if (Predicate.isTagged(scope, "user")) {
              yield* requireDeviceUser(device, scope.userId);

              const bound = yield* boundAppleUser(device, scope.userId);

              if (!bound)
                return {
                  activations: [],
                  configurations: [],
                  assets: [],
                  management: [],
                };

              const deviceToken = yield* deviceTokenFor(device.id);

              const { items, token } = yield* userDeclarationItems(
                device,
                deviceToken,
                { origin, authSecret: authSecret ?? "" },
                bound.directoryUserId,
              ).pipe(Effect.mapError(internal));

              // The token moving means the device actually received a new set
              // of declarations; a repeat fetch of the same set is not a
              // delivery event.
              if (bound.ddmDeclarationsToken !== token)
                yield* writeSystemAudit(
                  db,
                  {
                    organizationId: device.organizationId,
                    action: SYSTEM_AUDIT_ACTIONS.mdmPolicyDelivered,
                    targetType: "device",
                    targetId: device.id,
                    deviceId: device.id,
                    protocol: "apple",
                    ip: scope.clientIp ?? null,
                    userAgent: scope.userAgent ?? null,
                    certificateFingerprint: scope.identityCertificateFingerprintSha256 ?? null,
                    certificateSerial: scope.identityCertificateSerial ?? null,
                    metadata: {
                      platform: "apple",
                      channel: "user",
                      mode: "declarations",
                      declarations:
                        items.activations.length +
                        items.configurations.length +
                        items.assets.length +
                        items.management.length,
                    },
                  },
                  auditOptions,
                );

              yield* db
                .update(s.deviceAppleUser)
                .set({ ddmDeclarationsToken: token })
                .where(
                  and(
                    eq(s.deviceAppleUser.deviceId, device.id),
                    eq(s.deviceAppleUser.userId, scope.userId),
                  ),
                )
                .pipe(Effect.mapError(internal));

              return items;
            }

            const deviceToken = yield* deviceTokenFor(device.id);

            const mode = yield* deliveryModeForDevice(device.id).pipe(Effect.mapError(internal));

            const items = yield* declarationItemsForDevice(
              device,
              deviceToken,
              { origin, authSecret: authSecret ?? "" },
              mode,
            ).pipe(Effect.mapError(internal));

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

            if (device.ddmDeclarationsToken !== token)
              yield* writeSystemAudit(
                db,
                {
                  organizationId: device.organizationId,
                  action: SYSTEM_AUDIT_ACTIONS.mdmPolicyDelivered,
                  targetType: "device",
                  targetId: device.id,
                  deviceId: device.id,
                  protocol: "apple",
                  ip: scope.clientIp ?? null,
                  userAgent: scope.userAgent ?? null,
                  certificateFingerprint: scope.identityCertificateFingerprintSha256 ?? null,
                  certificateSerial: scope.identityCertificateSerial ?? null,
                  metadata: {
                    platform: "apple",
                    channel: "device",
                    mode: "declarations",
                    declarations:
                      items.activations.length +
                      items.configurations.length +
                      items.assets.length +
                      items.management.length,
                  },
                },
                auditOptions,
              );

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

            // Serve only declarations that belong to this user channel's own
            // resolved set. A device declaration is never served here.
            if (Predicate.isTagged(scope, "user")) {
              yield* requireDeviceUser(device, scope.userId);

              const bound = yield* boundAppleUser(device, scope.userId);

              if (!bound) return null;

              const deviceToken = yield* deviceTokenFor(device.id);

              const { items, groups, rows } = yield* userDeclarationItems(
                device,
                deviceToken,
                { origin, authSecret: authSecret ?? "" },
                bound.directoryUserId,
              ).pipe(Effect.mapError(internal));

              if (type === "activation") {
                const item = items.activations.find((entry) => entry.identifier === identifier);

                if (!item) return null;

                const configurations = (groups.get(identifier) ?? [])
                  .filter((row) => !isApplicationKind(row.kind))
                  .map((row) => configurationDeclarationIdentifier(row.policyId, row.kind));

                return {
                  Type: "com.apple.activation.simple",
                  Identifier: identifier,
                  ServerToken: item.serverToken,
                  Payload: { StandardConfigurations: configurations },
                };
              }

              if (type === "configuration") {
                if (!items.configurations.some((entry) => entry.identifier === identifier))
                  return null;

                const { policyId, kind } = splitConfigurationDeclarationIdentifier(identifier);
                const row = rows.find((item) => item.policyId === policyId && item.kind === kind);

                if (!row) return null;

                return yield* Effect.tryPromise({
                  try: () =>
                    buildConfigurationDeclaration(row, {
                      origin,
                      authSecret: authSecret ?? "",
                      deviceToken,
                      deviceId: device.id,
                    }),
                  catch: internal,
                });
              }

              if (type === "asset") {
                if (!items.assets.some((entry) => entry.identifier === identifier)) return null;

                const { policyId, kind } = splitConfigurationDeclarationIdentifier(
                  identifier.replace(/\.asset$/, ""),
                );

                const row = rows.find((item) => item.policyId === policyId && item.kind === kind);

                if (!row) return null;

                return yield* Effect.tryPromise({
                  try: () =>
                    buildAssetDeclaration(row, {
                      origin,
                      authSecret: authSecret ?? "",
                      deviceToken,
                      deviceId: device.id,
                    }),
                  catch: internal,
                });
              }

              return null;
            }

            const deviceToken = yield* deviceTokenFor(device.id);

            const context: DeclarationContext = {
              origin,
              authSecret: authSecret ?? "",
              deviceToken,
              deviceId: device.id,
            };

            const mode = yield* deliveryModeForDevice(device.id).pipe(Effect.mapError(internal));

            if (type === "activation" && identifier === DEVICE_INFORMATION_ACTIVATION_ID) {
              return {
                Type: "com.apple.activation.simple",
                Identifier: DEVICE_INFORMATION_ACTIVATION_ID,
                ServerToken: DEVICE_INFORMATION_ACTIVATION_SERVER_TOKEN,
                Payload: { StandardConfigurations: [DEVICE_INFORMATION_CONFIGURATION_ID] },
              };
            }

            if (type === "activation" && identifier === OS_UPDATE_ENFORCEMENT_ACTIVATION_ID) {
              const enforcement = yield* osUpdateEnforcementForDevice(device, mode);

              if (!enforcement) return null;

              return {
                Type: "com.apple.activation.simple",
                Identifier: OS_UPDATE_ENFORCEMENT_ACTIVATION_ID,
                ServerToken: OS_UPDATE_ENFORCEMENT_ACTIVATION_SERVER_TOKEN,
                Payload: { StandardConfigurations: [OS_UPDATE_ENFORCEMENT_CONFIGURATION_ID] },
              };
            }

            if (type === "activation") {
              const { configurations: rows } = yield* scopedConfigurations(device, mode).pipe(
                Effect.mapError(internal),
              );

              const configurations = rows
                .filter((row) => row.groupId === identifier)
                .filter((row) => !isApplicationKind(row.kind))
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
              const statusItems = appleStatusItemsForDevice(device);

              return {
                Type: "com.apple.configuration.management.status-subscriptions",
                Identifier: DEVICE_INFORMATION_CONFIGURATION_ID,
                ServerToken: yield* Effect.promise(() =>
                  deviceInformationConfigurationToken(statusItems),
                ),
                Payload: { StatusItems: statusItems.map((Name) => ({ Name })) },
              };
            }

            if (type === "configuration" && identifier === OS_UPDATE_ENFORCEMENT_CONFIGURATION_ID) {
              const enforcement = yield* osUpdateEnforcementForDevice(device, mode);

              if (!enforcement) return null;

              return {
                Type: enforcement.declaration.Type,
                Identifier: OS_UPDATE_ENFORCEMENT_CONFIGURATION_ID,
                ServerToken: enforcement.serverToken,
                Payload: enforcement.declaration.Payload,
              };
            }

            if (type === "configuration") {
              const { policyId, kind } = splitConfigurationDeclarationIdentifier(identifier);

              const { configurations: rows } = yield* scopedConfigurations(device, mode).pipe(
                Effect.mapError(internal),
              );

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

              const { configurations: rows } = yield* scopedConfigurations(device, mode).pipe(
                Effect.mapError(internal),
              );

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
            const readObject = readApplicationObject;

            const readContent = (key: string): Effect.Effect<Uint8Array | null> =>
              readObject
                ? Effect.tryPromise({
                    try: () => readObject(key),
                    catch: (cause) =>
                      new Error(`Could not read application object ${key}: ${String(cause)}`),
                  }).pipe(Effect.catch(() => Effect.succeed(null)))
                : Effect.succeed(null);

            // Catalogue app installs use their own signed identifier because
            // the upload belongs to the application row, not to a policy.
            const catalogueApplicationId = parseCatalogueApplicationAssetIdentifier(identifier);

            if (catalogueApplicationId) {
              if (!token) return null;

              // The identifier is an installer id for catalogues created after
              // multi-installer support, and an application id for older links.
              const [installer] = yield* db
                .select()
                .from(s.applicationInstaller)
                .where(eq(s.applicationInstaller.id, catalogueApplicationId))
                .limit(1)
                .pipe(Effect.mapError(internal));

              const [application] = installer
                ? [installer]
                : yield* db
                    .select()
                    .from(s.application)
                    .where(eq(s.application.id, catalogueApplicationId))
                    .limit(1)
                    .pipe(Effect.mapError(internal));

              if (!application?.r2Key || !application.sha256) return null;

              const assetToken = yield* Effect.tryPromise({
                try: () =>
                  verifyAppleAssetToken(authSecret ?? "", token, {
                    policyId: catalogueApplicationId,
                    kind: CATALOGUE_APPLICATION_ASSET_KIND,
                  }),
                catch: internal,
              });

              if (!assetToken) return null;

              const [assetDevice] = yield* db
                .select({ organizationId: s.device.organizationId, status: s.device.status })
                .from(s.device)
                .where(eq(s.device.id, assetToken.deviceId))
                .limit(1)
                .pipe(Effect.mapError(internal));

              if (
                assetDevice?.organizationId !== application.organizationId ||
                assetDevice.status !== "enrolled"
              )
                return null;

              const content = yield* readContent(application.r2Key);

              if (!content) return null;

              return {
                content,
                contentType: application.contentType ?? "application/octet-stream",
              };
            }

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

            // A disabled policy keeps its stored configuration but must not
            // keep serving signed asset URLs; the token only proves the device
            // is in scope, not that the policy still delivers.
            if (!row || row.policy.enabled === false) return null;

            const configKind = row.configuration.kind;
            const certificate = isCertificateKind(configKind);
            const application = isApplicationKind(configKind);

            if (!certificate && !application) return null;

            const data = Schema.decodeUnknownOption(Schema.Json)(row.configuration.data);

            if (Option.isNone(data)) return null;

            const configRow: PolicyConfigurationRow = {
              policyId: row.configuration.policyId,
              kind: configKind,
              data: data.value,
              hash: row.configuration.hash,
              organizationId: row.policy.organizationId,
            };

            // Tenant-scoped: either the device presents an identity
            // certificate from the owning tenant, or the DDM/install URL carries
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

            if (certificate) return buildAssetContent(configRow);

            const configuration = parseAppleApplicationConfiguration(configRow.data);

            if (
              configuration?.type !== "inline" ||
              configuration.source !== "upload" ||
              !configuration.sha256 ||
              !configuration.fileName
            )
              return null;

            const content = yield* readContent(
              policyApplicationKey(
                row.policy.organizationId,
                row.configuration.policyId,
                configuration.sha256,
              ),
            );

            if (!content) return null;

            return {
              content,
              contentType: configuration.contentType ?? "application/octet-stream",
            };
          }),
        ),

      /**
       * The OTA manifest for an uploaded `.ipa`.
       *
       * `InstallApplication` cannot carry an inline manifest the way
       * `InstallEnterpriseApplication` can, so the catalogue hosts the plist.
       * The request is authenticated by the signed, device-bound token on the
       * URL (the device fetches it outside its MDM check-in), and the manifest
       * points back at the signed asset endpoint that serves the upload.
       */
      getAppleManifest: (_identityCertificate, identifier, token) =>
        provideDb(
          Effect.gen(function* () {
            const catalogueApplicationId = parseCatalogueApplicationAssetIdentifier(identifier);

            if (!catalogueApplicationId || !token) return null;

            const [installer] = yield* db
              .select()
              .from(s.applicationInstaller)
              .where(eq(s.applicationInstaller.id, catalogueApplicationId))
              .limit(1)
              .pipe(Effect.mapError(internal));

            const [application] = yield* db
              .select()
              .from(s.application)
              .where(eq(s.application.id, installer?.applicationId ?? catalogueApplicationId))
              .limit(1)
              .pipe(Effect.mapError(internal));

            const file = installer ?? application;

            if (!application || !file?.sha256) return null;

            // Only an .ipa is installed through an OTA manifest; serving one
            // for a .pkg would point InstallApplication at a package it cannot
            // install.
            if (
              !isAppleIpaUpload({
                fileName: file.fileName,
                contentType: file.contentType,
              })
            )
              return null;

            const bundleId = installer?.bundleId ?? application.bundleId;

            if (!bundleId) return null;

            const assetToken = yield* Effect.tryPromise({
              try: () =>
                verifyAppleAssetToken(authSecret ?? "", token, {
                  policyId: catalogueApplicationId,
                  kind: CATALOGUE_APPLICATION_ASSET_KIND,
                }),
              catch: internal,
            });

            if (!assetToken) return null;

            const [assetDevice] = yield* db
              .select({ organizationId: s.device.organizationId, status: s.device.status })
              .from(s.device)
              .where(eq(s.device.id, assetToken.deviceId))
              .limit(1)
              .pipe(Effect.mapError(internal));

            if (
              assetDevice?.organizationId !== application.organizationId ||
              assetDevice.status !== "enrolled"
            )
              return null;

            const assetUrl = `${serverOrigin}/mdm/apple/assets/${encodeURIComponent(identifier)}?token=${encodeURIComponent(token)}`;

            const content = yield* serializePlist(
              buildAppleManifest({
                url: assetUrl,
                sha256: file.sha256,
                bundleId,
                version: installer?.version ?? application.version ?? "0",
                title: application.name,
              }),
            ).pipe(Effect.mapError(internal));

            return {
              content: new TextEncoder().encode(content),
              contentType: "application/xml",
            };
          }),
        ),

      getAppleProfile: (policyId, kind, deviceId) =>
        provideDb(
          Effect.gen(function* () {
            const [row] = yield* db
              .select()
              .from(s.configuration)
              .innerJoin(s.policy, eq(s.policy.id, s.configuration.policyId))
              .where(and(eq(s.configuration.policyId, policyId), eq(s.configuration.kind, kind)))
              .limit(1)
              .pipe(Effect.mapError(internal));

            // A disabled policy keeps its configuration but must not keep
            // serving signed profile URLs.
            if (!row || row.policy.enabled === false) return null;

            const [device] = yield* db
              .select({ organizationId: s.device.organizationId, status: s.device.status })
              .from(s.device)
              .where(eq(s.device.id, deviceId))
              .limit(1)
              .pipe(Effect.mapError(internal));

            // The signed link is device-bound; a leaked URL for a device that
            // was removed, unenrolled or belongs to another tenant must fail.
            if (
              !device ||
              device.status !== "enrolled" ||
              device.organizationId !== row.policy.organizationId
            )
              return null;

            const parsed = parseConfigurationKind(row.configuration.kind);

            if (parsed.type !== "device" && parsed.type !== "custom") return null;

            const data = Schema.decodeUnknownOption(Schema.Json)(row.configuration.data);

            if (Option.isNone(data)) return null;

            const profile = yield* Effect.tryPromise({
              try: () =>
                buildLegacyProfile({
                  policyId: row.configuration.policyId,
                  kind: row.configuration.kind,
                  data: data.value,
                  hash: row.configuration.hash,
                }),
              catch: internal,
            });

            if (!profile) return null;

            // A profile that escrows FileVault keys must carry the tenant's
            // certificate, otherwise the returned CMS payload is ciphertext the
            // product cannot decrypt.
            const escrowCertificatePem = yield* tenantEscrowCertificate(
              row.policy.organizationId,
            ).pipe(Effect.mapError(internal));

            if (!escrowCertificatePem) return profile;

            const rewritten = yield* Effect.promise(() =>
              applyEscrowCertificate(profile.content, escrowCertificatePem),
            );

            if ("error" in rewritten) {
              yield* Effect.logWarning(
                `Refusing to serve policy profile ${policyId}/${kind}: ${rewritten.error}`,
              );

              return null;
            }

            return { content: rewritten.content, contentType: profile.contentType };
          }),
        ),

      ...createWindowsBackend(windowsBackendOptions),
    });
  };

  static readonly layer = (
    origin: string,
    options?: {
      readonly apns?: ApnsService.Service;
      readonly webhookFetch?: typeof globalThis.fetch;
      readonly deliveryQueue?: BackgroundDeliveryOptions;
      readonly authSecret?: string;
      readonly windowsOrganizationId?: string;
      readonly requireWindowsDeviceIdentity?: boolean;
      readonly requireAppleDeviceIdentity?: boolean;
      readonly planLimits?: PlanLimitsConfig;
      readonly windowsFederated?: Parameters<typeof createWindowsBackend>[0]["federated"];
      readonly readApplicationObject?: (key: string) => Promise<Uint8Array | null>;
      readonly releaseAppleVppLicence?: AppleVppLicenceRelease;
      readonly appleProfileSigning?: Parameters<typeof createAppleProfileSigner>[0];
      readonly enrollmentProfileTtlSeconds?: number;
      readonly auditCheckinCoalesceWindowMs?: number;
    },
  ) =>
    Layer.effect(
      ManagementBackend,
      Effect.gen(function* () {
        const db = yield* Db;
        const backgroundDelivery = yield* BackgroundDelivery;

        return ManagementBackendEnterpriseLive.make({
          db,
          origin,
          ...options,
          backgroundDelivery,
        });
      }),
    ).pipe(Layer.provideMerge(BackgroundDeliveryLive(options?.deliveryQueue)));
}

export const policyHash = jsonHash;

export * from "./adeProfile.js";

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
} from "@mattrax/mdm-core";

export {
  WEBHOOK_DELIVERY_RETENTION_DAYS,
  WEBHOOK_DELIVERY_TIMEOUT_MS,
  WEBHOOK_MAX_RETRY_ATTEMPTS,
  buildWebhookPayload,
  dispatchWebhookEvent,
  generateWebhookSecret,
  pruneWebhookDeliveries,
  replayWebhookDelivery,
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
  WebhookPayload,
  type WebhookReplayResult,
  type WebhookRetryOptions,
  type WebhookRetryResult,
} from "@mattrax/mdm-core";

export { createScepChallenge, verifyScepChallenge } from "@mattrax/scep";

export {
  ScepRepositoryLive,
  issueScepChallenge,
  scepChallengeId,
  type IssueScepChallengeOptions,
  type IssuedScepChallenge,
} from "@mattrax/mdm-core";

export * from "@mattrax/mdm-core";

export { resolveEffectivePolicyForDevice } from "@mattrax/mdm-core";

export {
  SCRIPT_PROFILE_IDENTIFIER_PREFIX,
  isScriptProfileIdentifier,
  planScriptProfileChanges,
} from "@mattrax/mdm-core";

export type { DesiredScriptProfile, ScriptProfileChanges } from "@mattrax/mdm-core";

export * from "@mattrax/mdm-windows";

export {
  OS_UPDATE_INSTALL_STATES,
  parseDeviceInventory,
  normalizeBatteryHealth,
  normalizeBoolean,
  normalizeCapabilities,
  statusItemValue,
  type DeviceInventory,
  type ManagementAppStatus,
} from "@mattrax/mdm-core";

export {
  parseActivationLockBypassCode,
  parseRecoveryLockVerification,
  parseRotatedRecoveryKey,
  parseSecurityInfo,
  type FileVaultStatus,
  type RecoveryKeyFormat,
  type SecurityInfoReport,
} from "@mattrax/mdm-core";

export {
  ADDITIONAL_STATUS_ITEMS,
  DEVICE_INFORMATION_BASE_STATUS_ITEMS,
  appleStatusItemsForDevice,
} from "@mattrax/mdm-core";

export {
  appleDeclarativeCapability,
  appleDeliveryModeChanged,
  decideAppleDelivery,
  type AppleCapabilitySupport,
  type AppleDeliveryDecision,
  type AppleDeliveryMode,
} from "@mattrax/mdm-core";

export {
  describeSkippedConfigurations,
  scopeConfigurationsToDevice,
  type OsScopedConfigurations,
  type PolicyDeliveryDevice,
  type SkippedConfiguration,
} from "@mattrax/mdm-core";

export {
  buildLegacyProfiles,
  installProfilePayload,
  installedProfiles,
  planLegacyProfileChanges,
  profileDigest,
  type LegacyProfile,
  type LegacyProfileBuild,
  type LegacyProfileChanges,
} from "@mattrax/mdm-core";

export {
  APPLE_LOCK_SCREEN_PROFILE_IDENTIFIER_PREFIX,
  appleLockScreenProfileIdentifier,
  buildAppleLockScreenProfile,
  readAppleLockScreenProfile,
  type AppleLockScreenProfileContent,
} from "@mattrax/mdm-core";

export {
  APPLE_APPLICATION_INVENTORY_PAYLOAD,
  APPLE_DEVICE_INFORMATION_PAYLOAD,
  parseInstalledApplications,
  type InstalledApplicationReport,
} from "@mattrax/mdm-core";

export {
  syncDynamicGroup,
  syncDynamicGroupDependents,
  syncDynamicGroupsForDevice,
  syncDynamicGroupsForTenant,
  previewDynamicGroup,
  type DynamicGroupPreview,
  type DynamicGroupPreviewReference,
  type DynamicGroupSyncOptions,
  type DynamicGroupSyncResult,
} from "@mattrax/mdm-core";

export {
  syncDirectoryGroup,
  syncDirectoryGroupsForTenant,
  type DirectoryGroupSyncOptions,
  type DirectoryGroupSyncResult,
} from "@mattrax/mdm-core";

export {
  assignedApplicationIdsForDevice,
  assignedDeviceIdsForApplication,
} from "@mattrax/mdm-core";

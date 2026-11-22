import { Effect } from "effect";
import { eq, inArray } from "drizzle-orm";
import { schema } from "@mattrax/enterprise-core";
import {
  CUTOVER_MAX_AUDIT_ROWS,
  decodeCutoverArchive,
  normalizeOrigin,
} from "@mattrax/enterprise-domain";
import type {
  CutoverConflict,
  CutoverImportResponse,
  CutoverNeedsReissue,
  CutoverPayload,
  CutoverPreview,
} from "@mattrax/enterprise-domain";
import { sealSecret } from "@mattrax/crypto";
import { describeScepCa, importScepCa, sealCaPrivateKey } from "@mattrax/scep";
import { applyTenantBundle, parseTenantRestoreBundle } from "./tenantRestore.ts";
import type { TenantRestoreTransaction } from "./tenantRestore.ts";
import { TenantCutoverError } from "./cutover.ts";
import type { EnterpriseDb, EnterpriseOrganization } from "../schema.ts";

export type CutoverActor = {
  readonly accountId: string;
  readonly email: string;
};

export type CutoverTarget =
  | { readonly kind: "new" }
  | { readonly kind: "existing"; readonly organization: EnterpriseOrganization };

export type CutoverImportOptions = {
  readonly archive: string;
  readonly passphrase: string;
  readonly confirm: string;
  readonly target: CutoverTarget;
  readonly actor: CutoverActor;
  readonly targetDeploymentId: string;
  readonly targetOrigin: string;
  readonly authSecret?: string;
  readonly allowCrossDeployment?: boolean;
  readonly replaceConfiguration?: boolean;
  readonly replaceScepCa?: boolean;
  readonly replaceEscrowKey?: boolean;
  readonly deviceConflicts?: "fail" | "skip";
  readonly now?: Date;
};

const fail = (reason: TenantCutoverError["reason"], message: string) =>
  new TenantCutoverError({ reason, message });

const newId = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

type BuiltInRole = "owner" | "admin" | "member" | "auditor";

const BUILT_IN_ROLES: ReadonlySet<string> = new Set(["owner", "admin", "member", "auditor"]);

const isBuiltInRole = (value: string): value is BuiltInRole => BUILT_IN_ROLES.has(value);

const builtInRole = (role: string | null | undefined): BuiltInRole | null => {
  for (const part of (role ?? "").split(",")) {
    const candidate = part.trim().toLowerCase();

    if (isBuiltInRole(candidate)) return candidate;
  }

  return null;
};

const slugBase = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 240);

type UniqueSlug = { readonly slug: string; readonly conflicted: boolean };

const uniqueSlug = (requested: string, taken: ReadonlySet<string>): UniqueSlug => {
  const base = slugBase(requested) || "tenant";

  if (!taken.has(base)) return { slug: base, conflicted: false };

  for (let attempt = 2; attempt <= 100; attempt++) {
    const candidate = `${base.slice(0, 234)}-${attempt}`;

    if (!taken.has(candidate)) return { slug: candidate, conflicted: true };
  }

  return { slug: `${base.slice(0, 228)}-${newId()}`, conflicted: true };
};

const decode = (archive: string, passphrase: string) =>
  Effect.tryPromise({
    try: () => decodeCutoverArchive({ archive, passphrase }),
    catch: (cause) =>
      fail(
        "invalid",
        cause instanceof Error ? cause.message : "The cutover archive could not be read",
      ),
  });

type ExistingState = {
  readonly organization: EnterpriseOrganization | null;
  readonly devices: ReadonlyArray<{
    id: string;
    serial: string | null;
    dmIdentifier: string | null;
    proto: "apple" | "win" | "android";
  }>;
  readonly members: ReadonlyArray<{ accountId: string; email: string }>;
  readonly scepCa: { certPem: string; fingerprintSha256: string | null } | null;
  readonly escrowKey: {
    certificateFingerprintSha256: string;
  } | null;
  readonly hasConfiguration: boolean;
  readonly hasAudit: boolean;
};

const loadExistingState = (
  db: EnterpriseDb | TenantRestoreTransaction,
  organizationId: string,
): Effect.Effect<ExistingState, unknown> =>
  Effect.gen(function* () {
    const deviceRows = yield* db
      .select({
        id: schema.device.id,
        serial: schema.device.serial,
        dmIdentifier: schema.device.dmIdentifier,
        proto: schema.device.proto,
      })
      .from(schema.device)
      .where(eq(schema.device.organizationId, organizationId));

    const memberRows = yield* db
      .select({ accountId: schema.member.accountId, email: schema.account.email })
      .from(schema.member)
      .innerJoin(schema.account, eq(schema.member.accountId, schema.account.id))
      .where(eq(schema.member.organizationId, organizationId));

    const [caRow] = yield* db
      .select({ certPem: schema.scepCa.certPem })
      .from(schema.scepCa)
      .where(eq(schema.scepCa.organizationId, organizationId))
      .limit(1);

    const ca = caRow
      ? yield* describeScepCa(caRow.certPem).pipe(
          Effect.map((description) => ({
            certPem: caRow.certPem,
            fingerprintSha256: description.fingerprintSha256,
          })),
          Effect.catch(() => Effect.succeed({ certPem: caRow.certPem, fingerprintSha256: null })),
        )
      : null;

    const [escrowRow] = yield* db
      .select({
        certificateFingerprintSha256: schema.appleFdeEscrowKey.certificateFingerprintSha256,
      })
      .from(schema.appleFdeEscrowKey)
      .where(eq(schema.appleFdeEscrowKey.organizationId, organizationId))
      .limit(1);

    const [group] = yield* db
      .select({ id: schema.enterpriseGroup.id })
      .from(schema.enterpriseGroup)
      .where(eq(schema.enterpriseGroup.organizationId, organizationId))
      .limit(1);

    const [policy] = yield* db
      .select({ id: schema.policy.id })
      .from(schema.policy)
      .where(eq(schema.policy.organizationId, organizationId))
      .limit(1);

    const [application] = yield* db
      .select({ id: schema.application.id })
      .from(schema.application)
      .where(eq(schema.application.organizationId, organizationId))
      .limit(1);

    const [audit] = yield* db
      .select({ id: schema.auditLog.id })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.organizationId, organizationId))
      .limit(1);

    return {
      devices: deviceRows,
      members: memberRows,
      scepCa: ca,
      escrowKey: escrowRow ?? null,
      hasConfiguration: Boolean(group || policy || application),
      hasAudit: Boolean(audit),
      organization: null,
    };
  });

/** All tenant slugs, so a new import can pick a free one like plain import. */
const tenantSlugs = (db: EnterpriseDb | TenantRestoreTransaction) =>
  Effect.gen(function* () {
    const rows = yield* db.select({ slug: schema.organization.slug }).from(schema.organization);

    return new Set(rows.map((row) => row.slug));
  });

type ResolvedMemberRole = {
  readonly role: BuiltInRole;
  readonly customRoleId: string | null;
};

type Analysis = {
  readonly conflicts: ReadonlyArray<CutoverConflict>;
  readonly needsReissue: ReadonlyArray<CutoverNeedsReissue>;
  readonly warnings: ReadonlyArray<string>;
  readonly requirements: CutoverPreview["requirements"];
  readonly existing: ExistingState;
  readonly resolvedSlug: string;
  readonly targetOrganization: EnterpriseOrganization | null;
  readonly crossDeployment: boolean;
};

/**
 * Compare an archive with the target without writing anything.
 *
 * Both preview and import use this, so the operator cannot acknowledge one set
 * of conflicts and have import check a different set. Import re-runs it inside
 * the write path and refuses to continue when an acknowledgement is missing.
 */
const analyze = (
  db: EnterpriseDb,
  payload: CutoverPayload,
  options: {
    readonly target: CutoverTarget;
    readonly targetDeploymentId: string;
    readonly targetOrigin: string;
    readonly allowCrossDeployment?: boolean;
    readonly replaceScepCa?: boolean;
    readonly replaceEscrowKey?: boolean;
    readonly deviceConflicts?: "fail" | "skip";
  },
): Effect.Effect<Analysis, unknown> =>
  Effect.gen(function* () {
    const conflicts: Array<CutoverConflict> = [];
    const needsReissue: Array<CutoverNeedsReissue> = [...(payload.needsReissue ?? [])];
    const warnings: Array<string> = [];

    const crossDeployment = payload.source.deploymentId !== options.targetDeploymentId;

    if (crossDeployment)
      warnings.push(
        "This archive was exported by a different deployment. Device identities and the SCEP CA are portable; APNs, ABM, VPP, Android Enterprise and SCIM credentials are not.",
      );

    if (normalizeOrigin(payload.source.origin) !== normalizeOrigin(options.targetOrigin))
      warnings.push(
        `The archive was exported from ${normalizeOrigin(
          payload.source.origin,
        )} and this deployment serves ${normalizeOrigin(
          options.targetOrigin,
        )}. Installed device profiles keep the old hostname until they are replaced.`,
      );

    let targetOrganization: EnterpriseOrganization | null = null;
    let existing: ExistingState;

    if (options.target.kind === "existing") {
      targetOrganization = options.target.organization;
      existing = yield* loadExistingState(db, targetOrganization.id);
    } else {
      existing = {
        devices: [],
        members: [],
        scepCa: null,
        escrowKey: null,
        hasConfiguration: false,
        hasAudit: false,
        organization: null,
      };
    }

    let resolvedSlug = payload.source.slug;

    if (options.target.kind === "new") {
      const slugs = yield* tenantSlugs(db);
      const unique = uniqueSlug(payload.source.slug, slugs);

      resolvedSlug = unique.slug;

      if (unique.conflicted)
        conflicts.push({
          kind: "slug",
          item: payload.source.slug,
          detail: `That tenant URL is taken on this deployment. The tenant will be imported as "${unique.slug}".`,
          resolution: "auto",
        });
    }

    if (existing.hasConfiguration) {
      conflicts.push({
        kind: "configuration",
        item: targetOrganization?.name ?? "Target tenant",
        detail:
          "The target tenant already has groups, policies or applications. Importing replaces them with the archive's configuration.",
        resolution: "requires_confirmation",
      });
    }

    const targetSerials = new Map(
      existing.devices.flatMap((device) =>
        device.serial ? [[device.serial.toLowerCase(), device] as const] : [],
      ),
    );

    const deviceConflictCount = (payload.devices ?? []).filter((device) => {
      if (!device.serial) return false;
      const match = targetSerials.get(device.serial.toLowerCase());

      return Boolean(match && match.id !== device.key);
    }).length;

    if (deviceConflictCount > 0) {
      conflicts.push({
        kind: "device_serial",
        item: `${deviceConflictCount} device serial(s)`,
        detail:
          "A device with the same serial already exists in the target tenant under a different identity. Import can skip those rows; choose that explicitly.",
        resolution: "requires_confirmation",
      });
    }

    if (payload.scepCa && existing.scepCa) {
      const same =
        existing.scepCa.fingerprintSha256 != null &&
        payload.scepCa.fingerprintSha256 != null &&
        existing.scepCa.fingerprintSha256 === payload.scepCa.fingerprintSha256;

      if (!same)
        conflicts.push({
          kind: "scep_ca",
          item: payload.scepCa.commonName ?? "Tenant SCEP CA",
          detail:
            "The target tenant already has a different SCEP CA. By default the source CA is added as a trust anchor so imported identities keep checking in, and renewals are signed by the target CA. Replace the target CA only if you want the source CA to sign new identities.",
          resolution: "auto",
        });
    }

    if (
      payload.escrowKey &&
      existing.escrowKey &&
      existing.escrowKey.certificateFingerprintSha256 !==
        payload.escrowKey.certificateFingerprintSha256
    )
      conflicts.push({
        kind: "escrow_key",
        item: payload.escrowKey.subject ?? payload.escrowKey.certificateFingerprintSha256,
        detail:
          "The target tenant already has a different FileVault escrow key. Recovery keys collected on the source can only be revealed if that key is imported; replacing the target key breaks the source's escrow policies until they are re-saved.",
        resolution: "auto",
      });

    const existingMemberEmails = new Set(
      existing.members.map((member) => member.email.toLowerCase()),
    );

    const memberConflicts = (payload.members ?? []).filter((member) =>
      existingMemberEmails.has(member.email.toLowerCase()),
    ).length;

    if (memberConflicts > 0)
      conflicts.push({
        kind: "member",
        item: `${memberConflicts} member(s)`,
        detail:
          "Those accounts are already members of the target tenant and keep their current role.",
        resolution: "auto",
      });

    for (const member of payload.members ?? []) {
      if (member.customRoleName)
        needsReissue.push({
          kind: "member_role",
          item: member.email,
          reason: `Custom role "${member.customRoleName}" is not part of the archive. Review the member's role after import.`,
        });
    }

    const escrowKey = payload.escrowKey ?? null;

    if (
      escrowKey &&
      existing.escrowKey &&
      existing.escrowKey.certificateFingerprintSha256 !== escrowKey.certificateFingerprintSha256 &&
      !options.replaceEscrowKey
    )
      needsReissue.push({
        kind: "escrow_key",
        item: escrowKey.subject ?? escrowKey.certificateFingerprintSha256,
        reason:
          "The source FileVault escrow key was not imported. Recovery keys collected before the cutover cannot be revealed on this deployment.",
      });

    if (payload.scepCa && !payload.scepCa.privateKeyPem)
      needsReissue.push({
        kind: "scep_ca_private_key",
        item: payload.scepCa.commonName ?? "Tenant SCEP CA",
        reason:
          "Only the CA certificate is in the archive, so new identities cannot be signed. Upload the CA key or rotate it before identities expire.",
      });

    const requirement = {
      allowCrossDeployment: crossDeployment,
      replaceConfiguration: existing.hasConfiguration,
      replaceScepCa: Boolean(options.replaceScepCa),
      replaceEscrowKey: Boolean(options.replaceEscrowKey),
      deviceConflicts: options.deviceConflicts ?? ("fail" as const),
    } satisfies CutoverPreview["requirements"];

    return {
      conflicts,
      needsReissue,
      warnings,
      requirements: requirement,
      existing,
      resolvedSlug,
      targetOrganization,
      crossDeployment,
    };
  });

const mapCutoverError = (cause: unknown) =>
  cause instanceof TenantCutoverError
    ? cause
    : fail(
        "internal",
        `The cutover archive could not be applied: ${String(
          cause instanceof Error ? cause.message : cause,
        ).slice(0, 500)}`,
      );

/** Decode and analyse an archive without writing anything. */
export const previewTenantCutover = (
  db: EnterpriseDb,
  options: {
    readonly archive: string;
    readonly passphrase: string;
    readonly target: CutoverTarget;
    readonly targetDeploymentId: string;
    readonly targetOrigin: string;
    readonly allowCrossDeployment?: boolean;
    readonly replaceScepCa?: boolean;
    readonly replaceEscrowKey?: boolean;
    readonly deviceConflicts?: "fail" | "skip";
  },
): Effect.Effect<CutoverPreview, TenantCutoverError | unknown> =>
  Effect.gen(function* () {
    const decoded = yield* decode(options.archive, options.passphrase);
    const { manifest, payload } = decoded;

    const analysis = yield* analyze(db, payload, options);

    return {
      manifest,
      confirm: payload.source.slug,
      crossDeployment: analysis.crossDeployment,
      source: payload.source,
      counts: manifest.counts,
      conflicts: analysis.conflicts,
      needsReissue: analysis.needsReissue,
      warnings: analysis.warnings,
      requirements: analysis.requirements,
      target: analysis.targetOrganization
        ? {
            tenantId: analysis.targetOrganization.id,
            slug: analysis.targetOrganization.slug,
            name: analysis.targetOrganization.name,
          }
        : null,
    };
  });

const roleForMember = (
  entry: { role: string; customRoleName?: string | null; email: string },
  options: {
    readonly mode: "new" | "existing";
    readonly customRoleId: string | null;
    readonly needsReissue: Array<CutoverNeedsReissue>;
  },
): ResolvedMemberRole => {
  const builtIn = builtInRole(entry.role) ?? "member";

  if (options.customRoleId) return { role: "member", customRoleId: options.customRoleId };

  if (options.mode === "existing" && builtIn === "owner") {
    options.needsReissue.push({
      kind: "member_role",
      item: entry.email,
      reason: "Owner membership is not granted while importing into an existing tenant.",
    });

    return { role: "admin", customRoleId: null };
  }

  if (!builtInRole(entry.role)) {
    options.needsReissue.push({
      kind: "member_role",
      item: entry.email,
      reason:
        "The source role is not a built-in role. The member was imported with the member role.",
    });

    return { role: "member", customRoleId: null };
  }

  return { role: builtIn, customRoleId: null };
};

/**
 * Import a cutover archive.
 *
 * The whole write is one transaction: organization (for a new target),
 * configuration, devices, credentials, members and audit history commit
 * together or not at all. Identities that cannot move are returned in
 * `needsReissue`; they are never silently discarded.
 */
export const importTenantCutover = (
  db: EnterpriseDb,
  options: CutoverImportOptions,
): Effect.Effect<CutoverImportResponse, TenantCutoverError | unknown> =>
  Effect.gen(function* () {
    const decoded = yield* decode(options.archive, options.passphrase);
    const { payload } = decoded;

    if (options.confirm.trim() !== payload.source.slug)
      return yield* Effect.fail(
        fail("invalid", `Type "${payload.source.slug}" to confirm this import.`),
      );

    const analysis = yield* analyze(db, payload, {
      target: options.target,
      targetDeploymentId: options.targetDeploymentId,
      targetOrigin: options.targetOrigin,
      allowCrossDeployment: options.allowCrossDeployment,
      replaceScepCa: options.replaceScepCa,
      replaceEscrowKey: options.replaceEscrowKey,
      deviceConflicts: options.deviceConflicts,
    });

    if (analysis.crossDeployment && !options.allowCrossDeployment)
      return yield* Effect.fail(
        fail(
          "conflict",
          "This archive was exported by a different deployment. Review the preview and confirm the cross-deployment move explicitly.",
        ),
      );

    if (analysis.requirements.replaceConfiguration && !options.replaceConfiguration)
      return yield* Effect.fail(
        fail(
          "conflict",
          "The target tenant already has configuration. Acknowledge that importing replaces its groups, policies and applications.",
        ),
      );

    const configuration = payload.configuration;

    if (!configuration)
      return yield* Effect.fail(fail("invalid", "The archive has no configuration section."));

    const now = options.now ?? new Date();
    const authSecret = options.authSecret;
    const mode = options.target.kind;
    const needsReissue: Array<CutoverNeedsReissue> = [...analysis.needsReissue];

    if (
      !authSecret &&
      (payload.escrowKey ||
        payload.scepCa?.privateKeyPem ||
        (payload.devices ?? []).some((device) => (device.secrets?.length ?? 0) > 0))
    )
      needsReissue.push({
        kind: "auth_secret",
        item: "AUTH_SECRET",
        reason:
          "This deployment has no AUTH_SECRET, so the escrow key, SCEP CA key and device secrets could not be re-sealed. They were skipped.",
      });

    const escrow = payload.escrowKey;

    const escrowFingerprint = escrow
      ? options.replaceEscrowKey || !analysis.existing.escrowKey
        ? escrow.certificateFingerprintSha256
        : analysis.existing.escrowKey.certificateFingerprintSha256
      : (analysis.existing.escrowKey?.certificateFingerprintSha256 ?? null);

    const parsed = yield* parseTenantRestoreBundle(JSON.stringify(configuration), {
      escrowCertificateFingerprintSha256: escrowFingerprint,
    }).pipe(Effect.mapError((error) => fail("invalid", error.message)));

    const written = yield* db
      .transaction((tx) =>
        Effect.gen(function* () {
          let organization: EnterpriseOrganization;
          let slug: string;

          if (options.target.kind === "existing") {
            organization = options.target.organization;
            slug = organization.slug;
          } else {
            slug = analysis.resolvedSlug;
            const id = newId();

            // Re-check inside the write: preview ran outside it, so another
            // import could have claimed the slug in between.
            const [claimed] = yield* tx
              .select({ id: schema.organization.id })
              .from(schema.organization)
              .where(eq(schema.organization.slug, slug))
              .limit(1);

            if (claimed)
              return yield* Effect.fail(
                fail(
                  "conflict",
                  `The tenant URL "${slug}" was claimed by another import. Try again.`,
                ),
              );

            yield* tx.insert(schema.organization).values({
              id,
              name: parsed.name,
              slug,
              logo: null,
              displayName: null,
              supportEmail: null,
              brandColor: null,
              metadata: null,
              createdAt: now,
              updatedAt: now,
            });

            yield* tx.insert(schema.member).values({
              id: newId(),
              organizationId: id,
              accountId: options.actor.accountId,
              role: "owner",
              createdAt: now,
              updatedAt: now,
            });

            const [created] = yield* tx
              .select()
              .from(schema.organization)
              .where(eq(schema.organization.id, id))
              .limit(1);

            if (!created)
              return yield* Effect.fail(
                fail("internal", "The new tenant row could not be read back after creation."),
              );

            organization = created;
          }

          const organizationId = organization.id;

          // ─── Devices first, so configuration re-links their memberships ───
          const existingDevices = yield* loadExistingState(tx, organizationId);

          const targetSerials = new Map(
            existingDevices.devices.flatMap((device) =>
              device.serial ? [[device.serial.toLowerCase(), device] as const] : [],
            ),
          );

          const targetIds = new Set(existingDevices.devices.map((device) => device.id));

          const deviceIdByKey = new Map<string, string>();
          let devicesImported = 0;
          let devicesSkipped = 0;
          let secretsImported = 0;
          let secretsSkipped = 0;

          for (const device of payload.devices ?? []) {
            const serial = device.serial?.trim() || null;
            const bySerial = serial ? targetSerials.get(serial.toLowerCase()) : undefined;

            if (bySerial && bySerial.id !== device.key) {
              if (options.deviceConflicts !== "skip") {
                return yield* Effect.fail(
                  fail(
                    "conflict",
                    `Device serial "${serial}" already exists in the target tenant. Re-run the import with device conflicts set to skip.`,
                  ),
                );
              }

              devicesSkipped++;
              needsReissue.push({
                kind: "device",
                item: serial ?? device.name,
                reason:
                  "A device with this serial already exists in the target and was left untouched.",
              });
              continue;
            }

            let deviceId = bySerial?.id ?? device.key;
            const idTaken = targetIds.has(deviceId);

            if (!bySerial && idTaken) deviceId = newId();

            // Ids are random, but a collision with another tenant would make
            // the primary key fail after expensive work. Check it cheaply.
            if (!bySerial && !idTaken) {
              const [elsewhere] = yield* tx
                .select({ id: schema.device.id })
                .from(schema.device)
                .where(eq(schema.device.id, deviceId))
                .limit(1);

              if (elsewhere) deviceId = newId();
            }

            deviceIdByKey.set(device.key, deviceId);

            // Android management cannot move: the device row preserves history
            // but is marked unenrolled so it cannot look managed here.
            const status = device.platform === "android" ? "unenrolled" : device.status;

            if (bySerial || targetIds.has(deviceId))
              yield* tx
                .update(schema.device)
                .set({
                  name: device.name,
                  serial,
                  proto: device.platform,
                  status,
                  model: device.model ?? null,
                  vendor: device.vendor ?? null,
                  osVersion: device.osVersion ?? null,
                  osBuild: device.osBuild ?? null,
                  osEdition: device.osEdition ?? null,
                  physicalName: device.physicalName ?? null,
                  physicalNameAt: device.physicalNameAt ? new Date(device.physicalNameAt) : null,
                  namePushEnabled: device.namePushEnabled ?? null,
                  appliedName: device.appliedName ?? null,
                  appliedNameAt: device.appliedNameAt ? new Date(device.appliedNameAt) : null,
                  lockScreenMessage: device.lockScreenMessage ?? null,
                  lockScreenIncludeAssetTag: device.lockScreenIncludeAssetTag ?? null,
                  appliedLockScreenMessage: device.appliedLockScreenMessage ?? null,
                  appliedLockScreenAssetTag: device.appliedLockScreenAssetTag ?? null,
                  appliedLockScreenName: device.appliedLockScreenName ?? null,
                  appliedLockScreenAt: device.appliedLockScreenAt
                    ? new Date(device.appliedLockScreenAt)
                    : null,
                  assetTag: device.assetTag ?? null,
                  notes: device.notes ?? null,
                  enrolledAt: new Date(device.enrolledAt),
                  lastSeenAt: new Date(device.lastSeenAt),
                  dmIdentifier: device.dmIdentifier ?? null,
                  dmCertHash: device.dmCertHash ?? null,
                  dmIdentityFingerprint: device.dmIdentityFingerprint ?? null,
                })
                .where(eq(schema.device.id, deviceId));
            else
              yield* tx.insert(schema.device).values({
                id: deviceId,
                organizationId,
                proto: device.platform,
                status,
                name: device.name,
                serial,
                model: device.model ?? null,
                vendor: device.vendor ?? null,
                osVersion: device.osVersion ?? null,
                osBuild: device.osBuild ?? null,
                osEdition: device.osEdition ?? null,
                physicalName: device.physicalName ?? null,
                physicalNameAt: device.physicalNameAt ? new Date(device.physicalNameAt) : null,
                namePushEnabled: device.namePushEnabled ?? null,
                appliedName: device.appliedName ?? null,
                appliedNameAt: device.appliedNameAt ? new Date(device.appliedNameAt) : null,
                lockScreenMessage: device.lockScreenMessage ?? null,
                lockScreenIncludeAssetTag: device.lockScreenIncludeAssetTag ?? null,
                appliedLockScreenMessage: device.appliedLockScreenMessage ?? null,
                appliedLockScreenAssetTag: device.appliedLockScreenAssetTag ?? null,
                appliedLockScreenName: device.appliedLockScreenName ?? null,
                appliedLockScreenAt: device.appliedLockScreenAt
                  ? new Date(device.appliedLockScreenAt)
                  : null,
                assetTag: device.assetTag ?? null,
                notes: device.notes ?? null,
                enrolledAt: new Date(device.enrolledAt),
                lastSeenAt: new Date(device.lastSeenAt),
                dmIdentifier: device.dmIdentifier ?? null,
                dmCertHash: device.dmCertHash ?? null,
                dmIdentityFingerprint: device.dmIdentityFingerprint ?? null,
              });

            if (device.apple)
              yield* tx
                .insert(schema.deviceApple)
                .values({
                  deviceId,
                  enrollmentId: device.apple.enrollmentId ?? null,
                  enrollmentMode: device.apple.enrollmentMode ?? null,
                  token: device.apple.token ?? null,
                  pushMagic: device.apple.pushMagic ?? null,
                  topic: device.apple.topic ?? null,
                  unlockToken: device.apple.unlockToken ?? null,
                  bootstrapToken: device.apple.bootstrapToken ?? null,
                  bootstrapTokenEscrowed: device.apple.bootstrapTokenEscrowed ?? null,
                  awaitingConfiguration: device.apple.awaitingConfiguration ?? false,
                  configured: device.apple.configured ?? true,
                  declarationMode: device.apple.declarationMode ?? null,
                  tokenUpdatedAt: now,
                })
                .onDuplicateKeyUpdate({
                  set: {
                    enrollmentId: device.apple.enrollmentId ?? null,
                    enrollmentMode: device.apple.enrollmentMode ?? null,
                    token: device.apple.token ?? null,
                    pushMagic: device.apple.pushMagic ?? null,
                    topic: device.apple.topic ?? null,
                    unlockToken: device.apple.unlockToken ?? null,
                    bootstrapToken: device.apple.bootstrapToken ?? null,
                    bootstrapTokenEscrowed: device.apple.bootstrapTokenEscrowed ?? null,
                    awaitingConfiguration: device.apple.awaitingConfiguration ?? false,
                    configured: device.apple.configured ?? true,
                    declarationMode: device.apple.declarationMode ?? null,
                    tokenUpdatedAt: now,
                  },
                });

            for (const secret of device.secrets ?? []) {
              if (!authSecret) {
                secretsSkipped++;
                continue;
              }

              const sealedValue = yield* Effect.tryPromise({
                try: () => sealSecret(authSecret, secret.value),
                catch: () => null,
              });

              if (sealedValue === null) {
                secretsSkipped++;
                continue;
              }

              yield* tx
                .insert(schema.deviceSecret)
                .values({
                  deviceId,
                  organizationId,
                  kind: secret.kind,
                  sealedValue,
                  format: secret.format,
                  createdAt: now,
                  updatedAt: now,
                  rotatedAt: null,
                })
                .onDuplicateKeyUpdate({
                  set: {
                    sealedValue,
                    format: secret.format,
                    updatedAt: now,
                  },
                });

              secretsImported++;
            }

            devicesImported++;
          }

          // ─── Configuration ───────────────────────────────────────
          const applied = yield* applyTenantBundle(tx, organization, parsed, options.actor, now);

          // Full device membership/assignment set, including devices that the
          // configuration bundle did not reference.
          let groupMemberships = 0;

          for (const device of payload.devices ?? []) {
            const deviceId = deviceIdByKey.get(device.key);

            if (!deviceId) continue;

            for (const groupKey of device.groupKeys ?? []) {
              const groupId = applied.ids.groups.get(groupKey);

              if (!groupId) continue;

              yield* tx
                .insert(schema.groupDevice)
                .ignore()
                .values({ groupId, deviceId, source: "manual" });

              groupMemberships++;
            }

            for (const policyKey of device.policyKeys ?? []) {
              const policyId = applied.ids.policies.get(policyKey);

              if (policyId)
                yield* tx
                  .insert(schema.devicePolicy)
                  .ignore()
                  .values({ deviceId, policyId, mode: "include" });
            }

            for (const policyKey of device.excludedPolicyKeys ?? []) {
              const policyId = applied.ids.policies.get(policyKey);

              if (policyId)
                yield* tx
                  .insert(schema.devicePolicy)
                  .ignore()
                  .values({ deviceId, policyId, mode: "exclude" });
            }

            for (const applicationKey of device.applicationKeys ?? []) {
              const applicationId = applied.ids.applications.get(applicationKey);

              if (applicationId)
                yield* tx
                  .insert(schema.applicationDevice)
                  .ignore()
                  .values({ deviceId, applicationId });
            }
          }

          // ─── SCEP CA, trust anchors and issued identities ───────
          const [existingCa] = yield* tx
            .select()
            .from(schema.scepCa)
            .where(eq(schema.scepCa.organizationId, organizationId))
            .limit(1);

          let scepImported = false;
          let certificatesImported = 0;
          const certificatesSkipped = 0;

          if (payload.scepCa) {
            const sourceDescription = yield* describeScepCa(payload.scepCa.certPem).pipe(
              Effect.catch(() => Effect.succeed(null)),
            );

            const ca = payload.scepCa;
            const caKeyPem = ca.privateKeyPem;

            const caMaterial = caKeyPem
              ? yield* importScepCa({
                  certificatePem: ca.certPem,
                  privateKeyPem: caKeyPem,
                }).pipe(Effect.catch(() => Effect.succeed(null)))
              : null;

            const sameAsExisting =
              existingCa != null &&
              sourceDescription != null &&
              existingCa.certPem === payload.scepCa.certPem;

            if (existingCa && !sameAsExisting && options.replaceScepCa && caMaterial) {
              // Keep the target's previous CA as a trust anchor so identities it
              // issued keep checking in after the root change.
              const previous = yield* describeScepCa(existingCa.certPem).pipe(
                Effect.catch(() => Effect.succeed(null)),
              );

              if (previous)
                yield* tx.insert(schema.scepCaTrust).ignore().values({
                  id: newId(),
                  organizationId,
                  certPem: existingCa.certPem,
                  fingerprintSha256: previous.fingerprintSha256,
                  source: existingCa.source,
                  retiredAt: now,
                  trustUntil: previous.notAfter,
                  createdAt: now,
                });
            }

            if (caMaterial && authSecret) {
              const sealed = yield* Effect.tryPromise({
                try: () => sealCaPrivateKey(authSecret, caMaterial.privateKeyJwk),
                catch: () => null,
              });

              if (sealed) {
                const current = !existingCa || sameAsExisting || Boolean(options.replaceScepCa);

                if (current) {
                  const updated = yield* tx
                    .update(schema.scepCa)
                    .set({
                      certPem: caMaterial.certPem,
                      privateKeyJwk: sealed,
                      source: caMaterial.source,
                      rotatedAt: existingCa ? now : null,
                    })
                    .where(eq(schema.scepCa.organizationId, organizationId));

                  if (updated.affectedRows === 0)
                    yield* tx.insert(schema.scepCa).values({
                      organizationId,
                      certPem: caMaterial.certPem,
                      privateKeyJwk: sealed,
                      source: caMaterial.source,
                      createdAt: now,
                      rotatedAt: null,
                    });

                  scepImported = true;
                }
              }
            }

            if (!scepImported && sourceDescription && existingCa && !sameAsExisting) {
              // Keep the target CA signing, but trust the source CA so every
              // imported identity still authenticates on check-in and renewal.
              yield* tx.insert(schema.scepCaTrust).ignore().values({
                id: newId(),
                organizationId,
                certPem: payload.scepCa.certPem,
                fingerprintSha256: sourceDescription.fingerprintSha256,
                source: payload.scepCa.source,
                retiredAt: now,
                trustUntil: sourceDescription.notAfter,
                createdAt: now,
              });

              needsReissue.push({
                kind: "scep_ca",
                item: payload.scepCa.commonName ?? "Tenant SCEP CA",
                reason:
                  "The target keeps its own SCEP CA. Imported identities remain trusted and keep checking in; renewals are signed by the target CA.",
              });
            }

            if (!scepImported && sourceDescription && !existingCa) {
              // No signing CA is available, but the certificate alone is
              // enough to validate every imported identity's mTLS connection.
              yield* tx.insert(schema.scepCaTrust).ignore().values({
                id: newId(),
                organizationId,
                certPem: payload.scepCa.certPem,
                fingerprintSha256: sourceDescription.fingerprintSha256,
                source: payload.scepCa.source,
                retiredAt: now,
                trustUntil: sourceDescription.notAfter,
                createdAt: now,
              });

              needsReissue.push({
                kind: "scep_ca",
                item: payload.scepCa.commonName ?? "Tenant SCEP CA",
                reason:
                  "The archive has no usable CA private key, so the certificate was added as a trust anchor only. Import the CA key or rotate it before identity renewal is needed.",
              });
            }
          }

          for (const anchor of payload.scepTrustAnchors ?? [])
            yield* tx
              .insert(schema.scepCaTrust)
              .ignore()
              .values({
                id: newId(),
                organizationId,
                certPem: anchor.certPem,
                fingerprintSha256: anchor.fingerprintSha256,
                source: anchor.source,
                retiredAt: new Date(anchor.retiredAt),
                trustUntil: new Date(anchor.trustUntil),
                createdAt: new Date(anchor.createdAt),
              });

          for (const certificate of payload.scepCertificates ?? []) {
            const deviceId = certificate.deviceKey
              ? (deviceIdByKey.get(certificate.deviceKey) ?? null)
              : null;

            yield* tx
              .insert(schema.scepIssuedCertificate)
              .ignore()
              .values({
                serial: certificate.serial,
                organizationId,
                enrollmentId: organizationId,
                deviceId,
                caFingerprintSha256: certificate.caFingerprintSha256 ?? null,
                notAfter: new Date(certificate.notAfter),
                revokedAt: certificate.revokedAt ? new Date(certificate.revokedAt) : null,
                createdAt: new Date(certificate.createdAt),
              });

            certificatesImported++;
          }

          // ─── FileVault escrow identity ───────────────────────────
          const [existingEscrow] = yield* tx
            .select({ fingerprint: schema.appleFdeEscrowKey.certificateFingerprintSha256 })
            .from(schema.appleFdeEscrowKey)
            .where(eq(schema.appleFdeEscrowKey.organizationId, organizationId))
            .limit(1);

          let escrowImported = false;

          if (
            escrow &&
            authSecret &&
            (!existingEscrow ||
              existingEscrow.fingerprint === escrow.certificateFingerprintSha256 ||
              options.replaceEscrowKey)
          ) {
            const sealedPrivateKey = yield* Effect.tryPromise({
              try: () => sealSecret(authSecret, escrow.privateKeyPem),
              catch: () => null,
            });

            if (sealedPrivateKey) {
              yield* tx
                .insert(schema.appleFdeEscrowKey)
                .values({
                  organizationId,
                  certificatePem: escrow.certificatePem,
                  sealedPrivateKey,
                  certificateFingerprintSha256: escrow.certificateFingerprintSha256,
                  subject: escrow.subject ?? null,
                  certificateNotAfter: escrow.certificateNotAfter
                    ? new Date(escrow.certificateNotAfter)
                    : null,
                  source: escrow.source,
                  createdAt: new Date(escrow.createdAt),
                  updatedAt: now,
                })
                .onDuplicateKeyUpdate({
                  set: {
                    certificatePem: escrow.certificatePem,
                    sealedPrivateKey,
                    certificateFingerprintSha256: escrow.certificateFingerprintSha256,
                    subject: escrow.subject ?? null,
                    certificateNotAfter: escrow.certificateNotAfter
                      ? new Date(escrow.certificateNotAfter)
                      : null,
                    source: escrow.source,
                    updatedAt: now,
                  },
                });

              escrowImported = true;
            }
          }

          // ─── Members and invitations ─────────────────────────────
          const memberEmails = [
            ...new Set([
              ...(payload.members ?? []).map((member) => member.email.toLowerCase()),
              ...(payload.invitations ?? []).map((invitation) => invitation.email.toLowerCase()),
            ]),
          ].filter(Boolean);

          const accountRows = memberEmails.length
            ? yield* tx
                .select({ id: schema.account.id, email: schema.account.email })
                .from(schema.account)
                .where(inArray(schema.account.email, memberEmails))
            : [];

          const accountByEmail = new Map(
            accountRows.map((account) => [account.email.toLowerCase(), account.id]),
          );

          const existingMembers = yield* tx
            .select({ accountId: schema.member.accountId })
            .from(schema.member)
            .where(eq(schema.member.organizationId, organizationId));

          const memberAccountIds = new Set(existingMembers.map((member) => member.accountId));

          const roleRows = yield* tx
            .select({ id: schema.tenantRole.id, name: schema.tenantRole.name })
            .from(schema.tenantRole)
            .where(eq(schema.tenantRole.organizationId, organizationId));

          const roleIdByName = new Map(roleRows.map((role) => [role.name, role.id]));

          let membersImported = 0;
          let membersSkipped = 0;
          let invitationsImported = 0;
          let invitationsSkipped = 0;
          const invitedEmails = new Set<string>();

          for (const member of payload.members ?? []) {
            const email = member.email.toLowerCase();
            const accountId = accountByEmail.get(email);

            if (accountId && memberAccountIds.has(accountId)) {
              membersSkipped++;
              continue;
            }

            const resolved = roleForMember(member, {
              mode,
              customRoleId: member.customRoleName
                ? (roleIdByName.get(member.customRoleName) ?? null)
                : null,
              needsReissue,
            });

            if (accountId) {
              yield* tx.insert(schema.member).values({
                id: newId(),
                organizationId,
                accountId,
                role: resolved.role,
                customRoleId: resolved.customRoleId,
                createdAt: now,
                updatedAt: now,
              });
              memberAccountIds.add(accountId);
              membersImported++;
              continue;
            }

            // The person has no account on this deployment. Create a pending
            // invitation without a token: the owner resends it from the UI, so
            // no bearer secret is ever carried in the archive.
            if (invitedEmails.has(email)) {
              invitationsSkipped++;
              continue;
            }

            invitedEmails.add(email);
            yield* tx.insert(schema.invitation).values({
              id: newId(),
              organizationId,
              inviterId: options.actor.accountId,
              email: member.email,
              role: resolved.role,
              customRoleId: resolved.customRoleId,
              status: "pending",
              tokenHash: null,
              expiresAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
              lastSentAt: null,
              sendCount: 0,
              acceptedAt: null,
              createdAt: now,
              updatedAt: now,
            });
            invitationsImported++;
            needsReissue.push({
              kind: "invitation",
              item: member.email,
              reason:
                "There is no account for this address on the target. A pending invitation was created; resend it from Members.",
            });
          }

          for (const invitation of payload.invitations ?? []) {
            const email = invitation.email.toLowerCase();

            if (accountByEmail.has(email) || invitedEmails.has(email)) {
              invitationsSkipped++;
              continue;
            }

            invitedEmails.add(email);

            const resolved = roleForMember(
              {
                email: invitation.email,
                role: invitation.role ?? "member",
                customRoleName: invitation.customRoleName,
              },
              {
                mode,
                customRoleId: invitation.customRoleName
                  ? (roleIdByName.get(invitation.customRoleName) ?? null)
                  : null,
                needsReissue,
              },
            );

            yield* tx.insert(schema.invitation).values({
              id: newId(),
              organizationId,
              inviterId: options.actor.accountId,
              email: invitation.email,
              role: resolved.role,
              customRoleId: resolved.customRoleId,
              status: "pending",
              tokenHash: null,
              expiresAt: new Date(invitation.expiresAt),
              lastSentAt: null,
              sendCount: 0,
              acceptedAt: null,
              createdAt: new Date(invitation.createdAt),
              updatedAt: now,
            });
            invitationsImported++;
          }

          // ─── Audit history ───────────────────────────────────────
          let auditImported = 0;
          let auditSkipped = 0;

          for (const entry of payload.audit ?? []) {
            if (auditImported >= CUTOVER_MAX_AUDIT_ROWS) {
              auditSkipped++;
              continue;
            }

            yield* tx.insert(schema.auditLog).values({
              id: newId(),
              organizationId,
              actorAccountId: null,
              actorEmail: entry.actorEmail ?? null,
              actorType: "account",
              category: entry.action.startsWith("account.") ? "account" : "mdm",
              action: entry.action,
              targetType: entry.targetType,
              targetId: entry.targetId ?? null,
              metadata: entry.metadata === undefined ? null : entry.metadata,
              ip: null,
              userAgent: null,
              createdAt: new Date(entry.createdAt),
            });
            auditImported++;
          }

          yield* tx.insert(schema.auditLog).values({
            id: newId(),
            organizationId,
            actorAccountId: options.actor.accountId,
            actorEmail: options.actor.email,
            actorType: "account",
            category: "system",
            action: "tenant.cutover_imported",
            targetType: "tenant",
            targetId: organizationId,
            metadata: {
              sourceTenantId: payload.source.tenantId,
              sourceSlug: payload.source.slug,
              sourceOrigin: payload.source.origin,
              sourceDeploymentId: payload.source.deploymentId,
              withheldDeploymentId: analysis.crossDeployment,
              mode,
              counts: {
                members: membersImported,
                invitations: invitationsImported,
                devices: devicesImported,
                deviceSecrets: secretsImported,
                certificates: certificatesImported,
                auditEntries: auditImported,
              },
            },
            ip: null,
            userAgent: null,
            createdAt: now,
          });

          return {
            organizationId,
            slug,
            counts: {
              groups: applied.counts.groups,
              policies: applied.counts.policies,
              applications: applied.counts.applications,
              preRegistrations: applied.counts.preRegistrations,
              members: membersImported,
              invitations: invitationsImported,
              devices: devicesImported,
              deviceSecrets: secretsImported,
              groupMemberships,
              certificates: certificatesImported,
              auditEntries: auditImported,
              scepCa: scepImported,
              escrowKey: escrowImported,
            },
            skipped: {
              members: membersSkipped,
              invitations: invitationsSkipped,
              devices: devicesSkipped,
              deviceSecrets: secretsSkipped,
              certificates: certificatesSkipped,
              auditEntries: auditSkipped + (payload.auditTruncated ? CUTOVER_MAX_AUDIT_ROWS : 0),
            },
          };
        }),
      )
      .pipe(Effect.mapError(mapCutoverError));

    // The same item can be reported by analysis and again during the write.
    // One entry per kind/item/reason keeps the operator-facing list readable.
    const uniqueNeedsReissue = [
      ...new Map(
        needsReissue.map((item) => [`${item.kind}\u0000${item.item}\u0000${item.reason}`, item]),
      ).values(),
    ];

    return {
      tenantId: written.organizationId,
      slug: written.slug,
      mode,
      source: payload.source,
      imported: written.counts,
      skipped: written.skipped,
      conflicts: analysis.conflicts,
      needsReissue: uniqueNeedsReissue,
      warnings: analysis.warnings,
    };
  });

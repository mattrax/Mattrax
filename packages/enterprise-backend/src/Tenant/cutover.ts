import { Data, Effect, Schema } from "effect";
import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { schema } from "@mattrax/enterprise-core";
import type {
  CutoverPreflightReport,
  CutoverPayload,
  CutoverSectionSelection,
  CutoverSource,
} from "@mattrax/enterprise-domain";
import {
  CUTOVER_MAX_AUDIT_ROWS,
  CUTOVER_MAX_DEVICES,
  CUTOVER_MAX_MEMBERS,
  encodeCutoverArchive,
  normalizeOrigin,
  originHostname,
  selectedCutoverSections,
} from "@mattrax/enterprise-domain";
import type {
  CutoverCounts,
  CutoverDevice,
  CutoverDeviceSecret,
  CutoverEscrowKey,
  CutoverInvitation,
  CutoverMember,
  CutoverNeedsReissue,
  CutoverScepCa,
  CutoverScepCertificate,
  CutoverScepTrustAnchor,
} from "@mattrax/enterprise-domain";
import { importPrivateKeyJwk, openSecret, pemEncode } from "@mattrax/crypto";
import { describeScepCa, openCaPrivateKey } from "@mattrax/scep";
import { buildTenantExport } from "./tenantExport.ts";
import type { EnterpriseDb, EnterpriseOrganization } from "../schema.ts";

export class TenantCutoverError extends Data.TaggedError("TenantCutoverError")<{
  readonly reason: "invalid" | "conflict" | "internal";
  readonly message: string;
}> {}

const fail = (reason: TenantCutoverError["reason"], message: string) =>
  new TenantCutoverError({ reason, message });

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

const safeFilename = (value: string) =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 64) || "tenant";

const MAX_NEEDS_REISSUE = 500;

/** Keep an operator-facing list bounded even for a large fleet. */
const bound = (items: ReadonlyArray<CutoverNeedsReissue>): CutoverNeedsReissue[] =>
  items.slice(0, MAX_NEEDS_REISSUE);

const issue = (kind: string, item: string, reason: string): CutoverNeedsReissue => ({
  kind,
  item,
  reason,
});

/**
 * Convert a stored RSA JWK into the unencrypted PKCS#8 PEM that
 * `importScepCa` accepts. The private key only exists in memory and inside the
 * encrypted archive.
 */
const privateKeyPem = async (jwk: JsonWebKey): Promise<string> => {
  const key = await importPrivateKeyJwk(jwk);

  return pemEncode("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", key));
};

export type TenantCutoverExport = {
  readonly body: string;
  readonly filename: string;
  readonly version: number;
  readonly counts: CutoverCounts;
  readonly sections: ReadonlyArray<string>;
  readonly needsReissue: ReadonlyArray<CutoverNeedsReissue>;
};

/**
 * Build an encrypted cutover archive for one tenant.
 *
 * Configuration comes from the existing plaintext export builder so the two
 * formats cannot drift. The extra sections are the ones a plain export
 * deliberately excludes: member invitations, device identity/push credentials,
 * the SCEP CA, the FileVault escrow key and audit history.
 *
 * Every credential is either moved (re-sealed by the importer) or reported in
 * `needsReissue`. Nothing is dropped silently, and nothing leaves the process
 * except inside the encrypted payload.
 */
export const buildTenantCutover = (
  db: EnterpriseDb,
  organization: EnterpriseOrganization,
  options: {
    readonly passphrase: string;
    readonly sections?: CutoverSectionSelection;
    readonly origin: string;
    readonly deploymentId: string;
    readonly authSecret?: string;
    readonly now?: Date;
    /** Test-only override for the PBKDF2 work factor. */
    readonly iterations?: number;
  },
): Effect.Effect<TenantCutoverExport, TenantCutoverError | unknown> =>
  Effect.gen(function* () {
    const now = options.now ?? new Date();
    const organizationId = organization.id;
    const sections = selectedCutoverSections(options.sections);
    const included = new Set(sections);
    const needsReissue: Array<CutoverNeedsReissue> = [];

    const configuration = yield* buildTenantExport(db, organization, {
      includeAudit: false,
      now,
    });

    // A plain export always embeds member emails. The cutover toggle must be
    // truthful: with Members off, those rows are not in the archive either.
    const bundle = {
      ...configuration.bundle,
      members: included.has("members") ? configuration.bundle.members : [],
    };

    const groupIds = bundle.groups.map((group) => group.key);
    const policyIds = bundle.policies.map((policy) => policy.key);
    const applicationIds = bundle.applications.map((application) => application.key);

    // ─── Members and invitations ────────────────────────────────
    let members: CutoverMember[] | undefined;
    let invitations: CutoverInvitation[] | undefined;

    if (included.has("members")) {
      const memberRows = yield* db
        .select()
        .from(schema.member)
        .where(eq(schema.member.organizationId, organizationId))
        .limit(CUTOVER_MAX_MEMBERS + 1);

      if (memberRows.length > CUTOVER_MAX_MEMBERS)
        return yield* Effect.fail(
          fail(
            "invalid",
            `The tenant has more than ${CUTOVER_MAX_MEMBERS} members. Move members separately.`,
          ),
        );

      const accountIds = [...new Set(memberRows.map((member) => member.accountId))];

      const accounts = accountIds.length
        ? yield* db
            .select({
              id: schema.account.id,
              name: schema.account.name,
              email: schema.account.email,
            })
            .from(schema.account)
            .where(inArray(schema.account.id, accountIds))
        : [];

      const accountById = new Map(accounts.map((account) => [account.id, account]));

      const customRoleIds = [
        ...new Set(
          memberRows.flatMap((member) => (member.customRoleId ? [member.customRoleId] : [])),
        ),
      ];

      const customRoles = customRoleIds.length
        ? yield* db
            .select({ id: schema.tenantRole.id, name: schema.tenantRole.name })
            .from(schema.tenantRole)
            .where(inArray(schema.tenantRole.id, customRoleIds))
        : [];

      const customRoleName = new Map(customRoles.map((role) => [role.id, role.name]));

      members = memberRows.flatMap((member) => {
        const account = accountById.get(member.accountId);

        if (!account) {
          needsReissue.push(issue("member", member.accountId, "The account row no longer exists."));

          return [];
        }

        return [
          {
            email: account.email,
            name: account.name,
            role: member.role,
            customRoleName: member.customRoleId
              ? (customRoleName.get(member.customRoleId) ?? null)
              : null,
            createdAt: member.createdAt.toISOString(),
          },
        ];
      });

      const invitationRows = yield* db
        .select()
        .from(schema.invitation)
        .where(
          and(
            eq(schema.invitation.organizationId, organizationId),
            eq(schema.invitation.status, "pending"),
          ),
        )
        .orderBy(asc(schema.invitation.createdAt))
        .limit(CUTOVER_MAX_MEMBERS);

      const invitationRoleIds = [
        ...new Set(
          invitationRows.flatMap((invitation) =>
            invitation.customRoleId ? [invitation.customRoleId] : [],
          ),
        ),
      ];

      const invitationRoles = invitationRoleIds.length
        ? yield* db
            .select({ id: schema.tenantRole.id, name: schema.tenantRole.name })
            .from(schema.tenantRole)
            .where(inArray(schema.tenantRole.id, invitationRoleIds))
        : [];

      const invitationRoleName = new Map(invitationRoles.map((role) => [role.id, role.name]));

      invitations = invitationRows.map((invitation) => ({
        email: invitation.email,
        role: invitation.role,
        customRoleName: invitation.customRoleId
          ? (invitationRoleName.get(invitation.customRoleId) ?? null)
          : null,
        expiresAt: invitation.expiresAt.toISOString(),
        createdAt: invitation.createdAt.toISOString(),
      }));

      if (invitations.length > 0)
        needsReissue.push(
          issue(
            "invitation",
            `${invitations.length} pending invitation(s)`,
            "Invitation links embed the old origin and their bearer token is not exported. Resend them from this deployment.",
          ),
        );
    }

    // ─── Devices and their credentials ──────────────────────────
    let devices: CutoverDevice[] | undefined;

    if (included.has("devices")) {
      const deviceRows = yield* db
        .select()
        .from(schema.device)
        .where(eq(schema.device.organizationId, organizationId))
        .orderBy(asc(schema.device.name))
        .limit(CUTOVER_MAX_DEVICES + 1);

      if (deviceRows.length > CUTOVER_MAX_DEVICES)
        return yield* Effect.fail(
          fail(
            "invalid",
            `The tenant has more than ${CUTOVER_MAX_DEVICES} devices. Use a database backup to move a fleet this size.`,
          ),
        );

      const deviceIds = deviceRows.map((device) => device.id);

      const appleRows = deviceIds.length
        ? yield* db
            .select()
            .from(schema.deviceApple)
            .where(inArray(schema.deviceApple.deviceId, deviceIds))
        : [];

      const appleByDevice = new Map(appleRows.map((row) => [row.deviceId, row]));

      const membershipRows =
        groupIds.length && deviceIds.length
          ? yield* db
              .select()
              .from(schema.groupDevice)
              .where(inArray(schema.groupDevice.groupId, groupIds))
          : [];

      const groupKeysByDevice = new Map<string, string[]>();

      for (const membership of membershipRows) {
        // Directory rows are re-derived from live directory membership, and
        // nested rows from the child edges; importing either would double-count.
        if (membership.source === "directory" || membership.source === "nested") continue;

        if (!deviceIds.includes(membership.deviceId)) continue;
        groupKeysByDevice.set(membership.deviceId, [
          ...(groupKeysByDevice.get(membership.deviceId) ?? []),
          membership.groupId,
        ]);
      }

      const devicePolicyRows = policyIds.length
        ? yield* db
            .select()
            .from(schema.devicePolicy)
            .where(inArray(schema.devicePolicy.policyId, policyIds))
        : [];

      const policyIdsByDevice = new Map<string, { include: string[]; exclude: string[] }>();

      for (const link of devicePolicyRows) {
        const target = policyIdsByDevice.get(link.deviceId) ?? { include: [], exclude: [] };

        (link.mode === "exclude" ? target.exclude : target.include).push(link.policyId);
        policyIdsByDevice.set(link.deviceId, target);
      }

      const applicationDeviceRows = applicationIds.length
        ? yield* db
            .select()
            .from(schema.applicationDevice)
            .where(inArray(schema.applicationDevice.applicationId, applicationIds))
        : [];

      const applicationIdsByDevice = new Map<string, string[]>();

      for (const link of applicationDeviceRows)
        applicationIdsByDevice.set(link.deviceId, [
          ...(applicationIdsByDevice.get(link.deviceId) ?? []),
          link.applicationId,
        ]);

      const secretRows = deviceIds.length
        ? yield* db
            .select()
            .from(schema.deviceSecret)
            .where(inArray(schema.deviceSecret.deviceId, deviceIds))
        : [];

      const secretsByDevice = new Map<string, CutoverDeviceSecret[]>();
      const secretFailures = new Map<string, number>();

      const authSecret = options.authSecret;

      for (const row of secretRows) {
        let value: string | null = null;

        if (authSecret)
          value = yield* Effect.tryPromise({
            try: () => openSecret(authSecret, row.sealedValue),
            catch: () => null,
          });

        if (value === null) {
          secretFailures.set(row.deviceId, (secretFailures.get(row.deviceId) ?? 0) + 1);

          continue;
        }

        secretsByDevice.set(row.deviceId, [
          ...(secretsByDevice.get(row.deviceId) ?? []),
          {
            // SAFETY: the database enum constrains this column to the same
            // literal union the archive schema uses.
            kind: row.kind,
            value,
            format: row.format,
          },
        ]);
      }

      devices = deviceRows.map((device) => {
        const apple = appleByDevice.get(device.id);

        const assignments = policyIdsByDevice.get(device.id);
        let needsReissue: string | null = null;

        if (device.proto === "android")
          needsReissue =
            "Android management is bound to the source Google enterprise; re-enrol the device in this deployment.";

        if (
          device.proto === "apple" &&
          device.status === "enrolled" &&
          (!apple?.token || !apple.pushMagic)
        )
          needsReissue =
            needsReissue ?? "No Apple push token was stored; the device must report one.";

        if ((secretFailures.get(device.id) ?? 0) > 0)
          needsReissue =
            needsReissue ??
            "One or more escrowed device secrets could not be unsealed with this deployment's AUTH_SECRET.";

        return {
          key: device.id,
          name: device.name,
          serial: device.serial,
          platform: device.proto,
          status: device.status,
          model: device.model,
          vendor: device.vendor,
          osVersion: device.osVersion,
          osBuild: device.osBuild,
          osEdition: device.osEdition,
          physicalName: device.physicalName,
          physicalNameAt: device.physicalNameAt?.toISOString() ?? null,
          namePushEnabled: device.namePushEnabled,
          appliedName: device.appliedName,
          appliedNameAt: device.appliedNameAt?.toISOString() ?? null,
          assetTag: device.assetTag,
          notes: device.notes,
          enrolledAt: device.enrolledAt.toISOString(),
          lastSeenAt: device.lastSeenAt.toISOString(),
          dmIdentifier: device.dmIdentifier,
          dmCertHash: device.dmCertHash,
          dmIdentityFingerprint: device.dmIdentityFingerprint,
          apple: apple
            ? {
                enrollmentId: apple.enrollmentId,
                enrollmentMode: apple.enrollmentMode,
                token: apple.token,
                pushMagic: apple.pushMagic,
                topic: apple.topic,
                unlockToken: apple.unlockToken,
                bootstrapToken: apple.bootstrapToken,
                bootstrapTokenEscrowed: apple.bootstrapTokenEscrowed,
                awaitingConfiguration: apple.awaitingConfiguration,
                configured: apple.configured,
                declarationMode: apple.declarationMode,
              }
            : null,
          groupKeys: [...new Set(groupKeysByDevice.get(device.id) ?? [])].sort(),
          policyKeys: [...new Set(assignments?.include ?? [])].sort(),
          excludedPolicyKeys: [...new Set(assignments?.exclude ?? [])].sort(),
          applicationKeys: [...new Set(applicationIdsByDevice.get(device.id) ?? [])].sort(),
          secrets: secretsByDevice.get(device.id) ?? [],
          needsReissue,
        };
      });

      const secretFailureCount = [...secretFailures.values()].reduce(
        (total, count) => total + count,
        0,
      );

      if (secretFailureCount > 0)
        needsReissue.push(
          issue(
            "device_secret",
            `${secretFailureCount} escrowed secret(s)`,
            "They were sealed with a different AUTH_SECRET (or none is configured) and stay on the source deployment.",
          ),
        );

      const android = devices.filter((device) => device.platform === "android").length;

      if (android > 0)
        needsReissue.push(
          issue(
            "android_device",
            `${android} Android device(s)`,
            "Device rows are imported for history, but the Google enterprise mapping is not portable; re-enrol to manage them.",
          ),
        );
    }

    // ─── FileVault escrow identity ──────────────────────────────
    let escrowKey: CutoverEscrowKey | null | undefined;

    if (included.has("devices")) {
      const [row] = yield* db
        .select()
        .from(schema.appleFdeEscrowKey)
        .where(eq(schema.appleFdeEscrowKey.organizationId, organizationId))
        .limit(1);

      if (row) {
        const authSecret = options.authSecret;

        const opened = authSecret
          ? yield* Effect.tryPromise({
              try: () => openSecret(authSecret, row.sealedPrivateKey),
              catch: () => null,
            })
          : null;

        if (opened === null) {
          needsReissue.push(
            issue(
              "escrow_key",
              row.subject ?? row.certificateFingerprintSha256,
              "The FileVault escrow private key could not be unsealed. Previously collected recovery keys cannot be revealed here.",
            ),
          );
          escrowKey = null;
        } else {
          escrowKey = {
            certificatePem: row.certificatePem,
            privateKeyPem: opened,
            certificateFingerprintSha256: row.certificateFingerprintSha256,
            subject: row.subject,
            certificateNotAfter: iso(row.certificateNotAfter),
            source: row.source,
            createdAt: row.createdAt.toISOString(),
          };
        }
      } else {
        escrowKey = null;
      }
    }

    // ─── SCEP CA and issued identities ──────────────────────────
    let scepCa: CutoverScepCa | null | undefined;
    let scepTrustAnchors: CutoverScepTrustAnchor[] | undefined;
    let scepCertificates: CutoverScepCertificate[] | undefined;

    if (included.has("scepCa")) {
      const [row] = yield* db
        .select()
        .from(schema.scepCa)
        .where(eq(schema.scepCa.organizationId, organizationId))
        .limit(1);

      if (row) {
        const description = yield* describeScepCa(row.certPem).pipe(
          Effect.catch(() => Effect.succeed(null)),
        );

        const authSecret = options.authSecret;

        const opened = authSecret
          ? yield* Effect.tryPromise({
              try: () =>
                openCaPrivateKey(
                  Schema.decodeUnknownSync(Schema.Json)(row.privateKeyJwk),
                  authSecret,
                ),
              catch: () => null,
            })
          : null;

        const key = opened
          ? yield* Effect.tryPromise({
              try: () => privateKeyPem(opened.privateKeyJwk),
              catch: () => null,
            }).pipe(Effect.catch(() => Effect.succeed(null)))
          : null;

        if (key === null)
          needsReissue.push(
            issue(
              "scep_ca_private_key",
              description?.commonName ?? "Tenant SCEP CA",
              "Only the CA certificate is exported. Identity renewal will fail until the CA is re-issued and devices re-enrol.",
            ),
          );

        scepCa = {
          certPem: row.certPem,
          privateKeyPem: key,
          source: row.source,
          fingerprintSha256: description?.fingerprintSha256 ?? null,
          commonName: description?.commonName ?? null,
          notAfter: iso(description?.notAfter),
          createdAt: row.createdAt.toISOString(),
          rotatedAt: iso(row.rotatedAt),
        };
      } else {
        scepCa = null;
      }

      const trustRows = yield* db
        .select()
        .from(schema.scepCaTrust)
        .where(eq(schema.scepCaTrust.organizationId, organizationId))
        .orderBy(desc(schema.scepCaTrust.retiredAt));

      scepTrustAnchors = trustRows.map((row) => ({
        certPem: row.certPem,
        fingerprintSha256: row.fingerprintSha256,
        source: row.source,
        retiredAt: row.retiredAt.toISOString(),
        trustUntil: row.trustUntil.toISOString(),
        createdAt: row.createdAt.toISOString(),
      }));

      const certificateRows = yield* db
        .select()
        .from(schema.scepIssuedCertificate)
        .where(eq(schema.scepIssuedCertificate.organizationId, organizationId))
        .orderBy(desc(schema.scepIssuedCertificate.createdAt))
        .limit(CUTOVER_MAX_DEVICES * 4 + 1);

      if (certificateRows.length > CUTOVER_MAX_DEVICES * 4) {
        certificateRows.pop();
        needsReissue.push(
          issue(
            "scep_certificate_history",
            `${CUTOVER_MAX_DEVICES * 4} identities`,
            "Older identity history was left on the source deployment. Active identities are ordered newest first and were included.",
          ),
        );
      }

      const deviceIds = new Set((devices ?? []).map((device) => device.key));

      scepCertificates = certificateRows.map((row) => ({
        serial: row.serial,
        // Renewal maps either the internal device id or a Windows DeviceID. Only
        // an internal id can be re-linked safely.
        deviceKey: row.deviceId && deviceIds.has(row.deviceId) ? row.deviceId : null,
        caFingerprintSha256: row.caFingerprintSha256,
        notAfter: row.notAfter.toISOString(),
        revokedAt: iso(row.revokedAt),
        createdAt: row.createdAt.toISOString(),
      }));
    }

    // ─── Audit history ──────────────────────────────────────────
    let audit: CutoverPayload["audit"];
    let auditTruncated: boolean | undefined;

    if (included.has("audit")) {
      const rows = yield* db
        .select()
        .from(schema.auditLog)
        .where(eq(schema.auditLog.organizationId, organizationId))
        .orderBy(desc(schema.auditLog.createdAt))
        .limit(CUTOVER_MAX_AUDIT_ROWS + 1);

      auditTruncated = rows.length > CUTOVER_MAX_AUDIT_ROWS;
      audit = rows.slice(0, CUTOVER_MAX_AUDIT_ROWS).map((entry) => ({
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        actorEmail: entry.actorEmail,
        metadata: entry.metadata,
        createdAt: entry.createdAt.toISOString(),
      }));
    }

    // ─── Platform credentials that cannot move ──────────────────
    const pushCertificate = yield* db.query.applePushCertificate.findFirst({
      where: { organizationId },
    });

    if (pushCertificate) {
      needsReissue.push(
        issue(
          "apns",
          pushCertificate.topic,
          "The APNs certificate and private key are deployment secrets. Upload the renewed certificate here with the same topic; device push tokens stay valid.",
        ),
      );
    }

    const abm = yield* db.query.appleBusinessManager.findFirst({ where: { organizationId } });

    if (abm) {
      needsReissue.push(
        issue(
          "abm",
          "Apple Business Manager",
          "The ABM server token is bound to the source MDM server. Create a new server token in ABM and upload it here.",
        ),
      );
    }

    const vpp = yield* db.query.vppToken.findFirst({ where: { organizationId } });

    if (vpp) {
      needsReissue.push(
        issue(
          "vpp",
          "Apps and Books",
          "The VPP token is bound to the source location. Download and upload a token for this deployment.",
        ),
      );
    }

    const android = yield* db.query.androidEnterprise.findFirst({ where: { organizationId } });

    if (android) {
      needsReissue.push(
        issue(
          "android_enterprise",
          android.enterpriseName ?? "Android Enterprise",
          "The Google enterprise and its notification endpoint belong to the source deployment. Run the signup and bind devices here.",
        ),
      );
    }

    const scim = yield* db
      .select({ id: schema.scimToken.id })
      .from(schema.scimToken)
      .where(eq(schema.scimToken.organizationId, organizationId))
      .limit(1);

    if (scim.length > 0) {
      needsReissue.push(
        issue(
          "scim",
          "SCIM provisioning",
          "Only a hash of each SCIM token is stored. Issue a new token here and update the identity provider.",
        ),
      );
    }

    const source: CutoverSource = {
      tenantId: organization.id,
      slug: organization.slug,
      name: organization.name,
      origin: normalizeOrigin(options.origin),
      deploymentId: options.deploymentId,
    };

    const payload: CutoverPayload = {
      version: 1,
      exportedAt: now.toISOString(),
      source,
      sections: [...sections],
      configuration: bundle,
      members,
      invitations,
      devices,
      escrowKey,
      scepCa,
      scepTrustAnchors,
      scepCertificates,
      audit,
      auditTruncated,
      needsReissue: bound(needsReissue),
    };

    const encoded = yield* Effect.tryPromise({
      try: () => encodeCutoverArchive({ payload, passphrase: options.passphrase }),
      catch: (cause) =>
        cause instanceof Error
          ? fail("invalid", cause.message)
          : fail("internal", "Could not encrypt the cutover archive"),
    });

    return {
      body: encoded.archive,
      filename: `tenant-${safeFilename(organization.slug)}-cutover-${now
        .toISOString()
        .slice(0, 10)}.cutover.json`,
      version: encoded.envelope.version,
      counts: encoded.envelope.manifest.counts,
      sections,
      needsReissue: payload.needsReissue ?? [],
    };
  });

/**
 * Report what a change of origin breaks, before DNS is touched.
 *
 * This is deliberately conservative: anything the operator must think about is
 * an item, and a hostname change is a blocker for a zero-touch move because an
 * installed Apple profile keeps the old ServerURL until it is replaced.
 */
export const preflightTenantOriginSwitch = (
  db: EnterpriseDb,
  organization: EnterpriseOrganization,
  options: {
    readonly currentOrigin: string;
    readonly targetOrigin?: string | null;
    readonly deploymentId: string;
    readonly now?: Date;
  },
): Effect.Effect<CutoverPreflightReport, unknown> =>
  Effect.gen(function* () {
    const now = options.now ?? new Date();
    const currentOrigin = normalizeOrigin(options.currentOrigin);
    const targetOrigin = normalizeOrigin(options.targetOrigin?.trim() || currentOrigin);
    const hostnameChanged = originHostname(currentOrigin) !== originHostname(targetOrigin);
    const organizationId = organization.id;

    const items: Array<CutoverPreflightReport["items"][number]> = [];

    items.push({
      id: "origin",
      severity: hostnameChanged ? "blocker" : "ok",
      title: hostnameChanged ? "The hostname is changing" : "The hostname stays the same",
      detail: hostnameChanged
        ? `Devices keep the old ServerURL inside their installed profile. Moving ${originHostname(
            currentOrigin,
          )} to ${originHostname(
            targetOrigin,
          )} requires every enrolled Apple device to receive a new profile (or re-enrol). Pointing DNS at the new deployment while keeping the same hostname is the only zero-touch path.`
        : "Point the existing DNS name at the new deployment and set ORIGIN to the same value. Installed profiles, SCEP renewal URLs and enrollment links keep working.",
    });

    const [enrollment] = yield* db
      .select({ id: schema.enterpriseEnrollment.id })
      .from(schema.enterpriseEnrollment)
      .where(eq(schema.enterpriseEnrollment.organizationId, organizationId))
      .limit(1);

    const preRegistrations = yield* db
      .select({ id: schema.devicePreRegistration.id })
      .from(schema.devicePreRegistration)
      .where(eq(schema.devicePreRegistration.organizationId, organizationId))
      .limit(1000);

    items.push({
      id: "enrollment_profiles",
      severity: hostnameChanged ? "warning" : "info",
      title: "Enrollment profiles and links embed this origin",
      detail:
        "Apple profiles carry the SCEP URL and check-in URL derived from ORIGIN, and the public enrollment page and pre-registration links embed it too. Profiles already installed are not rewritten by this deployment.",
      affected: (enrollment ? 1 : 0) + preRegistrations.length,
    });

    const appleDevices = yield* db
      .select({ id: schema.device.id })
      .from(schema.device)
      .where(
        and(
          eq(schema.device.organizationId, organizationId),
          eq(schema.device.proto, "apple"),
          eq(schema.device.status, "enrolled"),
        ),
      )
      .limit(10_000);

    items.push({
      id: "scep_profile_urls",
      severity: appleDevices.length > 0 && hostnameChanged ? "blocker" : "info",
      title: "Installed Apple profiles point at the old SCEP endpoint",
      detail:
        "An identity renews against the SCEP URL in its installed profile. If the hostname changes, keep the old host answering until every device has the new profile, or expect renewals to fail and devices to drop off.",
      affected: appleDevices.length,
    });

    const [push] = yield* db
      .select({ topic: schema.applePushCertificate.topic })
      .from(schema.applePushCertificate)
      .where(eq(schema.applePushCertificate.organizationId, organizationId))
      .limit(1);

    items.push({
      id: "apns_topic",
      severity: push ? "warning" : "info",
      title: "APNs is deployment-bound",
      detail: push
        ? `The push certificate for ${push.topic} is not part of the archive. Upload the renewed certificate on the target with the same topic; stored device push tokens remain valid.`
        : "No Apple push certificate is configured, so there is no push identity to move.",
    });

    const [abm] = yield* db
      .select({ id: schema.appleBusinessManager.organizationId })
      .from(schema.appleBusinessManager)
      .where(eq(schema.appleBusinessManager.organizationId, organizationId))
      .limit(1);

    const [vpp] = yield* db
      .select({ id: schema.vppToken.organizationId })
      .from(schema.vppToken)
      .where(eq(schema.vppToken.organizationId, organizationId))
      .limit(1);

    const [android] = yield* db
      .select({ id: schema.androidEnterprise.organizationId })
      .from(schema.androidEnterprise)
      .where(eq(schema.androidEnterprise.organizationId, organizationId))
      .limit(1);

    const scim = yield* db
      .select({ id: schema.scimToken.id })
      .from(schema.scimToken)
      .where(eq(schema.scimToken.organizationId, organizationId))
      .limit(1);

    items.push(
      {
        id: "integrations",
        severity: abm || vpp || android || scim.length > 0 ? "warning" : "info",
        title: "Platform integrations need re-authorisation",
        detail:
          "Apple Business Manager, Apps and Books, Android Enterprise and SCIM tokens are issued to a specific server. Re-create them on the target; the archive reports each one as a re-issuance item.",
        affected: [abm, vpp, android, ...scim].filter(Boolean).length,
      },
      {
        id: "webauthn",
        severity: hostnameChanged ? "warning" : "info",
        title: "Passkeys are bound to the origin",
        detail: hostnameChanged
          ? `WebAuthn relying-party id follows the hostname (${originHostname(
              currentOrigin,
            )}). Existing passkeys will not work at ${originHostname(
              targetOrigin,
            )}; TOTP and recovery codes still do, so keep one of those available for every administrator.`
          : "The WebAuthn relying-party id is unchanged, so enrolled passkeys keep working.",
      },
    );

    const pendingInvitations = yield* db
      .select({ id: schema.invitation.id })
      .from(schema.invitation)
      .where(
        and(
          eq(schema.invitation.organizationId, organizationId),
          eq(schema.invitation.status, "pending"),
        ),
      )
      .limit(1000);

    items.push({
      id: "email_links",
      severity: pendingInvitations.length > 0 ? "warning" : "info",
      title: "Pending email links point at the old origin",
      detail:
        "Invitation, verification and step-up links are absolute URLs. Resend pending invitations after the switch (the cutover archive carries them without their bearer tokens).",
      affected: pendingInvitations.length,
    });

    const customRoles = yield* db
      .select({ id: schema.tenantRole.id })
      .from(schema.tenantRole)
      .where(eq(schema.tenantRole.organizationId, organizationId))
      .limit(1000);

    items.push({
      id: "custom_roles",
      severity: "info",
      title: "Custom roles are not part of the archive",
      detail:
        "Member roles are matched by account email. A member on a custom role is imported with a built-in fallback and listed as needing a role review.",
      affected: customRoles.length,
    });

    const activeChallenges = yield* db
      .select({ id: schema.scepChallenge.id })
      .from(schema.scepChallenge)
      .where(
        and(
          eq(schema.scepChallenge.organizationId, organizationId),
          isNull(schema.scepChallenge.consumedAt),
          gt(schema.scepChallenge.expiresAt, now),
        ),
      )
      .limit(1000);

    items.push({
      id: "scep_challenges",
      severity: activeChallenges.length > 0 ? "info" : "ok",
      title: "In-flight SCEP challenges expire quickly",
      detail:
        "Unconsumed challenges are short-lived and not exported. An enrollment started before the switch should be restarted afterwards.",
      affected: activeChallenges.length,
    });

    return {
      currentOrigin,
      targetOrigin,
      hostnameChanged,
      deploymentId: options.deploymentId,
      items,
      steps: [
        {
          id: "preflight",
          title: "Run the preflight report",
          detail:
            "Resolve every blocker and decide how devices will receive profiles on the new hostname before touching DNS.",
        },
        {
          id: "freeze",
          title: "Freeze writes on the source",
          detail:
            "Pause configuration changes and scheduled jobs. Devices may keep checking in; only new enrollments and writes need to stop so the archive is a consistent snapshot.",
        },
        {
          id: "export",
          title: "Export the encrypted cutover archive",
          detail:
            "Select configuration, members, devices, SCEP CA and audit, then download the archive. It contains private keys: store it like a backup and keep the passphrase out of band.",
        },
        {
          id: "switch",
          title: "Switch DNS and ORIGIN",
          detail:
            "Point the hostname at the target deployment and set ORIGIN to the same value. Keep the old deployment reachable until check-ins are verified.",
        },
        {
          id: "import",
          title: "Import on the target",
          detail:
            "Preview the archive, resolve conflicts (slug, device serials, existing SCEP CA), acknowledge cross-deployment and re-issue items, then apply it.",
        },
        {
          id: "verify",
          title: "Verify device check-ins",
          detail:
            "Watch the device list and audit stream for check-ins, renew identities if the CA was not moved, and confirm push delivery after the APNs certificate is uploaded.",
        },
        {
          id: "unfreeze",
          title: "Unfreeze and retire the source",
          detail:
            "Resume jobs and configuration changes, resend invitations and re-issue platform credentials. Keep the source read-only for the rollback window, then delete it.",
        },
      ],
    };
  });

import { Option, Schema } from "effect";
import { NullableString } from "./Errors.js";
import { TenantExportAuditEntry, TenantExportEnvelope } from "./Backup.js";

/**
 * Encrypted deployment cutover archive.
 *
 * A regular tenant export is a plaintext JSON bundle for configuration. A
 * cutover archive is different: it is the only thing that may carry private key
 * material (the tenant SCEP CA and escrowed device secrets), so it is always
 * encrypted, always authenticated and always bounded.
 *
 * The plaintext part (the manifest) is deliberately boring: it names the source
 * deployment, the sections, row counts and two digests. It never contains a
 * key, a passphrase, a certificate body or a token. Everything sensitive is in
 * the encrypted payload.
 */

/** Magic string written into every archive, so a JSON file cannot be misread. */
export const CUTOVER_FORMAT = "mattrax.cutover";

export const CUTOVER_VERSION = 1;

/**
 * PBKDF2-SHA256 work factor. WebCrypto is available in Workers and Node, which
 * keeps the codec portable; 600k iterations is the current OWASP figure.
 */
export const CUTOVER_KDF_ITERATIONS = 600_000;

/** Bounds accepted on import, so an archive cannot ask us to burn CPU. */
export const CUTOVER_KDF_MIN_ITERATIONS = 10_000;

export const CUTOVER_KDF_MAX_ITERATIONS = 2_000_000;

/** Reject an archive before parsing it. Base64 expands payloads by 4/3. */
export const CUTOVER_MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;

/** Reject a decrypted payload before giving it to the schema decoder. */
export const CUTOVER_MAX_PAYLOAD_BYTES = 24 * 1024 * 1024;

/** A cutover is for one tenant, not a deployment-sized database dump. */
export const CUTOVER_MAX_DEVICES = 10_000;

export const CUTOVER_MAX_MEMBERS = 10_000;

export const CUTOVER_MAX_AUDIT_ROWS = 10_000;

/**
 * A short passphrase would make the PBKDF2 work factor pointless. The export
 * refuses to produce an archive below this; import only requires a non-empty
 * value so the failure is reported as a wrong passphrase, not a format error.
 */
export const CUTOVER_MIN_PASSPHRASE_LENGTH = 12;

export const CUTOVER_PASSPHRASE_MAX_LENGTH = 1024;

export const CUTOVER_SECTION_NAMES = [
  "configuration",
  "members",
  "devices",
  "scepCa",
  "audit",
] as const;

export const CutoverSection = Schema.Literals(CUTOVER_SECTION_NAMES);

export type CutoverSection = typeof CutoverSection.Type;

/**
 * Section toggles. Configuration is not optional: devices, members and the CA
 * reference groups, policies and applications, so an archive without it cannot
 * be applied coherently.
 */
export const CutoverSectionSelection = Schema.Struct({
  configuration: Schema.optional(Schema.Boolean),
  members: Schema.optional(Schema.Boolean),
  devices: Schema.optional(Schema.Boolean),
  scepCa: Schema.optional(Schema.Boolean),
  audit: Schema.optional(Schema.Boolean),
});

export type CutoverSectionSelection = typeof CutoverSectionSelection.Type;

/** Resolve the toggles to the concrete section list, in a stable order. */
export const selectedCutoverSections = (
  input: CutoverSectionSelection | undefined,
): ReadonlyArray<CutoverSection> => {
  const selection = input ?? {};
  const sections: Array<CutoverSection> = ["configuration"];

  if (selection.members !== false) sections.push("members");

  if (selection.devices !== false) sections.push("devices");

  if (selection.scepCa !== false) sections.push("scepCa");

  if (selection.audit === true) sections.push("audit");

  return sections;
};

export const CutoverSource = Schema.Struct({
  tenantId: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  /** Canonical origin at export time. Devices have this baked into profiles. */
  origin: Schema.String,
  /**
   * Stable per-installation identity. Derived from AUTH_SECRET when no explicit
   * value is configured, so two independent deployments never share one by
   * accident.
   */
  deploymentId: Schema.String,
});

export type CutoverSource = typeof CutoverSource.Type;

export const CutoverCounts = Schema.Struct({
  groups: Schema.Number,
  policies: Schema.Number,
  applications: Schema.Number,
  preRegistrations: Schema.Number,
  members: Schema.Number,
  invitations: Schema.Number,
  devices: Schema.Number,
  deviceSecrets: Schema.Number,
  certificates: Schema.Number,
  auditEntries: Schema.Number,
});

export type CutoverCounts = typeof CutoverCounts.Type;

/**
 * The plaintext manifest. It is rendered by operators (the UI shows it before a
 * passphrase is supplied) and bound by the ciphertext digest, so it must never
 * carry secrets.
 */
export const CutoverManifest = Schema.Struct({
  version: Schema.Literal(CUTOVER_VERSION),
  createdAt: Schema.String,
  source: CutoverSource,
  sections: Schema.Array(CutoverSection),
  counts: CutoverCounts,
  /** SHA-256 of the decrypted UTF-8 payload, lowercase hex. */
  payloadSha256: Schema.String,
  /** SHA-256 of the AES-GCM ciphertext bytes, lowercase hex. */
  ciphertextSha256: Schema.String,
});

export type CutoverManifest = typeof CutoverManifest.Type;

export const CutoverEnvelope = Schema.Struct({
  format: Schema.Literal(CUTOVER_FORMAT),
  version: Schema.Literal(CUTOVER_VERSION),
  kdf: Schema.Struct({
    name: Schema.Literal("PBKDF2-SHA256"),
    iterations: Schema.Number,
    /** Base64, 16 random bytes. */
    salt: Schema.String,
  }),
  cipher: Schema.Struct({
    name: Schema.Literal("AES-256-GCM"),
    /** Base64, 12 random bytes. WebCrypto's recommended AES-GCM nonce size. */
    iv: Schema.String,
  }),
  manifest: CutoverManifest,
  /** Base64 AES-GCM ciphertext. The manifest's digest covers these bytes. */
  payload: Schema.String,
});

export type CutoverEnvelope = typeof CutoverEnvelope.Type;

export const CutoverDevicePlatform = Schema.Literals(["apple", "win", "android"]);

export const CutoverDeviceStatus = Schema.Literals([
  "enrolling",
  "enrolled",
  "unenrolling",
  "unenrolled",
]);

/** Apple push/identity state that must survive a cutover for pushes to work. */
export const CutoverDeviceApple = Schema.Struct({
  enrollmentId: Schema.optional(NullableString),
  enrollmentMode: Schema.optional(Schema.NullOr(Schema.Literals(["device", "user"]))),
  token: Schema.optional(NullableString),
  pushMagic: Schema.optional(NullableString),
  topic: Schema.optional(NullableString),
  unlockToken: Schema.optional(NullableString),
  bootstrapToken: Schema.optional(NullableString),
  bootstrapTokenEscrowed: Schema.optional(Schema.NullOr(Schema.Boolean)),
  awaitingConfiguration: Schema.optional(Schema.Boolean),
  configured: Schema.optional(Schema.Boolean),
  declarationMode: Schema.optional(Schema.NullOr(Schema.Literals(["ddm", "legacy"]))),
});

export type CutoverDeviceApple = typeof CutoverDeviceApple.Type;

export const CutoverDeviceSecretKind = Schema.Literals([
  "filevault_recovery_key",
  "bootstrap_token",
  "activation_lock_bypass_code",
  "recovery_lock_password",
  "local_admin_password",
]);

/**
 * An escrowed device secret, decrypted from its source-deployment envelope. It
 * only ever exists inside the encrypted payload; import re-seals it with the
 * target deployment's AUTH_SECRET.
 */
export const CutoverDeviceSecret = Schema.Struct({
  kind: CutoverDeviceSecretKind,
  value: Schema.String,
  format: Schema.Literals(["plaintext", "cms"]),
});

export type CutoverDeviceSecret = typeof CutoverDeviceSecret.Type;

export const CutoverDevice = Schema.Struct({
  /** Source internal device id. Import preserves it when the target can. */
  key: Schema.String,
  name: Schema.String,
  serial: Schema.optional(NullableString),
  platform: CutoverDevicePlatform,
  status: CutoverDeviceStatus,
  model: Schema.optional(NullableString),
  vendor: Schema.optional(NullableString),
  osVersion: Schema.optional(NullableString),
  osBuild: Schema.optional(NullableString),
  osEdition: Schema.optional(NullableString),
  physicalName: Schema.optional(NullableString),
  /** When the reported name was last written. */
  physicalNameAt: Schema.optional(NullableString),
  /** "Apply name to device with each sync"; null means never chosen. */
  namePushEnabled: Schema.optional(Schema.NullOr(Schema.Boolean)),
  appliedName: Schema.optional(NullableString),
  appliedNameAt: Schema.optional(NullableString),
  assetTag: Schema.optional(NullableString),
  notes: Schema.optional(NullableString),
  enrolledAt: Schema.String,
  lastSeenAt: Schema.String,
  /** Apple UDID or Windows DeviceID, used to resolve the device on check-in. */
  dmIdentifier: Schema.optional(NullableString),
  dmCertHash: Schema.optional(NullableString),
  dmIdentityFingerprint: Schema.optional(NullableString),
  apple: Schema.optional(Schema.NullOr(CutoverDeviceApple)),
  groupKeys: Schema.optional(Schema.Array(Schema.String)),
  /** Direct device-level assignments, mirroring the configuration bundle. */
  policyKeys: Schema.optional(Schema.Array(Schema.String)),
  excludedPolicyKeys: Schema.optional(Schema.Array(Schema.String)),
  applicationKeys: Schema.optional(Schema.Array(Schema.String)),
  secrets: Schema.optional(Schema.Array(CutoverDeviceSecret)),
  /** Set when identity material could not be exported (for example Android). */
  needsReissue: Schema.optional(NullableString),
});

export type CutoverDevice = typeof CutoverDevice.Type;

export const CutoverMember = Schema.Struct({
  email: Schema.String,
  name: Schema.optional(NullableString),
  role: Schema.String,
  /** Custom roles are tenant-scoped and are not part of the archive. */
  customRoleName: Schema.optional(NullableString),
  createdAt: Schema.optional(NullableString),
});

export type CutoverMember = typeof CutoverMember.Type;

/**
 * A pending invitation. The acceptance token is a bearer secret and is never
 * exported; the operator re-sends the invitation from the target deployment.
 */
export const CutoverInvitation = Schema.Struct({
  email: Schema.String,
  role: Schema.optional(NullableString),
  customRoleName: Schema.optional(NullableString),
  expiresAt: Schema.String,
  createdAt: Schema.String,
});

export type CutoverInvitation = typeof CutoverInvitation.Type;

/**
 * The tenant SCEP CA. The certificate alone keeps mTLS validation working for
 * already-issued identities; the private key is required for renewal, so it is
 * optional and its absence is reported as a re-issuance item.
 */
export const CutoverScepCa = Schema.Struct({
  certPem: Schema.String,
  privateKeyPem: Schema.optional(NullableString),
  source: Schema.Literals(["generated", "imported"]),
  fingerprintSha256: Schema.optional(NullableString),
  commonName: Schema.optional(NullableString),
  notAfter: Schema.optional(NullableString),
  createdAt: Schema.String,
  rotatedAt: Schema.optional(NullableString),
});

export type CutoverScepCa = typeof CutoverScepCa.Type;

/** A retired CA certificate that is still a verification anchor. */
export const CutoverScepTrustAnchor = Schema.Struct({
  certPem: Schema.String,
  fingerprintSha256: Schema.String,
  source: Schema.Literals(["generated", "imported"]),
  retiredAt: Schema.String,
  trustUntil: Schema.String,
  createdAt: Schema.String,
});

export type CutoverScepTrustAnchor = typeof CutoverScepTrustAnchor.Type;

/** Metadata for an identity issued by the CA. Private keys are never stored. */
export const CutoverScepCertificate = Schema.Struct({
  serial: Schema.String,
  deviceKey: Schema.optional(NullableString),
  caFingerprintSha256: Schema.optional(NullableString),
  notAfter: Schema.String,
  revokedAt: Schema.optional(NullableString),
  createdAt: Schema.String,
});

export type CutoverScepCertificate = typeof CutoverScepCertificate.Type;

/**
 * The tenant FileVault escrow identity. Importing it is what lets recovery keys
 * collected before the cutover still be revealed afterwards.
 */
export const CutoverEscrowKey = Schema.Struct({
  certificatePem: Schema.String,
  privateKeyPem: Schema.String,
  certificateFingerprintSha256: Schema.String,
  subject: Schema.optional(NullableString),
  certificateNotAfter: Schema.optional(NullableString),
  source: Schema.Literals(["generated", "uploaded"]),
  createdAt: Schema.String,
});

export type CutoverEscrowKey = typeof CutoverEscrowKey.Type;

/**
 * Something the source deployment holds that cannot be moved safely. It is
 * reported to the operator instead of being dropped silently.
 */
export const CutoverNeedsReissue = Schema.Struct({
  kind: Schema.String,
  item: Schema.String,
  reason: Schema.String,
});

export type CutoverNeedsReissue = typeof CutoverNeedsReissue.Type;

export const CutoverPayload = Schema.Struct({
  version: Schema.Literal(CUTOVER_VERSION),
  exportedAt: Schema.String,
  source: CutoverSource,
  sections: Schema.Array(CutoverSection),
  /** The plaintext tenant bundle (branding, groups, policies, applications). */
  configuration: Schema.optional(TenantExportEnvelope),
  members: Schema.optional(Schema.Array(CutoverMember)),
  invitations: Schema.optional(Schema.Array(CutoverInvitation)),
  devices: Schema.optional(Schema.Array(CutoverDevice)),
  escrowKey: Schema.optional(Schema.NullOr(CutoverEscrowKey)),
  scepCa: Schema.optional(Schema.NullOr(CutoverScepCa)),
  scepTrustAnchors: Schema.optional(Schema.Array(CutoverScepTrustAnchor)),
  scepCertificates: Schema.optional(Schema.Array(CutoverScepCertificate)),
  audit: Schema.optional(Schema.Array(TenantExportAuditEntry)),
  auditTruncated: Schema.optional(Schema.Boolean),
  needsReissue: Schema.optional(Schema.Array(CutoverNeedsReissue)),
});

export type CutoverPayload = typeof CutoverPayload.Type;

export const CutoverExportRequest = Schema.Struct({
  passphrase: Schema.String,
  sections: Schema.optional(CutoverSectionSelection),
});

export type CutoverExportRequest = typeof CutoverExportRequest.Type;

export const CutoverConflictKind = Schema.Literals([
  "slug",
  "configuration",
  "device_serial",
  "scep_ca",
  "escrow_key",
  "member",
  "certificate",
]);

export const CutoverConflict = Schema.Struct({
  kind: CutoverConflictKind,
  item: Schema.String,
  detail: Schema.String,
  /** Whether import can proceed without an extra acknowledgement. */
  resolution: Schema.Literals(["auto", "requires_confirmation", "skip"]),
});

export type CutoverConflict = typeof CutoverConflict.Type;

/**
 * Everything the operator must see before applying an archive: what will land,
 * what conflicts with the target and what has to be re-issued afterwards.
 */
export const CutoverPreview = Schema.Struct({
  manifest: CutoverManifest,
  /** The typed confirmation string; always the archive's tenant slug. */
  confirm: Schema.String,
  crossDeployment: Schema.Boolean,
  source: CutoverSource,
  counts: CutoverCounts,
  conflicts: Schema.Array(CutoverConflict),
  needsReissue: Schema.Array(CutoverNeedsReissue),
  warnings: Schema.Array(Schema.String),
  requirements: Schema.Struct({
    allowCrossDeployment: Schema.Boolean,
    replaceConfiguration: Schema.Boolean,
    replaceScepCa: Schema.Boolean,
    replaceEscrowKey: Schema.Boolean,
    deviceConflicts: Schema.Literals(["fail", "skip"]),
  }),
  target: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        tenantId: Schema.String,
        slug: Schema.String,
        name: Schema.String,
      }),
    ),
  ),
});

export type CutoverPreview = typeof CutoverPreview.Type;

export const CutoverPreviewRequest = Schema.Struct({
  archive: Schema.String,
  passphrase: Schema.String,
  /** Preview conflicts against this tenant instead of a fresh tenant. */
  targetTenantId: Schema.optional(NullableString),
});

export type CutoverPreviewRequest = typeof CutoverPreviewRequest.Type;

export const CutoverImportRequest = Schema.Struct({
  archive: Schema.String,
  passphrase: Schema.String,
  /** The archive's tenant slug, retyped. Never a boolean. */
  confirm: Schema.String,
  /** Import into an existing tenant; omit to create a new one. */
  targetTenantId: Schema.optional(NullableString),
  allowCrossDeployment: Schema.optional(Schema.Boolean),
  replaceConfiguration: Schema.optional(Schema.Boolean),
  replaceScepCa: Schema.optional(Schema.Boolean),
  replaceEscrowKey: Schema.optional(Schema.Boolean),
  deviceConflicts: Schema.optional(Schema.Literals(["fail", "skip"])),
});

export type CutoverImportRequest = typeof CutoverImportRequest.Type;

export const CutoverImportResponse = Schema.Struct({
  tenantId: Schema.String,
  slug: Schema.String,
  mode: Schema.Literals(["new", "existing"]),
  source: CutoverSource,
  imported: Schema.Struct({
    groups: Schema.Number,
    policies: Schema.Number,
    applications: Schema.Number,
    preRegistrations: Schema.Number,
    members: Schema.Number,
    invitations: Schema.Number,
    devices: Schema.Number,
    deviceSecrets: Schema.Number,
    groupMemberships: Schema.Number,
    certificates: Schema.Number,
    auditEntries: Schema.Number,
    scepCa: Schema.Boolean,
    escrowKey: Schema.Boolean,
  }),
  skipped: Schema.Struct({
    members: Schema.Number,
    invitations: Schema.Number,
    devices: Schema.Number,
    deviceSecrets: Schema.Number,
    certificates: Schema.Number,
    auditEntries: Schema.Number,
  }),
  conflicts: Schema.Array(CutoverConflict),
  needsReissue: Schema.Array(CutoverNeedsReissue),
  warnings: Schema.Array(Schema.String),
});

export type CutoverImportResponse = typeof CutoverImportResponse.Type;

export const CutoverPreflightQuery = Schema.Struct({
  /** Origin the operator intends to switch to. Defaults to the current one. */
  origin: Schema.optional(NullableString),
});

export type CutoverPreflightQuery = typeof CutoverPreflightQuery.Type;

export const CutoverPreflightSeverity = Schema.Literals(["ok", "info", "warning", "blocker"]);

export const CutoverPreflightItem = Schema.Struct({
  id: Schema.String,
  severity: CutoverPreflightSeverity,
  title: Schema.String,
  detail: Schema.String,
  /** How many rows or links are affected, when countable. */
  affected: Schema.optional(Schema.Number),
});

export type CutoverPreflightItem = typeof CutoverPreflightItem.Type;

export const CutoverPreflightReport = Schema.Struct({
  currentOrigin: Schema.String,
  targetOrigin: Schema.String,
  hostnameChanged: Schema.Boolean,
  deploymentId: Schema.String,
  items: Schema.Array(CutoverPreflightItem),
  /**
   * The ordered runbook. Steps name the operation, not just the concept, so the
   * dashboard can render them without duplicating the sequence.
   */
  steps: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      detail: Schema.String,
    }),
  ),
});

export type CutoverPreflightReport = typeof CutoverPreflightReport.Type;

// ─── Archive codec ───────────────────────────────────────────────

export class CutoverArchiveError extends Schema.TaggedError<CutoverArchiveError>()(
  "CutoverArchiveError",
  {
    reason: Schema.Literals([
      "invalid_archive",
      "unsupported_version",
      "wrong_passphrase",
      "tampered",
      "too_large",
      "invalid_passphrase",
    ]),
    message: Schema.String,
  },
) {}

const encoder = new TextEncoder();

const decoder = new TextDecoder();

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";

  // Chunked so a large payload cannot overflow the argument list.
  for (let index = 0; index < bytes.byteLength; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));

  return btoa(binary);
};

const base64ToBytes = (value: string, label: string): Uint8Array => {
  const trimmed = value.trim();

  if (!trimmed || !BASE64.test(trimmed))
    throw new CutoverArchiveError({
      reason: "invalid_archive",
      message: `The archive's ${label} is not valid base64`,
    });

  const binary = atob(trimmed);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);

  return bytes;
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return copy.buffer;
};

/** SHA-256 as lowercase hex, over arbitrary bytes. */
export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes));

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

/** SHA-256 as lowercase hex, over a UTF-8 string. */
export const sha256Text = (value: string): Promise<string> => sha256Hex(encoder.encode(value));

const deriveKey = async (
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> => {
  const material = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(encoder.encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};

const invalidArchive = (message: string) =>
  new CutoverArchiveError({ reason: "invalid_archive", message });

/**
 * Encrypt a cutover payload.
 *
 * The manifest is built here from the payload, so a caller cannot describe one
 * thing and encrypt another. Both digests and the AES-GCM tag bind the file: a
 * truncated, re-ordered or edited archive is rejected before any row is read.
 */
export const encodeCutoverArchive = async (input: {
  readonly payload: CutoverPayload;
  readonly passphrase: string;
  /** Test-only override; production always uses the default work factor. */
  readonly iterations?: number;
}): Promise<{ readonly archive: string; readonly envelope: CutoverEnvelope }> => {
  const passphrase = input.passphrase;

  if (passphrase.length < CUTOVER_MIN_PASSPHRASE_LENGTH)
    throw new CutoverArchiveError({
      reason: "invalid_passphrase",
      message: `Use a passphrase of at least ${CUTOVER_MIN_PASSPHRASE_LENGTH} characters. This archive contains private keys.`,
    });

  if (passphrase.length > CUTOVER_PASSPHRASE_MAX_LENGTH)
    throw new CutoverArchiveError({
      reason: "invalid_passphrase",
      message: "The passphrase is too long.",
    });

  const iterations = input.iterations ?? CUTOVER_KDF_ITERATIONS;

  if (
    !Number.isSafeInteger(iterations) ||
    iterations < CUTOVER_KDF_MIN_ITERATIONS ||
    iterations > CUTOVER_KDF_MAX_ITERATIONS
  )
    throw invalidArchive("The key derivation work factor is outside the supported range");

  const plaintext = JSON.stringify(input.payload);
  const plaintextBytes = encoder.encode(plaintext);

  if (plaintextBytes.byteLength > CUTOVER_MAX_PAYLOAD_BYTES)
    throw new CutoverArchiveError({
      reason: "too_large",
      message: `The archive payload is larger than ${Math.floor(
        CUTOVER_MAX_PAYLOAD_BYTES / 1024 / 1024,
      )} MB. Export fewer sections, or take a database backup of the deployment.`,
    });

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, iterations);

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(iv), tagLength: 128 },
      key,
      toArrayBuffer(plaintextBytes),
    ),
  );

  const payloadSha256 = await sha256Hex(plaintextBytes);
  const ciphertextSha256 = await sha256Hex(ciphertext);

  const counts: CutoverCounts = {
    groups: input.payload.configuration?.groups.length ?? 0,
    policies: input.payload.configuration?.policies.length ?? 0,
    applications: input.payload.configuration?.applications.length ?? 0,
    preRegistrations: input.payload.configuration?.preRegistrations.length ?? 0,
    members: input.payload.members?.length ?? 0,
    invitations: input.payload.invitations?.length ?? 0,
    devices: input.payload.devices?.length ?? 0,
    deviceSecrets: (input.payload.devices ?? []).reduce(
      (total, device) => total + (device.secrets?.length ?? 0),
      0,
    ),
    certificates: input.payload.scepCertificates?.length ?? 0,
    auditEntries: input.payload.audit?.length ?? 0,
  };

  const envelope: CutoverEnvelope = {
    format: CUTOVER_FORMAT,
    version: CUTOVER_VERSION,
    kdf: { name: "PBKDF2-SHA256", iterations, salt: bytesToBase64(salt) },
    cipher: { name: "AES-256-GCM", iv: bytesToBase64(iv) },
    manifest: {
      version: CUTOVER_VERSION,
      createdAt: input.payload.exportedAt,
      source: input.payload.source,
      sections: input.payload.sections,
      counts,
      payloadSha256,
      ciphertextSha256,
    },
    payload: bytesToBase64(ciphertext),
  };

  const archive = JSON.stringify(envelope, null, 2);
  const archiveBytes = encoder.encode(archive).byteLength;

  if (archiveBytes > CUTOVER_MAX_ARCHIVE_BYTES)
    throw new CutoverArchiveError({
      reason: "too_large",
      message: `The encrypted archive is larger than ${Math.floor(
        CUTOVER_MAX_ARCHIVE_BYTES / 1024 / 1024,
      )} MB. Take a database backup of the deployment instead.`,
    });

  return { archive, envelope };
};

/**
 * Verify an archive's envelope and manifest without the passphrase.
 *
 * This is what the dashboard uses to show "what is in this file" before asking
 * for a passphrase. Nothing here proves the payload is readable; only the
 * ciphertext digest and structural checks run.
 */
export const decodeCutoverEnvelope = (archive: string): CutoverEnvelope => {
  // Check the string length before encoding: a caller can hand us a very large
  // body, and copying it just to discover it is too large is the expensive part.
  if (archive.length > CUTOVER_MAX_ARCHIVE_BYTES)
    throw new CutoverArchiveError({
      reason: "too_large",
      message: `The archive is larger than ${Math.floor(
        CUTOVER_MAX_ARCHIVE_BYTES / 1024 / 1024,
      )} MB.`,
    });

  if (encoder.encode(archive).byteLength > CUTOVER_MAX_ARCHIVE_BYTES)
    throw new CutoverArchiveError({
      reason: "too_large",
      message: `The archive is larger than ${Math.floor(
        CUTOVER_MAX_ARCHIVE_BYTES / 1024 / 1024,
      )} MB.`,
    });

  let raw: unknown;

  try {
    raw = JSON.parse(archive);
  } catch {
    throw invalidArchive("This file is not a Mattrax cutover archive (invalid JSON)");
  }

  // Report a future version distinctly instead of as a malformed file: the
  // operator can then upgrade rather than hunt for corruption.
  const claimedVersion = Schema.decodeUnknownOption(Schema.Struct({ version: Schema.Number }))(raw);

  if (Option.isSome(claimedVersion) && claimedVersion.value.version !== CUTOVER_VERSION)
    throw new CutoverArchiveError({
      reason: "unsupported_version",
      message: `Unsupported cutover archive version ${String(
        claimedVersion.value.version,
      )}. This deployment reads version ${CUTOVER_VERSION}.`,
    });

  const decoded = Schema.decodeUnknownOption(CutoverEnvelope)(raw);

  if (Option.isNone(decoded)) throw invalidArchive("This file is not a Mattrax cutover archive");

  const envelope = decoded.value;

  if (envelope.kdf.iterations < CUTOVER_KDF_MIN_ITERATIONS)
    throw invalidArchive("The archive's key derivation work factor is too low to be safe");

  if (envelope.kdf.iterations > CUTOVER_KDF_MAX_ITERATIONS)
    throw invalidArchive("The archive's key derivation work factor is outside the supported range");

  const salt = base64ToBytes(envelope.kdf.salt, "salt");

  if (salt.byteLength < 16) throw invalidArchive("The archive's salt is too short");

  const iv = base64ToBytes(envelope.cipher.iv, "initialisation vector");

  if (iv.byteLength !== 12) throw invalidArchive("The archive's initialisation vector is invalid");

  return envelope;
};

/**
 * Decrypt and validate an archive.
 *
 * Order matters: the ciphertext checksum runs before the key is derived, so a
 * corrupted file is reported as tampering rather than as a wrong passphrase.
 */
export const decodeCutoverArchive = async (input: {
  readonly archive: string;
  readonly passphrase: string;
}): Promise<{
  readonly envelope: CutoverEnvelope;
  readonly manifest: CutoverManifest;
  readonly payload: CutoverPayload;
}> => {
  const envelope = decodeCutoverEnvelope(input.archive);

  const ciphertext = base64ToBytes(envelope.payload, "payload");

  if (ciphertext.byteLength <= 16)
    throw invalidArchive("The archive's encrypted payload is truncated");

  const ciphertextSha256 = await sha256Hex(ciphertext);

  if (ciphertextSha256 !== envelope.manifest.ciphertextSha256.toLowerCase())
    throw new CutoverArchiveError({
      reason: "tampered",
      message:
        "The archive's payload does not match its checksum. The file was modified or corrupted in transit; export it again.",
    });

  const salt = base64ToBytes(envelope.kdf.salt, "salt");
  const iv = base64ToBytes(envelope.cipher.iv, "initialisation vector");
  const key = await deriveKey(input.passphrase, salt, envelope.kdf.iterations);

  let plaintextBytes: Uint8Array;

  try {
    plaintextBytes = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: toArrayBuffer(iv), tagLength: 128 },
        key,
        toArrayBuffer(ciphertext),
      ),
    );
  } catch {
    // The ciphertext digest already matched, so the only remaining cause is the
    // key: report a wrong passphrase without echoing any key material.
    throw new CutoverArchiveError({
      reason: "wrong_passphrase",
      message: "The passphrase is wrong, or the archive was encrypted by a different deployment.",
    });
  }

  if (plaintextBytes.byteLength > CUTOVER_MAX_PAYLOAD_BYTES)
    throw new CutoverArchiveError({
      reason: "too_large",
      message: "The decrypted archive exceeds the payload limit",
    });

  const payloadSha256 = await sha256Hex(plaintextBytes);

  if (payloadSha256 !== envelope.manifest.payloadSha256.toLowerCase())
    throw new CutoverArchiveError({
      reason: "tampered",
      message: "The archive's decrypted payload does not match its manifest",
    });

  let raw: unknown;

  try {
    raw = JSON.parse(decoder.decode(plaintextBytes));
  } catch {
    throw invalidArchive("The decrypted archive payload is not valid JSON");
  }

  const decoded = Schema.decodeUnknownOption(CutoverPayload)(raw);

  if (Option.isNone(decoded)) throw invalidArchive("The decrypted archive payload is malformed");
  const payload = decoded.value;

  if (
    payload.source.tenantId !== envelope.manifest.source.tenantId ||
    payload.source.deploymentId !== envelope.manifest.source.deploymentId ||
    payload.source.origin !== envelope.manifest.source.origin
  )
    throw new CutoverArchiveError({
      reason: "tampered",
      message: "The archive manifest does not match its encrypted payload",
    });

  if (payload.devices && payload.devices.length > CUTOVER_MAX_DEVICES)
    throw invalidArchive(`The archive contains more than ${CUTOVER_MAX_DEVICES} devices`);

  return { envelope, manifest: envelope.manifest, payload };
};

/**
 * Stable deployment identity.
 *
 * An explicit value wins. Otherwise the identifier is derived from the
 * deployment's canonical origin. The origin is the identity devices and
 * operators actually use, and `AUTH_SECRET` is deliberately not an input:
 * publishing a hash of the deployment's master secret would give anyone who
 * holds an archive an offline verifier for it.
 *
 * A same-hostname move therefore shares a deployment id (the archive is still
 * passphrase-protected and the import is an explicit operator action); a move to
 * a different hostname produces a different id and requires an explicit
 * cross-deployment acknowledgement.
 */
export const deriveDeploymentId = async (input: {
  readonly configured?: string | null;
  readonly origin: string;
}): Promise<string> => {
  const configured = input.configured?.trim();

  if (configured) return configured.slice(0, 128);

  return `dp_${await sha256Text(`mattrax.deployment.v1\u0000${normalizeOrigin(input.origin)}`)}`;
};

/** Canonical origin: scheme + host, no trailing slash, lower-case host. */
export const normalizeOrigin = (origin: string): string => {
  try {
    return new URL(origin).origin;
  } catch {
    return origin.trim().replace(/\/+$/, "");
  }
};

/** Hostname used for origin-bound checks (WebAuthn RP, profile URLs). */
export const originHostname = (origin: string): string => {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return origin.trim().toLowerCase();
  }
};

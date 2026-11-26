import { Schema } from "effect";
import { certificateDer, certificateCommonName, certificateNotAfter, loadPkijs } from "@mattrax/scep";
import { sealSecret, openSecret } from "@mattrax/crypto";
import {
  CertificateMaterialUpload,
  PkcsCertificateConfiguration,
  PfxCertificateConfiguration,
  parseCertificateConfigurationKind,
} from "@mattrax/enterprise-domain";

/**
 * Certificate material extraction and at-rest handling.
 *
 * A PFX and its password are secret. They are never stored in a policy
 * configuration (which is returned by the API, snapshotted for rollback and
 * exported in tenant bundles). Instead the upload is validated, the public
 * leaf metadata is folded into the configuration, and the secret bytes are
 * sealed with AES-256-GCM under `AUTH_SECRET` in `policy_certificate_material`.
 */

/** A PFX larger than this is refused; Windows CSP blobs are far smaller. */
export const MAX_PFX_BYTES = 5 * 1024 * 1024;

export const MAX_PFX_PASSWORD_LENGTH = 1024;

export const MAX_CERTIFICATE_PEM_LENGTH = 256 * 1024;

/** Sealed material as stored in `policy_certificate_material`. */
export type PolicyCertificateMaterialRow = {
  readonly sealedPfx: string;
  readonly sealedPassword: string;
  readonly fileName: string | null;
  readonly certificatePem: string;
  readonly subject: string;
  readonly notAfter: Date;
  readonly fingerprintSha256: string;
  readonly materialSha256: string;
};

/** Opened material, ready to build a device payload. */
export type PolicyCertificateMaterial = {
  readonly pfx: Uint8Array;
  readonly password: string;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
};

export const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value.replaceAll(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);

  return bytes;
};

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));

export type Pkcs12Certificate = {
  readonly certificatePem: string;
  readonly subject: string;
  readonly notAfter: string;
  readonly fingerprintSha256: string;
};

const certificatePemFromDer = (der: Uint8Array): string => {
  let binary = "";

  for (const byte of der) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  const lines = base64.match(/.{1,64}/g) ?? [];

  return `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`;
};

/**
 * Parse a PKCS#12 and prove the supplied leaf certificate belongs to it.
 *
 * The password is verified by the PFX MAC (when one exists) and by decrypting
 * every privacy safe; a wrong password, junk bytes or a tampered file all fail
 * here. Only after that do we trust the leaf certificate, so policy metadata
 * always comes from the PFX rather than from client-supplied fields.
 */
export const inspectPkcs12 = async (input: {
  readonly pfx: Uint8Array;
  readonly password: string;
}): Promise<
  | { readonly ok: true; readonly certificates: ReadonlyArray<Pkcs12Certificate> }
  | { readonly ok: false; readonly message: string }
> => {
  let pkijs: Awaited<ReturnType<typeof loadPkijs>>;

  try {
    pkijs = await loadPkijs();
  } catch {
    return { ok: false, message: "PKCS#12 support is unavailable on this deployment" };
  }

  let parsed: InstanceType<typeof pkijs.PFX>;

  try {
    const buffer = input.pfx.buffer.slice(
      input.pfx.byteOffset,
      input.pfx.byteOffset + input.pfx.byteLength,
    ) as ArrayBuffer;

    parsed = pkijs.PFX.fromBER(buffer);
  } catch {
    return { ok: false, message: "The PFX is not a valid PKCS#12 file" };
  }

  const password = new TextEncoder().encode(input.password).buffer as ArrayBuffer;

  try {
    await parsed.parseInternalValues({
      password,
      checkIntegrity: parsed.macData !== undefined,
    });
  } catch {
    return {
      ok: false,
      message: "The PFX password is wrong or the PKCS#12 integrity check failed",
    };
  }

  const authenticatedSafe = parsed.parsedValue?.authenticatedSafe;

  if (!authenticatedSafe) return { ok: false, message: "The PFX has no authenticated safe" };

  try {
    await authenticatedSafe.parseInternalValues({
      safeContents: authenticatedSafe.safeContents.map((content) =>
        content.contentType === "1.2.840.113549.1.7.6" ? { password } : {},
      ),
    });
  } catch {
    return {
      ok: false,
      message:
        "The PFX could not be decrypted. Only password-protected PKCS#12 files are supported.",
    };
  }

  const encryptedSafe = authenticatedSafe.safeContents.some(
    (content) => content.contentType === "1.2.840.113549.1.7.6",
  );
  const hasIntegrity =
    parsed.macData !== undefined || parsed.parsedValue?.integrityMode === 1 || encryptedSafe;

  if (!hasIntegrity)
    return {
      ok: false,
      message:
        "The PFX has no MAC, signature or encrypted safe, so its password cannot be verified",
    };

  const certificates: Pkcs12Certificate[] = [];
  const seen = new Set<string>();
  let hasPrivateKey = false;

  for (const safe of authenticatedSafe.parsedValue?.safeContents ?? []) {
    for (const bag of safe.value.safeBags) {
      // KeyBag and PKCS#8 ShroudedKeyBag are the two private-key bag types.
      if (
        bag.bagId === "1.2.840.113549.1.12.10.1.1" ||
        bag.bagId === "1.2.840.113549.1.12.10.1.2"
      )
        hasPrivateKey = true;

      if (!(bag.bagValue instanceof pkijs.CertBag)) continue;
      const certificate = bag.bagValue.parsedValue;

      if (!(certificate instanceof pkijs.Certificate)) continue;

      const der = new Uint8Array(certificate.toSchema().toBER(false));
      const fingerprintSha256 = await sha256Hex(der);

      if (seen.has(fingerprintSha256)) continue;
      seen.add(fingerprintSha256);

      const commonName = await certificateCommonName(
        certificatePemFromDer(der),
      );
      const subject = certificate.subject.typesAndValues
        .map((attribute) => `${attribute.type}=${String(attribute.value.valueBlock.value ?? "")}`)
        .join(", ");

      certificates.push({
        certificatePem: certificatePemFromDer(der),
        subject: commonName ?? (subject || "Certificate"),
        notAfter: certificate.notAfter.value.toISOString(),
        fingerprintSha256,
      });
    }
  }

  if (certificates.length === 0)
    return { ok: false, message: "The PFX does not contain an X.509 certificate" };

  if (!hasPrivateKey)
    return {
      ok: false,
      message: "The PFX contains certificates but no private key; an identity is required",
    };

  return { ok: true, certificates };
};

/** Normalise a PEM certificate and reject anything without exactly one. */
export const normalizePemCertificate = (pem: string): string | null => {
  const trimmed = pem.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_CERTIFICATE_PEM_LENGTH) return null;
  const begins = trimmed.match(/-----BEGIN CERTIFICATE-----/g)?.length ?? 0;
  const ends = trimmed.match(/-----END CERTIFICATE-----/g)?.length ?? 0;

  if (begins !== 1 || ends !== 1) return null;

  return `${trimmed}\n`;
};

export type CertificatePemMetadata = {
  readonly certificatePem: string;
  readonly subject: string;
  readonly notAfter: string;
  readonly fingerprintSha256: string;
  readonly materialSha256: string;
};

/** Public metadata extracted from the leaf certificate of an uploaded PFX. */
export const certificatePemMetadata = async (
  input: { readonly certificatePem: string; readonly material: Uint8Array },
): Promise<CertificatePemMetadata | null> => {
  const certificatePem = normalizePemCertificate(input.certificatePem);

  if (!certificatePem) return null;

  let der: Uint8Array;

  try {
    der = certificateDer(certificatePem);
  } catch {
    return null;
  }

  const subject = await certificateCommonName(certificatePem);
  const notAfter = await certificateNotAfter(certificatePem);

  if (!Number.isFinite(notAfter.getTime())) return null;

  return {
    certificatePem,
    subject: subject ?? "Certificate",
    notAfter: notAfter.toISOString(),
    fingerprintSha256: await sha256Hex(der),
    materialSha256: await sha256Hex(input.material),
  };
};

/** Sealed public+secret representation produced while saving a policy. */
export type PreparedCertificateMaterial = PolicyCertificateMaterialRow & {
  readonly kind: string;
  readonly policyId: string;
  readonly organizationId: string;
};

export type PrepareCertificateConfigurationResult =
  | {
      readonly ok: true;
      /** Sanitised configuration safe to store and return through the API. */
      readonly data: Schema.Json;
      /** Null when the stored material is unchanged. */
      readonly material: Omit<
        PreparedCertificateMaterial,
        "kind" | "policyId" | "organizationId"
      > | null;
    }
  | { readonly ok: false; readonly message: string };

const stringField = (record: Schema.JsonObject, key: string): string | null =>
  Schema.is(Schema.String)(record[key]) ? record[key].trim() : null;

const numberField = (record: Schema.JsonObject, key: string): number | undefined =>
  Schema.is(Schema.Number)(record[key]) && Number.isFinite(record[key]) ? record[key] : undefined;

const booleanField = (record: Schema.JsonObject, key: string): boolean | undefined =>
  Schema.is(Schema.Boolean)(record[key]) ? record[key] : undefined;

const keyLocationField = (record: Schema.JsonObject) => {
  const value = record.keyLocation;

  if (value === undefined) return undefined;

  return value === "tpm-required" ||
    value === "tpm-preferred" ||
    value === "software" ||
    value === "windows-hello"
    ? value
    : undefined;
};

/**
 * Split a certificate configuration into public metadata and sealed material.
 *
 * On an update without a new PFX the stored material is kept. The caller must
 * verify that material actually exists before accepting such an update; this
 * function only makes clear that nothing new was uploaded.
 */
export const prepareCertificateConfiguration = async (input: {
  readonly kind: string;
  readonly data: Schema.Json;
  readonly authSecret: string;
}): Promise<PrepareCertificateConfigurationResult> => {
  const parsed = parseCertificateConfigurationKind(input.kind);

  if (!parsed || parsed.type === "trusted-root") return { ok: true, data: input.data, material: null };

  if (!Schema.is(Schema.JsonObject)(input.data))
    return { ok: false, message: `"${input.kind}" must be an object` };

  const record = input.data;
  const pfx = record.pfx;

  if (pfx !== undefined && (!Schema.is(Schema.String)(pfx) || pfx.length === 0))
    return { ok: false, message: `"${input.kind}.pfx" must be a base64 string` };

  const upload =
    Schema.is(Schema.String)(pfx) && pfx.length > 0
      ? (() => {
          const decoded = Schema.decodeUnknownOption(CertificateMaterialUpload)({
            pfx,
            password: record.password,
            certificatePem: record.certificatePem,
            fileName: record.fileName,
          });

          return decoded;
        })()
      : null;

  if (upload && upload._tag === "None")
    return {
      ok: false,
      message: `"${input.kind}" requires pfx, password (optional) and the leaf certificatePem`,
    };
  const uploaded = upload?._tag === "Some" ? upload.value : null;

  let material: Omit<PreparedCertificateMaterial, "kind" | "policyId" | "organizationId"> | null =
    null;
  let metadata: CertificatePemMetadata;

  if (uploaded) {
    let bytes: Uint8Array;

    try {
      bytes = base64ToBytes(uploaded.pfx);

      if (bytes.byteLength === 0) throw new Error("empty");
    } catch {
      return { ok: false, message: `"${input.kind}.pfx" is not valid base64` };
    }

    if (bytes.byteLength > MAX_PFX_BYTES)
      return {
        ok: false,
        message: `"${input.kind}.pfx" is larger than ${MAX_PFX_BYTES} bytes`,
      };

    const password = uploaded.password ?? "";

    if (password.length > MAX_PFX_PASSWORD_LENGTH)
      return { ok: false, message: `"${input.kind}.password" is too long` };

    const inspected = await inspectPkcs12({ pfx: bytes, password });

    if (!inspected.ok) return { ok: false, message: `"${input.kind}.pfx": ${inspected.message}` };

    const suppliedPem = normalizePemCertificate(uploaded.certificatePem);

    if (!suppliedPem)
      return {
        ok: false,
        message: `"${input.kind}.certificatePem" must be a PEM certificate`,
      };

    let suppliedDer: Uint8Array;

    try {
      suppliedDer = certificateDer(suppliedPem);
    } catch {
      return {
        ok: false,
        message: `"${input.kind}.certificatePem" must be a PEM certificate`,
      };
    }

    const suppliedFingerprint = await sha256Hex(suppliedDer);
    const leaf = inspected.certificates.find(
      (certificate) => certificate.fingerprintSha256 === suppliedFingerprint,
    );

    if (!leaf)
      return {
        ok: false,
        message: `"${input.kind}.certificatePem" is not a certificate inside the PFX`,
      };

    metadata = { ...leaf, materialSha256: await sha256Hex(bytes) };
    material = {
      sealedPfx: await sealSecret(input.authSecret, bytesToBase64(bytes)),
      sealedPassword: await sealSecret(input.authSecret, password),
      fileName: uploaded.fileName?.trim() || null,
      certificatePem: leaf.certificatePem,
      subject: leaf.subject,
      notAfter: new Date(leaf.notAfter),
      fingerprintSha256: leaf.fingerprintSha256,
      materialSha256: metadata.materialSha256,
    };
  } else {
    // An update keeps the stored material, but the client must still send the
    // public metadata it loaded so the configuration hash stays meaningful.
    const certificatePem = stringField(record, "certificatePem");
    const subject = stringField(record, "subject");
    const notAfter = stringField(record, "notAfter");
    const fingerprintSha256 = stringField(record, "fingerprintSha256");
    const materialSha256 = stringField(record, "materialSha256");

    if (!certificatePem || !subject || !notAfter || !fingerprintSha256 || !materialSha256)
      return {
        ok: false,
        message: `"${input.kind}" requires a PFX upload (pfx, password and certificatePem) the first time it is saved`,
      };

    const normalized = normalizePemCertificate(certificatePem);

    if (!normalized)
      return { ok: false, message: `"${input.kind}.certificatePem" is not a PEM certificate` };
    metadata = {
      certificatePem: normalized,
      subject,
      notAfter,
      fingerprintSha256,
      materialSha256,
    };
  }

  const channel = record.channel === "user" ? "user" : "device";

  const common = {
    certificatePem: metadata.certificatePem,
    subject: metadata.subject,
    notAfter: metadata.notAfter,
    fingerprintSha256: metadata.fingerprintSha256,
    materialSha256: metadata.materialSha256,
    fileName: material?.fileName ?? (stringField(record, "fileName") ?? undefined),
    channel,
    ...(keyLocationField(record) ? { keyLocation: keyLocationField(record) } : {}),
    ...(booleanField(record, "exportable") !== undefined
      ? { exportable: booleanField(record, "exportable") }
      : {}),
  };

  if (parsed.type === "pfx") {
    const decoded = Schema.decodeUnknownOption(PfxCertificateConfiguration)(common);

    if (decoded._tag === "None")
      return { ok: false, message: `"${input.kind}" has invalid certificate metadata` };

    return { ok: true, data: decoded.value, material };
  }

  const ca = Schema.is(Schema.JsonObject)(record.ca) ? record.ca : {};
  const extendedKeyUsage = Array.isArray(record.extendedKeyUsage)
    ? record.extendedKeyUsage.filter((value): value is string => Schema.is(Schema.String)(value))
    : undefined;

  const data = {
    ...common,
    ca: {
      ...(stringField(ca, "name") ? { name: stringField(ca, "name") } : {}),
      ...(stringField(ca, "serverUrl") ? { serverUrl: stringField(ca, "serverUrl") } : {}),
      ...(stringField(ca, "fingerprintSha256")
        ? { fingerprintSha256: stringField(ca, "fingerprintSha256") }
        : {}),
    },
    template: stringField(record, "template") ?? "",
    subjectNameFormat: stringField(record, "subjectNameFormat") ?? "",
    keyUsage: stringField(record, "keyUsage") ?? "",
    ...(extendedKeyUsage && extendedKeyUsage.length > 0 ? { extendedKeyUsage } : {}),
    ...(numberField(record, "validityDays") !== undefined
      ? { validityDays: numberField(record, "validityDays") }
      : {}),
    ...(numberField(record, "renewalThresholdPercent") !== undefined
      ? { renewalThresholdPercent: numberField(record, "renewalThresholdPercent") }
      : {}),
  };
  const decoded = Schema.decodeUnknownOption(PkcsCertificateConfiguration)(data);

  if (decoded._tag === "None")
    return { ok: false, message: `"${input.kind}" has invalid PKCS metadata` };

  return { ok: true, data: decoded.value, material };
};

/** Open sealed material for delivery. Throws when AUTH_SECRET changed. */
export const openPolicyCertificateMaterial = async (
  authSecret: string,
  row: Pick<PolicyCertificateMaterialRow, "sealedPfx" | "sealedPassword">,
): Promise<PolicyCertificateMaterial> => {
  const pfx = base64ToBytes(await openSecret(authSecret, row.sealedPfx));

  return {
    pfx,
    password: await openSecret(authSecret, row.sealedPassword),
  };
};

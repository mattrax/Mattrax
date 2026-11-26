import { Schema } from "effect";

/**
 * Certificate profile model shared by Apple, Windows and Android delivery.
 *
 * Four kinds of certificate configuration exist:
 *
 * - **Trusted root** installs a CA certificate the device should trust. It is
 *   the prerequisite for every issued certificate, including SCEP.
 * - **PKCS** describes how an enterprise CA issued a certificate (CA,
 *   template, subject format, key usage and renewal). Mattrax cannot talk to
 *   an enterprise CA or NDES by itself, so the issued PKCS#12 is supplied by
 *   the operator and sealed at rest. The profile keeps the issuance metadata
 *   so renewal is visible and the payload is correct.
 * - **PFX** imports a password-protected PKCS#12 directly, for shared Wi-Fi,
 *   VPN or S/MIME identities and for per-user delivery.
 * - **Mail** is an Apple mail account which can reference a PKCS/PFX identity
 *   for S/MIME signing and encryption.
 *
 * Android's Management API has no client-certificate or PKCS issuance
 * mechanism. `mttx.android.pkcs.<id>` and `mttx.android.pfx.<id>` are
 * therefore rejected at validation with an explanation instead of being
 * stored and silently ignored. A trusted root is supported as an ONC
 * certificate (a user-installed CA, not a system root).
 */

export const CERTIFICATE_PROFILE_PLATFORMS = ["apple", "windows", "android"] as const;

export const CertificateProfilePlatform = Schema.Literals(CERTIFICATE_PROFILE_PLATFORMS);

export type CertificateProfilePlatform = typeof CertificateProfilePlatform.Type;

export const CERTIFICATE_PROFILE_TYPES = ["trusted-root", "pkcs", "pfx"] as const;

export const CertificateProfileType = Schema.Literals(CERTIFICATE_PROFILE_TYPES);

export type CertificateProfileType = typeof CertificateProfileType.Type;

export type CertificateConfigurationKind = {
  readonly platform: CertificateProfilePlatform;
  readonly type: CertificateProfileType;
  /** Identifier suffix after the last dot. */
  readonly id: string;
  readonly kind: string;
};

const KIND_ID = "[A-Za-z0-9]{1,20}";

const MATCHERS: ReadonlyArray<{
  readonly pattern: RegExp;
  readonly platform: CertificateProfilePlatform;
  readonly type: CertificateProfileType;
}> = [
  { pattern: new RegExp(`^mttx\\.apple\\.certificate\\.(${KIND_ID})$`), platform: "apple", type: "trusted-root" },
  { pattern: new RegExp(`^mttx\\.apple\\.pkcs\\.(${KIND_ID})$`), platform: "apple", type: "pkcs" },
  { pattern: new RegExp(`^mttx\\.apple\\.pfx\\.(${KIND_ID})$`), platform: "apple", type: "pfx" },
  { pattern: new RegExp(`^mttx\\.windows\\.certificate\\.(${KIND_ID})$`), platform: "windows", type: "trusted-root" },
  { pattern: new RegExp(`^mttx\\.windows\\.pkcs\\.(${KIND_ID})$`), platform: "windows", type: "pkcs" },
  { pattern: new RegExp(`^mttx\\.windows\\.pfx\\.(${KIND_ID})$`), platform: "windows", type: "pfx" },
  { pattern: new RegExp(`^mttx\\.android\\.certificate\\.(${KIND_ID})$`), platform: "android", type: "trusted-root" },
  { pattern: new RegExp(`^mttx\\.android\\.pkcs\\.(${KIND_ID})$`), platform: "android", type: "pkcs" },
  { pattern: new RegExp(`^mttx\\.android\\.pfx\\.(${KIND_ID})$`), platform: "android", type: "pfx" },
];

/** Parse a certificate configuration kind, or null when it is not one. */
export const parseCertificateConfigurationKind = (
  kind: string,
): CertificateConfigurationKind | null => {
  for (const matcher of MATCHERS) {
    const match = matcher.pattern.exec(kind);

    if (!match?.[1]) continue;

    return { platform: matcher.platform, type: matcher.type, id: match[1], kind };
  }

  return null;
};

/** Whether a kind is a trusted-root certificate profile. */
export const isTrustedRootKind = (kind: string): boolean =>
  parseCertificateConfigurationKind(kind)?.type === "trusted-root";

/** Whether a kind is an issued/imported identity (PKCS or PFX). */
export const isIdentityCertificateKind = (kind: string): boolean => {
  const parsed = parseCertificateConfigurationKind(kind);

  return parsed !== null && parsed.type !== "trusted-root";
};

export type CertificateKindSupport = {
  readonly supported: boolean;
  readonly reason: string | null;
};

/** Whether a certificate kind is supported on its platform at all. */
export const certificateKindPlatformSupport = (kind: string): CertificateKindSupport => {
  const parsed = parseCertificateConfigurationKind(kind);

  if (!parsed) return { supported: true, reason: null };

  if (parsed.platform === "android" && parsed.type !== "trusted-root")
    return {
      supported: false,
      reason:
        "The Android Management API cannot install client certificates or issue PKCS certificates. Use Apple or Windows for PKCS/PFX, or configure Android Wi-Fi/VPN trust with a trusted root certificate.",
    };

  return { supported: true, reason: null };
};

/** Certificate identity material supplied by an operator. */
export const CertificateMaterialUpload = Schema.Struct({
  /** Base64-encoded PKCS#12 (PFX) bytes. */
  pfx: Schema.String,
  /** Password protecting the PFX. Empty when it is not password protected. */
  password: Schema.optional(Schema.String),
  /** PEM of the leaf certificate inside the PFX, for expiry and inventory. */
  certificatePem: Schema.String,
  fileName: Schema.optional(Schema.String),
});

export type CertificateMaterialUpload = typeof CertificateMaterialUpload.Type;

/** Public (non-secret) certificate metadata stored with the configuration. */
export const CertificateMetadata = Schema.Struct({
  /** PEM of the leaf certificate. Public by design. */
  certificatePem: Schema.String,
  /** Human-readable subject summary. */
  subject: Schema.String,
  /** ISO-8601 expiry of the leaf certificate. */
  notAfter: Schema.String,
  /** Lowercase hex SHA-256 of the leaf certificate DER. */
  fingerprintSha256: Schema.String,
  /** Lowercase hex SHA-256 of the sealed PFX bytes, so edits change the hash. */
  materialSha256: Schema.String,
  fileName: Schema.optional(Schema.String),
});

export type CertificateMetadata = typeof CertificateMetadata.Type;

/** Windows key storage provider choice; values match the CSP's KeyLocation. */
export const CERTIFICATE_KEY_LOCATIONS = [
  "tpm-required",
  "tpm-preferred",
  "software",
  "windows-hello",
] as const;

export const CertificateKeyLocation = Schema.Literals(CERTIFICATE_KEY_LOCATIONS);

export type CertificateKeyLocation = typeof CertificateKeyLocation.Type;

/** The CSP integer for a key location. */
export const certificateKeyLocationValue = (location: CertificateKeyLocation): number => {
  switch (location) {
    case "tpm-required":
      return 1;
    case "tpm-preferred":
      return 2;
    case "software":
      return 3;
    case "windows-hello":
      return 4;
  }
};

/** pfx and pkcs certificates share the same material metadata. */
export const PfxCertificateConfiguration = Schema.Struct({
  ...CertificateMetadata.fields,
  /** Derived from the policy scope by the server, never trusted from a client. */
  channel: Schema.Literals(["device", "user"]),
  keyLocation: Schema.optional(CertificateKeyLocation),
  exportable: Schema.optional(Schema.Boolean),
});

export type PfxCertificateConfiguration = typeof PfxCertificateConfiguration.Type;

/** A PKCS profile adds the enterprise CA issuance request to a PFX identity. */
export const PkcsCertificateConfiguration = Schema.Struct({
  ...PfxCertificateConfiguration.fields,
  ca: Schema.Struct({
    /** Fully qualified name of the enterprise CA, for operators and audit. */
    name: Schema.optional(Schema.String),
    /** NDES or certificate connector URL, when one exists. */
    serverUrl: Schema.optional(Schema.String),
    /** Root/intermediate CA certificate thumbprint, when known. */
    fingerprintSha256: Schema.optional(Schema.String),
  }),
  template: Schema.String,
  /** For example `CN={{device.name}}` or `CN={{user.email}}`. */
  subjectNameFormat: Schema.String,
  /** Comma or plus separated key usage names or OIDs. */
  keyUsage: Schema.String,
  extendedKeyUsage: Schema.optional(Schema.Array(Schema.String)),
  /** Requested validity, in days. */
  validityDays: Schema.optional(Schema.Finite),
  /** Renewal starts when this percentage of the validity has elapsed. */
  renewalThresholdPercent: Schema.optional(Schema.Finite),
});

export type PkcsCertificateConfiguration = typeof PkcsCertificateConfiguration.Type;

/** Apple Mail account with optional S/MIME identity references. */
export const AppleMailServerAuthentication = Schema.Literals([
  "None",
  "Password",
  "CRAMMD5",
  "NTLM",
  "HTTPMD5",
]);

export type AppleMailServerAuthentication = typeof AppleMailServerAuthentication.Type;

export const AppleMailServer = Schema.Struct({
  hostName: Schema.String,
  port: Schema.optional(Schema.Finite),
  authenticationMethod: AppleMailServerAuthentication,
  /**
   * A username may be supplied, but never a password: mail passwords in policy
   * JSON would be returned by the API and copied into snapshots/exports. Use
   * SSO, a credentials asset (not implemented), or a custom profile.
   */
  username: Schema.optional(Schema.String),
});

export type AppleMailServer = typeof AppleMailServer.Type;

export const AppleMailSmimeDirection = Schema.Struct({
  enabled: Schema.Boolean,
  /** Certificate kind in the same policy, for example `mttx.apple.pfx.smime`. */
  certificateKind: Schema.optional(Schema.String),
  userOverrideable: Schema.optional(Schema.Boolean),
  identityUserOverrideable: Schema.optional(Schema.Boolean),
});

export type AppleMailSmimeDirection = typeof AppleMailSmimeDirection.Type;

export const AppleMailConfiguration = Schema.Struct({
  visibleName: Schema.optional(Schema.String),
  emailAddress: Schema.optional(Schema.String),
  incoming: Schema.Struct({
    serverType: Schema.Literals(["IMAP", "POP"]),
    ...AppleMailServer.fields,
  }),
  outgoing: AppleMailServer,
  smime: Schema.optional(
    Schema.Struct({
      signing: Schema.optional(AppleMailSmimeDirection),
      encryption: Schema.optional(
        Schema.Struct({
          ...AppleMailSmimeDirection.fields,
          encryptByDefault: Schema.optional(Schema.Boolean),
          perMessageSwitchEnabled: Schema.optional(Schema.Boolean),
        }),
      ),
    }),
  ),
});

export type AppleMailConfiguration = typeof AppleMailConfiguration.Type;

/** File extensions accepted by the upload controls. */
export const PFX_FILE_EXTENSION = ".pfx";
export const PEM_CERTIFICATE_EXTENSIONS = ".pem,.crt,.cer";

/**
 * Describe the certificate profile mechanism for UI copy and documentation.
 * This table is the single place that says what each platform actually does.
 */
export type CertificatePlatformCapability = {
  readonly platform: CertificateProfilePlatform;
  readonly trustedRoot: string;
  readonly pkcs: string;
  readonly pfx: string;
  readonly limitation: string;
};

export const CERTIFICATE_PLATFORM_CAPABILITIES: Readonly<
  Record<CertificateProfilePlatform, CertificatePlatformCapability>
> = {
  apple: {
    platform: "apple",
    trustedRoot:
      "Installed as a DDM credential asset plus security.certificate declaration (macOS 14/iOS 17+), or a com.apple.security.pkcs1 profile on legacy devices.",
    pkcs: "Delivered as a DDM identity asset and security.identity declaration (macOS 14/iOS 17+), or a com.apple.security.pkcs12 profile on legacy devices. The PKCS#12 must be issued by the enterprise CA connector.",
    pfx: "Delivered as a DDM identity asset (macOS 14/iOS 17+), or a com.apple.security.pkcs12 profile on legacy devices.",
    limitation:
      "Apple has no on-device PKCS/NDES client. Mattrax cannot call an enterprise CA or issue a unique certificate per device; the operator supplies the issued PKCS#12.",
  },
  windows: {
    platform: "windows",
    trustedRoot:
      "Installed through the RootCATrustedCertificates CSP (Root or CA store) on the next SyncML check-in.",
    pkcs: "Installed through the ClientCertificateInstall PFXCertInstall CSP. Windows has no native PKCS/NDES client in OMA-DM, so the certificate is issued externally and delivered as PKCS#12.",
    pfx: "Installed through the ClientCertificateInstall PFXCertInstall CSP with the protected PKCS#12 blob and password.",
    limitation:
      "PFX nodes are not atomic in Mattrax's OMA-DM command pipeline, so a device may observe a partial install and retry; the CSP installs the blob last.",
  },
  android: {
    platform: "android",
    trustedRoot:
      "Added to the policy's Open Network Configuration Certificates array as a user-installed CA (Type Authority, TrustBits Web).",
    pkcs: "Not supported by the Android Management API.",
    pfx: "Not supported by the Android Management API.",
    limitation:
      "Android has no AMAPI client-certificate or PKCS issuance API, and the ONC CA is a user CA: apps must opt into trusting user-installed CAs. System-root installation and per-device issuance are not available.",
  },
};

/**
 * Whether the certificate has reached its renewal window.
 *
 * `issuedAt` is not stored, so the window is measured back from expiry using
 * the configured validity. A profile without a validity (an imported PFX) uses
 * the default threshold only for display; Mattrax cannot renew it.
 */
export const certificateRenewalDueAt = (
  notAfter: string | Date,
  options: {
    readonly validityDays?: number | null;
    readonly renewalThresholdPercent?: number | null;
  } = {},
): Date | null => {
  const expiry = notAfter instanceof Date ? notAfter : new Date(notAfter);

  if (!Number.isFinite(expiry.getTime())) return null;
  const percent = Math.min(Math.max(options.renewalThresholdPercent ?? 20, 1), 90);
  const validityDays = options.validityDays ?? 365;

  if (!Number.isFinite(validityDays) || validityDays <= 0) return null;

  return new Date(expiry.getTime() - (validityDays * percent * 24 * 60 * 60 * 1000) / 100);
};

import { Option, Schema } from "effect";
import { certificateDer } from "@mattrax/scep";
import {
  APPLE_LOCK_SCREEN_MESSAGE_CONFIGURATION_KIND,
  PkcsCertificateConfiguration,
  PfxCertificateConfiguration,
  WINDOWS_LAPS_CONFIGURATION_KIND,
  certificateKeyLocationValue,
  parseCertificateConfigurationKind,
  parseWindowsLapsPolicy,
  windowsLapsPolicyNodes,
} from "@mattrax/enterprise-domain";
import type { PolicyCertificateMaterial } from "./certificateProfiles.js";

export type PolicyConfigurationRow = {
  readonly policyId: string;
  readonly kind: string;
  readonly data: Schema.Json | undefined;
  /** Content hash stored with the configuration row. */
  readonly hash: string;
  /** Owning tenant. Optional for older call sites. */
  readonly organizationId?: string;
};

export type ConfigurationKind =
  | { readonly type: "device" }
  | { readonly type: "custom"; readonly id: string }
  /** Apple trusted root: the historical `mttx.apple.certificate.<id>` kind. */
  | { readonly type: "certificate"; readonly id: string }
  | {
      readonly type: "pkcs";
      readonly platform: "apple" | "windows" | "android";
      readonly id: string;
    }
  | {
      readonly type: "pfx";
      readonly platform: "apple" | "windows" | "android";
      readonly id: string;
    }
  | { readonly type: "windowsCertificate"; readonly id: string }
  | { readonly type: "androidCertificate"; readonly id: string }
  | { readonly type: "appleMail"; readonly id: string }
  | { readonly type: "declaration"; readonly id: string }
  | { readonly type: "application"; readonly id: string }
  | { readonly type: "windows"; readonly id: string }
  | { readonly type: "windows-laps" }
  | { readonly type: "android"; readonly id: string }
  | { readonly type: "lockScreenMessage" }
  | { readonly type: "unknown" };

const IDENTIFIER_PATTERN = /^[A-Za-z0-9]{1,20}$/;

export const parseConfigurationKind = (kind: string): ConfigurationKind => {
  if (kind === "mttx.apple.device") return { type: "device" };
  if (kind === APPLE_LOCK_SCREEN_MESSAGE_CONFIGURATION_KIND) return { type: "lockScreenMessage" };

  const android = /^mttx\.android\.policy\.(.+)$/.exec(kind);

  if (android?.[1] && IDENTIFIER_PATTERN.test(android[1]))
    return { type: "android", id: android[1] };

  const windows = /^mttx\.windows\.custom\.(.+)$/.exec(kind);

  if (windows?.[1] && IDENTIFIER_PATTERN.test(windows[1]))
    return { type: "windows", id: windows[1] };
  if (kind === WINDOWS_LAPS_CONFIGURATION_KIND) return { type: "windows-laps" };

  // Certificate profiles share a parsed family across three platforms. Apple's
  // historical trusted-root kind keeps its name for compatibility.
  const certificate = parseCertificateConfigurationKind(kind);

  if (certificate) {
    if (certificate.type === "trusted-root")
      switch (certificate.platform) {
        case "apple":
          return { type: "certificate", id: certificate.id };
        case "windows":
          return { type: "windowsCertificate", id: certificate.id };
        case "android":
          return { type: "androidCertificate", id: certificate.id };
      }

    return {
      type: certificate.type === "pkcs" ? "pkcs" : "pfx",
      platform: certificate.platform,
      id: certificate.id,
    };
  }

  const mail = /^mttx\.apple\.mail\.(.+)$/.exec(kind);

  if (mail?.[1] && IDENTIFIER_PATTERN.test(mail[1]))
    return { type: "appleMail", id: mail[1] };
  const match = /^mttx\.apple\.(custom|declaration|application)\.(.+)$/.exec(kind);

  if (!match) return { type: "unknown" };
  const [, group, id] = match;

  if (!IDENTIFIER_PATTERN.test(id)) return { type: "unknown" };

  switch (group) {
    case "custom":
      return { type: "custom", id };
    case "certificate":
      return { type: "certificate", id };
    case "declaration":
      return { type: "declaration", id };
    case "application":
      return { type: "application", id };
    default:
      return { type: "unknown" };
  }
};

export const isLegacyKind = (kind: string): boolean => {
  const parsed = parseConfigurationKind(kind);

  return parsed.type === "device" || parsed.type === "custom";
};

export const isCertificateKind = (kind: string): boolean => {
  const parsed = parseConfigurationKind(kind);

  return (
    parsed.type === "certificate" ||
    parsed.type === "windowsCertificate" ||
    parsed.type === "androidCertificate" ||
    parsed.type === "pkcs" ||
    parsed.type === "pfx"
  );
};

/** An Apple PKCS/PFX identity (not a trusted root). */
export const isAppleIdentityCertificateKind = (kind: string): boolean => {
  const parsed = parseConfigurationKind(kind);

  return parsed.type === "pkcs" || parsed.type === "pfx" ? parsed.platform === "apple" : false;
};

/** Certificate profiles that Apple delivers as a DDM identity or profile. */
export const isAppleCertificateKind = (kind: string): boolean => {
  const parsed = parseConfigurationKind(kind);

  return (
    parsed.type === "certificate" ||
    (parsed.type === "pkcs" && parsed.platform === "apple") ||
    (parsed.type === "pfx" && parsed.platform === "apple")
  );
};

export const isAppleMailKind = (kind: string): boolean =>
  parseConfigurationKind(kind).type === "appleMail";

/** Whether a configuration kind is delivered by the Apple path. */
export const isAppleConfigurationKind = (kind: string): boolean => {
  const parsed = parseConfigurationKind(kind);

  switch (parsed.type) {
    case "device":
    case "custom":
    case "certificate":
    case "declaration":
    case "application":
    case "lockScreenMessage":
    case "appleMail":
      return true;
    case "pkcs":
    case "pfx":
      return parsed.platform === "apple";
    default:
      return false;
  }
};

export const isApplicationKind = (kind: string): boolean =>
  parseConfigurationKind(kind).type === "application";

export const CATALOGUE_APPLICATION_ASSET_KIND = "catalogue-application";

export const catalogueApplicationAssetIdentifier = (applicationId: string): string =>
  `app.${applicationId}`;

export const parseCatalogueApplicationAssetIdentifier = (identifier: string): string | null =>
  identifier.startsWith("app.") && identifier.length > 4 ? identifier.slice(4) : null;

export const configurationDeclarationIdentifier = (policyId: string, kind: string): string =>
  `${policyId}:${kind}`;

export const splitConfigurationDeclarationIdentifier = (identifier: string) => {
  const [policyId, ...rest] = identifier.split(":");

  return { policyId: policyId ?? "", kind: rest.join(":") };
};

export const configurationAssetIdentifier = (policyId: string, kind: string): string =>
  `${policyId}.${kind}.asset`;

export const splitConfigurationAssetIdentifier = (
  identifier: string,
): { policyId: string; kind: string } | null => {
  const withoutSuffix = identifier.endsWith(".asset")
    ? identifier.slice(0, -".asset".length)
    : identifier;
  const separator = withoutSuffix.indexOf(".");

  if (separator <= 0) return null;

  return {
    policyId: withoutSuffix.slice(0, separator),
    kind: withoutSuffix.slice(separator + 1),
  };
};

const isJsonObject = Schema.is(Schema.JsonObject);
const JsonArray = Schema.Array(Schema.Json);
const asRecord = (value: Schema.Json | undefined): Schema.JsonObject | undefined =>
  isJsonObject(value) ? value : undefined;

export type WindowsPolicyNode = {
  omaUri: string;
  value: Schema.Json;
  format?: string;
  /** OMA-DM operation for this node (default `Replace`). */
  operation?: "Add" | "Replace";
};

/**
 * Parent `PFXCertInstall/{id}` URI for a certificate child node.
 *
 * Windows removes an installed identity by deleting this parent, not each leaf
 * under it; deleting a leaf leaves the private key and certificate behind.
 */
export const windowsPfxCertInstallParent = (uri: string): string | null => {
  const match = /^(\.\/(?:Device|User)\/Vendor\/MSFT\/ClientCertificateInstall\/PFXCertInstall\/[^/]+)(?:\/|$)/.exec(
    uri,
  );

  return match?.[1] ?? null;
};

/**
 * SHA-1, which the RootCATrustedCertificates CSP uses as its dynamic node
 * name. A synchronous implementation keeps OMA-URI generation synchronous;
 * SHA-1 here is an identifier, not a security decision.
 */
const sha1Hex = async (bytes: Uint8Array): Promise<string> =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-1", bytes as BufferSource)),
    (byte) => byte.toString(16).padStart(2, "0"),
  )
    .join("")
    .toUpperCase();

const windowsCertificateUniqueId = (row: PolicyConfigurationRow): string =>
  `${row.policyId}-${row.kind}`.replaceAll(/[^A-Za-z0-9]/g, "-").slice(0, 64);

/**
 * OMA-URI nodes for a Windows certificate profile.
 *
 * A trusted root goes to RootCATrustedCertificates. Windows has no native
 * PKCS/NDES client in OMA-DM, so both PKCS and imported PFX are delivered
 * through ClientCertificateInstall/PFXCertInstall; the PKCS profile's CA and
 * template metadata documents how the externally issued PKCS#12 was produced.
 */
const windowsCertificateNodes = async (
  row: PolicyConfigurationRow,
  material: PolicyCertificateMaterial | null | undefined,
): Promise<Array<WindowsPolicyNode>> => {
  const parsed = parseConfigurationKind(row.kind);

  if (parsed.type === "windowsCertificate") {
    const pem = asRecord(row.data)?.pem;

    if (!Schema.is(Schema.String)(pem)) return [];

    let der: Uint8Array;

    try {
      der = certificateDer(pem);
    } catch {
      return [];
    }

    return [
      {
        omaUri: `./Device/Vendor/MSFT/RootCATrustedCertificates/Root/${await sha1Hex(der)}/EncodedCertificate`,
        value: bytesToBase64(der),
        format: "b64",
      },
    ];
  }

  if (parsed.type !== "pkcs" && parsed.type !== "pfx") return [];
  if (parsed.platform !== "windows" || !material) return [];

  const data = asRecord(row.data);

  if (!data) return [];

  const configuration = Option.getOrUndefined(
    Schema.decodeUnknownOption(
      parsed.type === "pkcs" ? PkcsCertificateConfiguration : PfxCertificateConfiguration,
    )(data),
  );

  if (!configuration) return [];

  const channel = configuration.channel === "user" ? "User" : "Device";
  const prefix = `./${channel}/Vendor/MSFT/ClientCertificateInstall/PFXCertInstall/${windowsCertificateUniqueId(row)}`;

  return [
    {
      omaUri: `${prefix}/KeyLocation`,
      value: certificateKeyLocationValue(configuration.keyLocation ?? "tpm-preferred"),
      format: "int",
    },
    {
      omaUri: `${prefix}/PFXKeyExportable`,
      value: configuration.keyLocation === "software" ? (configuration.exportable ?? false) : false,
      format: "bool",
    },
    ...(configuration.keyLocation === "windows-hello"
      ? [
          {
            omaUri: `${prefix}/ContainerName`,
            value: `mattrax-${windowsCertificateUniqueId(row)}`,
            format: "chr",
          } satisfies WindowsPolicyNode,
        ]
      : []),
    // The password is sealed among Mattrax's rows but the CSP needs it to
    // import the blob; TLS protects the check-in. Type 0 is the CSP's
    // "not encrypted" value, which is the only one that does not require a
    // device-specific MDM certificate encryption key.
    { omaUri: `${prefix}/PFXCertPasswordEncryptionType`, value: 0, format: "int" },
    { omaUri: `${prefix}/PFXCertPassword`, value: material.password, format: "chr" },
    {
      omaUri: `${prefix}/PFXCertBlob`,
      value: bytesToBase64(material.pfx),
      format: "b64",
      // The CSP requires Add for the first blob; the delivery path switches to
      // Replace once the device has acknowledged a blob for this URI.
      operation: "Add",
    },
  ];
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
};

/** Extract OMA-URI nodes from a Windows custom or structured LAPS policy. */
export const windowsPolicyNodes = async (
  row: PolicyConfigurationRow,
  material?: PolicyCertificateMaterial | null,
): Promise<Array<WindowsPolicyNode>> => {
  const configuration = parseConfigurationKind(row.kind);

  if (configuration.type === "windows-laps") {
    const policy = parseWindowsLapsPolicy(row.data);

    return policy
      ? windowsLapsPolicyNodes(policy).map((node) => ({
          omaUri: node.omaUri,
          value: node.value,
          format: node.format,
        }))
      : [];
  }

  if (
    configuration.type === "windowsCertificate" ||
    configuration.type === "pkcs" ||
    configuration.type === "pfx"
  )
    return windowsCertificateNodes(row, material);

  if (configuration.type !== "windows") return [];

  const data = asRecord(row.data);
  const nodes = data === undefined ? [] : Schema.is(JsonArray)(data.nodes) ? data.nodes : [data];

  return nodes.flatMap((node) => {
    if (!isJsonObject(node)) return [];

    const omaUri = node.omaUri;

    if (!Schema.is(Schema.String)(omaUri)) return [];

    const result: WindowsPolicyNode = { omaUri, value: node.value };

    if (Schema.is(Schema.String)(node.format)) result.format = node.format;

    return [result];
  });
};

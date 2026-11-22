import { Effect, Exit, Schema } from "effect";
import { parsePlist, serializePlist } from "@mattrax/plist";
import { certificateDer, extractCmsSignedContent } from "@mattrax/scep";
import {
  appleAssetTokenEpoch,
  appleAssetTokenExpiresAt,
  isApplePackageUpload,
  signAppleAssetToken,
  signAppleProfileToken,
  verifyAppleAssetToken,
} from "@mattrax/dm-apple";
import type { VerifiedAppleAssetToken } from "@mattrax/dm-apple";
import { isPlistObject, plistText } from "./internal/plistValue.js";
import type { PlistObject } from "./internal/plistValue.js";

/**
 * Apple policy compiler for the enterprise management backend.
 *
 * Behaviour is ported from mttx's `mx-policy` crate:
 *   - legacy configuration kinds become `com.apple.configuration.legacy`
 *     declarations pointing at a signed `.mobileconfig` URL
 *   - certificate configurations become a credential asset plus a
 *     `com.apple.configuration.security.certificate` declaration
 *   - custom declarations pass through with the operator-supplied kind
 */

export type PolicyConfigurationRow = {
  readonly policyId: string;
  readonly kind: string;
  readonly data: Schema.Json | undefined;
  /** Content hash stored with the configuration row. */
  readonly hash: string;
  /** Owning tenant. Optional for older call sites. */
  readonly organizationId?: string;
};

export type DeclarationContext = {
  readonly origin: string;
  /** Empty string is allowed so local development still produces stable URLs. */
  readonly authSecret: string;
  readonly deviceToken: string;
  /** Stable internal device id used to bind expiring asset links. */
  readonly deviceId: string;
  /** Injectable clock for deterministic URLs and tokens in tests. */
  readonly now?: number;
};

export type CompiledDeclaration = {
  readonly Type: string;
  readonly Identifier: string;
  readonly ServerToken: string;
  readonly Payload: Schema.JsonObject;
};

export type ConfigurationKind =
  | { readonly type: "device" }
  | { readonly type: "custom"; readonly id: string }
  | { readonly type: "certificate"; readonly id: string }
  | { readonly type: "declaration"; readonly id: string }
  | { readonly type: "application"; readonly id: string }
  | { readonly type: "windows"; readonly id: string }
  | { readonly type: "android"; readonly id: string }
  | { readonly type: "unknown" };

const IDENTIFIER_PATTERN = /^[A-Za-z0-9]{1,20}$/;

/**
 * Declaration types Apple documents with `user` in their macOS allowed scopes.
 * Derived from the `declarative/declarations` schema in
 * apple/device-management. Kept explicit: a declaration type is only accepted
 * for the user channel when Apple says the user channel supports it.
 */
const USER_SCOPED_DECLARATIONS = new Set([
  "com.apple.configuration.accessibility.settings",
  "com.apple.configuration.account.caldav",
  "com.apple.configuration.account.carddav",
  "com.apple.configuration.account.exchange",
  "com.apple.configuration.account.google",
  "com.apple.configuration.account.ldap",
  "com.apple.configuration.account.mail",
  "com.apple.configuration.account.settings",
  "com.apple.configuration.account.subscribed-calendar",
  "com.apple.configuration.app.managed",
  "com.apple.configuration.app.settings",
  "com.apple.configuration.extensible-sso",
  "com.apple.configuration.external-intelligence.settings",
  "com.apple.configuration.intelligence.settings",
  "com.apple.configuration.keyboard.settings",
  "com.apple.configuration.legacy",
  "com.apple.configuration.legacy.interactive",
  "com.apple.configuration.management.status-subscriptions",
  "com.apple.configuration.math.settings",
  "com.apple.configuration.network.relay",
  "com.apple.configuration.network.vpn.ikev2",
  "com.apple.configuration.passcode.settings",
  "com.apple.configuration.safari.bookmarks",
  "com.apple.configuration.safari.extensions.settings",
  "com.apple.configuration.safari.settings",
  "com.apple.configuration.screensharing.connection",
  "com.apple.configuration.screensharing.connection.group",
  "com.apple.configuration.security.certificate",
  "com.apple.configuration.security.identity",
  "com.apple.configuration.security.passkey.attestation",
  "com.apple.configuration.siri.settings",
]);

const encoder = new TextEncoder();

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export const parseConfigurationKind = (kind: string): ConfigurationKind => {
  if (kind === "mttx.apple.device") return { type: "device" };
  const android = /^mttx\.android\.policy\.(.+)$/.exec(kind);

  if (android?.[1] && IDENTIFIER_PATTERN.test(android[1]))
    return { type: "android", id: android[1] };
  const windows = /^mttx\.windows\.custom\.(.+)$/.exec(kind);

  if (windows?.[1] && IDENTIFIER_PATTERN.test(windows[1]))
    return { type: "windows", id: windows[1] };
  const match = /^mttx\.apple\.(custom|certificate|declaration|application)\.(.+)$/.exec(kind);

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

export const isCertificateKind = (kind: string): boolean =>
  parseConfigurationKind(kind).type === "certificate";

export const isApplicationKind = (kind: string): boolean =>
  parseConfigurationKind(kind).type === "application";

/** The synthetic request/kind pair a catalogue app's signed asset URL is bound to. */
export const CATALOGUE_APPLICATION_ASSET_KIND = "catalogue-application";

/**
 * Signed asset identifier for an uploaded file in the application catalogue.
 *
 * Policy-scoped artefacts reuse the configuration aid (`<policyId>.<kind>.asset`);
 * catalogue files are not owned by a policy, so they get a separate prefix that
 * cannot collide with a policy id.
 */
export const catalogueApplicationAssetIdentifier = (applicationId: string): string =>
  `app.${applicationId}`;

export const parseCatalogueApplicationAssetIdentifier = (identifier: string): string | null =>
  identifier.startsWith("app.") && identifier.length > 4 ? identifier.slice(4) : null;

export type AppleApplicationSource = "upload" | "manifest" | "store";

/**
 * An app a policy installs, either by referencing a catalogue entry or by
 * carrying the metadata for a `.pkg` uploaded against the policy itself.
 */
export type AppleApplicationConfiguration = {
  readonly type: "catalogue" | "inline";
  /** Present for `catalogue`: the tenant's application row id. */
  readonly applicationId?: string;
  readonly source: AppleApplicationSource;
  readonly bundleId: string;
  readonly version?: string;
  readonly title?: string;
  /** Policy-scoped upload (`uploadPolicyApplication`) digest. */
  readonly sha256?: string;
  readonly fileName?: string;
  readonly contentType?: string;
  readonly manifestUrl?: string;
  readonly storeId?: string;
  /** Managed app configuration handed to the install command. */
  readonly configuration?: Schema.JsonObject;
  readonly managementFlags?: number;
};

type MutableAppleApplicationConfiguration = {
  -readonly [K in keyof AppleApplicationConfiguration]: AppleApplicationConfiguration[K];
};

const applicationSourceOf = (record: Schema.JsonObject): AppleApplicationSource | undefined => {
  const explicit = record.source;

  if (explicit === "upload" || explicit === "manifest" || explicit === "store") return explicit;

  if (explicit !== undefined) return undefined;

  if (Schema.is(Schema.String)(record.storeId) && record.storeId.trim()) return "store";

  if (Schema.is(Schema.String)(record.manifestUrl) && record.manifestUrl.trim()) return "manifest";

  if (Schema.is(Schema.String)(record.sha256) && record.sha256.trim()) return "upload";

  return undefined;
};

const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Parse and structurally validate a `mttx.apple.application.<id>` payload.
 *
 * DB-backed checks (does the referenced catalogue row belong to the tenant?)
 * live in the handler that has the tenant context. This function only accepts
 * shapes a device can actually install, so a stored configuration cannot fail
 * silently at delivery time.
 */
export const parseAppleApplicationConfiguration = (
  data: Schema.Json | undefined,
): AppleApplicationConfiguration | null => {
  const record = asRecord(data);

  if (!record) return null;

  const applicationId = record.applicationId;

  if (applicationId !== undefined) {
    if (!Schema.is(Schema.String)(applicationId) || !applicationId.trim()) return null;

    const configuration = record.configuration;

    if (configuration !== undefined && !isJsonObject(configuration)) return null;

    return {
      type: "catalogue",
      applicationId: applicationId.trim(),
      source: "manifest",
      bundleId: "",
      configuration: isJsonObject(configuration) ? configuration : undefined,
    };
  }

  const source = applicationSourceOf(record);

  if (!source) return null;
  const bundleId = record.bundleId;

  if (!Schema.is(Schema.String)(bundleId) || !bundleId.trim()) return null;
  const version = record.version;
  const title = record.title;
  const configuration = record.configuration;

  if (configuration !== undefined && !isJsonObject(configuration)) return null;
  const managementFlags = record.managementFlags;

  if (
    managementFlags !== undefined &&
    (!Schema.is(Schema.Number)(managementFlags) || managementFlags !== 1)
  )
    return null;

  const result: MutableAppleApplicationConfiguration = {
    type: "inline",
    source,
    bundleId: bundleId.trim(),
  };

  if (Schema.is(Schema.String)(title) && title.trim()) result.title = title.trim();

  if (isJsonObject(configuration)) result.configuration = configuration;

  if (managementFlags === 1) result.managementFlags = 1;

  if (Schema.is(Schema.String)(version) && version.trim()) result.version = version.trim();

  if (source === "upload") {
    const sha256 = record.sha256;
    const fileName = record.fileName;
    const contentType = record.contentType;

    if (!Schema.is(Schema.String)(sha256) || !/^[a-f0-9]{64}$/i.test(sha256)) return null;

    if (!Schema.is(Schema.String)(fileName) || !fileName.trim()) return null;

    if (!result.version) return null;

    if (
      !isApplePackageUpload({
        fileName,
        contentType: Schema.is(Schema.String)(contentType) ? contentType : undefined,
      })
    )
      return null;

    result.sha256 = sha256.toLowerCase();
    result.fileName = fileName.trim();

    if (Schema.is(Schema.String)(contentType) && contentType.trim())
      result.contentType = contentType.trim();

    return result;
  }

  if (source === "manifest") {
    const manifestUrl = record.manifestUrl;

    if (!Schema.is(Schema.String)(manifestUrl) || !isHttpsUrl(manifestUrl.trim())) return null;

    if (!result.version) return null;

    result.manifestUrl = manifestUrl.trim();

    return result;
  }

  const storeId = record.storeId;

  if (!Schema.is(Schema.String)(storeId) || !/^\d+$/.test(storeId.trim())) return null;

  result.storeId = storeId.trim();

  if (!result.version) result.version = "0";

  return result;
};

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

const decodeBase64 = (value: string): Uint8Array => {
  const cleaned = value.replaceAll(/\s/g, "");
  const binary = atob(cleaned);

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const sha256Hex = async (value: string | Uint8Array): Promise<string> => {
  const bytes = Schema.is(Schema.String)(value) ? encoder.encode(value) : value;
  // SAFETY: WebCrypto accepts Uint8Array as a BufferSource; the TypeScript DOM
  // libs model the buffer backing separately from the view.
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
};

const asRecord = (value: Schema.Json | undefined): Schema.JsonObject | undefined =>
  isJsonObject(value) ? value : undefined;

/** Signed profiles are CMS/PKCS#7 DER or PEM with an embedded plist. */
const isSignedMobileconfig = (bytes: Uint8Array, text: string): boolean => {
  const pem = /-----BEGIN (?:PKCS7|CMS)-----/.test(text);

  const der =
    bytes.length > 3 &&
    bytes[0] === 0x30 &&
    (bytes[1] === 0x82 || bytes[1] === 0x81 || bytes[1] === 0x80);

  const embedded = text.includes("<plist") || text.includes("<?xml");

  return (pem || der) && embedded;
};

const payloadsFromMobileconfig = (root: PlistObject): Array<PlistObject> => {
  const content = root.PayloadContent;

  if (Array.isArray(content)) return content.filter(isPlistObject);

  if (isPlistObject(content)) return [content];

  return [];
};

/** One payload inside a `.mobileconfig`, after CMS unwrapping when signed. */
export type MobileconfigPayload = {
  readonly type: string;
  readonly uuid: string | null;
  readonly identifier: string | null;
  /** DER of the certificate carried by a `com.apple.security.pkcs1` payload. */
  readonly certificateDer: Uint8Array | null;
};

export type MobileconfigInspection = {
  readonly form: "plist" | "signed-cms";
  /** Root `PayloadIdentifier`, when present. */
  readonly identifier: string | null;
  /** The decoded plist. Signed profiles are inspected but never rewritten. */
  readonly plist: PlistObject;
  readonly payloads: ReadonlyArray<MobileconfigPayload>;
};

const certificateDerFromPayload = (payload: PlistObject): Uint8Array | null => {
  const content = payload.PayloadContent;

  if (content instanceof Uint8Array) return content;

  if (content instanceof ArrayBuffer) return new Uint8Array(content);

  if (Schema.is(Schema.String)(content)) {
    try {
      return decodeBase64(content);
    } catch {
      return null;
    }
  }

  // fast-plist decodes some `<data>` values into a number array.
  if (Array.isArray(content)) {
    const bytes = content.filter((entry): entry is number => Schema.is(Schema.Number)(entry));

    return bytes.length === content.length ? Uint8Array.from(bytes) : null;
  }

  return null;
};

/**
 * Decode a `.mobileconfig`, including the CMS SignedData wrapper Apple accepts
 * (and the designer produces for signed profiles). The payload list is what OS
 * scoping and FileVault escrow validation need.
 */
export const inspectMobileconfig = async (
  bytes: Uint8Array,
): Promise<MobileconfigInspection | null> => {
  const text = new TextDecoder().decode(bytes);
  let form: MobileconfigInspection["form"] = "plist";
  let plistTextValue = text;

  if (!text.includes("<plist") && !text.includes("<?xml")) {
    if (bytes.length < 4 || bytes[0] !== 0x30) return null;

    try {
      const inner = await extractCmsSignedContent(bytes);

      plistTextValue = new TextDecoder().decode(inner);
      form = "signed-cms";
    } catch {
      return null;
    }
  }

  const parsed = await Effect.runPromise(Effect.exit(parsePlist(plistTextValue)));

  if (Exit.isFailure(parsed) || !isPlistObject(parsed.value)) return null;
  const plist = parsed.value;

  const payloads = payloadsFromMobileconfig(plist).flatMap((payload) => {
    const type = plistText(payload.PayloadType);

    if (!type) return [];

    const certificateDer =
      type === "com.apple.security.pkcs1" ? certificateDerFromPayload(payload) : null;

    return [
      {
        type,
        uuid: plistText(payload.PayloadUUID) ?? null,
        identifier: plistText(payload.PayloadIdentifier) ?? null,
        certificateDer,
      },
    ];
  });

  return {
    form,
    identifier: plistText(plist.PayloadIdentifier) ?? null,
    plist,
    payloads,
  };
};

/** Payload/declaration types a configuration delivers, when they are known. */
export const configurationPayloadTypes = async (
  kind: string,
  data: Schema.Json,
): Promise<ReadonlyArray<string>> => {
  const parsed = parseConfigurationKind(kind);
  const record = asRecord(data);

  switch (parsed.type) {
    case "device":
      return ["com.apple.applicationaccess"];
    case "custom": {
      const content = record?.content;

      if (!Schema.is(Schema.String)(content)) return [];

      let bytes: Uint8Array;

      try {
        bytes = decodeBase64(content);
      } catch {
        return [];
      }

      const inspection = await inspectMobileconfig(bytes);

      return inspection?.payloads.map((payload) => payload.type) ?? [];
    }

    case "certificate":
      return ["com.apple.configuration.security.certificate"];
    case "declaration": {
      const declarationKind = record?.kind;

      return Schema.is(Schema.String)(declarationKind) ? [declarationKind] : [];
    }

    default:
      return [];
  }
};

const ESCROW_PAYLOAD_TYPE = "com.apple.security.FDERecoveryKeyEscrow";

const ESCROW_CERTIFICATE_PAYLOAD_TYPE = "com.apple.security.pkcs1";

/**
 * Check a policy configuration that escrows FileVault recovery keys.
 *
 * Mattrax can only unwrap a key it holds the private key for, so a profile that
 * pins another certificate is rejected instead of storing ciphertext that the
 * product presents as a usable recovery key. A profile without a resolvable
 * `EncryptCertPayloadUUID` certificate is accepted: delivery injects the
 * tenant's escrow certificate under that UUID.
 */
export const validateEscrowConfiguration = async (
  inspection: MobileconfigInspection,
  escrow: {
    readonly certificateFingerprintSha256?: string | null;
  },
): Promise<string | null> => {
  const escrowPayload = inspection.plist;

  if (!inspection.payloads.some((payload) => payload.type === ESCROW_PAYLOAD_TYPE)) return null;

  if (!escrow.certificateFingerprintSha256)
    return "This profile escrows FileVault recovery keys, but this tenant has no FileVault escrow key. Generate one in tenant settings first, otherwise Mattrax would store a key it cannot decrypt.";

  if (inspection.form !== "plist")
    return "This is a signed configuration profile that escrows FileVault recovery keys. Mattrax cannot replace the encryption certificate inside a signed profile; remove the signature or use an unsigned profile so the tenant escrow certificate can be installed.";

  const payloads = payloadsFromMobileconfig(escrowPayload);

  for (const payload of payloads) {
    if (plistText(payload.PayloadType) !== ESCROW_PAYLOAD_TYPE) continue;
    const encryptCertificateUuid = plistText(payload.EncryptCertPayloadUUID);

    if (!encryptCertificateUuid) continue;

    const certificatePayload = payloads.find(
      (candidate) =>
        plistText(candidate.PayloadType) === ESCROW_CERTIFICATE_PAYLOAD_TYPE &&
        plistText(candidate.PayloadUUID) === encryptCertificateUuid,
    );

    if (!certificatePayload) continue;
    const der = certificateDerFromPayload(certificatePayload);

    if (!der) continue;
    const fingerprint = await sha256Hex(der);

    if (fingerprint !== escrow.certificateFingerprintSha256.toLowerCase())
      return "This profile encrypts the FileVault recovery key with a certificate Mattrax does not hold the private key for. Remove the certificate payload so the tenant escrow certificate can be used, or upload the matching key pair in tenant settings.";
  }

  return null;
};

/**
 * Validate a configuration before it is persisted. Anything that cannot be
 * deployed by an Apple device is rejected at patch time (rather than being
 * stored and silently ignored during declaration sync).
 */
export const validateConfiguration = (
  kind: string,
  data: Schema.Json,
  context: {
    /**
     * Tenant FileVault escrow certificate fingerprint, when the tenant has one.
     * Required to accept an `FDERecoveryKeyEscrow` profile Mattrax can unwrap.
     */
    readonly escrowCertificateFingerprintSha256?: string | null;
    /**
     * Delivery channel. Defaults to `device`. User scope is only accepted when
     * the payload or declaration actually supports it on the user channel.
     */
    readonly scope?: "device" | "user";
  } = {},
): Effect.Effect<void, string> =>
  Effect.gen(function* () {
    const parsed = parseConfigurationKind(kind);
    const scope = context.scope ?? "device";

    switch (parsed.type) {
      case "unknown":
        return yield* Effect.fail(
          `Unknown configuration kind "${kind}". Supported kinds are mttx.apple.device, mttx.apple.custom.<id>, mttx.apple.certificate.<id>, mttx.apple.declaration.<id>, mttx.windows.custom.<id> and mttx.android.policy.<id>.`,
        );
      case "application": {
        if (scope === "user")
          return yield* Effect.fail(
            `"${kind}" can only be device-scoped: Apple user-channel application installs are not implemented.`,
          );
        const configuration = parseAppleApplicationConfiguration(data);

        if (!configuration)
          return yield* Effect.fail(
            `"${kind}" must reference an applicationId or describe an installable Apple app: either a policy-uploaded .pkg (source "upload" with sha256, fileName, bundleId and version), an HTTPS manifest (source "manifest" with manifestUrl, bundleId and version) or a numeric App Store id (source "store" with storeId).`,
          );

        return;
      }

      case "device": {
        if (scope === "user")
          return yield* Effect.fail(`"${kind}" is a device restriction and cannot be user-scoped.`);
        const record = asRecord(data);

        if (!record) return yield* Effect.fail(`"${kind}" must be an object`);

        if (record.camera !== undefined && !Schema.is(Schema.Boolean)(record.camera))
          return yield* Effect.fail(`"${kind}.camera" must be a boolean`);

        return;
      }

      case "custom": {
        const record = asRecord(data);

        if (!record || !Schema.is(Schema.String)(record.content) || record.content.length === 0)
          return yield* Effect.fail(`"${kind}" requires a base64 encoded "content" string`);
        let bytes: Uint8Array;

        try {
          bytes = decodeBase64(record.content);
        } catch {
          return yield* Effect.fail(`"${kind}.content" is not valid base64`);
        }

        const text = new TextDecoder().decode(bytes);
        const parsed = yield* Effect.exit(parsePlist(text));
        const inspection = yield* Effect.promise(() => inspectMobileconfig(bytes));

        if (inspection) {
          const escrowProblem = yield* Effect.promise(() =>
            validateEscrowConfiguration(inspection, {
              certificateFingerprintSha256: context.escrowCertificateFingerprintSha256,
            }),
          );

          if (escrowProblem) return yield* Effect.fail(`"${kind}": ${escrowProblem}`);
        }

        if (Exit.isFailure(parsed)) {
          // A CMS/PKCS#7-wrapped profile keeps its code signature and is
          // deployed verbatim. We only check that it carries an embedded
          // plist; the device is responsible for validating the signer.
          if (isSignedMobileconfig(bytes, text)) {
            if (scope === "user")
              return yield* Effect.fail(
                `"${kind}" is user-scoped, but a signed mobileconfig cannot be inspected for PayloadScope "User". Use an unsigned profile or a declaration.`,
              );

            return;
          }

          const cause = parsed.cause;

          return yield* Effect.fail(
            `"${kind}.content" is not a valid mobileconfig plist: ${String(cause)}`,
          );
        }

        const plist = parsed.value;

        if (!isPlistObject(plist))
          return yield* Effect.fail(`"${kind}.content" must contain a plist dictionary`);

        if (plist.PayloadType !== "Configuration")
          return yield* Effect.fail(
            `"${kind}.content" must have a top-level PayloadType of Configuration`,
          );

        if (
          !Schema.is(Schema.String)(plist.PayloadIdentifier) ||
          plist.PayloadIdentifier.length === 0
        )
          return yield* Effect.fail(`"${kind}.content" must have a PayloadIdentifier`);

        if (
          !Schema.is(Schema.String)(plist.PayloadDisplayName) ||
          plist.PayloadDisplayName.length === 0
        )
          return yield* Effect.fail(`"${kind}.content" must have a PayloadDisplayName`);

        const payloadScope = plistText(plist.PayloadScope);

        if (
          plist.PayloadScope !== undefined &&
          (payloadScope === undefined || !["System", "User"].includes(payloadScope))
        )
          return yield* Effect.fail(`"${kind}.content" PayloadScope must be System or User`);

        if (scope === "user" && payloadScope !== "User")
          return yield* Effect.fail(
            `"${kind}" is user-scoped, so its profile must declare PayloadScope "User" (Apple refuses to install a System profile in a user context).`,
          );

        if (scope === "device" && payloadScope === "User")
          return yield* Effect.fail(
            `"${kind}.content" declares PayloadScope "User"; mark the configuration as user scope so it is delivered on the user channel.`,
          );
        const payloads = payloadsFromMobileconfig(plist);

        if (payloads.length === 0)
          return yield* Effect.fail(
            `"${kind}.content" must contain at least one PayloadContent entry`,
          );
        const hasMdm = payloads.some((payload) => payload.PayloadType === "com.apple.mdm");

        if (hasMdm)
          return yield* Effect.fail(
            `"${kind}.content" contains a com.apple.mdm payload, which cannot be deployed as a managed profile`,
          );

        return;
      }

      case "android": {
        if (scope === "user")
          return yield* Effect.fail(
            `"${kind}" cannot be user-scoped: the Android Management API assigns a policy to a device, not a user.`,
          );
        const record = asRecord(data);

        if (!record) return yield* Effect.fail(`"${kind}" must be an object`);
        const policy = record.policy === undefined ? record : asRecord(record.policy);

        if (!policy) return yield* Effect.fail(`"${kind}.policy" must be an object`);

        if ("name" in policy || "policyName" in policy)
          return yield* Effect.fail(`"${kind}.policy" must not contain name or policyName`);

        return;
      }

      case "windows": {
        const record = asRecord(data);

        if (!record) return yield* Effect.fail(`"${kind}" must be an object`);
        const nodes = Schema.is(JsonArray)(record.nodes) ? record.nodes : [record];

        if (nodes.length === 0)
          return yield* Effect.fail(`"${kind}" must contain at least one OMA-URI node`);

        for (const node of nodes) {
          if (!isJsonObject(node))
            return yield* Effect.fail(`Every "${kind}" node must be an object`);

          if (!Schema.is(Schema.String)(node.omaUri) || !node.omaUri.startsWith("./"))
            return yield* Effect.fail(
              `"${kind}.omaUri" must be a Windows OMA-URI starting with "./"`,
            );

          const perUserUri = node.omaUri.startsWith("./User/");

          if (scope === "user" && !perUserUri)
            return yield* Effect.fail(
              `"${kind}.omaUri" must start with "./User/" for user scope; "${node.omaUri}" is device-scoped.`,
            );

          if (scope === "device" && perUserUri)
            return yield* Effect.fail(
              `"${kind}.omaUri" is a per-user setting ("${node.omaUri}"). Mark the configuration as user scope, or use a device-scoped CSP.`,
            );

          if (node.value === undefined || node.value === null)
            return yield* Effect.fail(`"${kind}.value" is required`);

          if (
            node.format !== undefined &&
            !(
              Schema.is(Schema.String)(node.format) &&
              ["int", "chr", "bool", "xml", "b64", "node"].includes(node.format)
            )
          )
            return yield* Effect.fail(`"${kind}.format" must be int, chr, bool, xml, b64 or node`);
        }

        return;
      }

      case "certificate": {
        if (scope === "user")
          return yield* Effect.fail(
            `"${kind}" issues a device credential asset; user-channel certificate assets are not implemented.`,
          );
        const record = asRecord(data);

        if (!record || !Schema.is(Schema.String)(record.pem) || record.pem.length === 0)
          return yield* Effect.fail(`"${kind}" requires a PEM "pem" string`);
        const begins = record.pem.match(/-----BEGIN CERTIFICATE-----/g)?.length ?? 0;
        const ends = record.pem.match(/-----END CERTIFICATE-----/g)?.length ?? 0;

        if (begins !== 1 || ends !== 1)
          return yield* Effect.fail(`"${kind}.pem" must contain exactly one PEM certificate`);

        return;
      }

      case "declaration": {
        const record = asRecord(data);

        if (!record || !Schema.is(Schema.String)(record.kind) || record.kind.length === 0)
          return yield* Effect.fail(`"${kind}" requires a declaration "kind" string`);

        if (!record.kind.startsWith("com.apple."))
          return yield* Effect.fail(
            `"${kind}.kind" must be an Apple declaration type (for example com.apple.configuration.services.configuration-files)`,
          );

        if (!isJsonObject(record.configuration))
          return yield* Effect.fail(`"${kind}" requires a "configuration" object`);

        if (scope === "user" && !USER_SCOPED_DECLARATIONS.has(record.kind))
          return yield* Effect.fail(
            `"${record.kind}" has no user scope on macOS according to Apple's declaration schema.`,
          );

        return;
      }
    }
  });

const declarationTypeFor = (row: PolicyConfigurationRow): string | null => {
  const parsed = parseConfigurationKind(row.kind);

  switch (parsed.type) {
    case "device":
    case "custom":
      return "com.apple.configuration.legacy";
    case "certificate":
      return "com.apple.configuration.security.certificate";
    case "declaration": {
      const data = asRecord(row.data);
      const kind = data?.kind;

      return Schema.is(Schema.String)(kind) ? kind : null;
    }

    default:
      return null;
  }
};

/**
 * Server tokens incorporate the actual payload plus anything that appears in
 * the rendered declaration (for legacy profiles that means origin and device
 * token). A content edit therefore always produces a new token.
 */
/**
 * Content hash used for declaration server tokens.
 *
 * Must match the hash written when a policy is saved (`jsonHash`), so a
 * configuration whose variables resolved to the stored text keeps its token.
 */
export const policyDataHash = async (value: Schema.Json): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
};

export const configurationServerToken = async (
  row: PolicyConfigurationRow,
  context: Pick<DeclarationContext, "origin" | "deviceToken">,
): Promise<string> => {
  if (isLegacyKind(row.kind)) {
    return (
      await sha256Hex(
        [row.hash, context.origin, context.deviceToken, row.policyId, row.kind].join("\u0000"),
      )
    ).toUpperCase();
  }

  return row.hash;
};

/**
 * Asset declaration server token.
 *
 * It rotates on the same fixed window as the signed `DataURL`, so a device
 * whose declaration is still cached is told to fetch the new declaration before
 * its previous link expires. The window is part of the token, not the exact
 * issuance time, so every device in a tenant converges on the same value.
 */
export const configurationAssetServerToken = async (
  row: PolicyConfigurationRow,
  context: Pick<DeclarationContext, "origin" | "deviceToken" | "now">,
): Promise<string> =>
  (
    await sha256Hex(
      [
        row.hash,
        context.origin,
        context.deviceToken,
        row.policyId,
        row.kind,
        String(appleAssetTokenEpoch(context.now)),
      ].join("\u0000"),
    )
  ).toUpperCase();

export const configurationProfileUrl = async (
  row: PolicyConfigurationRow,
  context: DeclarationContext,
): Promise<string> => {
  const expiresAt = appleAssetTokenExpiresAt(context.now);

  const token = await signAppleProfileToken(context.authSecret, {
    policyId: row.policyId,
    kind: row.kind,
    deviceToken: context.deviceToken,
    deviceId: context.deviceId,
    expiresAt,
  });

  const origin = trimTrailingSlash(context.origin);

  return `${origin}/mdm/apple/profiles/${encodeURIComponent(context.deviceToken)}/${encodeURIComponent(row.policyId)}/${encodeURIComponent(row.kind)}?token=${encodeURIComponent(token)}&deviceId=${encodeURIComponent(context.deviceId)}&expiresAt=${expiresAt}`;
};

export const buildConfigurationDeclaration = async (
  row: PolicyConfigurationRow,
  context: DeclarationContext,
): Promise<CompiledDeclaration | null> => {
  const type = declarationTypeFor(row);

  if (!type) return null;

  const identifier = configurationDeclarationIdentifier(row.policyId, row.kind);
  const serverToken = await configurationServerToken(row, context);

  switch (parseConfigurationKind(row.kind).type) {
    case "device":
    case "custom":
      return {
        Type: type,
        Identifier: identifier,
        ServerToken: serverToken,
        Payload: { ProfileURL: await configurationProfileUrl(row, context) },
      };
    case "certificate":
      return {
        Type: type,
        Identifier: identifier,
        ServerToken: serverToken,
        Payload: {
          CredentialAssetReference: configurationAssetIdentifier(row.policyId, row.kind),
        },
      };
    case "declaration": {
      const data = asRecord(row.data);
      const payload = data?.configuration;

      return {
        Type: type,
        Identifier: identifier,
        ServerToken: serverToken,
        Payload: isJsonObject(payload) ? payload : {},
      };
    }

    default:
      return null;
  }
};

export const buildAssetDeclaration = async (
  row: PolicyConfigurationRow,
  context: DeclarationContext,
): Promise<CompiledDeclaration | null> => {
  const parsed = parseConfigurationKind(row.kind);

  if (parsed.type !== "certificate") return null;
  const data = asRecord(row.data);

  if (!Schema.is(Schema.String)(data?.pem)) return null;

  const identifier = configurationAssetIdentifier(row.policyId, row.kind);
  const serverToken = await configurationAssetServerToken(row, context);

  const assetToken = await signAppleAssetToken(context.authSecret, {
    policyId: row.policyId,
    kind: row.kind,
    deviceId: context.deviceId,
    expiresAt: appleAssetTokenExpiresAt(context.now),
  });

  const pemBytes = encoder.encode(data.pem);
  const origin = trimTrailingSlash(context.origin);

  return {
    Type: "com.apple.asset.credential.certificate",
    Identifier: identifier,
    ServerToken: serverToken,
    Payload: {
      Reference: {
        DataURL: `${origin}/mdm/apple/assets/${encodeURIComponent(identifier)}?token=${encodeURIComponent(assetToken)}`,
        ContentType: "application/pem",
        "Hash-SHA-256": bytesToBase64(
          new Uint8Array(await crypto.subtle.digest("SHA-256", pemBytes)),
        ),
        Size: pemBytes.byteLength,
      },
    },
  };
};

const stableUuid = async (value: string): Promise<string> => {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).slice(0, 16);

  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const legacyDeviceProfile = async (row: PolicyConfigurationRow) => {
  const data = asRecord(row.data);
  const allowCamera = data?.camera !== false;
  const uuid = await stableUuid(`mattrax:${row.policyId}:${row.kind}`);

  return {
    PayloadContent: [
      {
        allowCamera,
        PayloadIdentifier: `app.mattrax.p.${row.policyId}.${row.kind}.applicationaccess`,
        PayloadType: "com.apple.applicationaccess",
        PayloadUUID: await stableUuid(`mattrax:${row.policyId}:${row.kind}:payload`),
        PayloadVersion: 1,
      },
    ],
    PayloadDisplayName: `Mattrax policy ${row.policyId}`,
    PayloadIdentifier: `app.mattrax.p.${row.policyId}.${row.kind}`,
    PayloadOrganization: "Mattrax",
    PayloadType: "Configuration",
    PayloadUUID: uuid,
    PayloadVersion: 1,
  };
};

/**
 * Render the legacy `.mobileconfig` for a policy configuration.
 * Returns null for kinds that are not served as legacy profiles.
 */
export const buildLegacyProfile = async (
  row: PolicyConfigurationRow,
): Promise<{ content: Uint8Array; contentType: string } | null> => {
  const parsed = parseConfigurationKind(row.kind);

  if (parsed.type === "custom") {
    const content = asRecord(row.data)?.content;

    if (!Schema.is(Schema.String)(content)) return null;

    return {
      content: decodeBase64(content),
      contentType: "application/x-apple-aspen-config",
    };
  }

  if (parsed.type === "device") {
    const plist = await Effect.runPromise(serializePlist(await legacyDeviceProfile(row)));

    return {
      content: encoder.encode(plist),
      contentType: "application/x-apple-aspen-config",
    };
  }

  // Certificates are an asset in DDM. The legacy equivalent Apple installs from
  // a profile is a `com.apple.security.pkcs1` payload, which is what a pre-DDM
  // device (or one below the certificate declaration's minimum OS) receives.
  if (parsed.type === "certificate") {
    const pem = asRecord(row.data)?.pem;

    if (!Schema.is(Schema.String)(pem)) return null;

    let der: Uint8Array;

    try {
      der = await certificateDer(pem);
    } catch {
      return null;
    }

    const plist = await Effect.runPromise(
      serializePlist({
        PayloadContent: [
          {
            PayloadCertificateFileName: `${row.policyId}-${row.kind}.cer`,
            PayloadContent: der,
            PayloadDisplayName: `Mattrax certificate ${row.kind}`,
            PayloadIdentifier: `app.mattrax.p.${row.policyId}.${row.kind}.certificate`,
            PayloadType: "com.apple.security.pkcs1",
            PayloadUUID: await stableUuid(`mattrax:${row.policyId}:${row.kind}:certificate`),
            PayloadVersion: 1,
          },
        ],
        PayloadDisplayName: `Mattrax policy ${row.policyId}`,
        PayloadIdentifier: `app.mattrax.p.${row.policyId}.${row.kind}.legacy`,
        PayloadOrganization: "Mattrax",
        PayloadType: "Configuration",
        PayloadUUID: await stableUuid(`mattrax:${row.policyId}:${row.kind}:legacy`),
        PayloadVersion: 1,
      }),
    );

    return {
      content: encoder.encode(plist),
      contentType: "application/x-apple-aspen-config",
    };
  }

  return null;
};

/**
 * Replace the FileVault escrow certificate in a configuration profile with the
 * tenant's certificate, so the CMS payload a Mac returns can be unwrapped.
 *
 * A profile the device already pinned to a foreign certificate is rejected by
 * `validateEscrowConfiguration` at save time; this is the delivery-time guard
 * for profiles saved before the tenant key existed and for signed profiles.
 */
export const applyEscrowCertificate = async (
  bytes: Uint8Array,
  certificatePem: string,
): Promise<{ content: Uint8Array } | { error: string }> => {
  const inspection = await inspectMobileconfig(bytes);

  if (!inspection) return { error: "The stored configuration profile could not be decoded." };

  if (!inspection.payloads.some((payload) => payload.type === ESCROW_PAYLOAD_TYPE))
    return { content: bytes };

  if (inspection.form !== "plist")
    return {
      error:
        "This signed configuration profile escrows FileVault keys and cannot be rewritten to use the tenant escrow certificate.",
    };

  const payloads = payloadsFromMobileconfig(inspection.plist).map((payload) => ({ ...payload }));
  const der = await certificateDer(certificatePem);

  const escrowPayload = payloads.find(
    (payload) => plistText(payload.PayloadType) === ESCROW_PAYLOAD_TYPE,
  );

  if (!escrowPayload) return { content: bytes };

  const requestedUuid = plistText(escrowPayload.EncryptCertPayloadUUID);

  let certificatePayload = payloads.find(
    (payload) => plistText(payload.PayloadType) === ESCROW_CERTIFICATE_PAYLOAD_TYPE,
  );

  if (certificatePayload) {
    certificatePayload.PayloadContent = der;
  } else {
    certificatePayload = {
      PayloadCertificateFileName: "mattrax-filevault-escrow.cer",
      PayloadContent: der,
      PayloadDisplayName: "Mattrax FileVault escrow certificate",
      PayloadIdentifier: `${inspection.identifier ?? "app.mattrax"}.filevault-escrow`,
      PayloadType: ESCROW_CERTIFICATE_PAYLOAD_TYPE,
      PayloadUUID: requestedUuid ?? crypto.randomUUID().toUpperCase(),
      PayloadVersion: 1,
    };
    payloads.push(certificatePayload);
  }

  escrowPayload.EncryptCertPayloadUUID =
    plistText(certificatePayload.PayloadUUID) ?? requestedUuid ?? crypto.randomUUID().toUpperCase();

  const plist = await Effect.runPromise(
    serializePlist({ ...inspection.plist, PayloadContent: payloads }),
  );

  return { content: encoder.encode(plist) };
};

export const buildAssetContent = (
  row: PolicyConfigurationRow,
): { content: Uint8Array; contentType: string } | null => {
  if (!isCertificateKind(row.kind)) return null;
  const pem = asRecord(row.data)?.pem;

  if (!Schema.is(Schema.String)(pem)) return null;

  return { content: encoder.encode(pem), contentType: "application/pem" };
};

export const certificateOrganizationalUnit = (
  identityCertificate: string | undefined,
): string | null => {
  if (!identityCertificate) return null;
  let text = identityCertificate;

  try {
    text = decodeURIComponent(identityCertificate);
  } catch {
    // Header may already be decoded.
  }

  return text.match(/(?:^|[,/\n])\s*OU\s*=\s*([^,/\n]+)/i)?.[1]?.trim() ?? null;
};

/**
 * Assets are tenant-scoped. When the request carries the device's MDM identity
 * certificate (the normal mTLS path) the OU must match the policy owner. DDM
 * asset fetches use a signed URL instead and are validated separately.
 */
export const certificateAllowsOrganization = (
  identityCertificate: string | undefined,
  organizationId: string,
): boolean => certificateOrganizationalUnit(identityCertificate) === organizationId;

/**
 * Verify a DDM asset `DataURL` token.
 *
 * Returns the device token and expiry the link was issued for, or `null` when it
 * is malformed, expired, tampered with or belongs to another policy/kind. The
 * caller must resolve `deviceToken` and confirm the device is still enrolled for
 * the policy's tenant, which is what makes the link revocable.
 */
export const verifyAssetRequestToken = (
  authSecret: string,
  token: string | undefined,
  row: Pick<PolicyConfigurationRow, "policyId" | "kind">,
  now?: number,
): Promise<VerifiedAppleAssetToken | null> =>
  token
    ? verifyAppleAssetToken(authSecret, token, { policyId: row.policyId, kind: row.kind }, now)
    : Promise.resolve(null);

export type WindowsPolicyNode = {
  omaUri: string;
  value: Schema.Json;
  format?: string;
};

/** Extract OMA-URI nodes from a Windows custom policy configuration. */
export const windowsPolicyNodes = (row: PolicyConfigurationRow): Array<WindowsPolicyNode> => {
  if (parseConfigurationKind(row.kind).type !== "windows") return [];
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

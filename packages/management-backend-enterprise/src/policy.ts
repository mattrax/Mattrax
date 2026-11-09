import { Effect } from "effect";
import { parsePlist, serializePlist } from "@mattrax/plist";
import {
  signAppleAssetToken,
  signAppleProfileToken,
  verifyAppleAssetToken,
} from "@mattrax/dm-apple";

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
  readonly data: unknown;
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
};

export type CompiledDeclaration = {
  readonly Type: string;
  readonly Identifier: string;
  readonly ServerToken: string;
  readonly Payload: Record<string, unknown>;
};

export type ConfigurationKind =
  | { readonly type: "device" }
  | { readonly type: "custom"; readonly id: string }
  | { readonly type: "certificate"; readonly id: string }
  | { readonly type: "declaration"; readonly id: string }
  | { readonly type: "application"; readonly id: string }
  | { readonly type: "unknown" };

const IDENTIFIER_PATTERN = /^[A-Za-z0-9]{1,20}$/;
const encoder = new TextEncoder();

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export const parseConfigurationKind = (kind: string): ConfigurationKind => {
  if (kind === "mttx.apple.device") return { type: "device" };
  const match = /^mttx\.apple\.(custom|certificate|declaration|application)\.(.+)$/.exec(kind);
  if (!match) return { type: "unknown" };
  const [, group, id] = match;
  if (!IDENTIFIER_PATTERN.test(id!)) return { type: "unknown" };
  switch (group) {
    case "custom":
      return { type: "custom", id: id! };
    case "certificate":
      return { type: "certificate", id: id! };
    case "declaration":
      return { type: "declaration", id: id! };
    case "application":
      return { type: "application", id: id! };
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const decodeBase64 = (value: string): Uint8Array => {
  const cleaned = value.replace(/\s/g, "");
  const binary = atob(cleaned);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const sha256Hex = async (value: string | Uint8Array): Promise<string> => {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

const payloadsFromMobileconfig = (
  root: Record<string, unknown>,
): Array<Record<string, unknown>> => {
  const content = root.PayloadContent;
  if (Array.isArray(content)) return content.filter(isRecord);
  if (isRecord(content)) return [content];
  return [];
};

/**
 * Validate a configuration before it is persisted. Anything that cannot be
 * deployed by an Apple device is rejected at patch time (rather than being
 * stored and silently ignored during declaration sync).
 */
export const validateConfiguration = (kind: string, data: unknown): Effect.Effect<void, string> =>
  Effect.gen(function* () {
    const parsed = parseConfigurationKind(kind);
    switch (parsed.type) {
      case "unknown":
        return yield* Effect.fail(
          `Unknown configuration kind "${kind}". Supported kinds are mttx.apple.device, mttx.apple.custom.<id>, mttx.apple.certificate.<id> and mttx.apple.declaration.<id>.`,
        );
      case "application":
        return yield* Effect.fail(
          `"${kind}" is not supported: application deployment is not implemented yet. Remove it from the policy or upload the app as a custom mobileconfig.`,
        );
      case "device": {
        const record = asRecord(data);
        if (!record) return yield* Effect.fail(`"${kind}" must be an object`);
        if (record.camera !== undefined && typeof record.camera !== "boolean")
          return yield* Effect.fail(`"${kind}.camera" must be a boolean`);
        return;
      }
      case "custom": {
        const record = asRecord(data);
        if (!record || typeof record.content !== "string" || record.content.length === 0)
          return yield* Effect.fail(`"${kind}" requires a base64 encoded "content" string`);
        let bytes: Uint8Array;
        try {
          bytes = decodeBase64(record.content);
        } catch {
          return yield* Effect.fail(`"${kind}.content" is not valid base64`);
        }
        const text = new TextDecoder().decode(bytes);
        const plist = yield* parsePlist(text).pipe(
          Effect.mapError(
            (cause) =>
              `"${kind}.content" is not a valid mobileconfig plist: ${cause.message ?? String(cause)}`,
          ),
        );
        if (!isRecord(plist))
          return yield* Effect.fail(`"${kind}.content" must contain a plist dictionary`);
        const hasMdm = payloadsFromMobileconfig(plist).some(
          (payload) => payload.PayloadType === "com.apple.mdm",
        );
        if (hasMdm)
          return yield* Effect.fail(
            `"${kind}.content" contains a com.apple.mdm payload, which cannot be deployed as a managed profile`,
          );
        return;
      }
      case "certificate": {
        const record = asRecord(data);
        if (!record || typeof record.pem !== "string" || record.pem.length === 0)
          return yield* Effect.fail(`"${kind}" requires a PEM "pem" string`);
        const begins = record.pem.match(/-----BEGIN CERTIFICATE-----/g)?.length ?? 0;
        const ends = record.pem.match(/-----END CERTIFICATE-----/g)?.length ?? 0;
        if (begins !== 1 || ends !== 1)
          return yield* Effect.fail(`"${kind}.pem" must contain exactly one PEM certificate`);
        return;
      }
      case "declaration": {
        const record = asRecord(data);
        if (!record || typeof record.kind !== "string" || record.kind.length === 0)
          return yield* Effect.fail(`"${kind}" requires a declaration "kind" string`);
        if (!record.kind.startsWith("com.apple."))
          return yield* Effect.fail(
            `"${kind}.kind" must be an Apple declaration type (for example com.apple.configuration.services.configuration-files)`,
          );
        if (!isRecord(record.configuration))
          return yield* Effect.fail(`"${kind}" requires a "configuration" object`);
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
    case "declaration":
      return typeof (row.data as Record<string, unknown>).kind === "string"
        ? ((row.data as Record<string, unknown>).kind as string)
        : null;
    default:
      return null;
  }
};

/**
 * Server tokens incorporate the actual payload plus anything that appears in
 * the rendered declaration (for legacy profiles that means origin and device
 * token). A content edit therefore always produces a new token.
 */
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

export const configurationAssetServerToken = async (
  row: PolicyConfigurationRow,
  context: Pick<DeclarationContext, "origin" | "deviceToken">,
): Promise<string> =>
  (
    await sha256Hex(
      [row.hash, context.origin, context.deviceToken, row.policyId, row.kind].join("\u0000"),
    )
  ).toUpperCase();

export const configurationProfileUrl = async (
  row: PolicyConfigurationRow,
  context: DeclarationContext,
): Promise<string> => {
  const token = await signAppleProfileToken(context.authSecret, {
    policyId: row.policyId,
    kind: row.kind,
    deviceToken: context.deviceToken,
  });
  const origin = trimTrailingSlash(context.origin);
  return `${origin}/mdm/apple/profiles/${encodeURIComponent(context.deviceToken)}/${encodeURIComponent(row.policyId)}/${encodeURIComponent(row.kind)}?token=${encodeURIComponent(token)}`;
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
      const data = row.data as Record<string, unknown>;
      return {
        Type: type,
        Identifier: identifier,
        ServerToken: serverToken,
        Payload: data.configuration as Record<string, unknown>,
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
  const data = row.data as Record<string, unknown>;
  if (typeof data.pem !== "string") return null;

  const identifier = configurationAssetIdentifier(row.policyId, row.kind);
  const serverToken = await configurationAssetServerToken(row, context);
  const assetToken = await signAppleAssetToken(context.authSecret, row.policyId, row.kind);
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
        "Hash-SHA-256": await sha256Hex(pemBytes),
        Size: pemBytes.byteLength,
      },
    },
  };
};

const legacyDeviceProfile = (row: PolicyConfigurationRow) => {
  const data = row.data as Record<string, unknown>;
  const allowCamera = data.camera !== false;
  return {
    PayloadContent: [
      {
        allowCamera,
        PayloadIdentifier: `app.mattrax.p.${row.policyId}.${row.kind}.applicationaccess`,
        PayloadType: "com.apple.applicationaccess",
        PayloadUUID: `${row.policyId}-${row.kind}`,
        PayloadVersion: 1,
      },
    ],
    PayloadDisplayName: `Mattrax policy ${row.policyId}`,
    PayloadIdentifier: `app.mattrax.p.${row.policyId}.${row.kind}`,
    PayloadOrganization: "Mattrax",
    PayloadType: "Configuration",
    PayloadUUID: `${row.policyId}-${row.kind}`,
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
    const content = (row.data as Record<string, unknown>).content;
    if (typeof content !== "string") return null;
    return {
      content: decodeBase64(content),
      contentType: "application/x-apple-aspen-config",
    };
  }
  if (parsed.type === "device") {
    const plist = await Effect.runPromise(serializePlist(legacyDeviceProfile(row)));
    return {
      content: encoder.encode(plist),
      contentType: "application/x-apple-aspen-config",
    };
  }
  return null;
};

export const buildAssetContent = (
  row: PolicyConfigurationRow,
): { content: Uint8Array; contentType: string } | null => {
  if (!isCertificateKind(row.kind)) return null;
  const pem = (row.data as Record<string, unknown>).pem;
  if (typeof pem !== "string") return null;
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

export const verifyAssetRequestToken = (
  authSecret: string,
  token: string | undefined,
  row: Pick<PolicyConfigurationRow, "policyId" | "kind">,
): Promise<boolean> =>
  token ? verifyAppleAssetToken(authSecret, token, row.policyId, row.kind) : Promise.resolve(false);

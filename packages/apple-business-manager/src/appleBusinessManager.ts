import { and, eq } from "drizzle-orm";
import { Effect, Layer, Option, Predicate, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { openSecret, sealSecret } from "@mattrax/crypto";
import { parsePlist, PlistValue } from "@mattrax/plist";
import { schema } from "@mattrax/enterprise-core";
import type { EnterpriseDb } from "@mattrax/enterprise-core";
import { signToken, verifyToken } from "@mattrax/enterprise-tokens";
import { AppleBusinessManagerError } from "./errors.js";
import type { AppleBusinessManagerErrorKind } from "./errors.js";

/**
 * Apple Business Manager (ABM/ADE) integration.
 *
 * Apple replaced the legacy DEP server-token protocol with an OAuth 2 API
 * (`https://api-business.apple.com/v1`, or `api-school.apple.com` for Apple
 * School Manager). An API account is identified by a Client ID and Key ID and
 * signs a short-lived ES256 client assertion with an EC P-256 private key. The
 * assertion is exchanged for a one-hour bearer token.
 *
 * This module accepts both credential shapes:
 *  - `abm_api`: the current OAuth API account (JSON bundle or PEM + ids).
 *  - `legacy_dep`: a `.p7m` DEP server token, validated and stored but not
 *    syncable through the current API. The UI and docs explain the migration;
 *    sync fails closed instead of pretending the legacy token still works.
 *
 * Every outbound request runs on an Effect `HttpClient` with an explicit
 * deadline, and the `fetch` implementation is injectable so tests never touch
 * Apple.
 */

export { AppleBusinessManagerError };
export type { AppleBusinessManagerErrorKind };

const now = () => new Date();

/** Truncate and redact Apple/provider errors before storing or returning them. */
export const describeAppleError = (cause: unknown): string => {
  const text =
    cause instanceof Error
      ? cause.message
      : Schema.is(Schema.String)(cause)
        ? cause
        : (() => {
            try {
              return JSON.stringify(cause);
            } catch {
              return String(cause);
            }
          })();

  return text
    .replaceAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replaceAll(
      /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?=$|[^A-Za-z0-9_-])/g,
      "[client_assertion]",
    )
    .replaceAll(/(client_assertion(?:=|%3D))[^&\s]+/gi, "$1[client_assertion]")
    .replaceAll(/\s+/g, " ")
    .slice(0, 500);
};

const fail = (kind: AppleBusinessManagerErrorKind, message: string, cause?: unknown) =>
  new AppleBusinessManagerError({ kind, message, cause });

const notConfigured = () =>
  fail("not_configured", "Apple Business Manager is not configured for this tenant.");

const mapAppleError = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
  effect.pipe(
    Effect.mapError((cause) =>
      cause instanceof AppleBusinessManagerError
        ? cause
        : fail("upstream", describeAppleError(cause), cause),
    ),
  );

// ─── Credential shapes and parsing ───────────────────────────────

export type AbmApiCredential = {
  readonly kind: "abm_api";
  readonly clientId: string;
  readonly teamId: string;
  readonly keyId: string;
  readonly privateKeyPem: string;
  readonly scope: "business.api" | "school.api";
  readonly orgId?: string;
  readonly orgName?: string;
  readonly expiresAt: Date | null;
};

export type LegacyDepCredential = {
  readonly kind: "legacy_dep";
  readonly consumerKey: string;
  readonly consumerSecret: string;
  readonly orgId: string;
  readonly orgName: string;
  readonly expiresAt: Date | null;
};

export type AbmCredential = AbmApiCredential | LegacyDepCredential;

export type AbmTokenUpload = {
  readonly content: string;
  readonly encoding?: "text" | "base64";
  readonly fileName?: string;
  readonly clientId?: string;
  readonly keyId?: string;
  readonly teamId?: string;
  readonly orgId?: string;
  readonly orgName?: string;
  readonly scope?: "business.api" | "school.api";
};

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

type CredentialValue = Schema.Json | PlistValue | undefined;

type CredentialRecord = Record<string, CredentialValue>;

const CredentialValueSchema = Schema.Union([Schema.Json, PlistValue]);

const CredentialRecordSchema = Schema.Record(Schema.String, CredentialValueSchema);

const text = (value: CredentialValue): string | undefined =>
  Option.getOrUndefined(Schema.decodeUnknownOption(Schema.String)(value))?.trim() || undefined;

const record = (value: CredentialValue): CredentialRecord | undefined =>
  Schema.is(CredentialRecordSchema)(value) ? value : undefined;

const firstValue = (value: CredentialRecord, keys: ReadonlyArray<string>): CredentialValue => {
  for (const key of keys) {
    const found = value[key];

    if (found === undefined || found === null) continue;
    if (typeof found === "string" && !found.trim()) continue;

    return found;
  }

  return undefined;
};

const firstText = (value: CredentialRecord, keys: ReadonlyArray<string>) => {
  for (const key of keys) {
    const found = text(value[key]);

    if (found) return found;
  }

  return undefined;
};

/** Parse plist dates, Apple's `YYYY-MM-DDTHH:MM:SS+0000`, and ISO-8601 dates. */
export const parseAppleDate = (value: CredentialValue): Date | null => {
  const date = Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Date)(value));

  if (date) return Number.isFinite(date.getTime()) ? date : null;

  const raw = text(value);

  if (!raw) return null;

  const normalised = raw
    .replace(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})([+-])(\d{2})(\d{2})$/, "$1$2$3:$4")
    .replace(" ", "T");

  const parsed = Date.parse(normalised);

  return Number.isFinite(parsed) ? new Date(parsed) : null;
};

const base64ToBytes = (value: string): Uint8Array => {
  const cleaned = value.replaceAll(/\s/g, "");
  const binary = atob(cleaned);

  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
};

const decodeUpload = (upload: AbmTokenUpload): string => {
  if (upload.encoding !== "base64") return upload.content;

  try {
    return new TextDecoder().decode(base64ToBytes(upload.content));
  } catch (error) {
    throw fail("invalid_token", "The uploaded token is not valid base64.", error);
  }
};

const tryJson = (value: string): Schema.Json | undefined => {
  const trimmed = value.trim();

  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return undefined;

  try {
    return Option.getOrUndefined(Schema.decodeUnknownOption(Schema.Json)(JSON.parse(trimmed)));
  } catch {
    return undefined;
  }
};

const tryBase64Json = (value: string): Schema.Json | undefined => {
  const trimmed = value.replaceAll(/\s/g, "");

  if (!/^[A-Za-z0-9+/=]+$/.test(trimmed) || trimmed.length < 8) return undefined;

  try {
    return tryJson(new TextDecoder().decode(base64ToBytes(trimmed)));
  } catch {
    return undefined;
  }
};

const pemFrom = (value: string, label: RegExp): string | undefined => {
  const match = label.exec(value);

  return match ? match[0].trim() : undefined;
};

const PRIVATE_KEY_PEM =
  /-----BEGIN (?:EC )?PRIVATE KEY-----[\s\S]*?-----END (?:EC )?PRIVATE KEY-----/;

const PKCS7_PEM = /-----BEGIN PKCS7-----[\s\S]*?-----END PKCS7-----/;

/** Validate that a PEM is an unencrypted PKCS#8 EC P-256 key. */
export const validateAbmPrivateKey = async (pem: string): Promise<void> => {
  if (!/-----BEGIN PRIVATE KEY-----/.test(pem))
    throw fail(
      "invalid_token",
      "The ABM private key must be an unencrypted PKCS#8 PEM key (-----BEGIN PRIVATE KEY-----). Convert Apple's .p12 key before uploading it.",
    );
  let der: Uint8Array;

  try {
    const body = pem
      .replace(/-----BEGIN PRIVATE KEY-----/, "")
      .replace(/-----END PRIVATE KEY-----/, "")
      .replaceAll(/\s/g, "");

    der = base64ToBytes(body);
  } catch (error) {
    throw fail("invalid_token", "The ABM private key is not valid PEM.", error);
  }

  try {
    await crypto.subtle.importKey(
      "pkcs8",
      new Uint8Array(der).buffer,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
  } catch (error) {
    throw fail(
      "invalid_token",
      "The ABM private key is not an EC P-256 key Apple can use for ES256 client assertions.",
      error,
    );
  }
};

/** Extract the plist payload from a legacy PKCS#7 `.p7m` DEP server token. */
const extractPkcs7Plist = async (bytes: Uint8Array): Promise<CredentialRecord> => {
  try {
    const pkijs = await import("pkijs");
    const der = new Uint8Array(bytes.byteLength);
    der.set(bytes);

    const contentInfo = pkijs.ContentInfo.fromBER(der.buffer);

    if (contentInfo.contentType !== pkijs.ContentInfo.SIGNED_DATA)
      throw new Error("The token is not a PKCS#7 signed payload");
    const signedData = new pkijs.SignedData({ schema: contentInfo.content });

    const content = signedData.encapContentInfo.eContent;
    const value = content?.getValue();

    if (!value) throw new Error("The token has no signed content");
    const parsed = await Effect.runPromise(parsePlist(new TextDecoder().decode(value)));
    const result = record(parsed);

    if (!result) throw new Error("The token content is not a dictionary");

    return result;
  } catch (error) {
    throw fail(
      "invalid_token",
      "Could not read the legacy DEP .p7m server token. Download a fresh token from Apple Business Manager, or upload the current API private key with its Client ID and Key ID.",
      error,
    );
  }
};

const legacyCredentialFrom = (value: CredentialRecord): LegacyDepCredential => {
  const consumerKey = firstText(value, ["consumer_key", "consumerKey", "ConsumerKey"]);
  const consumerSecret = firstText(value, ["consumer_secret", "consumerSecret", "ConsumerSecret"]);
  const orgId = firstText(value, ["org_id", "orgId", "OrgId", "orgIdStr"]);
  const orgName = firstText(value, ["org_name", "orgName", "OrgName"]);

  const expiresAt = parseAppleDate(
    firstValue(value, [
      "token_expiration_date",
      "tokenExpirationDate",
      "expiration_date",
      "expirationDate",
      "expDate",
      "expiry",
      "expires",
    ]),
  );

  if (!consumerKey || !consumerSecret || !orgId)
    throw fail(
      "invalid_token",
      "The legacy DEP token is missing its consumer key, consumer secret or organization id.",
    );

  if (expiresAt && expiresAt.getTime() <= Date.now())
    throw fail(
      "expired",
      "This legacy DEP server token has expired. Download a new token from Apple Business Manager.",
    );

  return {
    kind: "legacy_dep",
    consumerKey,
    consumerSecret,
    orgId,
    orgName: orgName ?? orgId,
    expiresAt,
  };
};

const apiCredentialFrom = (
  value: CredentialRecord,
  upload: AbmTokenUpload,
  privateKeyPem?: string,
): AbmApiCredential => {
  const clientId =
    firstText(value, ["clientId", "client_id", "clientID"]) ?? upload.clientId?.trim();

  const keyId = firstText(value, ["keyId", "key_id", "keyID"]) ?? upload.keyId?.trim();

  const teamId =
    firstText(value, ["teamId", "team_id", "teamID"]) ?? upload.teamId?.trim() ?? clientId;

  const privateKey =
    privateKeyPem ??
    firstText(value, ["privateKey", "private_key", "privateKeyPem", "private_key_pem", "key"]);

  const scopeValue = firstText(value, ["scope"]) ?? upload.scope ?? "business.api";
  const scope = scopeValue === "school.api" ? "school.api" : "business.api";
  const orgId = firstText(value, ["orgId", "org_id"]) ?? upload.orgId?.trim();
  const orgName = firstText(value, ["orgName", "org_name"]) ?? upload.orgName?.trim();

  const expiresAt = parseAppleDate(
    firstValue(value, ["expiresAt", "expires_at", "tokenExpirationDate", "expDate"]),
  );

  if (!clientId)
    throw fail(
      "invalid_token",
      "The ABM API account is missing its Client ID. Copy it from Apple Business Manager → Settings → API.",
    );

  if (!keyId)
    throw fail(
      "invalid_token",
      "The ABM API account is missing its Key ID. Copy it from Apple Business Manager → Settings → API.",
    );

  if (!privateKey)
    throw fail(
      "invalid_token",
      "The ABM API private key is missing. Upload Apple's .pem key or include `privateKey` in the JSON bundle.",
    );
  const pem = pemFrom(privateKey, PRIVATE_KEY_PEM);

  if (!pem)
    throw fail(
      "invalid_token",
      "The ABM private key must be an unencrypted PKCS#8 PEM key (-----BEGIN PRIVATE KEY-----).",
    );

  if (expiresAt && expiresAt.getTime() <= Date.now())
    throw fail("expired", "The ABM API credential has expired.");

  const credential: Mutable<AbmApiCredential> = {
    kind: "abm_api",
    clientId,
    teamId: teamId ?? clientId,
    keyId,
    privateKeyPem: pem,
    scope,
    expiresAt,
  };

  if (orgId) credential.orgId = orgId;

  if (orgName) credential.orgName = orgName;

  return credential;
};

/**
 * Parse an uploaded ABM credential. The parser accepts:
 *  - a JSON bundle (`clientId`, `keyId`, optional `teamId`/`privateKey`);
 *  - a PEM private key plus `clientId`/`keyId` fields;
 *  - a base64 or raw legacy DEP `.p7m` token.
 */
export const parseAbmTokenUpload = async (upload: AbmTokenUpload): Promise<AbmCredential> => {
  const decoded = decodeUpload(upload).trim();

  if (!decoded) throw fail("invalid_token", "The uploaded Apple token is empty.");

  const json = tryJson(decoded) ?? tryBase64Json(decoded);
  const jsonRecord = record(json);

  if (jsonRecord) {
    if (
      "consumer_key" in jsonRecord ||
      "consumerKey" in jsonRecord ||
      "consumer_secret" in jsonRecord ||
      "consumerSecret" in jsonRecord
    )
      return legacyCredentialFrom(jsonRecord);
    const credential = apiCredentialFrom(jsonRecord, upload);
    await validateAbmPrivateKey(credential.privateKeyPem);

    return credential;
  }

  const privateKey =
    decoded.startsWith("<?xml") || decoded.startsWith("<plist")
      ? undefined
      : pemFrom(decoded, PRIVATE_KEY_PEM);

  if (privateKey) {
    const credential = apiCredentialFrom({}, upload, privateKey);
    await validateAbmPrivateKey(credential.privateKeyPem);

    return credential;
  }

  // A legacy `.p7m` may be raw DER, PEM-wrapped PKCS#7, or plist XML.
  let bytes: Uint8Array | undefined;
  const pkcs7Pem = pemFrom(decoded, PKCS7_PEM);

  if (pkcs7Pem) {
    bytes = base64ToBytes(
      pkcs7Pem.replace(/-----BEGIN PKCS7-----/, "").replace(/-----END PKCS7-----/, ""),
    );
  } else if (decoded.startsWith("<?xml") || decoded.startsWith("<plist")) {
    const parsed = await Effect.runPromise(parsePlist(decoded)).catch(() => undefined);
    const value = record(parsed);

    if (value) {
      if (
        "consumer_key" in value ||
        "consumerKey" in value ||
        "consumer_secret" in value ||
        "consumerSecret" in value
      )
        return legacyCredentialFrom(value);

      const credential = apiCredentialFrom(value, upload);
      await validateAbmPrivateKey(credential.privateKeyPem);

      return credential;
    }
  } else if (upload.encoding === "base64") {
    bytes = base64ToBytes(upload.content);
  } else if (
    decoded.length > 0 &&
    decoded.split("").every((char) => char.charCodeAt(0) <= 0xff) &&
    decoded.charCodeAt(0) === 0x30
  ) {
    bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  }

  if (bytes) {
    const value = await extractPkcs7Plist(bytes);

    return legacyCredentialFrom(value);
  }

  throw fail(
    "invalid_token",
    "Unrecognised Apple token. Upload the ABM API private key (.pem) with its Client ID and Key ID, a JSON credential bundle, or a legacy DEP .p7m server token.",
  );
};

export const sealAbmCredential = async (
  authSecret: string,
  credential: AbmCredential,
): Promise<string> => {
  const payload = {
    ...credential,
    expiresAt: credential.expiresAt ? credential.expiresAt.toISOString() : null,
  };

  return sealSecret(authSecret, JSON.stringify(payload));
};

export const openAbmCredential = async (
  authSecret: string,
  sealed: string,
): Promise<AbmCredential> => {
  let parsed: CredentialValue;

  try {
    parsed = JSON.parse(await openSecret(authSecret, sealed));
  } catch (error) {
    throw fail(
      "invalid_token",
      "The stored Apple Business Manager credential could not be decrypted. Re-upload the token.",
      error,
    );
  }

  const value = record(parsed);

  if (!value)
    throw fail("invalid_token", "The stored Apple Business Manager credential is malformed.");
  const expiresAt = parseAppleDate(value.expiresAt);

  if (value.kind === "legacy_dep") {
    const consumerKey = text(value.consumerKey);
    const consumerSecret = text(value.consumerSecret);
    const orgId = text(value.orgId);

    if (!consumerKey || !consumerSecret || !orgId)
      throw fail("invalid_token", "The stored legacy DEP credential is incomplete.");

    return {
      kind: "legacy_dep",
      consumerKey,
      consumerSecret,
      orgId,
      orgName: text(value.orgName) ?? orgId,
      expiresAt,
    };
  }

  const clientId = text(value.clientId);
  const keyId = text(value.keyId);
  const privateKeyPem = text(value.privateKeyPem);

  if (!clientId || !keyId || !privateKeyPem)
    throw fail("invalid_token", "The stored ABM API credential is incomplete.");

  const credential: Mutable<AbmApiCredential> = {
    kind: "abm_api",
    clientId,
    teamId: text(value.teamId) ?? clientId,
    keyId,
    privateKeyPem,
    scope: value.scope === "school.api" ? "school.api" : "business.api",
    expiresAt,
  };

  const orgId = text(value.orgId);
  const orgName = text(value.orgName);

  if (orgId) credential.orgId = orgId;

  if (orgName) credential.orgName = orgName;

  return credential;
};

// ─── OAuth + typed API client ────────────────────────────────────

export const ABM_DEFAULT_TOKEN_URL = "https://account.apple.com/auth/oauth2/token";

export const ABM_DEFAULT_ASSERTION_AUDIENCE = "https://account.apple.com/auth/oauth2/v2/token";

/** Apple answers fast or the credential is dead; never hold a sync open. */
export const ABM_REQUEST_TIMEOUT_MS = 15_000;

export const ABM_BUSINESS_BASE_URL = "https://api-business.apple.com/v1";

export const ABM_SCHOOL_BASE_URL = "https://api-school.apple.com/v1";

export type AppleApiConfig = {
  /** Injected fetch for tests. Defaults to the runtime `fetch`. */
  readonly fetch?: typeof globalThis.fetch;
  /** Deadline for every outbound Apple request. Defaults to 15s. */
  readonly timeoutMs?: number;
  readonly tokenUrl?: string;
  readonly assertionAudience?: string;
  readonly businessBaseUrl?: string;
  readonly schoolBaseUrl?: string;
  /** Clock override for tests. */
  readonly now?: () => number;
};

const bytesToBase64Url = (bytes: Uint8Array) =>
  bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

const base64UrlJson = (value: Schema.Json) =>
  bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));

const importAbmSigningKey = async (pem: string): Promise<CryptoKey> => {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replaceAll(/\s/g, "");

  const der = base64ToBytes(body);

  return crypto.subtle.importKey(
    "pkcs8",
    new Uint8Array(der).buffer,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
};

/** Build the ES256 client assertion Apple's OAuth server expects. */
export const buildClientAssertion = async (input: {
  readonly credential: AbmApiCredential;
  readonly audience?: string;
  readonly now?: () => number;
  readonly ttlSeconds?: number;
}): Promise<string> => {
  const issuedAt = Math.floor((input.now?.() ?? Date.now()) / 1000);
  const header = base64UrlJson({ alg: "ES256", kid: input.credential.keyId, typ: "JWT" });

  const payload = base64UrlJson({
    iss: input.credential.teamId,
    sub: input.credential.clientId,
    aud: input.audience ?? ABM_DEFAULT_ASSERTION_AUDIENCE,
    iat: issuedAt,
    exp: issuedAt + (input.ttlSeconds ?? 300),
    jti: crypto.randomUUID(),
  });

  const key = await importAbmSigningKey(input.credential.privateKeyPem);

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );

  return `${header}.${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
};

export type AbmAccessToken = {
  readonly accessToken: string;
  readonly tokenType: "Bearer";
  readonly expiresIn: number;
  readonly expiresAt: Date;
  readonly scope?: string;
};

export type AbmOrgDevice = {
  readonly id: string;
  readonly serialNumber: string;
  readonly model?: string;
  readonly productFamily?: string;
  readonly productType?: string;
  readonly status: "ASSIGNED" | "UNASSIGNED" | string;
  readonly updatedDateTime?: string;
  readonly addedToOrgDateTime?: string;
  readonly raw: Record<string, Schema.Json>;
};

export type AbmMdmServer = {
  readonly id: string;
  readonly serverName?: string;
  readonly serverType?: string;
  readonly status?: string;
  readonly deviceCount?: number;
};

export type AbmApp = {
  readonly id: string;
  readonly name?: string;
  readonly bundleId?: string;
  readonly version?: string;
};

export type AbmClient = {
  readonly exchangeAccessToken: (
    credential: AbmApiCredential,
  ) => Effect.Effect<AbmAccessToken, AppleBusinessManagerError>;
  readonly listOrgDevices: (
    accessToken: string,
    options?: { readonly serial?: string; readonly status?: "ASSIGNED" | "UNASSIGNED" },
  ) => Effect.Effect<AbmOrgDevice[], AppleBusinessManagerError>;
  readonly listMdmServers: (
    accessToken: string,
  ) => Effect.Effect<AbmMdmServer[], AppleBusinessManagerError>;
  readonly createMdmServer: (
    accessToken: string,
    input: { readonly serverName: string; readonly certificatePem: string },
  ) => Effect.Effect<AbmMdmServer, AppleBusinessManagerError>;
  readonly assignDevices: (
    accessToken: string,
    input: { readonly mdmServerId: string; readonly deviceIds: ReadonlyArray<string> },
  ) => Effect.Effect<
    { readonly activityId?: string; readonly status?: string },
    AppleBusinessManagerError
  >;
  readonly getAssignedServerId: (
    accessToken: string,
    deviceId: string,
  ) => Effect.Effect<string | null, AppleBusinessManagerError>;
  readonly listMdmServerDeviceIds: (
    accessToken: string,
    mdmServerId: string,
  ) => Effect.Effect<string[], AppleBusinessManagerError>;
  readonly listApps: (accessToken: string) => Effect.Effect<AbmApp[], AppleBusinessManagerError>;
};

type ClientAssertionInput = {
  credential: AbmApiCredential;
  audience?: string;
  now?: () => number;
};

type AssignedDevicesActivity = { activityId?: string; status?: string };

type EnsureMdmServerInput = {
  existingId: string | null;
  serverName: string;
  certificatePem?: string;
};

type AssignedAppleDevice = {
  serial: string;
  mdmServerId: string;
  activityId?: string;
};

const AppleErrorBodySchema = Schema.Struct({
  errors: Schema.optional(
    Schema.Array(
      Schema.Struct({
        title: Schema.optional(Schema.String),
        detail: Schema.optional(Schema.String),
        status: Schema.optional(Schema.String),
        code: Schema.optional(Schema.String),
      }),
    ),
  ),
});

type AppleErrorBody = typeof AppleErrorBodySchema.Type;

const appleErrorMessage = (body: AppleErrorBody | undefined, fallback: string): string => {
  const first = body?.errors?.[0];
  const detail = first?.detail ?? first?.title;

  return detail ? `${fallback}: ${describeAppleError(detail)}` : fallback;
};

const AbmAttributesSchema = Schema.Record(Schema.String, Schema.Json);

const AbmResourceSchema = Schema.Struct({
  id: Schema.NonEmptyString,
  attributes: Schema.optional(AbmAttributesSchema),
});

const AbmResourceResponseSchema = Schema.Struct({ data: AbmResourceSchema });

const AssignedServerResponseSchema = Schema.Struct({
  data: Schema.NullOr(AbmResourceSchema),
});

const AssignedDevicesResponseSchema = Schema.Struct({
  data: Schema.Struct({
    id: Schema.optional(Schema.NonEmptyString),
    attributes: Schema.optional(
      Schema.Struct({
        status: Schema.optional(Schema.String),
        subStatus: Schema.optional(Schema.String),
      }),
    ),
  }),
});

const OAuthTokenResponseSchema = Schema.Struct({
  access_token: Schema.NonEmptyString,
  token_type: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
  scope: Schema.optional(Schema.String),
});

const OAuthErrorResponseSchema = Schema.Struct({
  error: Schema.optional(Schema.String),
  error_description: Schema.optional(Schema.String),
});

/** Parse JSON without trusting its shape; callers validate it with a Schema. */
const parseJson = (text: string): Schema.Json | undefined => {
  try {
    return Schema.decodeUnknownSync(Schema.Json)(JSON.parse(text));
  } catch {
    return undefined;
  }
};

const apiErrorKind = (status: number): AppleBusinessManagerErrorKind => {
  if (status === 401) return "unauthorized";

  if (status === 403) return "forbidden";

  if (status === 404) return "not_found";

  if (status === 409) return "conflict";

  return "upstream";
};

export const createAbmClient = (
  config: AppleApiConfig = {},
  defaultScope: "business.api" | "school.api" = "business.api",
): AbmClient => {
  const doFetch = config.fetch ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? ABM_REQUEST_TIMEOUT_MS;
  const tokenUrl = config.tokenUrl ?? ABM_DEFAULT_TOKEN_URL;

  // Every method below owns its client, so callers never thread a layer.
  const clientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, doFetch)),
  );

  const baseUrl = () =>
    defaultScope === "school.api"
      ? (config.schoolBaseUrl ?? ABM_SCHOOL_BASE_URL)
      : (config.businessBaseUrl ?? ABM_BUSINESS_BASE_URL);

  /**
   * One Apple API request. The deadline covers the response body as well as the
   * headers, so a stalled page fails like a hung connect.
   */
  const request = <T>(
    schema: Schema.Decoder<T>,
    url: string,
    accessToken: string,
    init: { readonly method?: "POST"; readonly body?: string } = {},
  ): Effect.Effect<T | undefined, AppleBusinessManagerError, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;

      const base =
        init.method === "POST"
          ? HttpClientRequest.post(url).pipe(
              HttpClientRequest.bodyText(init.body ?? "", "application/json"),
            )
          : HttpClientRequest.get(url);

      const sent = yield* Effect.gen(function* () {
        const response = yield* client.execute(
          base.pipe(
            HttpClientRequest.setHeaders({
              accept: "application/json",
              authorization: `Bearer ${accessToken}`,
            }),
          ),
        );

        return {
          status: response.status,
          text: yield* response.text.pipe(Effect.orElseSucceed(() => "")),
        };
      }).pipe(
        Effect.mapError((cause) =>
          fail(
            "upstream",
            `Apple Business API request failed: ${describeAppleError(cause)}`,
            cause,
          ),
        ),
        Effect.timeoutOrElse({
          duration: timeoutMs,
          orElse: () =>
            Effect.fail(
              fail("upstream", `Apple Business API request timed out after ${timeoutMs}ms`),
            ),
        }),
      );

      if (sent.status < 200 || sent.status > 299) {
        const body = Option.getOrUndefined(
          Schema.decodeUnknownOption(AppleErrorBodySchema)(parseJson(sent.text)),
        );

        return yield* Effect.fail(
          fail(
            apiErrorKind(sent.status),
            appleErrorMessage(body, `Apple Business API returned HTTP ${sent.status}`),
          ),
        );
      }

      if (sent.status === 204) return undefined;

      const json = parseJson(sent.text);

      if (json === undefined)
        return yield* Effect.fail(
          fail("invalid_response", "Apple Business API returned invalid JSON."),
        );

      const decoded = Option.getOrUndefined(Schema.decodeUnknownOption(schema)(json));

      if (decoded === undefined)
        return yield* Effect.fail(
          fail("invalid_response", "Apple Business API returned an invalid response shape."),
        );

      return decoded;
    });

  const paged = <T>(
    valueSchema: Schema.Decoder<T>,
    initialUrl: string,
    accessToken: string,
    base: string,
    maxItems?: number,
  ): Effect.Effect<T[], AppleBusinessManagerError, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      const pageSchema = Schema.Struct({
        data: Schema.Array(valueSchema),
        links: Schema.optional(Schema.Struct({ next: Schema.optional(Schema.String) })),
      });
      const items: T[] = [];
      let url: string | undefined = initialUrl;
      let pages = 0;

      while (url) {
        if (pages >= 100)
          return yield* Effect.fail(
            fail("invalid_response", "Apple Business API pagination exceeded 100 pages."),
          );
        pages++;

        const page = yield* request(pageSchema, url, accessToken);

        if (!page)
          return yield* Effect.fail(
            fail("invalid_response", "Apple Business API page did not include a data array."),
          );

        if (maxItems !== undefined && items.length + page.data.length > maxItems)
          return yield* Effect.fail(
            fail(
              "invalid_response",
              `Apple returned more than ${maxItems} ABM items; sync is bounded.`,
            ),
          );

        items.push(...page.data);

        const next = page.links?.next;
        if (!next) break;

        let nextUrl: URL;

        try {
          nextUrl = new URL(next);
        } catch {
          return yield* Effect.fail(
            fail("invalid_response", "Apple Business API returned an invalid pagination link."),
          );
        }

        if (nextUrl.origin !== new URL(base).origin)
          return yield* Effect.fail(
            fail("invalid_response", "Apple Business API pagination left the Apple origin."),
          );

        if (maxItems !== undefined && items.length >= maxItems)
          return yield* Effect.fail(
            fail(
              "invalid_response",
              `Apple returned at least ${maxItems} ABM items with another page; sync is bounded.`,
            ),
          );

        url = nextUrl.toString();
      }

      return items;
    });

  const exchangeAccessToken = (
    credential: AbmApiCredential,
  ): Effect.Effect<AbmAccessToken, AppleBusinessManagerError, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      const assertionInput: ClientAssertionInput = { credential };

      if (config.assertionAudience) assertionInput.audience = config.assertionAudience;
      if (config.now) assertionInput.now = config.now;

      const assertion = yield* Effect.tryPromise({
        try: () => buildClientAssertion(assertionInput),
        catch: (cause) =>
          fail("upstream", `Apple client assertion failed: ${describeAppleError(cause)}`, cause),
      });

      const params = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: credential.clientId,
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: assertion,
        scope: credential.scope,
      });

      const client = yield* HttpClient.HttpClient;

      const sent = yield* Effect.gen(function* () {
        const response = yield* client.execute(
          HttpClientRequest.post(tokenUrl).pipe(
            HttpClientRequest.bodyText(params.toString(), "application/x-www-form-urlencoded"),
          ),
        );

        return {
          status: response.status,
          text: yield* response.text.pipe(Effect.orElseSucceed(() => "")),
        };
      }).pipe(
        Effect.mapError((cause) =>
          fail("upstream", `Apple OAuth request failed: ${describeAppleError(cause)}`, cause),
        ),
        Effect.timeoutOrElse({
          duration: timeoutMs,
          orElse: () =>
            Effect.fail(fail("upstream", `Apple OAuth request timed out after ${timeoutMs}ms`)),
        }),
      );

      if (sent.status < 200 || sent.status > 299) {
        const body = Option.getOrUndefined(
          Schema.decodeUnknownOption(OAuthErrorResponseSchema)(parseJson(sent.text)),
        );

        return yield* Effect.fail(
          fail(
            sent.status === 400 || sent.status === 401 ? "unauthorized" : "upstream",
            body?.error_description
              ? `Apple rejected the ABM credential: ${describeAppleError(body.error_description)}`
              : `Apple rejected the ABM credential (HTTP ${sent.status}).`,
          ),
        );
      }

      const body = Option.getOrUndefined(
        Schema.decodeUnknownOption(OAuthTokenResponseSchema)(parseJson(sent.text)),
      );

      if (!body)
        return yield* Effect.fail(
          fail("invalid_response", "Apple OAuth response did not include a valid access token."),
        );

      const expiresIn = body.expires_in ?? 3600;

      const token: Mutable<AbmAccessToken> = {
        accessToken: body.access_token,
        tokenType: "Bearer",
        expiresIn,
        expiresAt: new Date((config.now?.() ?? Date.now()) + expiresIn * 1000),
      };

      if (body.scope) token.scope = body.scope;

      return token;
    });

  const listOrgDevices = (
    accessToken: string,
    options: { readonly serial?: string; readonly status?: "ASSIGNED" | "UNASSIGNED" } = {},
  ): Effect.Effect<AbmOrgDevice[], AppleBusinessManagerError> =>
    Effect.gen(function* () {
      const base = baseUrl();
      const params = new URLSearchParams({ limit: "1000" });

      if (options.serial) params.set("filter[serialNumber]", options.serial);
      if (options.status) params.set("filter[status]", options.status);

      const data = yield* paged(
        AbmResourceSchema,
        `${base}/orgDevices?${params.toString()}`,
        accessToken,
        base,
        5000,
      );

      return data.map((item) => {
        const attributes: Record<string, Schema.Json> = item.attributes ?? {};

        const device: Mutable<AbmOrgDevice> = {
          id: item.id,
          serialNumber: text(attributes.serialNumber) ?? item.id,
          status: text(attributes.status) ?? "UNASSIGNED",
          raw: attributes,
        };

        const model = text(attributes.deviceModel);
        const productFamily = text(attributes.productFamily);
        const productType = text(attributes.productType);
        const updatedDateTime = text(attributes.updatedDateTime);
        const addedToOrgDateTime = text(attributes.addedToOrgDateTime);

        if (model) device.model = model;
        if (productFamily) device.productFamily = productFamily;
        if (productType) device.productType = productType;
        if (updatedDateTime) device.updatedDateTime = updatedDateTime;
        if (addedToOrgDateTime) device.addedToOrgDateTime = addedToOrgDateTime;

        return device;
      });
    }).pipe(Effect.provide(clientLayer));

  const listMdmServers = (
    accessToken: string,
  ): Effect.Effect<AbmMdmServer[], AppleBusinessManagerError> =>
    Effect.gen(function* () {
      const base = baseUrl();

      const data = yield* paged(
        AbmResourceSchema,
        `${base}/mdmServers?limit=1000`,
        accessToken,
        base,
      );

      return data.map((item) => {
        const server: Mutable<AbmMdmServer> = { id: item.id };
        const serverName = text(item.attributes?.serverName);
        const serverType = text(item.attributes?.serverType);
        const status = text(item.attributes?.status);

        const deviceCount = Option.getOrUndefined(
          Schema.decodeUnknownOption(Schema.Number)(item.attributes?.deviceCount),
        );

        if (serverName) server.serverName = serverName;
        if (serverType) server.serverType = serverType;
        if (status) server.status = status;
        if (deviceCount !== undefined) server.deviceCount = deviceCount;

        return server;
      });
    }).pipe(Effect.provide(clientLayer));

  const createMdmServer = (
    accessToken: string,
    input: { readonly serverName: string; readonly certificatePem: string },
  ): Effect.Effect<AbmMdmServer, AppleBusinessManagerError> =>
    Effect.gen(function* () {
      const base = baseUrl();

      const certificate = input.certificatePem
        .replace(/-----BEGIN CERTIFICATE-----/, "")
        .replace(/-----END CERTIFICATE-----/, "")
        .replaceAll(/\s/g, "");

      const response = yield* request(
        AbmResourceResponseSchema,
        `${base}/mdmServers`,
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({
            data: {
              type: "mdmServers",
              attributes: {
                serverName: input.serverName,
                serverCertificate: { name: "mattrax-push.pem", data: certificate },
                enableMdmDisownFlag: true,
              },
            },
          }),
        },
      );

      const id = response?.data?.id;

      if (!id)
        return yield* Effect.fail(
          fail("invalid_response", "Apple did not return an MDM server id."),
        );

      const server: Mutable<AbmMdmServer> = { id };
      const serverName = text(response?.data?.attributes?.serverName);
      const status = text(response?.data?.attributes?.status);

      if (serverName) server.serverName = serverName;
      if (status) server.status = status;

      return server;
    }).pipe(Effect.provide(clientLayer));

  const assignDevices = (
    accessToken: string,
    input: { readonly mdmServerId: string; readonly deviceIds: ReadonlyArray<string> },
  ): Effect.Effect<AssignedDevicesActivity, AppleBusinessManagerError> =>
    Effect.gen(function* () {
      const base = baseUrl();

      const response = yield* request(
        AssignedDevicesResponseSchema,
        `${base}/orgDeviceActivities`,
        accessToken,
        {
          method: "POST",
          body: JSON.stringify({
            data: {
              type: "orgDeviceActivities",
              attributes: { activityType: "ASSIGN_DEVICES" },
              relationships: {
                mdmServer: { data: { type: "mdmServers", id: input.mdmServerId } },
                devices: {
                  data: input.deviceIds.map((id) => ({ type: "orgDevices", id })),
                },
              },
            },
          }),
        },
      );

      const result: AssignedDevicesActivity = {};

      if (response?.data?.id) result.activityId = response.data.id;
      if (response?.data?.attributes?.status) result.status = response.data.attributes.status;

      return result;
    }).pipe(Effect.provide(clientLayer));

  const getAssignedServerId = (
    accessToken: string,
    deviceId: string,
  ): Effect.Effect<string | null, AppleBusinessManagerError> =>
    Effect.gen(function* () {
      const base = baseUrl();

      const response = yield* request(
        AssignedServerResponseSchema,
        `${base}/orgDevices/${encodeURIComponent(deviceId)}/relationships/assignedServer`,
        accessToken,
      );

      return response?.data?.id ?? null;
    }).pipe(Effect.provide(clientLayer));

  const listMdmServerDeviceIds = (
    accessToken: string,
    mdmServerId: string,
  ): Effect.Effect<string[], AppleBusinessManagerError> =>
    Effect.gen(function* () {
      const base = baseUrl();

      const data = yield* paged(
        AbmResourceSchema,
        `${base}/mdmServers/${encodeURIComponent(mdmServerId)}/relationships/devices?limit=1000`,
        accessToken,
        base,
      );

      return data.map((item) => item.id);
    }).pipe(Effect.provide(clientLayer));

  const listApps = (accessToken: string): Effect.Effect<AbmApp[], AppleBusinessManagerError> =>
    Effect.gen(function* () {
      const base = baseUrl();

      const data = yield* paged(AbmResourceSchema, `${base}/apps?limit=1000`, accessToken, base);

      return data.map((item) => {
        const app: Mutable<AbmApp> = { id: item.id };
        const name = text(item.attributes?.name);
        const bundleId = text(item.attributes?.bundleId);
        const version = text(item.attributes?.version);

        if (name) app.name = name;
        if (bundleId) app.bundleId = bundleId;
        if (version) app.version = version;

        return app;
      });
    }).pipe(Effect.provide(clientLayer));

  return {
    exchangeAccessToken: (credential) =>
      exchangeAccessToken(credential).pipe(Effect.provide(clientLayer)),
    listOrgDevices,
    listMdmServers,
    createMdmServer,
    assignDevices,
    getAssignedServerId,
    listMdmServerDeviceIds,
    listApps,
  };
};
export const makeAbmClient = createAbmClient;

// ─── Persistence and tenant-scoped service operations ────────────

export type AppleBusinessManagerRow = typeof schema.appleBusinessManager.$inferSelect;

export type AbmDeviceRow = typeof schema.abmDevice.$inferSelect;

export const loadAppleBusinessManager = (
  db: EnterpriseDb,
  organizationId: string,
): Effect.Effect<AppleBusinessManagerRow | undefined, unknown> =>
  db.query.appleBusinessManager.findFirst({ where: { organizationId } });

const iso = (value: Date | null | undefined) =>
  value == null ? null : (value instanceof Date ? value : new Date(value)).toISOString();

const OS_BY_FAMILY = {
  Mac: "macOS",
  iPhone: "iOS",
  iPad: "iPadOS",
  iPod: "iOS",
  AppleTV: "tvOS",
  Watch: "watchOS",
  Vision: "visionOS",
} satisfies Record<string, string>;

const OS_FAMILY = new Map(Object.entries(OS_BY_FAMILY));

export type AppleBusinessManagerInfo = {
  readonly configured: boolean;
  readonly status: AppleBusinessManagerRow["status"];
  readonly credentialType: AppleBusinessManagerRow["credentialType"] | null;
  readonly appleOrgId: string | null;
  readonly appleOrgName: string | null;
  readonly tokenExpiresAt: string | null;
  readonly mdmServerId: string | null;
  readonly profileUuid: string | null;
  /** Stable ADE enrollment URL; registered as the ADE profile's `url`. */
  readonly enrollmentUrl: string | null;
  readonly lastSyncedAt: string | null;
  readonly lastError: string | null;
  readonly deviceCount: number;
  readonly assignedCount: number;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
};

export const appleBusinessManagerInfo = (
  db: EnterpriseDb,
  organizationId: string,
  origin?: string,
): Effect.Effect<AppleBusinessManagerInfo, AppleBusinessManagerError> =>
  Effect.gen(function* () {
    const row = yield* loadAppleBusinessManager(db, organizationId);

    const devices = yield* db
      .select()
      .from(schema.abmDevice)
      .where(eq(schema.abmDevice.organizationId, organizationId));

    return {
      configured: Boolean(row),
      status: row?.status ?? "unconfigured",
      credentialType: row?.credentialType ?? null,
      appleOrgId: row?.appleOrgId ?? null,
      appleOrgName: row?.appleOrgName ?? null,
      tokenExpiresAt: iso(row?.tokenExpiry ?? null),
      mdmServerId: row?.mdmServerId ?? null,
      profileUuid: row?.profileUuid ?? null,
      enrollmentUrl: origin ? `${origin.replace(/\/+$/, "")}/api/v1/abm/ade/enroll` : null,
      lastSyncedAt: iso(row?.lastSyncedAt ?? null),
      lastError: row?.lastError ?? null,
      deviceCount: devices.length,
      assignedCount: devices.filter(
        (device) => device.enrollmentState === "ASSIGNED" && device.profileStatus !== "removed",
      ).length,
      createdAt: iso(row?.createdAt ?? null),
      updatedAt: iso(row?.updatedAt ?? null),
    };
  }).pipe(mapAppleError);

const upsertAbmRow = (
  db: EnterpriseDb,
  organizationId: string,
  patch: Partial<typeof schema.appleBusinessManager.$inferInsert>,
  existing: AppleBusinessManagerRow | undefined,
) =>
  existing
    ? db
        .update(schema.appleBusinessManager)
        .set({ ...patch, updatedAt: now() })
        .where(eq(schema.appleBusinessManager.organizationId, organizationId))
    : db.insert(schema.appleBusinessManager).values({
        organizationId,
        credentialType: "abm_api",
        encryptedToken: "",
        status: "unconfigured",
        ...patch,
        createdAt: now(),
        updatedAt: now(),
      } satisfies typeof schema.appleBusinessManager.$inferInsert);

export const saveAppleBusinessManagerToken = (input: {
  readonly db: EnterpriseDb;
  readonly organizationId: string;
  readonly authSecret?: string;
  readonly upload: AbmTokenUpload;
  readonly config?: AppleApiConfig;
}): Effect.Effect<AppleBusinessManagerInfo, AppleBusinessManagerError> =>
  Effect.gen(function* () {
    if (!input.authSecret)
      return yield* Effect.fail(
        fail(
          "not_configured",
          "AUTH_SECRET is required to store Apple Business Manager credentials.",
        ),
      );

    const credential = yield* Effect.tryPromise({
      try: () => parseAbmTokenUpload(input.upload),
      catch: (cause) =>
        cause instanceof AppleBusinessManagerError
          ? cause
          : fail("invalid_token", describeAppleError(cause), cause),
    });

    const sealed = yield* Effect.tryPromise({
      try: () => sealAbmCredential(input.authSecret!, credential),
      catch: (cause) => fail("upstream", "Could not seal the Apple credential.", cause),
    });

    const existing = yield* loadAppleBusinessManager(input.db, input.organizationId);
    const profileUuid = existing?.profileUuid ?? crypto.randomUUID();

    const appleOrgId =
      credential.kind === "abm_api"
        ? (credential.orgId ?? existing?.appleOrgId ?? null)
        : credential.orgId;

    const appleOrgName =
      credential.kind === "abm_api"
        ? (credential.orgName ?? existing?.appleOrgName ?? null)
        : credential.orgName;

    const tokenExpiry = credential.expiresAt ?? null;

    yield* upsertAbmRow(
      input.db,
      input.organizationId,
      {
        credentialType: credential.kind,
        encryptedToken: sealed,
        tokenExpiry,
        appleOrgId,
        appleOrgName,
        profileUuid,
        status: "active",
        lastError: null,
      },
      existing,
    );

    // Validate the OAuth credential immediately. A stored but rejected key is
    // reported as an error state (and to the caller) rather than pretending
    // sync will work later.
    if (credential.kind === "abm_api") {
      const client = makeAbmClient(input.config, credential.scope);

      const validation = yield* client.exchangeAccessToken(credential).pipe(Effect.result);

      if (Predicate.isTagged(validation, "Failure")) {
        yield* upsertAbmRow(
          input.db,
          input.organizationId,
          { status: "error", lastError: describeAppleError(validation.failure.message) },
          existing ?? (yield* loadAppleBusinessManager(input.db, input.organizationId)),
        );

        return yield* Effect.fail(validation.failure);
      }
    }

    return yield* appleBusinessManagerInfo(input.db, input.organizationId);
  }).pipe(mapAppleError);

export const clearAppleBusinessManagerToken = (input: {
  readonly db: EnterpriseDb;
  readonly organizationId: string;
}): Effect.Effect<void, AppleBusinessManagerError> =>
  Effect.gen(function* () {
    yield* input.db
      .delete(schema.appleBusinessManager)
      .where(eq(schema.appleBusinessManager.organizationId, input.organizationId));
    yield* input.db
      .delete(schema.abmDevice)
      .where(eq(schema.abmDevice.organizationId, input.organizationId));
  }).pipe(mapAppleError);

const resolveDeviceIds = (
  db: EnterpriseDb,
  organizationId: string,
  serials: ReadonlyArray<string>,
): Effect.Effect<Array<{ serial: string; deviceId: string | null }>, unknown> =>
  Effect.gen(function* () {
    const rows = yield* db
      .select()
      .from(schema.device)
      .where(eq(schema.device.organizationId, organizationId));

    const bySerial = new Map(
      rows.flatMap((row) => (row.serial ? ([[row.serial, row.id]] as const) : [])),
    );

    return serials.map((serial) => ({ serial, deviceId: bySerial.get(serial) ?? null }));
  });

export const syncAppleBusinessManagerDevices = (input: {
  readonly db: EnterpriseDb;
  readonly organizationId: string;
  readonly authSecret?: string;
  readonly config?: AppleApiConfig;
}): Effect.Effect<
  {
    readonly devices: number;
    readonly assigned: number;
    readonly unassigned: number;
    readonly removed: number;
    readonly lastSyncedAt: string;
  },
  AppleBusinessManagerError
> =>
  Effect.gen(function* () {
    const row = yield* loadAppleBusinessManager(input.db, input.organizationId);

    if (!row) return yield* Effect.fail(notConfigured());

    if (!input.authSecret)
      return yield* Effect.fail(
        fail(
          "not_configured",
          "AUTH_SECRET is required to decrypt the Apple Business Manager credential.",
        ),
      );

    const credential = yield* Effect.tryPromise({
      try: () => openAbmCredential(input.authSecret!, row.encryptedToken),
      catch: (cause) =>
        cause instanceof AppleBusinessManagerError
          ? cause
          : fail("invalid_token", describeAppleError(cause), cause),
    });

    if (credential.kind === "legacy_dep")
      return yield* Effect.fail(
        fail(
          "not_configured",
          "This tenant uses a legacy DEP .p7m server token. Mattrax syncs devices through the Apple Business API; create an API account in Apple Business Manager and upload its private key with the Client ID and Key ID.",
        ),
      );

    if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now())
      return yield* Effect.fail(
        fail("expired", "The Apple Business Manager credential has expired."),
      );

    const client = makeAbmClient(input.config, credential.scope);

    const token = yield* client.exchangeAccessToken(credential);

    const remote = yield* client.listOrgDevices(token.accessToken);

    const local = yield* input.db
      .select()
      .from(schema.abmDevice)
      .where(eq(schema.abmDevice.organizationId, input.organizationId));

    const localBySerial = new Map(local.map((device) => [device.serial, device]));
    const remoteSerials = new Set(remote.map((device) => device.serialNumber));

    const resolved = yield* resolveDeviceIds(
      input.db,
      input.organizationId,
      remote.map((device) => device.serialNumber),
    );

    const deviceIdBySerial = new Map(
      resolved.flatMap((entry) => (entry.deviceId ? [[entry.serial, entry.deviceId]] : [])),
    );

    let assigned = 0;
    let unassigned = 0;

    for (const device of remote) {
      const existing = localBySerial.get(device.serialNumber);
      const isAssigned = device.status === "ASSIGNED";

      if (isAssigned) assigned++;
      else unassigned++;

      const patch = {
        abmDeviceId: device.id,
        model: device.model ?? null,
        deviceFamily: device.productFamily ?? null,
        os: device.productFamily ? (OS_FAMILY.get(device.productFamily) ?? null) : null,
        profileStatus: isAssigned ? ("assigned" as const) : ("unassigned" as const),
        enrollmentState: isAssigned ? ("ASSIGNED" as const) : ("UNASSIGNED" as const),
        assignedProfileUuid: isAssigned ? (existing?.assignedProfileUuid ?? row.profileUuid) : null,
        assignedServerId: isAssigned ? (existing?.assignedServerId ?? null) : null,
        deviceId: deviceIdBySerial.get(device.serialNumber) ?? existing?.deviceId ?? null,
        lastSeenAt: parseAppleDate(device.updatedDateTime) ?? now(),
        raw: device.raw,
        updatedAt: now(),
      };

      if (existing) {
        yield* input.db
          .update(schema.abmDevice)
          .set(patch)
          .where(
            and(
              eq(schema.abmDevice.organizationId, input.organizationId),
              eq(schema.abmDevice.serial, device.serialNumber),
            ),
          );
      } else {
        yield* input.db.insert(schema.abmDevice).values({
          organizationId: input.organizationId,
          serial: device.serialNumber,
          createdAt: now(),
          ...patch,
        });
      }
    }

    let removed = 0;

    for (const device of local) {
      if (remoteSerials.has(device.serial) || device.enrollmentState === "REMOVED") continue;
      removed++;
      yield* input.db
        .update(schema.abmDevice)
        .set({
          profileStatus: "removed",
          enrollmentState: "REMOVED",
          assignedProfileUuid: null,
          updatedAt: now(),
        })
        .where(
          and(
            eq(schema.abmDevice.organizationId, input.organizationId),
            eq(schema.abmDevice.serial, device.serial),
          ),
        );
    }

    const result = { devices: remote.length, assigned, unassigned, removed };
    const syncedAt = now();
    yield* input.db
      .update(schema.appleBusinessManager)
      .set({ status: "active", lastSyncedAt: syncedAt, lastError: null, updatedAt: syncedAt })
      .where(eq(schema.appleBusinessManager.organizationId, input.organizationId));

    return { ...result, lastSyncedAt: syncedAt.toISOString() };
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        yield* Effect.gen(function* () {
          yield* input.db
            .update(schema.appleBusinessManager)
            .set({
              status: "error",
              lastError: describeAppleError(
                error instanceof AppleBusinessManagerError ? error.message : error,
              ),
              updatedAt: now(),
            })
            .where(eq(schema.appleBusinessManager.organizationId, input.organizationId));
        }).pipe(Effect.catch(() => Effect.void));

        return yield* Effect.fail(error);
      }),
    ),
    mapAppleError,
  );

const ensureMdmServer = (
  client: AbmClient,
  accessToken: string,
  input: {
    readonly existingId: string | null;
    readonly serverName: string;
    readonly certificatePem?: string;
  },
): Effect.Effect<string, AppleBusinessManagerError> =>
  Effect.gen(function* () {
    if (input.existingId) return input.existingId;

    const servers = yield* client.listMdmServers(accessToken);
    const match = servers.find((server) => server.serverName === input.serverName);

    if (match) return match.id;

    if (!input.certificatePem)
      return yield* Effect.fail(
        fail(
          "not_configured",
          "An Apple push certificate is required to create the ABM device management service. Upload APNs first.",
        ),
      );

    const created = yield* client.createMdmServer(accessToken, {
      serverName: input.serverName,
      certificatePem: input.certificatePem,
    });

    return created.id;
  });

export const assignAppleBusinessManagerDevice = (input: {
  readonly db: EnterpriseDb;
  readonly organizationId: string;
  readonly serial: string;
  readonly authSecret?: string;
  readonly config?: AppleApiConfig;
  readonly serverName: string;
  readonly certificatePem?: string;
}): Effect.Effect<
  { readonly serial: string; readonly mdmServerId: string; readonly activityId?: string },
  AppleBusinessManagerError
> =>
  Effect.gen(function* () {
    const row = yield* loadAppleBusinessManager(input.db, input.organizationId);

    if (!row) return yield* Effect.fail(notConfigured());

    if (!input.authSecret)
      return yield* Effect.fail(
        fail(
          "not_configured",
          "AUTH_SECRET is required to decrypt the Apple Business Manager credential.",
        ),
      );

    const credential = yield* Effect.tryPromise({
      try: () => openAbmCredential(input.authSecret!, row.encryptedToken),
      catch: (cause) =>
        cause instanceof AppleBusinessManagerError
          ? cause
          : fail("invalid_token", describeAppleError(cause), cause),
    });

    if (credential.kind === "legacy_dep")
      return yield* Effect.fail(
        fail(
          "not_configured",
          "Legacy DEP tokens cannot assign devices through the Apple Business API. Create an API account and re-upload its key.",
        ),
      );

    const device = yield* input.db.query.abmDevice.findFirst({
      where: { organizationId: input.organizationId, serial: input.serial },
    });

    if (!device)
      return yield* Effect.fail(
        fail(
          "not_found",
          "This serial is not in the tenant's ABM inventory. Run an ABM sync first.",
        ),
      );

    if (device.enrollmentState === "REMOVED")
      return yield* Effect.fail(
        fail("conflict", "Apple has removed this device from the organization."),
      );

    const client = makeAbmClient(input.config, credential.scope);

    const result = yield* Effect.gen(function* () {
      const token = yield* client.exchangeAccessToken(credential);

      const serverInput: EnsureMdmServerInput = {
        existingId: row.mdmServerId,
        serverName: input.serverName,
      };

      if (input.certificatePem) serverInput.certificatePem = input.certificatePem;

      const mdmServerId = yield* ensureMdmServer(client, token.accessToken, serverInput);

      const activity = yield* client.assignDevices(token.accessToken, {
        mdmServerId,
        deviceIds: [device.abmDeviceId ?? device.serial],
      });

      return { mdmServerId, activity };
    });

    const profileUuid = row.profileUuid ?? crypto.randomUUID();
    yield* input.db
      .update(schema.appleBusinessManager)
      .set({ mdmServerId: result.mdmServerId, profileUuid, updatedAt: now() })
      .where(eq(schema.appleBusinessManager.organizationId, input.organizationId));
    yield* input.db
      .update(schema.abmDevice)
      .set({
        enrollmentState: "ASSIGNED",
        profileStatus: "assigned",
        assignedServerId: result.mdmServerId,
        assignedProfileUuid: profileUuid,
        updatedAt: now(),
      })
      .where(
        and(
          eq(schema.abmDevice.organizationId, input.organizationId),
          eq(schema.abmDevice.serial, input.serial),
        ),
      );

    const assignment: AssignedAppleDevice = {
      serial: input.serial,
      mdmServerId: result.mdmServerId,
    };

    if (result.activity.activityId) assignment.activityId = result.activity.activityId;

    return assignment;
  }).pipe(mapAppleError);

// ─── Signed ADE profile URLs ─────────────────────────────────────

export const ADE_PROFILE_PURPOSE = "ade-profile";

export type AdeProfileToken = {
  readonly token: string;
  readonly organizationId: string;
  readonly serial: string;
  readonly profileUuid: string;
  readonly expiresAt: Date;
};

export const createAdeProfileToken = (input: {
  readonly authSecret: string;
  readonly organizationId: string;
  readonly serial: string;
  readonly profileUuid: string;
  readonly ttlSeconds?: number;
}): Effect.Effect<AdeProfileToken, AppleBusinessManagerError> =>
  Effect.gen(function* () {
    const expiresAt = new Date(Date.now() + (input.ttlSeconds ?? 7 * 24 * 60 * 60) * 1000);

    const token = yield* signToken(input.authSecret, {
      sub: input.organizationId,
      email: "ade-profile",
      exp: expiresAt.getTime(),
      purpose: ADE_PROFILE_PURPOSE,
      tenantId: input.organizationId,
      serial: input.serial,
      profileUuid: input.profileUuid,
    }).pipe(
      Effect.catchDefect((cause) =>
        Effect.fail(fail("upstream", "Could not sign the ADE profile URL.", cause)),
      ),
    );

    return {
      token,
      organizationId: input.organizationId,
      serial: input.serial,
      profileUuid: input.profileUuid,
      expiresAt,
    };
  });

export const readAdeProfileToken = (input: {
  readonly authSecret: string;
  readonly token: string;
}): Effect.Effect<AdeProfileToken, AppleBusinessManagerError> =>
  Effect.gen(function* () {
    const payload = yield* verifyToken(input.authSecret, input.token).pipe(
      Effect.catchDefect((cause) =>
        Effect.fail(
          fail("invalid_token", "The ADE profile link is invalid or has expired.", cause),
        ),
      ),
    );

    const organizationId = payload.tenantId ?? payload.sub;
    const serial = payload.serial;
    const profileUuid = payload.profileUuid;

    if (payload.purpose !== ADE_PROFILE_PURPOSE || !organizationId || !serial || !profileUuid)
      return yield* Effect.fail(
        fail("invalid_token", "The ADE profile link is invalid or has expired."),
      );

    if (payload.exp <= Date.now())
      return yield* Effect.fail(fail("expired", "The ADE profile link has expired."));

    return {
      token: input.token,
      organizationId,
      serial,
      profileUuid,
      expiresAt: new Date(payload.exp),
    };
  });

import { Effect } from "effect";
import { Crypto, CryptoError } from "@mattrax/crypto";

/**
 * HMAC-signed URLs for DDM legacy profiles and certificate assets.
 *
 * Declarative Management fetches `ProfileURL` and asset `DataURL` values
 * directly; those requests do not carry the MDM check-in identity certificate.
 * Signing the URL keeps the endpoint stateless while binding the content to the
 * tenant/policy/device that was issued the declaration.
 *
 * Profile tokens bind the policy, kind and device token. Asset tokens bind the
 * same values plus an expiry, because an asset URL is handed to whatever fetches
 * the declaration and may end up in logs or screenshots. A short expiry bounds
 * that exposure; the declaration's `ServerToken` rotates on the same schedule so
 * a device receives a fresh link on its next sync without re-enrolling.
 *
 * The management backend additionally resolves the device token in the asset
 * token and rejects it when the device is no longer enrolled, which makes a
 * leaked link revocable without server-side token storage.
 */

const encoder = new TextEncoder();

/**
 * Maximum lifetime of an asset URL. The declaration is regenerated twice per
 * window, so every link a device receives is valid for 30–60 minutes.
 */
export const APPLE_ASSET_TOKEN_TTL_SECONDS = 60 * 60;

/** How often an asset declaration's `ServerToken` (and therefore URL) changes. */
export const APPLE_ASSET_TOKEN_REFRESH_SECONDS = 30 * 60;

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const fromBase64Url = (value: string): string | null => {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;

  const padded = value.replaceAll("-", "+").replaceAll("_", "/");

  try {
    return atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), "="));
  } catch {
    return null;
  }
};

const sign = async (secret: string, message: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));

  return toBase64Url(new Uint8Array(signature));
};

const timingSafeEqual = (left: string, right: string): boolean => {
  const a = encoder.encode(left);
  const b = encoder.encode(right);

  if (a.length !== b.length) return false;
  let difference = 0;

  for (let index = 0; index < a.length; index++) difference |= a[index] ^ b[index];

  return difference === 0;
};

const verify = async (secret: string, message: string, token: string): Promise<boolean> =>
  timingSafeEqual(await sign(secret, message), token);

const signEffect = (secret: string, message: string): Effect.Effect<string, CryptoError> =>
  Crypto.hmacSha256Hex(secret, message).pipe(
    Effect.map((hex) => {
      const bytes = Uint8Array.from(hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));

      return toBase64Url(bytes);
    }),
  );

const profileMessage = (context: AppleProfileTokenContext): string =>
  [
    "profile",
    "v2",
    context.policyId,
    context.kind,
    context.deviceToken,
    context.deviceId,
    String(context.expiresAt),
  ].join("\u0000");

const assetMessage = (context: AppleAssetTokenContext): string =>
  ["asset", "v2", context.policyId, context.kind, context.deviceId, String(context.expiresAt)].join(
    "\u0000",
  );

export type AppleProfileTokenContext = {
  readonly policyId: string;
  readonly kind: string;
  readonly deviceToken: string;
  /** Stable internal device id the profile link is bound to. */
  readonly deviceId: string;
  /** Unix seconds after which the URL is rejected. */
  readonly expiresAt: number;
};

export type AppleAssetTokenContext = {
  readonly policyId: string;
  readonly kind: string;
  /** Stable internal device id the link is bound to. */
  readonly deviceId: string;
  /** Unix seconds after which the URL is rejected. */
  readonly expiresAt: number;
};

/** A verified asset token. Every field is covered by the HMAC. */
export type VerifiedAppleAssetToken = AppleAssetTokenContext;

/**
 * The current asset declaration refresh bucket. `ServerToken` changes when this
 * value changes, which is how a device learns it must fetch a fresh `DataURL`
 * before the previous one expires.
 */
export const appleAssetTokenEpoch = (now: number = Date.now()): number =>
  Math.floor(now / 1000 / APPLE_ASSET_TOKEN_REFRESH_SECONDS);

/**
 * Expiry for a token minted in the current refresh bucket. Tokens are valid for
 * the remainder of the current bucket plus the full next one, so the shortest
 * possible lifetime is {@link APPLE_ASSET_TOKEN_REFRESH_SECONDS}.
 */
export const appleAssetTokenExpiresAt = (now: number = Date.now()): number =>
  (appleAssetTokenEpoch(now) + 2) * APPLE_ASSET_TOKEN_REFRESH_SECONDS;

export const signAppleProfileToken = (
  secret: string,
  context: AppleProfileTokenContext,
): Promise<string> => sign(secret, profileMessage(context));

export const verifyAppleProfileToken = (
  secret: string,
  token: string,
  context: AppleProfileTokenContext,
): Promise<boolean> => verify(secret, profileMessage(context), token);

export const verifyAppleProfileTokenEffect = (
  secret: string,
  token: string,
  context: AppleProfileTokenContext,
): Effect.Effect<boolean, CryptoError> =>
  signEffect(secret, profileMessage(context)).pipe(
    Effect.map((expected) => timingSafeEqual(expected, token)),
  );

/**
 * Sign an expiring, device-bound asset URL token.
 *
 * The payload is `<expiresAt>.<deviceId>` in base64url, followed by a base64url
 * HMAC over the policy, kind, bound device id, version and expiry.
 */
export const signAppleAssetToken = (
  secret: string,
  context: AppleAssetTokenContext,
): Promise<string> => {
  if (!Number.isSafeInteger(context.expiresAt) || context.expiresAt <= 0) {
    throw new Error("Asset token expiry must be a positive Unix timestamp");
  }

  const payload = toBase64Url(encoder.encode(`${context.expiresAt}.${context.deviceId}`));

  return sign(secret, assetMessage(context)).then((signature) => `${payload}.${signature}`);
};

export const signAppleAssetTokenEffect = (
  secret: string,
  context: AppleAssetTokenContext,
): Effect.Effect<string, CryptoError> => {
  if (!Number.isSafeInteger(context.expiresAt) || context.expiresAt <= 0)
    return Effect.fail(
      new CryptoError({ message: "Asset token expiry must be a positive Unix timestamp" }),
    );
  const payload = toBase64Url(encoder.encode(`${context.expiresAt}.${context.deviceId}`));

  return signEffect(secret, assetMessage(context)).pipe(
    Effect.map((signature) => `${payload}.${signature}`),
  );
};

/**
 * Verify an asset token against the declaration it was issued for.
 *
 * Returns the bound device id and expiry, or `null` when the token is
 * malformed, expired, tampered with, or was issued for a different policy or
 * kind. Callers must still confirm the device is enrolled for the owning tenant.
 */
export const verifyAppleAssetToken = async (
  secret: string,
  token: string,
  expected: Pick<AppleAssetTokenContext, "policyId" | "kind">,
  now: number = Date.now(),
): Promise<VerifiedAppleAssetToken | null> => {
  const separator = token.indexOf(".");
  const encodedPayload = separator === -1 ? token : token.slice(0, separator);
  const signature = separator === -1 ? "" : token.slice(separator + 1);

  if (encodedPayload.length === 0 || signature.length === 0) return null;

  if (signature.includes(".")) return null;

  const payload = fromBase64Url(encodedPayload);

  if (payload === null) return null;

  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{8,128})$/.exec(payload);

  if (!match) return null;

  const expiresAt = Number(match[1]);

  if (!Number.isSafeInteger(expiresAt) || expiresAt * 1000 <= now) return null;

  const context: AppleAssetTokenContext = {
    policyId: expected.policyId,
    kind: expected.kind,
    deviceId: match[2],
    expiresAt,
  };

  return (await verify(secret, assetMessage(context), signature)) ? context : null;
};

export const verifyAppleAssetTokenEffect = (
  secret: string,
  token: string,
  expected: Pick<AppleAssetTokenContext, "policyId" | "kind">,
  now: number = Date.now(),
): Effect.Effect<VerifiedAppleAssetToken | null, CryptoError> => {
  const separator = token.indexOf(".");
  const encodedPayload = separator === -1 ? token : token.slice(0, separator);
  const signature = separator === -1 ? "" : token.slice(separator + 1);

  if (encodedPayload.length === 0 || signature.length === 0 || signature.includes("."))
    return Effect.succeed(null);
  const payload = fromBase64Url(encodedPayload);

  if (payload === null) return Effect.succeed(null);
  const match = /^(\d{1,12})\.([A-Za-z0-9_-]{8,128})$/.exec(payload);

  if (!match) return Effect.succeed(null);
  const expiresAt = Number(match[1]);

  if (!Number.isSafeInteger(expiresAt) || expiresAt * 1000 <= now) return Effect.succeed(null);
  const context: AppleAssetTokenContext = {
    policyId: expected.policyId,
    kind: expected.kind,
    deviceId: match[2],
    expiresAt,
  };

  return signEffect(secret, assetMessage(context)).pipe(
    Effect.map((expectedSignature) =>
      timingSafeEqual(expectedSignature, signature) ? context : null,
    ),
  );
};

/**
 * HMAC-signed URLs for DDM legacy profiles and certificate assets.
 *
 * Declarative Management fetches `ProfileURL` and asset `DataURL` values
 * directly; those requests do not carry the MDM check-in identity certificate.
 * Signing the URL keeps the endpoint stateless while binding the content to the
 * tenant/policy/device that was issued the declaration.
 */

const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
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

  for (let index = 0; index < a.length; index++) difference |= a[index]! ^ b[index]!;

  return difference === 0;
};

const verify = async (secret: string, message: string, token: string): Promise<boolean> =>
  timingSafeEqual(await sign(secret, message), token);

const profileMessage = (policyId: string, kind: string, deviceToken: string): string =>
  ["profile", policyId, kind, deviceToken].join("\u0000");

const assetMessage = (policyId: string, kind: string): string =>
  ["asset", policyId, kind].join("\u0000");

export type AppleProfileTokenContext = {
  readonly policyId: string;
  readonly kind: string;
  readonly deviceToken: string;
};

export const signAppleProfileToken = (
  secret: string,
  context: AppleProfileTokenContext,
): Promise<string> =>
  sign(secret, profileMessage(context.policyId, context.kind, context.deviceToken));

export const verifyAppleProfileToken = (
  secret: string,
  token: string,
  context: AppleProfileTokenContext,
): Promise<boolean> =>
  verify(secret, profileMessage(context.policyId, context.kind, context.deviceToken), token);

export const signAppleAssetToken = (
  secret: string,
  policyId: string,
  kind: string,
): Promise<string> => sign(secret, assetMessage(policyId, kind));

export const verifyAppleAssetToken = (
  secret: string,
  token: string,
  policyId: string,
  kind: string,
): Promise<boolean> => verify(secret, assetMessage(policyId, kind), token);

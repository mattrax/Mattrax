/**
 * Stateless per-enrollment SCEP challenge passwords.
 *
 * A challenge is derived from the enrollment id and the application secret rather
 * than stored in the database, so resetting an enrollment (which allocates a new
 * id) automatically invalidates every previously issued challenge.
 *
 * Encodings accepted by {@link verifyScepChallenge}:
 *   - `<enrollmentId>.<signature>`
 *   - `<enrollmentId>.<expiresAtEpochSeconds>.<signature>` (signed payload includes
 *     the expiry, so a stale challenge fails closed)
 */

const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const hmac = async (secret: string, message: string): Promise<string> => {
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

export type ScepChallengeVerification = {
  readonly enrollmentId: string;
  /** Unix epoch seconds when the challenge expires, if it carries an expiry. */
  readonly expiresAt?: number;
};

export type ScepChallengeOptions = {
  /** Optional lifetime. When omitted the challenge does not expire. */
  readonly ttlSeconds?: number;
  /** Injectable clock for tests. */
  readonly now?: number;
};

export const createScepChallenge = async (
  enrollmentId: string,
  authSecret: string,
  options: ScepChallengeOptions = {},
): Promise<string> => {
  if (!enrollmentId) throw new Error("Enrollment id is required");

  if (options.ttlSeconds === undefined) {
    return `${enrollmentId}.${await hmac(authSecret, enrollmentId)}`;
  }

  const expiresAt = Math.floor((options.now ?? Date.now()) / 1000) + options.ttlSeconds;

  return `${enrollmentId}.${expiresAt}.${await hmac(authSecret, `${enrollmentId}.${expiresAt}`)}`;
};

export const verifyScepChallenge = async (
  challenge: string | undefined,
  authSecret: string,
  options: { readonly now?: number } = {},
): Promise<ScepChallengeVerification | null> => {
  if (!challenge) return null;
  const parts = challenge.split(".");
  const [enrollmentId, middle, signature] = parts;

  if (!enrollmentId) return null;

  if (parts.length === 2) {
    const expected = await hmac(authSecret, enrollmentId);

    return timingSafeEqual(expected, middle ?? "") ? { enrollmentId } : null;
  }

  if (parts.length === 3) {
    const expiresAt = Number(middle);

    if (!Number.isFinite(expiresAt)) return null;
    const expected = await hmac(authSecret, `${enrollmentId}.${middle}`);

    if (!timingSafeEqual(expected, signature ?? "")) return null;
    const nowSeconds = Math.floor((options.now ?? Date.now()) / 1000);

    if (nowSeconds > expiresAt) return null;

    return { enrollmentId, expiresAt };
  }

  return null;
};
